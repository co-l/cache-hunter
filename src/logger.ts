import initSqlJs, { Database } from 'sql.js';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface RequestRecord {
  id: string;
  timestamp: number;
  method: string;
  path: string;
  headers: string;
  body: string;
  cache_salt: string | null;
  client_ip: string;
}

interface ResponseRecord {
  request_id: string;
  timestamp: number;
  status_code: number;
  headers: string;
  body: string;
  duration_ms: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface LogEntry {
  request: RequestRecord;
  response: ResponseRecord;
}

export class AsyncLogger {
  private db: Database | null = null;
  private queue: LogEntry[] = [];
  private flushing = false;
  private flushInterval: NodeJS.Timeout;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    
    this.flushInterval = setInterval(() => {
      this.flush();
    }, 100);
  }

  private async initDb(): Promise<void> {
    if (this.db) return;
    
    const SQL = await initSqlJs();
    this.db = new SQL.Database();
    
    const schemaPath = join(__dirname, 'schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');
    this.db.run(schema);
  }

  log(request: RequestRecord, response: ResponseRecord): void {
    this.queue.push({ request, response });
    
    if (this.queue.length >= 50) {
      this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) {
      return;
    }

    if (!this.db) {
      await this.initDb();
    }

    this.flushing = true;
    const entries = this.queue;
    this.queue = [];

    try {
      if (!this.db) throw new Error('Database not initialized');

      this.db.run('BEGIN TRANSACTION');

      for (const entry of entries) {
        this.db.run(
          `INSERT INTO requests (id, timestamp, method, path, headers, body, cache_salt, client_ip)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            entry.request.id,
            entry.request.timestamp,
            entry.request.method,
            entry.request.path,
            entry.request.headers,
            entry.request.body,
            entry.request.cache_salt,
            entry.request.client_ip,
          ]
        );

        this.db.run(
          `INSERT INTO responses (request_id, timestamp, status_code, headers, body, duration_ms, prompt_tokens, completion_tokens, total_tokens)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            entry.response.request_id,
            entry.response.timestamp,
            entry.response.status_code,
            entry.response.headers,
            entry.response.body,
            entry.response.duration_ms,
            entry.response.prompt_tokens ?? null,
            entry.response.completion_tokens ?? null,
            entry.response.total_tokens ?? null,
          ]
        );
      }

      this.db.run('COMMIT');
      this.save();
    } catch (error) {
      console.error('[Logger] Error flushing to database:', error);
      this.queue.unshift(...entries);
      if (this.db) {
        try {
          this.db.run('ROLLBACK');
        } catch {}
      }
    } finally {
      this.flushing = false;
    }
  }

  private save(): void {
    if (!this.db) return;
    const data = this.db.export();
    const buffer = Buffer.from(data);
    writeFileSync(this.dbPath, buffer);
  }

  close(): void {
    clearInterval(this.flushInterval);
    this.flush();
    if (this.db) {
      this.save();
      this.db.close();
      this.db = null;
    }
  }
}
