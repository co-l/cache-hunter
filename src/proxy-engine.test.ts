import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createServer, IncomingMessage } from 'http'
import { AddressInfo } from 'net'
import { ProxyEngine } from './proxy-engine.js'

describe('ProxyEngine', () => {
  let targetServer: any
  let targetPort: number

  beforeEach(async () => {
    targetServer = createServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({
            choices: [{ message: { content: 'test response' } }],
            usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
          }))
        }, 50)
      })
    })

    await new Promise<void>((resolve) => {
      targetServer.listen(0, () => {
        targetPort = (targetServer.address() as AddressInfo).port
        resolve()
      })
    })
  })

  afterEach(async () => {
    if (targetServer) {
      await new Promise<void>((resolve) => targetServer.close(() => resolve()))
    }
  })

  it('should start and stop', async () => {
    const engine = new ProxyEngine({ targetHost: 'localhost', targetPort, proxyPort: 0 })
    expect(engine.running).toBe(false)

    await engine.start()
    expect(engine.running).toBe(true)

    await engine.stop()
    expect(engine.running).toBe(false)
  })

  it('should emit start and stop events', async () => {
    const engine = new ProxyEngine({ targetHost: 'localhost', targetPort, proxyPort: 0 })
    const events: string[] = []

    engine.on('start', () => events.push('start'))
    engine.on('stop', () => events.push('stop'))

    await engine.start()
    await engine.stop()

    expect(events).toEqual(['start', 'stop'])
  })

  it('should emit request event when body is received and response event when done', async () => {
    const engine = new ProxyEngine({ targetHost: 'localhost', targetPort, proxyPort: 0 })
    const requestEvents: any[] = []
    const responseEvents: any[] = []

    engine.on('request', (evt) => requestEvents.push(evt))
    engine.on('response', (evt) => responseEvents.push(evt))

    await engine.start()
    engine.startCapture()

    const proxyPort = engine.getConfig().proxyPort

    await new Promise<void>((resolve, reject) => {
      const req = require('http').request(
        `http://localhost:${proxyPort}/v1/chat/completions`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } },
        (res: IncomingMessage) => {
          let data = ''
          res.on('data', (chunk) => { data += chunk })
          res.on('end', () => {
            try {
              expect(res.headers['x-proxy-request-id']).toBeDefined()
              expect(requestEvents.length).toBe(1)
              expect(responseEvents.length).toBe(1)
              expect(requestEvents[0].request.method).toBe('POST')
              expect(requestEvents[0].request.path).toBe('/v1/chat/completions')
              expect(responseEvents[0].response.status_code).toBe(200)
              expect(responseEvents[0].response.prompt_tokens).toBe(10)
              expect(responseEvents[0].response.completion_tokens).toBe(20)
              expect(responseEvents[0].response.total_tokens).toBe(30)
              resolve()
            } catch (error) { reject(error) }
          })
        }
      )
      req.on('error', reject)
      req.write(JSON.stringify({ prompt: 'test' }))
      req.end()
    })

    await engine.stop()
  })

  it('should not emit request or response events when not capturing', async () => {
    const engine = new ProxyEngine({ targetHost: 'localhost', targetPort, proxyPort: 0 })
    const requestEvents: any[] = []
    const responseEvents: any[] = []

    engine.on('request', (evt) => requestEvents.push(evt))
    engine.on('response', (evt) => responseEvents.push(evt))

    await engine.start()

    const proxyPort = engine.getConfig().proxyPort

    await new Promise<void>((resolve, reject) => {
      const req = require('http').request(
        `http://localhost:${proxyPort}/v1/chat/completions`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } },
        (res: IncomingMessage) => {
          let data = ''
          res.on('data', (chunk) => { data += chunk })
          res.on('end', () => {
            try {
              expect(requestEvents.length).toBe(0)
              expect(responseEvents.length).toBe(0)
              resolve()
            } catch (error) { reject(error) }
          })
        }
      )
      req.on('error', reject)
      req.write(JSON.stringify({ prompt: 'test' }))
      req.end()
    })

    await engine.stop()
  })

  it('should toggle capture state', async () => {
    const engine = new ProxyEngine({ targetHost: 'localhost', targetPort, proxyPort: 0 })
    expect(engine.capturing).toBe(false)

    await engine.start()
    engine.startCapture()
    expect(engine.capturing).toBe(true)

    engine.stopCapture()
    expect(engine.capturing).toBe(false)

    await engine.stop()
  })

  it('should error if starting proxy twice', async () => {
    const engine = new ProxyEngine({ targetHost: 'localhost', targetPort, proxyPort: 0 })
    await engine.start()
    await expect(engine.start()).rejects.toThrow('Proxy is already running')
    await engine.stop()
  })

  it('should error if capturing without proxy running', () => {
    const engine = new ProxyEngine({ targetHost: 'localhost', targetPort, proxyPort: 0 })
    expect(() => engine.startCapture()).toThrow('Proxy must be running to capture')
  })

  it('should update config only when not running', () => {
    const engine = new ProxyEngine({ targetHost: 'localhost', targetPort: 8000, proxyPort: 8080 })
    engine.updateConfig({ targetHost: '10.0.0.1', targetPort: 9000 })
    const cfg = engine.getConfig()
    expect(cfg.targetHost).toBe('10.0.0.1')
    expect(cfg.targetPort).toBe(9000)
  })

  it('should throw when updating config while running', async () => {
    const engine = new ProxyEngine({ targetHost: 'localhost', targetPort, proxyPort: 0 })
    await engine.start()
    expect(() => engine.updateConfig({ targetHost: 'other' })).toThrow('Cannot update config while proxy is running')
    await engine.stop()
  })
})
