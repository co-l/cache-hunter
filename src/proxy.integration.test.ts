import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, IncomingMessage } from 'http';
import { AddressInfo } from 'net';
import { createProxyHandler, ProxyResult } from './proxy.js';

describe('Proxy Handler Integration', () => {
  let proxyServer: any;
  let targetServer: any;
  let proxyPort: number;
  let targetPort: number;
  let lastLogResult: ProxyResult | null = null;

  beforeEach(async () => {
    lastLogResult = null;

    targetServer = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            choices: [{ message: { content: 'test response' } }],
            usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 }
          }));
        }, 50);
      });
    });

    await new Promise<void>((resolve) => {
      targetServer.listen(0, () => {
        targetPort = (targetServer.address() as AddressInfo).port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    if (proxyServer) {
      await new Promise<void>((resolve) => proxyServer.close(() => resolve()));
    }
    if (targetServer) {
      await new Promise<void>((resolve) => targetServer.close(() => resolve()));
    }
  });

  it('should forward requests and log results', async () => {
    const handler = createProxyHandler({ vllmHost: 'localhost', vllmPort: targetPort });
    handler.onLog = (result) => {
      lastLogResult = result;
    };

    proxyServer = createServer(handler);
    await new Promise<void>((resolve) => {
      proxyServer.listen(0, () => {
        proxyPort = (proxyServer.address() as AddressInfo).port;
        resolve();
      });
    });

    const requestBody = JSON.stringify({ prompt: 'test message' });

    await new Promise<void>((resolve, reject) => {
      const req = require('http').request(
        `http://localhost:${proxyPort}/v1/chat/completions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        },
        (res: IncomingMessage) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            try {
              expect(res.headers['x-proxy-request-id']).toBeDefined();
              expect(lastLogResult).not.toBeNull();
              expect(lastLogResult!.request.method).toBe('POST');
              expect(lastLogResult!.request.path).toBe('/v1/chat/completions');
              expect(lastLogResult!.response.status_code).toBe(200);
              expect(lastLogResult!.response.prompt_tokens).toBe(10);
              expect(lastLogResult!.response.completion_tokens).toBe(20);
              expect(lastLogResult!.response.total_tokens).toBe(30);
              resolve();
            } catch (error) {
              reject(error);
            }
          });
        }
      );
      req.on('error', reject);
      req.write(requestBody);
      req.end();
    });
  });

  it('should measure request duration', async () => {
    const handler = createProxyHandler({ vllmHost: 'localhost', vllmPort: targetPort });
    handler.onLog = (result) => {
      lastLogResult = result;
    };

    proxyServer = createServer(handler);
    await new Promise<void>((resolve) => {
      proxyServer.listen(0, () => {
        proxyPort = (proxyServer.address() as AddressInfo).port;
        resolve();
      });
    });

    await new Promise<void>((resolve, reject) => {
      const req = require('http').request(
        `http://localhost:${proxyPort}/test`,
        { method: 'GET' },
        (res: IncomingMessage) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            try {
              expect(lastLogResult).not.toBeNull();
              expect(lastLogResult!.response.duration_ms).toBeGreaterThanOrEqual(40);
              resolve();
            } catch (error) {
              reject(error);
            }
          });
        }
      );
      req.on('error', reject);
      req.end();
    });
  });

  it('should handle errors gracefully', async () => {
    const handler = createProxyHandler({ vllmHost: 'localhost', vllmPort: targetPort });
    handler.onLog = (result) => {
      lastLogResult = result;
    };

    proxyServer = createServer(handler);
    await new Promise<void>((resolve) => {
      proxyServer.listen(0, () => {
        proxyPort = (proxyServer.address() as AddressInfo).port;
        resolve();
      });
    });

    await new Promise<void>((resolve, reject) => {
      const req = require('http').request(
        `http://localhost:${proxyPort}/error`,
        { method: 'POST' },
        (res: IncomingMessage) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            try {
              expect(res.statusCode).toBe(200);
              expect(lastLogResult).not.toBeNull();
              expect(lastLogResult!.response.status_code).toBe(200);
              resolve();
            } catch (error) {
              reject(error);
            }
          });
        }
      );
      req.on('error', reject);
      req.write('invalid json');
      req.end();
    });
  });
});
