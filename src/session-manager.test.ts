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
  renameSession,
  getSessionHashGrid,
  backfillSessionTitles,
  finalizeStaleSessions,
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

  it('should rename a session', () => {
    const session = createSession('localhost', 8000, null)
    expect(session.name).toBeUndefined()

    const updated = renameSession(session.id, 'My Test Session')
    expect(updated).not.toBeNull()
    expect(updated!.name).toBe('My Test Session')

    const sessions = listSessions()
    const found = sessions.find(s => s.id === session.id)
    expect(found!.name).toBe('My Test Session')
  })

  it('should return null when renaming non-existent session', () => {
    const result = renameSession('nonexistent', 'anything')
    expect(result).toBeNull()
  })

  it('should trim the name', () => {
    const session = createSession('localhost', 8000, null)
    const updated = renameSession(session.id, '  Spaced Name  ')
    expect(updated!.name).toBe('Spaced Name')
  })

  it('should allow renaming to empty string (clears name)', () => {
    const session = createSession('localhost', 8000, null)
    const updated = renameSession(session.id, 'Some Name')
    expect(updated!.name).toBe('Some Name')

    const cleared = renameSession(session.id, '')
    expect(cleared!.name).toBeUndefined()
  })

  async function writeRequests(rows: Array<{ id: string; ts: number; body: string }>, sessionId?: string) {
    const session = createSession('localhost', 8000, 'test-model', sessionId)
    const dbPath = getSessionDbPath(session.id)!
    const initSqlJs = (await import('sql.js')).default
    const SQL = await initSqlJs()
    const db = new SQL.Database()
    db.run(`CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY, timestamp INTEGER NOT NULL, method TEXT NOT NULL,
      path TEXT NOT NULL, headers TEXT NOT NULL, body TEXT NOT NULL,
      cache_salt TEXT, client_ip TEXT
    )`)
    for (const r of rows) {
      db.run("INSERT INTO requests (id, timestamp, method, path, headers, body) VALUES (?, ?, 'POST', '/v1/chat/completions', '{}', ?)",
        [r.id, r.ts, r.body])
    }
    writeFileSync(dbPath, Buffer.from(db.export()))
    db.close()
    return session
  }

  it('should auto-title a session on finalize from the primary thread', async () => {
    const session = await writeRequests([
      {
        id: 't1', ts: 100,
        body: JSON.stringify({ messages: [{ role: 'user', content: 'Fix the auth flow please' }] }),
      },
      {
        id: 't2', ts: 150,
        body: JSON.stringify({ messages: [{ role: 'user', content: '## sub agent - verify something' }] }),
      },
    ])

    await finalizeSession(session.id)

    const sessions = listSessions()
    const finalized = sessions.find(s => s.id === session.id)!
    expect(finalized.name).toBe('Fix the auth flow please')
  })

  it('should not override an existing manual name on finalize', async () => {
    const session = await writeRequests([
      {
        id: 't1', ts: 100,
        body: JSON.stringify({ messages: [{ role: 'user', content: 'Something to do' }] }),
      },
    ])
    renameSession(session.id, 'Hand Picked Name')

    await finalizeSession(session.id)

    const sessions = listSessions()
    const finalized = sessions.find(s => s.id === session.id)!
    expect(finalized.name).toBe('Hand Picked Name')
  })

  it('should enrich the session hash grid with thread metadata', async () => {
    const session = await writeRequests([
      {
        id: 't1', ts: 100,
        body: JSON.stringify({ messages: [{ role: 'user', content: 'main task' }] }),
      },
      {
        id: 't2', ts: 105,
        body: JSON.stringify({ messages: [{ role: 'user', content: 'Generate a concise, descriptive session name (max 50 characters)' }] }),
      },
      {
        id: 't3', ts: 110,
        body: JSON.stringify({ messages: [{ role: 'user', content: '## sub agent prompt here' }] }),
      },
    ])

    const grid = await getSessionHashGrid(session.id)
    expect(grid._threads).toBeDefined()
    expect(grid._columnThread).toBeDefined()
    expect(grid._columnThread).toHaveLength(3)
    const kinds = grid._threads.map((t: any) => t.kind)
    expect(kinds).toContain('primary')
    expect(kinds).toContain('title')
    expect(kinds).toContain('subagent')
  })

  it('should preserve reasoning effort in the enriched hash grid', async () => {
    const session = await writeRequests([
      {
        id: 't1', ts: 100,
        body: JSON.stringify({ messages: [{ role: 'user', content: 'main task' }], reasoning_effort: 'max' }),
      },
    ])

    const grid = await getSessionHashGrid(session.id)
    expect(grid.lines[1][0]).toBe('max')
  })

  async function markCompleted(sessionId: string) {
    const man = JSON.parse(readFileSync(join(TEST_DATA_DIR, 'manifest.json'), 'utf-8'))
    const s = man.sessions.find((x: any) => x.id === sessionId)
    s.status = 'completed'
    s.ended_at = Date.now()
    writeFileSync(join(TEST_DATA_DIR, 'manifest.json'), JSON.stringify(man, null, 2))
  }

  it('should backfill auto-titles for completed sessions without a name', async () => {
    const old = await writeRequests([
      { id: 't1', ts: 100, body: JSON.stringify({ messages: [{ role: 'user', content: 'Fix the auth flow' }] }) },
    ], 'backfill-old')
    await markCompleted(old.id)

    const named = await writeRequests([
      { id: 't1', ts: 100, body: JSON.stringify({ messages: [{ role: 'user', content: 'irrelevant' }] }) },
    ], 'backfill-named')
    renameSession(named.id, 'Keep Me')
    await markCompleted(named.id)

    const count = await backfillSessionTitles()
    expect(count).toBe(1)

    const sessions = listSessions()
    expect(sessions.find(s => s.id === old.id)!.name).toBe('Fix the auth flow')
    expect(sessions.find(s => s.id === named.id)!.name).toBe('Keep Me')
  })

  it('should skip backfill when the derived title would be Untitled session', async () => {
    const s = await writeRequests([
      { id: 't1', ts: 100, body: JSON.stringify({ messages: [{ role: 'system', content: 'You are an agent' }] }) },
    ], 'backfill-untitled')
    await markCompleted(s.id)

    const count = await backfillSessionTitles()
    expect(count).toBe(0)
    expect(listSessions().find(x => x.id === s.id)!.name).toBeUndefined()
  })

  it('should not crash the backfill on an unreadable session db', async () => {
    const s = createSession('localhost', 8000, 'test-model', 'backfill-corrupt')
    writeFileSync(getSessionDbPath(s.id)!, Buffer.from('this is not a sqlite file'))
    const man = JSON.parse(readFileSync(join(TEST_DATA_DIR, 'manifest.json'), 'utf-8'))
    const entry = man.sessions.find((x: any) => x.id === s.id)
    entry.status = 'completed'
    entry.ended_at = Date.now()
    writeFileSync(join(TEST_DATA_DIR, 'manifest.json'), JSON.stringify(man, null, 2))

    const count = await backfillSessionTitles()
    expect(count).toBe(0)
    expect(listSessions().find(x => x.id === s.id)!.name).toBeUndefined()
  })

  it('should leave a session unnamed on finalize when no title can be derived', async () => {
    const s = await writeRequests([
      { id: 't1', ts: 100, body: JSON.stringify({ messages: [{ role: 'system', content: 'You are an agent' }] }) },
    ], 'finalize-untitled')

    await finalizeSession(s.id)

    expect(listSessions().find(x => x.id === s.id)!.name).toBeUndefined()
  })

  it('should finalize stale active sessions on startup sweep', async () => {
    const s = await writeRequests([
      { id: 't1', ts: 100, body: JSON.stringify({ messages: [{ role: 'user', content: 'Fix the auth flow' }] }) },
    ], 'stale-active')

    expect(getActiveSession()!.id).toBe(s.id)

    const count = await finalizeStaleSessions()
    expect(count).toBe(1)

    const sessions = listSessions()
    const fin = sessions.find(x => x.id === s.id)!
    expect(fin.status).toBe('completed')
    expect(fin.ended_at).not.toBeNull()
    expect(fin.name).toBe('Fix the auth flow')
    expect(getActiveSession()).toBeNull()
  })

  it('should be a no-op when there are no active sessions', async () => {
    const count = await finalizeStaleSessions()
    expect(count).toBe(0)
  })

  it('should finalize a stale active session even when its db file is missing', async () => {
    const s = createSession('localhost', 8000, 'test-model', 'stale-nodb')

    const count = await finalizeStaleSessions()
    expect(count).toBe(1)
    expect(listSessions().find(x => x.id === s.id)!.status).toBe('completed')
  })
});
