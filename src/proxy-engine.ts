import { createServer, IncomingMessage, ServerResponse, Server, request as httpRequest, IncomingHttpHeaders } from 'http';
import { EventEmitter } from 'events';

export interface ProxyEngineConfig {
  targetHost: string;
  targetPort: number;
  proxyPort: number;
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

export declare interface ProxyEngine {
  on(event: 'log', listener: (result: ProxyResult) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'start' | 'stop' | 'captureStart' | 'captureStop', listener: () => void): this;
  emit(event: 'log', result: ProxyResult): boolean;
  emit(event: 'error', error: Error): boolean;
  emit(event: 'start' | 'stop' | 'captureStart' | 'captureStop'): boolean;
}

export class ProxyEngine extends EventEmitter {
  private server: Server | null = null;
  private _running = false;
  private _capturing = false;
  private config: ProxyEngineConfig;
  private _activeModel: string | null = null;

  constructor(config: ProxyEngineConfig) {
    super();
    this.config = config;
  }

  get running(): boolean { return this._running; }
  get capturing(): boolean { return this._capturing; }
  get activeModel(): string | null { return this._activeModel; }

  updateConfig(config: Partial<ProxyEngineConfig>): void {
    if (this._running) throw new Error('Cannot update config while proxy is running');
    Object.assign(this.config, config);
  }

  getConfig(): ProxyEngineConfig {
    return { ...this.config };
  }

  async start(): Promise<void> {
    if (this._running) throw new Error('Proxy is already running');

    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => this.handleRequest(req, res));
      this.server.listen(this.config.proxyPort, () => {
        const addr = this.server!.address();
        if (addr && typeof addr === 'object') {
          this.config.proxyPort = addr.port;
        }
        this._running = true;
        this.fetchActiveModel();
        this.emit('start');
        resolve();
      });
      this.server.on('error', (err) => {
        this._running = false;
        this.server = null;
        reject(err);
      });
    });
  }

  async stop(): Promise<void> {
    if (!this._running || !this.server) return;

    return new Promise((resolve) => {
      this.server!.close(() => {
        this._running = false;
        this._capturing = false;
        this.server = null;
        this.emit('stop');
        resolve();
      });
    });
  }

  startCapture(): void {
    if (!this._running) throw new Error('Proxy must be running to capture');
    if (this._capturing) return;
    this._capturing = true;
    this.emit('captureStart');
  }

  stopCapture(): void {
    if (!this._capturing) return;
    this._capturing = false;
    this.emit('captureStop');
  }

  private async fetchActiveModel(): Promise<void> {
    try {
      const res = await fetch(`http://${this.config.targetHost}:${this.config.targetPort}/v1/models`);
      const data = await res.json() as { data: Array<{ id: string }> };
      if (data.data && data.data.length > 0) {
        this._activeModel = data.data[0].id;
      }
    } catch {
      // ignore
    }
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const requestId = crypto.randomUUID();
    const startTime = Date.now();
    const clientIp = req.socket.remoteAddress || 'unknown';

    let requestBody = '';
    let responseBody = '';
    let responseHeaders: IncomingHttpHeaders = {};
    let responseStatusCode = 0;

    req.on('data', (chunk) => { requestBody += chunk; });

    req.on('end', () => {
      const cacheSalt = this.extractCacheSalt(requestBody);
      const requestHeaders = JSON.stringify(req.headers);

      if (this._activeModel && requestBody) {
        try {
          const body = JSON.parse(requestBody);
          if (body.model && body.model !== this._activeModel) {
            body.model = this._activeModel;
            requestBody = JSON.stringify(body);
          }
        } catch {
          // ignore
        }
      }

      const targetPath = req.url || '/';
      const targetUrl = `http://${this.config.targetHost}:${this.config.targetPort}${targetPath}`;

      const proxyReq = httpRequest(targetUrl, {
        method: req.method,
        headers: req.headers,
      });

      proxyReq.on('response', (proxyRes) => {
        responseStatusCode = proxyRes.statusCode || 0;
        responseHeaders = proxyRes.headers;

        res.statusCode = responseStatusCode;
        for (const [key, value] of Object.entries(responseHeaders)) {
          if (value !== undefined) res.setHeader(key, value);
        }
        res.setHeader('x-proxy-request-id', requestId);

        const isStreaming = responseHeaders['content-type']?.toString().includes('text/event-stream');

        const onEnd = () => {
          const endTime = Date.now();
          const durationMs = endTime - startTime;
          const usage = this.extractUsage(responseBody);
          const responseHeadersJson = JSON.stringify(responseHeaders);

          const result: ProxyResult = {
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
          if (this._capturing) {
            this.emit('log', result);
          }
        };

        if (isStreaming) {
          proxyRes.on('data', (chunk) => { responseBody += chunk.toString(); res.write(chunk); });
          proxyRes.on('end', onEnd);
        } else {
          proxyRes.on('data', (chunk) => { responseBody += chunk.toString(); });
          proxyRes.on('end', () => {
            res.write(responseBody);
            onEnd();
          });
        }
      });

      proxyReq.on('error', (error) => {
        const endTime = Date.now();
        const durationMs = endTime - startTime;

        console.error(`[Proxy] Error forwarding request: ${error.message}`);

        res.statusCode = 502;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('x-proxy-request-id', requestId);
        const errorBody = JSON.stringify({ error: 'Bad Gateway', message: error.message });
        res.end(errorBody);

        if (this._capturing) {
          this.emit('log', {
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
              status_code: 502,
              headers: JSON.stringify({ 'content-type': 'application/json' }),
              body: errorBody,
              duration_ms: durationMs,
            },
          });
        }
      });

      proxyReq.write(requestBody);
      proxyReq.end();
    });
  }

  private extractCacheSalt(body: string): string | null {
    try {
      const parsed = JSON.parse(body);
      return parsed.cache_salt || null;
    } catch { return null; }
  }

  private extractUsage(body: string): { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } {
    try {
      const parsed = JSON.parse(body);
      return {
        prompt_tokens: parsed.usage?.prompt_tokens,
        completion_tokens: parsed.usage?.completion_tokens,
        total_tokens: parsed.usage?.total_tokens,
      };
    } catch { return {}; }
  }
}
