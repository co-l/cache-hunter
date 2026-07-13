import initSqlJs from 'sql.js'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { ProxyRequestData } from './proxy-engine.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

interface RequestRecord extends ProxyRequestData {}

export class AsyncLogger {
  private queue: RequestRecord[] = []
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
    this.queue.push(request)
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
        db.run(
          `INSERT INTO requests (id, timestamp, method, path, headers, body, cache_salt, client_ip)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            entry.id,
            entry.timestamp,
            entry.method,
            entry.path,
            entry.headers,
            entry.body,
            entry.cache_salt,
            entry.client_ip,
          ]
        )
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
