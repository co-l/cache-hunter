import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, existsSync, rmSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { loadProxyConfig, saveProxyConfig, getConfigPath } from './config-store.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TEST_DIR = join(__dirname, '..', 'data-test-config-store')

describe('config-store', () => {
  beforeEach(() => {
    if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  const envFallback = { targetHost: 'fallback.host', targetPort: 9999, proxyPort: 7777 }

  it('returns env fallback when no config file exists', () => {
    const cfg = loadProxyConfig(TEST_DIR, envFallback)
    expect(cfg).toEqual(envFallback)
  })

  it('reads config from file when it exists', () => {
    const saved = { targetHost: '10.0.0.1', targetPort: 8080, proxyPort: 8888 }
    saveProxyConfig(TEST_DIR, saved)

    const loaded = loadProxyConfig(TEST_DIR, envFallback)
    expect(loaded).toEqual(saved)
  })

  it('merges partial config with env fallback', () => {
    const partial = { targetHost: '10.0.0.1', targetPort: 1234 } as any
    saveProxyConfig(TEST_DIR, partial)

    const loaded = loadProxyConfig(TEST_DIR, envFallback)
    expect(loaded.targetHost).toBe('10.0.0.1')
    expect(loaded.targetPort).toBe(1234)
    expect(loaded.proxyPort).toBe(envFallback.proxyPort)
  })

  it('falls through on corrupt file', () => {
    const path = getConfigPath(TEST_DIR)
    saveProxyConfig(TEST_DIR, { targetHost: 'x', targetPort: 1, proxyPort: 2 })
    // corrupt it
    const { writeFileSync } = require('fs')
    writeFileSync(path, '{invalid json')

    const loaded = loadProxyConfig(TEST_DIR, envFallback)
    expect(loaded).toEqual(envFallback)
  })

  it('writes valid JSON to disk', () => {
    const cfg = { targetHost: 'a.b.c', targetPort: 1111, proxyPort: 2222 }
    saveProxyConfig(TEST_DIR, cfg)

    const raw = readFileSync(getConfigPath(TEST_DIR), 'utf-8')
    expect(JSON.parse(raw)).toEqual(cfg)
  })
})
