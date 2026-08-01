import { describe, it, expect } from 'vitest';
import {
  analyzeThreads,
  generateSessionTitle,
  isTitleGenCall,
  MAX_TITLE_LEN,
} from './thread-analyzer.js';

function msg(role: string, content: string): Record<string, unknown> {
  return { role, content };
}

function call(...messages: Array<Record<string, unknown>>) {
  return { messages, path: '/v1/chat/completions', tools: [] };
}

describe('thread-analyzer', () => {
  describe('analyzeThreads', () => {
    it('returns empty analysis for no completions', () => {
      const analysis = analyzeThreads([]);
      expect(analysis.threads).toEqual([]);
      expect(analysis.columnThread).toEqual([]);
      expect(analysis.primaryThread).toBe(-1);
    });

    it('classifies a single call as primary', () => {
      const analysis = analyzeThreads([call(msg('user', 'do the thing'))]);
      expect(analysis.threads).toHaveLength(1);
      expect(analysis.threads[0].kind).toBe('primary');
      expect(analysis.columnThread).toEqual([0]);
      expect(analysis.primaryThread).toBe(0);
    });

    it('groups a cumulatively growing thread into one primary thread', () => {
      const completions = [
        call(msg('user', 'task')),
        call(msg('user', 'task'), msg('assistant', 'thinking')),
        call(msg('user', 'task'), msg('assistant', 'thinking'), msg('user', 'more input')),
      ];
      const analysis = analyzeThreads(completions);
      expect(new Set(analysis.columnThread).size).toBe(1);
      expect(analysis.primaryThread).toBe(analysis.columnThread[0]);
      expect(analysis.threads[0].callIndices).toEqual([0, 1, 2]);
    });

    it('flags a call with no shared content as a new subagent thread', () => {
      const completions = [
        call(msg('user', 'task')),
        call(msg('user', 'task'), msg('assistant', 'progress')),
        call(msg('user', '## Criteria - verify this isolated thing')),
      ];
      const analysis = analyzeThreads(completions);
      expect(analysis.columnThread[2]).not.toBe(analysis.columnThread[1]);
      const sub = analysis.threads.find(t => t.kind === 'subagent');
      expect(sub).toBeDefined();
      expect(sub!.callIndices).toEqual([2]);
    });

    it('merges a context restart back into the primary thread', () => {
      const mainSeed = [msg('user', 'task'), msg('assistant', 'step')];
      const main2 = [...mainSeed, msg('user', 'go deeper')];
      const subA = [msg('user', '## Criteria - verify x')];
      const subB = [
        msg('user', '## Modified Files (none) review the git diff'),
        msg('assistant', 'scanning'),
      ];
      const mainRestart = [...mainSeed, msg('user', 'resume the task')];
      const completions = [call(...mainSeed), call(...main2), call(...subA), call(...subB), call(...mainRestart)];
      const analysis = analyzeThreads(completions);

      const mainThread = analysis.columnThread[0];
      expect(analysis.columnThread[4]).toBe(mainThread);
      expect(analysis.columnThread[1]).toBe(mainThread);
      expect(analysis.columnThread[2]).not.toBe(mainThread);
      expect(analysis.columnThread[3]).not.toBe(mainThread);
      const subs = analysis.threads.filter(t => t.kind === 'subagent');
      expect(subs).toHaveLength(2);
    });

    it('isolates repeated identical title-gen calls as separate singleton threads', () => {
      const titleBody = msg('user', 'Generate a concise, descriptive session name (max 50 characters)');
      const completions = [
        call(titleBody),
        call(msg('user', 'task'), msg('assistant', 'step')),
        call(titleBody),
      ];
      const analysis = analyzeThreads(completions);
      const titles = analysis.threads.filter(t => t.kind === 'title');
      expect(titles).toHaveLength(2);
      expect(analysis.columnThread[0]).not.toBe(analysis.columnThread[2]);
    });

    it('sets aside an opencode-style title call and keeps the conversation as primary', () => {
      const titleCall = {
        messages: [
          msg('system', 'You are a title generator. You output ONLY a thread title.'),
          msg('user', 'Generate a title for this conversation: '),
          msg('user', [] as any),
        ],
        tools: [],
      };
      const conv1 = {
        messages: [msg('system', 'You are opencode, an interactive CLI tool.'), msg('user', [] as any)],
        tools: [{}],
      };
      const conv2 = {
        messages: [
          msg('system', 'You are opencode, an interactive CLI tool.'),
          msg('user', 'hi'),
          msg('assistant', 'Hi! What would you like help with?'),
          msg('user', [] as any),
        ],
        tools: [{}],
      };
      const conv3 = {
        messages: [
          msg('system', 'You are opencode, an interactive CLI tool.'),
          msg('user', 'hi'),
          msg('assistant', 'Hi! What would you like help with?'),
          msg('user', 'nothing much'),
          msg('assistant', 'Gotcha.'),
          msg('user', [] as any),
        ],
        tools: [{}],
      };
      const completions = [titleCall, conv1, conv2, conv3];
      const analysis = analyzeThreads(completions);
      expect(analysis.threads.find(t => t.kind === 'title')!.callIndices).toEqual([0]);
      expect(analysis.columnThread[0]).not.toBe(analysis.columnThread[1]);
      const primary = analysis.threads.find(t => t.kind === 'primary')!;
      expect(primary.callIndices).toEqual([1, 2, 3]);
      expect(generateSessionTitle(completions, analysis)).toBe('nothing much');
    });

    it('attaches system-only seed calls to the following thread', () => {
      const seed = call(msg('system', 'You are an agent'));
      const main = call(msg('system', 'You are an agent'), msg('user', 'task'));
      const analysis = analyzeThreads([seed, main]);
      expect(analysis.columnThread[0]).toBe(analysis.columnThread[1]);
      expect(analysis.primaryThread).toBe(analysis.columnThread[1]);
    });

    it('does not attach a seed call onto a title-gen thread', () => {
      const seed = call(msg('system', 'You are an agent'));
      const title = call(msg('user', 'Generate a concise, descriptive session name (max 50 characters)'));
      const main = call(msg('system', 'You are an agent'), msg('user', 'real task'));
      const analysis = analyzeThreads([seed, title, main]);
      const mainT = analysis.columnThread[2];
      expect(analysis.columnThread[0]).toBe(mainT);
      expect(analysis.columnThread[1]).not.toBe(mainT);
      expect(analysis.threads.filter(t => t.kind === 'title')).toHaveLength(1);
    });

    it('separates interleaved parallel subagent threads', () => {
      const completions = [
        call(msg('user', 'main task')),
        call(msg('user', '## sub agent alpha prompt')),
        call(msg('user', 'main task'), msg('assistant', 'main progress')),
        call(msg('user', '## sub agent alpha prompt'), msg('assistant', 'alpha progress')),
        call(msg('user', '## sub agent beta prompt')),
      ];
      const analysis = analyzeThreads(completions);
      const mainT = analysis.columnThread[0];
      const alphaT = analysis.columnThread[1];
      const betaT = analysis.columnThread[4];
      expect(analysis.columnThread[2]).toBe(mainT);
      expect(analysis.columnThread[3]).toBe(alphaT);
      expect(betaT).not.toBe(mainT);
      expect(betaT).not.toBe(alphaT);
      expect(analysis.primaryThread).toBe(mainT);
    });

    it('classifies the largest-content thread as primary even with many small threads', () => {
      const bigMain = [
        call(msg('user', 'long task a'), msg('assistant', 'resp a')),
        call(msg('user', 'long task a'), msg('assistant', 'resp a'), msg('user', 'long task b')),
      ];
      const subAgents = Array.from({ length: 3 }, (_, i) =>
        call(msg('user', `## sub review ${i}`))
      );
      const analysis = analyzeThreads([...bigMain, ...subAgents]);
      expect(analysis.primaryThread).toBe(analysis.columnThread[0]);
    });
  });

  describe('isTitleGenCall', () => {
    it('detects OpenFox-style title generation calls', () => {
      const body = call(msg('user', 'Generate a concise, descriptive session name (max 50 characters) based on the user\'s message'));
      expect(isTitleGenCall(body)).toBe(true);
    });

    it('detects opencode-style title generation calls with a title-generator system prompt', () => {
      const body = {
        messages: [
          msg('system', 'You are a title generator. You output ONLY a thread title. Nothing else.'),
          msg('user', 'Generate a title for this conversation: '),
          msg('user', [] as any),
        ],
        tools: [],
      };
      expect(isTitleGenCall(body)).toBe(true);
    });

    it('detects a bare "generate a title for this conversation" instruction', () => {
      expect(isTitleGenCall(call(msg('user', 'Generate a title for this conversation: ')))).toBe(true);
    });

    it('does not flag the opencode main conversation', () => {
      const body = {
        messages: [
          msg('system', 'You are opencode, an interactive CLI tool that helps users write and debug code.'),
          msg('user', 'hi'),
          msg('user', [] as any),
        ],
        tools: [{ name: 'shell' }],
      };
      expect(isTitleGenCall(body)).toBe(false);
    });

    it('does not flag an anchored summarization call', () => {
      const body = {
        messages: [
          msg('system', 'You are an anchored context summarization assistant for coding sessions.'),
          msg('user', 'Create a new anchored summary from the conversation history.'),
        ],
        tools: [],
      };
      expect(isTitleGenCall(body)).toBe(false);
    });

    it('rejects normal calls', () => {
      expect(isTitleGenCall(call(msg('user', 'fix the bug')))).toBe(false);
      expect(isTitleGenCall(call(msg('system', 'You are X'), msg('user', 'hi')))).toBe(false);
    });
  });

  describe('generateSessionTitle', () => {
    it('derives the title from the first substantive user message of the primary thread', () => {
      const completions = [
        call(msg('user', 'How do I set up React with Vite?')),
        call(msg('user', 'How do I set up React with Vite?'), msg('assistant', 'steps...')),
      ];
      expect(generateSessionTitle(completions)).toBe('How do I set up React with Vite?');
    });

    it('skips system-reminder and markdown boilerplate lines', () => {
      const completions = [
        call(
          msg('user', '<system-reminder>\n# Plan Mode\nCRITICAL: read only\n</system-reminder>\n\nImplement the login page now.')
        ),
      ];
      expect(generateSessionTitle(completions)).toBe('Implement the login page now.');
    });

    it('extracts the title from array content, ignoring inline harness reminders', () => {
      const completions = [
        {
          messages: [
            msg('system', 'You are opencode, an interactive CLI tool.'),
            {
              role: 'user',
              content: [
                { type: 'text', text: 'nothing much' },
                { type: 'text', text: '<system-reminder>\n# Plan Mode\nCRITICAL: read only\n</system-reminder>' },
              ],
            },
          ],
          tools: [{}],
        },
      ];
      expect(generateSessionTitle(completions)).toBe('nothing much');
    });

    it('truncates long titles and appends an ellipsis', () => {
      const long = 'a'.repeat(200);
      const title = generateSessionTitle([call(msg('user', long))]);
      expect(title.length).toBeLessThanOrEqual(MAX_TITLE_LEN + 1);
      expect(title.endsWith('…')).toBe(true);
    });

    it('falls back when there is no usable user content', () => {
      expect(generateSessionTitle([call(msg('system', 'You are an agent'))])).toBeTruthy();
    });
  });
});
