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

  it('preserves full message objects in chat completions', () => {
    const body = JSON.stringify({
      model: 'gpt-4',
      messages: [
        { role: 'user', content: 'Hello', name: 'Alice' },
        { role: 'assistant', content: 'Hi', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'foo', arguments: '{}' } }] },
      ],
    });
    const result = parseRequestBody(body, '/v1/chat/completions');
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toHaveProperty('name', 'Alice');
    expect(result.messages[1]).toHaveProperty('tool_calls');
    expect((result.messages[1] as any).tool_calls).toHaveLength(1);
  });

  it('parses responses API format preserving full items', () => {
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
    expect(result.messages[0]).toHaveProperty('type', 'message');
    expect(result.messages[0]).toHaveProperty('role', 'developer');
    expect((result.messages[0] as any).content).toBeInstanceOf(Array);
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
    expect(result.messages[0]).toHaveProperty('type', 'message');
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

  it('preserves assistant tool_calls in chat completions', () => {
    const body = JSON.stringify({
      model: 'gpt-4',
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'foo', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: 'call_1', content: '42' },
      ],
    });
    const result = parseRequestBody(body, '/v1/chat/completions');
    expect(result.messages).toHaveLength(3);
    expect(result.messages[0]).toEqual({ role: 'user', content: 'Hello' });
    expect((result.messages[1] as any).tool_calls).toBeDefined();
    expect((result.messages[2] as any).tool_call_id).toBe('call_1');
  });

  it('preserves null content in chat completions messages', () => {
    const body = JSON.stringify({
      model: 'gpt-4',
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: null },
      ],
    });
    const result = parseRequestBody(body, '/v1/chat/completions');
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toEqual({ role: 'user', content: 'Hello' });
    expect(result.messages[1]).toEqual({ role: 'assistant', content: null });
  });
});


