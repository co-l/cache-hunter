export interface ParsedRequest {
  messages: Array<Record<string, unknown>>;
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
      .map((item: any) => ({ ...item }));
    return { messages, tools: parsed.tools || [], reasoningEffort: parsed.reasoning_effort };
  }

  if (path === '/v1/chat/completions') {
    return {
      messages: (parsed.messages || []).map((m: any) => ({ ...m })),
      tools: parsed.tools || [],
      reasoningEffort: parsed.reasoning_effort,
    };
  }

  return { messages: [], tools: [] };
}


