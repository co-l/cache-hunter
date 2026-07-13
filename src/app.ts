import express, { Request, Response } from 'express'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { ProxyEngine } from './proxy-engine.js'
import { AsyncLogger } from './logger.js'
import {
  listSessions,
  createSession,
  finalizeSession,
  deleteSession,
  deleteSessionCall,
  getSessionHashGrid,
} from './session-manager.js'
import type { WSBroadcaster } from './ws-server.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = join(__dirname, '..')
const DATA_DIR = join(PROJECT_ROOT, 'data')

export function createApp(engine: ProxyEngine, dataDir: string = DATA_DIR, broadcaster?: WSBroadcaster) {
  let currentLogger: AsyncLogger | null = null
  let currentSessionId: string | null = null

  engine.on('request', async (evt) => {
    if (currentLogger) {
      currentLogger.logRequest(evt.request)
    }
    if (broadcaster) {
      broadcaster.broadcast('request:received', { requestId: evt.requestId })
      broadcaster.broadcast('session:updated', { sessionId: currentSessionId })
    }
  })

  engine.on('error', (err) => {
    console.error('[Engine]', err.message)
  })

  const app = express()
  app.use(express.json())

  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    if (_req.method === 'OPTIONS') { res.sendStatus(204); return }
    next()
  })

  // Config
  app.get('/api/config', (_req: Request, res: Response) => {
    const cfg = engine.getConfig()
    res.json({ targetHost: cfg.targetHost, targetPort: cfg.targetPort, proxyPort: cfg.proxyPort })
  })

  app.put('/api/config', (req: Request, res: Response) => {
    if (engine.running) {
      res.status(409).json({ error: 'Cannot change config while proxy is running' })
      return
    }
    const { targetHost, targetPort } = req.body
    const updates: any = {}
    if (targetHost) updates.targetHost = targetHost
    if (targetPort) updates.targetPort = parseInt(targetPort, 10)
    engine.updateConfig(updates)
    const cfg = engine.getConfig()
    res.json({ targetHost: cfg.targetHost, targetPort: cfg.targetPort })
  })

  // Proxy
  app.post('/api/proxy/start', async (_req: Request, res: Response) => {
    try {
      await engine.start()
      res.json({ running: true })
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  app.post('/api/proxy/stop', async (_req: Request, res: Response) => {
    try {
      if (engine.capturing) await stopCapture()
      await engine.stop()
      res.json({ running: false })
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  app.get('/api/proxy/status', (_req: Request, res: Response) => {
    res.json({ running: engine.running, capturing: engine.capturing, activeModel: engine.activeModel })
  })

  // Capture
  async function startCapture(): Promise<any> {
    const cfg = engine.getConfig()
    const session = createSession(cfg.targetHost, cfg.targetPort, engine.activeModel)
    currentSessionId = session.id
    currentLogger = new AsyncLogger(join(dataDir, session.filename))
    engine.startCapture()
    if (broadcaster) broadcaster.broadcast('capture:start', { session })
    return session
  }

  async function stopCapture(): Promise<void> {
    if (currentLogger) { currentLogger.close(); currentLogger = null }
    engine.stopCapture()
    if (currentSessionId) {
      await finalizeSession(currentSessionId)
      if (broadcaster) broadcaster.broadcast('capture:stop', { sessionId: currentSessionId })
      currentSessionId = null
    }
  }

  app.post('/api/capture/start', async (_req: Request, res: Response) => {
    if (!engine.running) { res.status(400).json({ error: 'Proxy must be running to capture' }); return }
    if (engine.capturing) { res.status(409).json({ error: 'Already capturing' }); return }
    try {
      const session = await startCapture()
      res.json({ capturing: true, session })
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  app.post('/api/capture/stop', async (_req: Request, res: Response) => {
    if (!engine.capturing) { res.status(409).json({ error: 'Not capturing' }); return }
    try {
      await stopCapture()
      res.json({ capturing: false })
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // Sessions
  app.get('/api/sessions', (_req: Request, res: Response) => {
    res.json({ sessions: listSessions() })
  })

  app.get('/api/sessions/:id', async (req: Request, res: Response) => {
    try {
      const grid = await getSessionHashGrid(req.params.id)
      if (!grid) { res.status(404).json({ error: 'Session not found' }); return }
      res.json(grid)
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  app.delete('/api/sessions/:id', (req: Request, res: Response) => {
    deleteSession(req.params.id)
    res.json({ deleted: true })
  })

  app.delete('/api/sessions/:id/calls/:index', async (req: Request, res: Response) => {
    try {
      const index = parseInt(req.params.index, 10)
      if (isNaN(index) || index < 0) {
        res.status(400).json({ error: 'Invalid call index' })
        return
      }
      const ok = await deleteSessionCall(req.params.id, index)
      if (!ok) {
        res.status(404).json({ error: 'Call not found' })
        return
      }
      res.json({ deleted: true })
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  return app
}
