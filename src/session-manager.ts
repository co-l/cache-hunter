import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import initSqlJs, { Database } from 'sql.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let DATA_DIR = join(__dirname, '..', 'data');

export function setDataDir(dir: string): void {
  DATA_DIR = dir;
}

export function getDataDir(): string {
  return DATA_DIR;
}

export interface SessionMeta {
  id: string;
  filename: string;
  created_at: number;
  ended_at: number | null;
  status: 'active' | 'completed';
  model: string | null;
  request_count: number;
  target_host: string;
  target_port: number;
  name?: string;
}

interface Manifest {
  sessions: SessionMeta[];
}

const MANIFEST_PATH = () => join(DATA_DIR, 'manifest.json');
let sqlJsPromise: ReturnType<typeof initSqlJs> | null = null;
async function getSqlJs() {
  if (!sqlJsPromise) sqlJsPromise = initSqlJs();
  return sqlJsPromise;
}

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function readManifest(): Manifest {
  ensureDataDir();
  if (!existsSync(MANIFEST_PATH())) return { sessions: [] };
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH(), 'utf-8'));
  } catch {
    return { sessions: [] };
  }
}

function writeManifest(manifest: Manifest): void {
  ensureDataDir();
  writeFileSync(MANIFEST_PATH(), JSON.stringify(manifest, null, 2));
}

export function getActiveSession(): SessionMeta | null {
  const manifest = readManifest();
  return manifest.sessions.find(s => s.status === 'active') || null;
}

export function listSessions(): SessionMeta[] {
  const manifest = readManifest();
  return manifest.sessions.sort((a, b) => b.created_at - a.created_at);
}

export function createSession(targetHost: string, targetPort: number, model: string | null): SessionMeta {
  const now = Date.now();
  const id = new Date(now).toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  const filename = `${id}.db`;

  const session: SessionMeta = {
    id,
    filename,
    created_at: now,
    ended_at: null,
    status: 'active',
    model,
    request_count: 0,
    target_host: targetHost,
    target_port: targetPort,
  };

  const manifest = readManifest();
  manifest.sessions.push(session);
  writeManifest(manifest);

  return session;
}

export async function finalizeSession(id: string): Promise<void> {
  const manifest = readManifest();
  const session = manifest.sessions.find(s => s.id === id);
  if (!session) return;

  session.status = 'completed';
  session.ended_at = Date.now();

  const dbPath = join(DATA_DIR, session.filename);
  if (existsSync(dbPath)) {
    const SQL = await getSqlJs();
    const data = readFileSync(dbPath);
    const db = new SQL.Database(data);
    const countResult = db.exec('SELECT COUNT(*) as cnt FROM requests');
    if (countResult.length > 0 && countResult[0].values.length > 0) {
      session.request_count = countResult[0].values[0][0] as number;
    }
    db.close();
  }

  writeManifest(manifest);
}

export function deleteSession(id: string): void {
  const manifest = readManifest();
  const idx = manifest.sessions.findIndex(s => s.id === id);
  if (idx === -1) return;

  const session = manifest.sessions[idx];
  const dbPath = join(DATA_DIR, session.filename);
  if (existsSync(dbPath)) unlinkSync(dbPath);

  manifest.sessions.splice(idx, 1);
  writeManifest(manifest);
}

export function renameSession(id: string, name: string): SessionMeta | null {
  const manifest = readManifest()
  const session = manifest.sessions.find(s => s.id === id)
  if (!session) return null

  const trimmed = name.trim()
  if (trimmed) {
    session.name = trimmed
  } else {
    delete session.name
  }

  writeManifest(manifest)
  return session
}

export function getSessionDbPath(id: string): string | null {
  const manifest = readManifest();
  const session = manifest.sessions.find(s => s.id === id);
  if (!session) return null;
  return join(DATA_DIR, session.filename);
}

export async function deleteSessionCall(id: string, callIndex: number): Promise<boolean> {
  const manifest = readManifest()
  const session = manifest.sessions.find(s => s.id === id)
  if (!session) return false

  const dbPath = join(DATA_DIR, session.filename)
  if (!existsSync(dbPath)) return false

  const SQL = await getSqlJs()
  const data = readFileSync(dbPath)
  const db = new SQL.Database(data)

  const idsResult = db.exec(`
    SELECT id FROM requests
    WHERE path IN ('/v1/chat/completions', '/v1/responses')
    ORDER BY timestamp
  `)

  if (idsResult.length === 0 || idsResult[0].values.length <= callIndex) {
    db.close()
    return false
  }

  const requestId = idsResult[0].values[callIndex][0] as string

  db.run('DELETE FROM requests WHERE id = ?', [requestId])

  const countResult = db.exec('SELECT COUNT(*) as cnt FROM requests')
  if (countResult.length > 0 && countResult[0].values.length > 0) {
    session.request_count = countResult[0].values[0][0] as number
  }

  const buf = Buffer.from(db.export())
  writeFileSync(dbPath, buf)
  db.close()

  writeManifest(manifest)
  return true
}

export async function getSessionHashGrid(id: string): Promise<any> {
  const dbPath = getSessionDbPath(id);
  if (!dbPath) return null;

  const SQL = await getSqlJs();
  const data = readFileSync(dbPath);
  const db = new SQL.Database(data);

  const query = `
    SELECT body, path, timestamp
    FROM requests
    WHERE path IN ('/v1/chat/completions', '/v1/responses')
    ORDER BY timestamp
  `;

  const results = db.exec(query);
  db.close();

  if (results.length === 0 || results[0].values.length === 0) return null;

  const { buildTreeData } = await import('./hash-grid.js');
  const { parseRequestBody } = await import('./parse-api.js');

  const completions = results[0].values.map((row: any[]) => {
    const reqBody = row[0] as string;
    const path = row[1] as string;
    const parsed = parseRequestBody(reqBody, path);

    return {
      messages: parsed.messages,
      tools: parsed.tools,
      path,
      reasoningEffort: parsed.reasoningEffort,
    };
  });

  return buildTreeData(completions, true);
}
