import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AddressInfo } from 'net';
import { mkdirSync, existsSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { setDataDir } from './session-manager.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DATA_DIR = join(__dirname, '..', 'data-test-api');

async function fetchJson(url: string, options?: RequestInit): Promise<any> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const body = await res.text();
  try { return { status: res.status, body: JSON.parse(body) }; }
  catch { return { status: res.status, body }; }
}

describe('API Endpoints', () => {
  let server: any;
  let port: number;
  let baseUrl: string;

  beforeEach(async () => {
    if (!existsSync(TEST_DATA_DIR)) mkdirSync(TEST_DATA_DIR, { recursive: true });
    setDataDir(TEST_DATA_DIR);

    const { ProxyEngine } = await import('./proxy-engine.js');
    const { createApp } = await import('./app.js');

    const engine = new ProxyEngine({ targetHost: 'localhost', targetPort: 8765, proxyPort: 0 });
    const app = createApp(engine, TEST_DATA_DIR);

    server = await new Promise<any>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    port = (server.address() as AddressInfo).port;
    baseUrl = `http://localhost:${port}`;
  });

  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  });

  it('GET /api/config returns config', async () => {
    const { status, body } = await fetchJson(`${baseUrl}/api/config`);
    expect(status).toBe(200);
    expect(body.targetHost).toBe('localhost');
    expect(body.targetPort).toBe(8765);
  });

  it('PUT /api/config updates config', async () => {
    const { status, body } = await fetchJson(`${baseUrl}/api/config`, {
      method: 'PUT',
      body: JSON.stringify({ targetHost: '10.0.0.1', targetPort: 8080 }),
    });
    expect(status).toBe(200);
    expect(body.targetHost).toBe('10.0.0.1');
    expect(body.targetPort).toBe(8080);
  });

  it('GET /api/proxy/status returns stopped initially', async () => {
    const { status, body } = await fetchJson(`${baseUrl}/api/proxy/status`);
    expect(status).toBe(200);
    expect(body.running).toBe(false);
    expect(body.capturing).toBe(false);
  });

  it('POST /api/proxy/start starts the proxy', async () => {
    const { status, body } = await fetchJson(`${baseUrl}/api/proxy/start`, { method: 'POST' });
    expect(status).toBe(200);
    expect(body.running).toBe(true);
  });

  it('POST /api/proxy/stop stops the proxy', async () => {
    await fetchJson(`${baseUrl}/api/proxy/start`, { method: 'POST' });
    const { status, body } = await fetchJson(`${baseUrl}/api/proxy/stop`, { method: 'POST' });
    expect(status).toBe(200);
    expect(body.running).toBe(false);
  });

  it('POST /api/capture/start requires proxy running', async () => {
    const { status } = await fetchJson(`${baseUrl}/api/capture/start`, { method: 'POST' });
    expect(status).toBe(400);
  });

  it('POST /api/capture/start and stop works', async () => {
    await fetchJson(`${baseUrl}/api/proxy/start`, { method: 'POST' });
    const { status: s1, body: b1 } = await fetchJson(`${baseUrl}/api/capture/start`, { method: 'POST' });
    expect(s1).toBe(200);
    expect(b1.capturing).toBe(true);

    const { status: s2, body: b2 } = await fetchJson(`${baseUrl}/api/capture/stop`, { method: 'POST' });
    expect(s2).toBe(200);
    expect(b2.capturing).toBe(false);

    await fetchJson(`${baseUrl}/api/proxy/stop`, { method: 'POST' });
  });

  it('GET /api/sessions returns empty list initially', async () => {
    const { status, body } = await fetchJson(`${baseUrl}/api/sessions`);
    expect(status).toBe(200);
    expect(body.sessions).toEqual([]);
  });

  it('GET /api/sessions/:id returns 404 for unknown session', async () => {
    const { status } = await fetchJson(`${baseUrl}/api/sessions/nonexistent`);
    expect(status).toBe(404);
  });

  it('DELETE /api/sessions/:id succeeds', async () => {
    const { status, body } = await fetchJson(`${baseUrl}/api/sessions/unknown`, { method: 'DELETE' });
    expect(status).toBe(200);
    expect(body.deleted).toBe(true);
  });

  it('DELETE /api/sessions/:id/calls/:index returns 400 for invalid index', async () => {
    const { status } = await fetchJson(`${baseUrl}/api/sessions/test/calls/abc`, { method: 'DELETE' });
    expect(status).toBe(400);
  });

  it('DELETE /api/sessions/:id/calls/:index returns 404 for unknown session', async () => {
    const { status } = await fetchJson(`${baseUrl}/api/sessions/nonexistent/calls/0`, { method: 'DELETE' });
    expect(status).toBe(404);
  });

  it('PUT /api/sessions/:id renames a session', async () => {
    // Create a session via capture lifecycle
    await fetchJson(`${baseUrl}/api/proxy/start`, { method: 'POST' });
    const capRes = await fetchJson(`${baseUrl}/api/capture/start`, { method: 'POST' });
    const sessionId = capRes.body.session.id;
    await fetchJson(`${baseUrl}/api/capture/stop`, { method: 'POST' });
    await fetchJson(`${baseUrl}/api/proxy/stop`, { method: 'POST' });

    const { status, body } = await fetchJson(`${baseUrl}/api/sessions/${sessionId}`, {
      method: 'PUT',
      body: JSON.stringify({ name: 'Renamed Session' }),
    });
    expect(status).toBe(200);
    expect(body.name).toBe('Renamed Session');
    expect(body.id).toBe(sessionId);
  });

  it('PUT /api/sessions/:id returns 400 for missing name', async () => {
    const { status } = await fetchJson(`${baseUrl}/api/sessions/foo`, {
      method: 'PUT',
      body: JSON.stringify({}),
    });
    expect(status).toBe(400);
  });

  it('PUT /api/sessions/:id returns 404 for unknown session', async () => {
    const { status } = await fetchJson(`${baseUrl}/api/sessions/nonexistent`, {
      method: 'PUT',
      body: JSON.stringify({ name: 'Test' }),
    });
    expect(status).toBe(404);
  });

  it('full lifecycle: proxy start → capture start → capture stop → proxy stop', async () => {
    let res;

    res = await fetchJson(`${baseUrl}/api/proxy/start`, { method: 'POST' });
    expect(res.body.running).toBe(true);

    res = await fetchJson(`${baseUrl}/api/proxy/status`);
    expect(res.body.running).toBe(true);
    expect(res.body.capturing).toBe(false);

    res = await fetchJson(`${baseUrl}/api/capture/start`, { method: 'POST' });
    expect(res.body.capturing).toBe(true);

    res = await fetchJson(`${baseUrl}/api/proxy/status`);
    expect(res.body.capturing).toBe(true);

    res = await fetchJson(`${baseUrl}/api/capture/stop`, { method: 'POST' });
    expect(res.body.capturing).toBe(false);

    res = await fetchJson(`${baseUrl}/api/proxy/stop`, { method: 'POST' });
    expect(res.body.running).toBe(false);
  });
});
