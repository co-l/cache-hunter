import initSqlJs, { Database } from 'sql.js'
import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { ProxyRequestData, ProxyResponseData } from './proxy-engine.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface RequestRecord extends ProxyRequestData {}
interface ResponseRecord extends ProxyResponseData {}

export class AsyncLogger {
  private db: Database | null = null
  private queue: Array<{ type: 'request'; record: RequestRecord } | { type: 'response'; record: ResponseRecord }> = []
  private flushing = false
  private flushInterval: NodeJS.Timeout
  private dbPath: string

  constructor(dbPath: string) {
    this.dbPath = dbPath
    
    this.flushInterval = setInterval(() => {
      this.flush()
    }, 100)
  }

  private async initDb(): Promise<void> {
    if (this.db) return
    
    const SQL = await initSqlJs()
    this.db = new SQL.Database()
    
    const schemaPath = join(__dirname, 'schema.sql')
    const schema = readFileSync(schemaPath, 'utf-8')
    this.db.run(schema)
  }

  logRequest(request: RequestRecord): void {
    this.queue.push({ type: 'request', record: request })
    process.stdout.write('.')
    this.flush()
  }

  logResponse(response: ResponseRecord): void {
    this.queue.push({ type: 'response', record: response })
    process.stdout.write('.')
    this.flush()
  }

  async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) {
      return
    }

    if (!this.db) {
      await this.initDb()
    }

    this.flushing = true
    const entries = this.queue
    this.queue = []

    try {
      if (!this.db) throw new Error('Database not initialized')

      this.db.run('BEGIN TRANSACTION')

      for (const entry of entries) {
        if (entry.type === 'request') {
          this.db.run(
            `INSERT INTO requests (id, timestamp, method, path, headers, body, cache_salt, client_ip)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              entry.record.id,
              entry.record.timestamp,
              entry.record.method,
              entry.record.path,
              entry.record.headers,
              entry.record.body,
              entry.record.cache_salt,
              entry.record.client_ip,
            ]
          )
        } else {
          this.db.run(
            `INSERT INTO responses (request_id, timestamp, status_code, headers, body, duration_ms, prompt_tokens, completion_tokens, total_tokens)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              entry.record.request_id,
              entry.record.timestamp,
              entry.record.status_code,
              entry.record.headers,
              entry.record.body,
              entry.record.duration_ms,
              entry.record.prompt_tokens ?? null,
              entry.record.completion_tokens ?? null,
              entry.record.total_tokens ?? null,
            ]
          )
        }
      }

      this.db.run('COMMIT')
      this.save()
    } catch (error) {
      console.error('[Logger] Error flushing to database:', error)
      this.queue.unshift(...entries)
      if (this.db) {
        try {
          this.db.run('ROLLBACK')
        } catch {}
      }
    } finally {
      this.flushing = false
    }
  }

  private save(): void {
    if (!this.db) return
    const data = this.db.export()
    const buffer = Buffer.from(data)
    writeFileSync(this.dbPath, buffer)
  }

  close(): void {
    clearInterval(this.flushInterval)
    this.flush()
    if (this.db) {
      this.save()
      this.db.close()
      this.db = null
    }
  }
}
