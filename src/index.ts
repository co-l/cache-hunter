import { createServer } from 'http';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { ProxyEngine } from './proxy-engine.js';
import { createApp } from './app.js';
import { setDataDir } from './session-manager.js';
import { attachWSServer } from './ws-server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const DATA_DIR = join(PROJECT_ROOT, 'data');

const WEB_PORT = parseInt(process.env.WEB_PORT || '4000', 10);
const PROXY_PORT = parseInt(process.env.PROXY_PORT || '8787', 10);
const DEFAULT_TARGET_HOST = process.env.TARGET_HOST || '192.168.1.223';
const DEFAULT_TARGET_PORT = parseInt(process.env.TARGET_PORT || '8000', 10);

setDataDir(DATA_DIR);

const engine = new ProxyEngine({
  targetHost: DEFAULT_TARGET_HOST,
  targetPort: DEFAULT_TARGET_PORT,
  proxyPort: PROXY_PORT,
});

const server = createServer();
const broadcaster = attachWSServer(server);

const webApp = createApp(engine, DATA_DIR, broadcaster);

const FRONTEND_DIST = join(PROJECT_ROOT, 'frontend', 'dist');
webApp.use(express.static(FRONTEND_DIST));
webApp.get('*', (_req: any, res: any) => {
  res.sendFile(join(FRONTEND_DIST, 'index.html'));
});

server.on('request', webApp);

server.listen(WEB_PORT, () => {
  console.log(`Cache Hunter Web App running on http://localhost:${WEB_PORT}`);
  console.log(`Proxy port: ${PROXY_PORT}`);
  console.log(`Default target: ${DEFAULT_TARGET_HOST}:${DEFAULT_TARGET_PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);

  engine.start().catch((err: Error) => {
    console.error(`Failed to start proxy: ${err.message}`);
  });
});

function shutdown() {
  console.log('\nShutting down...');
  server.close(() => {
    if (engine.running) {
      engine.stop().catch(() => {});
    }
    console.log('Graceful shutdown complete');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
