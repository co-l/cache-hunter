import { describe, it, expect } from 'vitest';
import { parseRequestBody } from './parse-api.js';

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


