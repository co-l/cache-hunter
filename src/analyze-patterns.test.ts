import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, writeFileSync } from 'fs';
import initSqlJs, { Database } from 'sql.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = join(__dirname, '..', 'test-cache.db');

describe('Cache Pattern Analysis', () => {
  let db: Database;

  beforeEach(async () => {
    const SQL = await initSqlJs();
    db = new SQL.Database();
    
    const schemaPath = join(__dirname, 'schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');
    db.run(schema);

    const testData = [
      {
        id: 'req-1',
        timestamp: Date.now() - 3000,
        method: 'POST',
        path: '/v1/chat/completions',
        headers: JSON.stringify({ 'content-type': 'application/json' }),
        body: JSON.stringify({ model: 'test', messages: [{ role: 'user', content: 'Hello' }] }),
        cache_salt: null,
        client_ip: '127.0.0.1',
      },
      {
        id: 'req-2',
        timestamp: Date.now() - 2000,
        method: 'POST',
        path: '/v1/chat/completions',
        headers: JSON.stringify({ 'content-type': 'application/json' }),
        body: JSON.stringify({ model: 'test', messages: [{ role: 'user', content: 'Hello' }] }),
        cache_salt: null,
        client_ip: '127.0.0.1',
      },
    ];

    testData.forEach(req => {
      db.run(
        `INSERT INTO requests (id, timestamp, method, path, headers, body, cache_salt, client_ip)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        Object.values(req)
      );
    });

    const respData = [
      {
        request_id: 'req-1',
        timestamp: Date.now() - 2900,
        status_code: 200,
        headers: JSON.stringify({ 'content-type': 'application/json' }),
        body: JSON.stringify({ choices: [{ message: { content: 'Hi' } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }),
        duration_ms: 500,
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
      {
        request_id: 'req-2',
        timestamp: Date.now() - 1900,
        status_code: 200,
        headers: JSON.stringify({ 'content-type': 'application/json' }),
        body: JSON.stringify({ choices: [{ message: { content: 'Hi there' } }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }),
        duration_ms: 300,
        prompt_tokens: 10,
        completion_tokens: 10,
        total_tokens: 20,
      },
    ];

    respData.forEach(resp => {
      db.run(
        `INSERT INTO responses (request_id, timestamp, status_code, headers, body, duration_ms, prompt_tokens, completion_tokens, total_tokens)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        Object.values(resp)
      );
    });
  });

  afterEach(() => {
    db.close();
    try {
      writeFileSync(TEST_DB_PATH, Buffer.from(db.export()));
    } catch {}
  });

  it('should detect repeated prefixes', () => {
    const query = `
      SELECT 
        substr(r.body, 1, 50) as prefix,
        count(*) as occurrences,
        round(avg(resp.duration_ms), 0) as avg_duration
      FROM requests r
      JOIN responses resp ON r.id = resp.request_id
      WHERE r.path = '/v1/chat/completions'
      GROUP BY substr(r.body, 1, 50)
      HAVING count(*) > 1
    `;

    const results = db.exec(query);
    expect(results.length).toBe(1);
    expect(results[0].values[0][1]).toBe(2);
  });

  it('should calculate ms per token', () => {
    const query = `
      SELECT 
        round(resp.duration_ms * 1.0 / resp.prompt_tokens, 2) as ms_per_token
      FROM responses resp
      WHERE resp.prompt_tokens IS NOT NULL
    `;

    const results = db.exec(query);
    expect(results.length).toBe(1);
    expect(results[0].values.length).toBe(2);
  });

  it('should detect conversation chains', () => {
    const query = `
      WITH conversation_groups AS (
        SELECT 
          substr(r.body, instr(r.body, '"model":"'), 50) as model_key
        FROM requests r
        JOIN responses resp ON r.id = resp.request_id
        WHERE r.path = '/v1/chat/completions'
      )
      SELECT 
        model_key,
        count(*) as turns
      FROM conversation_groups
      GROUP BY model_key
      HAVING count(*) > 1
    `;

    const results = db.exec(query);
    expect(results.length).toBe(1);
    expect(results[0].values[0][1]).toBe(2);
  });

  it('should handle requests with null prompt_tokens', () => {
    const query = `
      SELECT 
        resp.prompt_tokens,
        resp.duration_ms
      FROM responses resp
      WHERE resp.prompt_tokens IS NULL
    `;

    const results = db.exec(query);
    expect(results.length).toBe(0);
  });
});
