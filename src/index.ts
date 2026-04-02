import express, { Request, Response } from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, renameSync } from 'fs';
import { AsyncLogger } from './logger.js';
import { createProxyHandler, ProxyResult } from './proxy.js';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

const PROXY_PORT = 8787;
const VLLM_HOST = '192.168.1.223';
const VLLM_PORT = 8000;
const DB_PATH = join(PROJECT_ROOT, 'cache-hunter.db');

console.log('Cache Hunter Proxy starting...');
console.log(`Database: ${DB_PATH}`);
console.log(`Proxy listening on http://localhost:${PROXY_PORT}`);
console.log(`Forwarding to vLLM at http://${VLLM_HOST}:${VLLM_PORT}`);

if (existsSync(DB_PATH)) {
  const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  const backupPath = DB_PATH.replace('.db', `.${timestamp}.db`);
  renameSync(DB_PATH, backupPath);
  console.log(`Database archived to: ${backupPath}`);
}

const logger = new AsyncLogger(DB_PATH);
const proxyHandler = createProxyHandler();

proxyHandler.onLog = (result: ProxyResult) => {
  logger.log(result.request, result.response);
};

const app = express();

app.all('*', (req: Request, res: Response) => {
  proxyHandler(req, res);
});

const server = app.listen(PROXY_PORT, () => {
  console.log(`Proxy server ready on port ${PROXY_PORT}`);
});

process.on('SIGINT', () => {
  console.log('\n\nShutting down...\n');
  server.close(() => {
    logger.close();
    
    try {
      execSync('npx tsx src/hash-tree.ts', { stdio: 'inherit', cwd: PROJECT_ROOT });
    } catch (e) {
      console.log('Hash tree visualization completed');
    }
    
    console.log('\nGraceful shutdown complete');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\n\nShutting down...\n');
  server.close(() => {
    logger.close();
    
    try {
      execSync('npx tsx src/hash-tree.ts', { stdio: 'inherit', cwd: PROJECT_ROOT });
    } catch (e) {
      console.log('Hash tree visualization completed');
    }
    
    console.log('\nGraceful shutdown complete');
    process.exit(0);
  });
});
