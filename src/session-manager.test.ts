import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  createSession,
  listSessions,
  getActiveSession,
  finalizeSession,
  deleteSession,
  deleteSessionCall,
  getSessionDbPath,
  setDataDir,
} from './session-manager.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DATA_DIR = join(__dirname, '..', 'data-test');

describe('SessionManager', () => {
  beforeEach(() => {
    if (!existsSync(TEST_DATA_DIR)) mkdirSync(TEST_DATA_DIR, { recursive: true });
    setDataDir(TEST_DATA_DIR);
  });

  afterEach(() => {
    rmSync(TEST_DATA_DIR, { recursive: true, force: true });
  });

  it('should create a session', () => {
    const session = createSession('localhost', 8000, 'test-model');
    expect(session.id).toBeDefined();
    expect(session.status).toBe('active');
    expect(session.target_host).toBe('localhost');
    expect(session.target_port).toBe(8000);
    expect(session.model).toBe('test-model');
    expect(session.request_count).toBe(0);
  });

  it('should list sessions newest first', () => {
    const s1 = createSession('host1', 8000, null);
    const s2 = createSession('host2', 8000, null);

    const sessions = listSessions();
    expect(sessions.length).toBe(2);
    expect(sessions[0].id).toBe(s2.id);
    expect(sessions[1].id).toBe(s1.id);
  });

  it('should get active session', () => {
    const session = createSession('localhost', 8000, null);
    const active = getActiveSession();
    expect(active).not.toBeNull();
    expect(active!.id).toBe(session.id);
  });

  it('should finalize a session', async () => {
    const session = createSession('localhost', 8000, null);
    expect(session.status).toBe('active');

    await finalizeSession(session.id);

    const active = getActiveSession();
    expect(active).toBeNull();

    const sessions = listSessions();
    const finalized = sessions.find(s => s.id === session.id);
    expect(finalized).toBeDefined();
    expect(finalized!.status).toBe('completed');
    expect(finalized!.ended_at).not.toBeNull();
  });

  it('should delete a session', () => {
    const session = createSession('localhost', 8000, null);
    expect(listSessions().length).toBe(1);

    deleteSession(session.id);
    expect(listSessions().length).toBe(0);
  });

  it('should return db path for existing session', () => {
    const session = createSession('localhost', 8000, null);
    const path = getSessionDbPath(session.id);
    expect(path).not.toBeNull();
    expect(path).toContain(session.filename);
  });

  it('should return null for non-existent session', () => {
    const path = getSessionDbPath('nonexistent');
    expect(path).toBeNull();
  });

  it('should delete a specific call by index', async () => {
    const session = createSession('localhost', 8000, 'test-model')
    const dbPath = getSessionDbPath(session.id)!

    const initSqlJs = (await import('sql.js')).default
    const SQL = await initSqlJs()
    const db = new SQL.Database()

    db.run(`CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY, timestamp INTEGER NOT NULL, method TEXT NOT NULL,
      path TEXT NOT NULL, headers TEXT NOT NULL, body TEXT NOT NULL,
      cache_salt TEXT, client_ip TEXT
    )`)

    db.run("INSERT INTO requests (id, timestamp, method, path, headers, body) VALUES ('r1', 100, 'POST', '/v1/chat/completions', '{}', '{\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}')")
    db.run("INSERT INTO requests (id, timestamp, method, path, headers, body) VALUES ('r2', 200, 'POST', '/v1/chat/completions', '{}', '{\"messages\":[{\"role\":\"user\",\"content\":\"bye\"}]}')")

    const buf = Buffer.from(db.export())
    const { writeFileSync } = await import('fs')
    writeFileSync(dbPath, buf)
    db.close()

    const ok = await deleteSessionCall(session.id, 0)
    expect(ok).toBe(true)

    const data = (await import('fs')).readFileSync(dbPath)
    const db2 = new SQL.Database(data)
    const remaining = db2.exec('SELECT id FROM requests ORDER BY timestamp')
    db2.close()

    expect(remaining[0].values).toEqual([['r2']])
  })

  it('should return false for out-of-bounds call index', async () => {
    const session = createSession('localhost', 8000, null)
    const ok = await deleteSessionCall(session.id, 99)
    expect(ok).toBe(false)
  })

  it('should return false for non-existent session', async () => {
    const ok = await deleteSessionCall('nonexistent', 0)
    expect(ok).toBe(false)
  })
});
