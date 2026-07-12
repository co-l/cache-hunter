export interface ParsedRequest {
  messages: Array<{ role: string; content: string }>;
  tools: any[];
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
    return { messages, tools: parsed.tools || [] };
  }

  if (path === '/v1/chat/completions') {
    return {
      messages: (parsed.messages || []).map((m: any) => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      })),
      tools: parsed.tools || [],
    };
  }

  return { messages: [], tools: [] };
}

export function extractSSETokenUsage(body: string): {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
} {
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === 'event: response.completed') {
      const dataLine = lines[i + 1];
      if (dataLine && dataLine.startsWith('data: ')) {
        try {
          const data = JSON.parse(dataLine.slice(6));
          const usage = data.usage;
          if (usage) {
            return {
              prompt_tokens: usage.input_tokens,
              completion_tokens: usage.output_tokens,
              total_tokens: usage.total_tokens,
            };
          }
        } catch {
          return {};
        }
      }
    }
  }
  return {};
}

export function extractTokensFromResponse(
  responseBody: string,
  path: string,
): { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } {
  if (path === '/v1/responses') {
    return extractSSETokenUsage(responseBody);
  }
  return {};
}
