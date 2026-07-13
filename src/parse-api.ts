export interface ParsedRequest {
  messages: Array<{ role: string; content: string }>;
  tools: any[];
  reasoningEffort?: string;
}

export function parseRequestBody(body: string, path: string): ParsedRequest {
  let parsed: any;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { messages: [], tools: [] };
  }

  if (path === '/v1/responses') {
    const messages = (parsed.input || [])
      .filter((item: any) => item.type === 'message')
      .map((item: any) => ({
        role: item.role,
        content: item.content?.[0]?.text || '',
      }));
    return { messages, tools: parsed.tools || [], reasoningEffort: parsed.reasoning_effort };
  }

  if (path === '/v1/chat/completions') {
    return {
      messages: (parsed.messages || []).map((m: any) => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      })),
      tools: parsed.tools || [],
      reasoningEffort: parsed.reasoning_effort,
    };
  }

  return { messages: [], tools: [] };
}


