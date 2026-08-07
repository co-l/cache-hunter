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

  if (path.startsWith('/v1/responses')) {
    const messages = (parsed.input || [])
      .filter((item: any) => item.type === 'message')
      .map((item: any) => ({ ...item }));
    return { messages, tools: parsed.tools || [], reasoningEffort: parsed.reasoning_effort };
  }

  if (path.startsWith('/v1/messages')) {
    const sys = parsed.system
    const systemMessages: Array<Record<string, unknown>> = sys
      ? [{ role: 'system', content: sys }]
      : []
    const userMessages = (parsed.messages || []).map((m: any) => ({ ...m }))
    return {
      messages: [...systemMessages, ...userMessages],
      tools: parsed.tools || [],
      reasoningEffort: parsed.thinking?.budget_tokens != null
        ? String(parsed.thinking.budget_tokens)
        : undefined,
    }
  }

  if (path.startsWith('/v1/chat/completions')) {
    return {
      messages: (parsed.messages || []).map((m: any) => ({ ...m })),
      tools: parsed.tools || [],
      reasoningEffort: parsed.reasoning_effort,
    };
  }

  return { messages: [], tools: [] };
}


