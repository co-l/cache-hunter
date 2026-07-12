import { describe, it, expect } from 'vitest';
import {
  parseRequestBody,
  extractTokensFromResponse,
  extractSSETokenUsage,
} from './parse-api.js';

describe('parseRequestBody', () => {
  it('parses chat completions format', () => {
    const body = JSON.stringify({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: 'You are a bot.' },
        { role: 'user', content: 'Hello' },
      ],
      tools: [{ name: 'test_tool' }],
    });
    const result = parseRequestBody(body, '/v1/chat/completions');
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toEqual({ role: 'system', content: 'You are a bot.' });
    expect(result.messages[1]).toEqual({ role: 'user', content: 'Hello' });
    expect(result.tools).toEqual([{ name: 'test_tool' }]);
  });

  it('parses responses API format', () => {
    const body = JSON.stringify({
      model: 'deepseek-v4-flash',
      input: [
        { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'System instructions' }] },
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hello!' }] },
      ],
      tools: [{ name: 'exec_command' }],
    });
    const result = parseRequestBody(body, '/v1/responses');
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toEqual({ role: 'developer', content: 'System instructions' });
    expect(result.messages[1]).toEqual({ role: 'user', content: 'Hello!' });
    expect(result.tools).toEqual([{ name: 'exec_command' }]);
  });

  it('handles responses input with non-message items', () => {
    const body = JSON.stringify({
      model: 'deepseek-v4-flash',
      input: [
        { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hi' }] },
        { type: 'computer_call', id: 'call_1' },
      ],
    });
    const result = parseRequestBody(body, '/v1/responses');
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe('Hi');
  });

  it('returns empty messages for unknown path', () => {
    const body = JSON.stringify({ foo: 'bar' });
    const result = parseRequestBody(body, '/v1/unknown');
    expect(result.messages).toEqual([]);
    expect(result.tools).toEqual([]);
  });

  it('returns empty for invalid JSON', () => {
    const result = parseRequestBody('not json', '/v1/chat/completions');
    expect(result.messages).toEqual([]);
    expect(result.tools).toEqual([]);
  });

  it('handles missing input field in responses API', () => {
    const body = JSON.stringify({ model: 'test', tools: [] });
    const result = parseRequestBody(body, '/v1/responses');
    expect(result.messages).toEqual([]);
    expect(result.tools).toEqual([]);
  });
});

describe('extractSSETokenUsage', () => {
  it('extracts usage from response.completed event', () => {
    const sse =
      'event: response.created\n' +
      'data: {"response":{"id":"resp_1"}}\n' +
      '\n' +
      'event: response.completed\n' +
      'data: {"usage":{"input_tokens":100,"output_tokens":50,"total_tokens":150},"type":"response.completed"}\n';
    const result = extractSSETokenUsage(sse);
    expect(result).toEqual({ prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 });
  });

  it('returns empty object when no response.completed event', () => {
    const sse =
      'event: response.created\n' +
      'data: {"response":{"id":"resp_1"}}\n';
    const result = extractSSETokenUsage(sse);
    expect(result).toEqual({});
  });

  it('returns empty object for empty body', () => {
    expect(extractSSETokenUsage('')).toEqual({});
  });

  it('handles malformed data line gracefully', () => {
    const sse =
      'event: response.completed\n' +
      'data: not-json\n';
    const result = extractSSETokenUsage(sse);
    expect(result).toEqual({});
  });
});

describe('extractTokensFromResponse', () => {
  it('extracts from SSE for /v1/responses', () => {
    const body =
      'event: response.completed\n' +
      'data: {"usage":{"input_tokens":5,"output_tokens":3,"total_tokens":8}}\n';
    const result = extractTokensFromResponse(body, '/v1/responses');
    expect(result).toEqual({ prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 });
  });

  it('returns empty for /v1/chat/completions (handled by proxy)', () => {
    const result = extractTokensFromResponse('{"usage":{"prompt_tokens":10}}', '/v1/chat/completions');
    expect(result).toEqual({});
  });

  it('returns empty for unknown path', () => {
    const result = extractTokensFromResponse('{}', '/v1/unknown');
    expect(result).toEqual({});
  });
});
