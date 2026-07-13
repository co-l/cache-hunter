import initSqlJs from 'sql.js'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { ProxyRequestData, ProxyResponseData } from './proxy-engine.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface RequestRecord extends ProxyRequestData {}
interface ResponseRecord extends ProxyResponseData {}

export class AsyncLogger {
  private queue: Array<{ type: 'request'; record: RequestRecord } | { type: 'response'; record: ResponseRecord }> = []
  private flushing = false
  private flushInterval: NodeJS.Timeout
  private dbPath: string
  private sqlJsReady: Promise<any>

  constructor(dbPath: string) {
    this.dbPath = dbPath
    this.sqlJsReady = initSqlJs()

    this.flushInterval = setInterval(() => {
      this.flush()
    }, 100)
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
    if (this.flushing || this.queue.length === 0) return

    this.flushing = true
    const entries = this.queue
    this.queue = []

    try {
      const SQL = await this.sqlJsReady

      let db: any
      if (existsSync(this.dbPath)) {
        const data = readFileSync(this.dbPath)
        db = new SQL.Database(data)
      } else {
        db = new SQL.Database()
        const schemaPath = join(__dirname, 'schema.sql')
        const schema = readFileSync(schemaPath, 'utf-8')
        db.run(schema)
      }

      db.run('BEGIN TRANSACTION')

      for (const entry of entries) {
        if (entry.type === 'request') {
          db.run(
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
          db.run(
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

      db.run('COMMIT')

      const buf = Buffer.from(db.export())
      writeFileSync(this.dbPath, buf)
      db.close()
    } catch (error) {
      console.error('[Logger] Error flushing to database:', error)
      this.queue.unshift(...entries)
    } finally {
      this.flushing = false
    }
  }

  close(): void {
    clearInterval(this.flushInterval)
    this.flush()
  }
}
