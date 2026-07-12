import { IncomingMessage, ServerResponse, request as httpRequest, IncomingHttpHeaders } from 'http';

const VLLM_HOST = '192.168.1.223';
const VLLM_PORT = 8000;

let activeModel: string | null = null;

export async function fetchActiveModel(): Promise<string | null> {
  try {
    const res = await fetch(`http://${VLLM_HOST}:${VLLM_PORT}/v1/models`);
    const data = await res.json() as { data: Array<{ id: string }> };
    if (data.data && data.data.length > 0) {
      activeModel = data.data[0].id;
      return activeModel;
    }
  } catch {
    // ignore
  }
  return null;
}

export function getActiveModel(): string | null {
  return activeModel;
}

export interface ProxyResult {
  requestId: string;
  request: {
    id: string;
    timestamp: number;
    method: string;
    path: string;
    headers: string;
    body: string;
    cache_salt: string | null;
    client_ip: string;
  };
  response: {
    request_id: string;
    timestamp: number;
    status_code: number;
    headers: string;
    body: string;
    duration_ms: number;
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export function extractCacheSalt(body: string): string | null {
  try {
    const parsed = JSON.parse(body);
    return parsed.cache_salt || null;
  } catch {
    return null;
  }
}

export function extractUsage(body: string): { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } {
  try {
    const parsed = JSON.parse(body);
    return {
      prompt_tokens: parsed.usage?.prompt_tokens,
      completion_tokens: parsed.usage?.completion_tokens,
      total_tokens: parsed.usage?.total_tokens,
    };
  } catch {
    return {};
  }
}

function getHeaderObject(headers: IncomingHttpHeaders): string {
  return JSON.stringify(headers);
}

function getHeaderObjectFromResponse(headers: IncomingHttpHeaders): string {
  return JSON.stringify(headers);
}

export interface ProxyHandler {
  (req: IncomingMessage, res: ServerResponse): void;
  onLog?: (result: ProxyResult) => void;
}

export interface ProxyConfig {
  vllmHost?: string;
  vllmPort?: number;
}

export function createProxyHandler(config?: ProxyConfig): ProxyHandler {
  const vllmHost = config?.vllmHost || VLLM_HOST;
  const vllmPort = config?.vllmPort || VLLM_PORT;
  
  const handler = function(req: IncomingMessage, res: ServerResponse) {
    const requestId = crypto.randomUUID();
    const startTime = Date.now();
    const clientIp = req.socket.remoteAddress || 'unknown';

    let requestBody = '';
    let responseBody = '';
    let responseHeaders: IncomingHttpHeaders = {};
    let responseStatusCode = 0;

    req.on('data', (chunk) => {
      requestBody += chunk;
    });

    req.on('end', () => {
      const cacheSalt = extractCacheSalt(requestBody);
      const requestHeaders = getHeaderObject(req.headers);

      if (activeModel && requestBody) {
        try {
          const body = JSON.parse(requestBody);
          if (body.model && body.model !== activeModel) {
            body.model = activeModel;
            requestBody = JSON.stringify(body);
          }
        } catch {
          // ignore parse errors
        }
      }

      const targetPath = req.url || '/';
      const targetUrl = `http://${vllmHost}:${vllmPort}${targetPath}`;

      const proxyReq = httpRequest(targetUrl, {
        method: req.method,
        headers: req.headers,
      });

      proxyReq.on('response', (proxyRes) => {
        responseStatusCode = proxyRes.statusCode || 0;
        responseHeaders = proxyRes.headers;

        res.statusCode = responseStatusCode;
        Object.entries(responseHeaders).forEach(([key, value]) => {
          if (value !== undefined) {
            res.setHeader(key, value);
          }
        });
        res.setHeader('x-proxy-request-id', requestId);

        const isStreaming = responseHeaders['content-type']?.toString().includes('text/event-stream');

        if (isStreaming) {
          proxyRes.on('data', (chunk) => {
            responseBody += chunk.toString();
            res.write(chunk);
          });

          proxyRes.on('end', () => {
            const endTime = Date.now();
            const durationMs = endTime - startTime;
            const usage = extractUsage(responseBody);
            const responseHeadersJson = getHeaderObjectFromResponse(responseHeaders);

            const proxyResult: ProxyResult = {
              requestId,
              request: {
                id: requestId,
                timestamp: startTime,
                method: req.method || 'UNKNOWN',
                path: targetPath,
                headers: requestHeaders,
                body: requestBody,
                cache_salt: cacheSalt,
                client_ip: clientIp,
              },
              response: {
                request_id: requestId,
                timestamp: endTime,
                status_code: responseStatusCode,
                headers: responseHeadersJson,
                body: responseBody,
                duration_ms: durationMs,
                ...usage,
              },
            };

            res.end();
            if (handler.onLog) handler.onLog(proxyResult);
          });
        } else {
          proxyRes.on('data', (chunk) => {
            responseBody += chunk.toString();
          });

          proxyRes.on('end', () => {
            const endTime = Date.now();
            const durationMs = endTime - startTime;
            const usage = extractUsage(responseBody);
            const responseHeadersJson = getHeaderObjectFromResponse(responseHeaders);

            const proxyResult: ProxyResult = {
              requestId,
              request: {
                id: requestId,
                timestamp: startTime,
                method: req.method || 'UNKNOWN',
                path: targetPath,
                headers: requestHeaders,
                body: requestBody,
                cache_salt: cacheSalt,
                client_ip: clientIp,
              },
              response: {
                request_id: requestId,
                timestamp: endTime,
                status_code: responseStatusCode,
                headers: responseHeadersJson,
                body: responseBody,
                duration_ms: durationMs,
                ...usage,
              },
            };

            res.write(responseBody);
            res.end();
            if (handler.onLog) handler.onLog(proxyResult);
          });
        }
      });

      proxyReq.on('error', (error) => {
        const endTime = Date.now();
        const durationMs = endTime - startTime;
        const requestHeadersJson = getHeaderObject(req.headers);

        console.error(`[Proxy] Error forwarding request: ${error.message}`);

        res.statusCode = 502;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('x-proxy-request-id', requestId);
        const errorBody = JSON.stringify({ error: 'Bad Gateway', message: error.message });
        res.end(errorBody);

        const proxyResult: ProxyResult = {
          requestId,
          request: {
            id: requestId,
            timestamp: startTime,
            method: req.method || 'UNKNOWN',
            path: targetPath,
            headers: requestHeadersJson,
            body: requestBody,
            cache_salt: cacheSalt,
            client_ip: clientIp,
          },
          response: {
            request_id: requestId,
            timestamp: endTime,
            status_code: 502,
            headers: JSON.stringify({ 'content-type': 'application/json' }),
            body: errorBody,
            duration_ms: durationMs,
          },
        };

        if (handler.onLog) handler.onLog(proxyResult);
      });

      proxyReq.write(requestBody);
      proxyReq.end();
    });
  } as ProxyHandler;

  return handler;
}
