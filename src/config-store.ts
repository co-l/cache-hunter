import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'

export interface StoredProxyConfig {
  targetHost: string
  targetPort: number
  proxyPort: number
}

const CONFIG_FILENAME = 'proxy-config.json'

export function getConfigPath(dataDir: string): string {
  return join(dataDir, CONFIG_FILENAME)
}

export function loadProxyConfig(dataDir: string, envFallback: StoredProxyConfig): StoredProxyConfig {
  const path = getConfigPath(dataDir)
  if (existsSync(path)) {
    try {
      const raw = readFileSync(path, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<StoredProxyConfig>
      return {
        targetHost: parsed.targetHost ?? envFallback.targetHost,
        targetPort: parsed.targetPort ?? envFallback.targetPort,
        proxyPort: parsed.proxyPort ?? envFallback.proxyPort,
      }
    } catch {
      // corrupt file, fall through
    }
  }
  return envFallback
}

export function saveProxyConfig(dataDir: string, config: StoredProxyConfig): void {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
  writeFileSync(getConfigPath(dataDir), JSON.stringify(config, null, 2))
}
