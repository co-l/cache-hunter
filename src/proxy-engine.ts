import { createServer, IncomingMessage, ServerResponse, Server, request as httpRequest, IncomingHttpHeaders } from 'http'
import { EventEmitter } from 'events'

export interface ProxyEngineConfig {
  targetHost: string
  targetPort: number
  proxyPort: number
}

export interface ProxyRequestData {
  id: string
  timestamp: number
  method: string
  path: string
  headers: string
  body: string
  cache_salt: string | null
  client_ip: string
}

export declare interface ProxyEngine {
  on(event: 'request', listener: (data: { requestId: string; request: ProxyRequestData }) => void): this
  on(event: 'error', listener: (error: Error) => void): this
  on(event: 'start' | 'stop' | 'captureStart' | 'captureStop', listener: () => void): this
  emit(event: 'request', data: { requestId: string; request: ProxyRequestData }): boolean
  emit(event: 'error', error: Error): boolean
  emit(event: 'start' | 'stop' | 'captureStart' | 'captureStop'): boolean
}

export class ProxyEngine extends EventEmitter {
  private server: Server | null = null
  private _running = false
  private _capturing = false
  private config: ProxyEngineConfig
  private _activeModel: string | null = null

  constructor(config: ProxyEngineConfig) {
    super()
    this.config = config
  }

  get running(): boolean { return this._running }
  get capturing(): boolean { return this._capturing }
  get activeModel(): string | null { return this._activeModel }

  updateConfig(config: Partial<ProxyEngineConfig>): void {
    if (this._running) throw new Error('Cannot update config while proxy is running')
    Object.assign(this.config, config)
  }

  getConfig(): ProxyEngineConfig {
    return { ...this.config }
  }

  async start(): Promise<void> {
    if (this._running) throw new Error('Proxy is already running')

    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => this.handleRequest(req, res))
      this.server.listen(this.config.proxyPort, () => {
        const addr = this.server!.address()
        if (addr && typeof addr === 'object') {
          this.config.proxyPort = addr.port
        }
        this._running = true
        this.fetchActiveModel()
        this.emit('start')
        resolve()
      })
      this.server.on('error', (err) => {
        this._running = false
        this.server = null
        reject(err)
      })
    })
  }

  async stop(): Promise<void> {
    if (!this._running || !this.server) return

    return new Promise((resolve) => {
      this.server!.close(() => {
        this._running = false
        this._capturing = false
        this.server = null
        this.emit('stop')
        resolve()
      })
    })
  }

  startCapture(): void {
    if (!this._running) throw new Error('Proxy must be running to capture')
    if (this._capturing) return
    this._capturing = true
    this.emit('captureStart')
  }

  stopCapture(): void {
    if (!this._capturing) return
    this._capturing = false
    this.emit('captureStop')
  }

  private async fetchActiveModel(): Promise<void> {
    try {
      const res = await fetch(`http://${this.config.targetHost}:${this.config.targetPort}/v1/models`)
      const data = await res.json() as { data: Array<{ id: string }> }
      if (data.data && data.data.length > 0) {
        this._activeModel = data.data[0].id
      }
    } catch {
      // ignore
    }
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const requestId = crypto.randomUUID()
    const startTime = Date.now()
    const clientIp = req.socket.remoteAddress || 'unknown'

    let requestBody = ''

    req.on('data', (chunk) => { requestBody += chunk })

    req.on('end', () => {
      const cacheSalt = this.extractCacheSalt(requestBody)
      const requestHeaders = JSON.stringify(req.headers)

      const requestData: ProxyRequestData = {
        id: requestId,
        timestamp: startTime,
        method: req.method || 'UNKNOWN',
        path: req.url || '/',
        headers: requestHeaders,
        body: requestBody,
        cache_salt: cacheSalt,
        client_ip: clientIp,
      }

      if (this._capturing) {
        this.emit('request', { requestId, request: requestData })
      }

      const targetPath = req.url || '/'
      const targetUrl = `http://${this.config.targetHost}:${this.config.targetPort}${targetPath}`

      const proxyReq = httpRequest(targetUrl, {
        method: req.method,
        headers: req.headers,
      })

      proxyReq.on('response', (proxyRes) => {
        const responseStatusCode = proxyRes.statusCode || 0
        const responseHeaders = proxyRes.headers

        res.statusCode = responseStatusCode
        for (const [key, value] of Object.entries(responseHeaders)) {
          if (value !== undefined) res.setHeader(key, value)
        }
        res.setHeader('x-proxy-request-id', requestId)

        const isStreaming = responseHeaders['content-type']?.toString().includes('text/event-stream')

        if (isStreaming) {
          proxyRes.on('data', (chunk) => { res.write(chunk) })
          proxyRes.on('end', () => { res.end() })
        } else {
          let responseBody = ''
          proxyRes.on('data', (chunk) => { responseBody += chunk.toString() })
          proxyRes.on('end', () => {
            res.write(responseBody)
            res.end()
          })
        }
      })

      proxyReq.on('error', (error) => {
        console.error(`[Proxy] Error forwarding request: ${error.message}`)

        res.statusCode = 502
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('x-proxy-request-id', requestId)
        res.end(JSON.stringify({ error: 'Bad Gateway', message: error.message }))
      })

      proxyReq.write(requestBody)
      proxyReq.end()
    })
  }

  private extractCacheSalt(body: string): string | null {
    try {
      const parsed = JSON.parse(body)
      return parsed.cache_salt || null
    } catch { return null }
  }
}
