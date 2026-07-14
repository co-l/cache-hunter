import { useState, useCallback } from 'react'
import './JsonViewer.css'

interface JsonViewerProps {
  data: string
}

export function JsonViewer({ data }: JsonViewerProps) {
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    return <pre className="jv-root jv-string">{data}</pre>
  }

  return (
    <div className="jv-root">
      <JsonNode value={parsed} depth={0} />
    </div>
  )
}

function JsonNode({ value, depth, keyLabel }: { value: unknown; depth: number; keyLabel?: string }) {
  if (value === null) return <span className="jv-null">null</span>
  if (value === undefined) return <span className="jv-null">undefined</span>

  if (typeof value === 'string') {
    return (
      <span>
        {keyLabel && <span className="jv-key">{keyLabel}: </span>}
        <span className="jv-string">"{escapeJson(value)}"</span>
      </span>
    )
  }

  if (typeof value === 'number') {
    return (
      <span>
        {keyLabel && <span className="jv-key">{keyLabel}: </span>}
        <span className="jv-number">{String(value)}</span>
      </span>
    )
  }

  if (typeof value === 'boolean') {
    return (
      <span>
        {keyLabel && <span className="jv-key">{keyLabel}: </span>}
        <span className="jv-boolean">{String(value)}</span>
      </span>
    )
  }

  if (Array.isArray(value)) {
    return <JsonArray arr={value} depth={depth} keyLabel={keyLabel} />
  }

  if (typeof value === 'object') {
    return <JsonObject obj={value as Record<string, unknown>} depth={depth} keyLabel={keyLabel} />
  }

  return <span>{String(value)}</span>
}

function JsonArray({ arr, depth, keyLabel }: { arr: unknown[]; depth: number; keyLabel?: string }) {
  const [collapsed, setCollapsed] = useState(depth > 2)
  const toggle = useCallback(() => setCollapsed(c => !c), [])

  if (arr.length === 0) {
    return (
      <span>
        {keyLabel && <span className="jv-key">{keyLabel}: </span>}
        <span className="jv-bracket">[ ]</span>
      </span>
    )
  }

  return (
    <span>
      {keyLabel && <span className="jv-key">{keyLabel}: </span>}
      <span className="jv-toggle" onClick={toggle}>{collapsed ? '▶' : '▼'}</span>
      <span className="jv-bracket">[</span>
      {collapsed ? (
        <span className="jv-ellipsis"> … </span>
      ) : (
        <span className="jv-children">
          {arr.map((item, i) => (
            <div key={i} className="jv-entry" style={{ paddingLeft: `${(depth + 1) * 16}px` }}>
              <JsonNode value={item} depth={depth + 1} />
              {i < arr.length - 1 && <span className="jv-comma">,</span>}
            </div>
          ))}
        </span>
      )}
      <span className="jv-bracket">]</span>
    </span>
  )
}

function JsonObject({ obj, depth, keyLabel }: { obj: Record<string, unknown>; depth: number; keyLabel?: string }) {
  const [collapsed, setCollapsed] = useState(depth > 2)
  const toggle = useCallback(() => setCollapsed(c => !c), [])

  const keys = Object.keys(obj)
  if (keys.length === 0) {
    return (
      <span>
        {keyLabel && <span className="jv-key">{keyLabel}: </span>}
        <span className="jv-bracket">{'{ }'}</span>
      </span>
    )
  }

  return (
    <span>
      {keyLabel && <span className="jv-key">{keyLabel}: </span>}
      <span className="jv-toggle" onClick={toggle}>{collapsed ? '▶' : '▼'}</span>
      <span className="jv-bracket">{'{'}</span>
      {collapsed ? (
        <span className="jv-ellipsis"> … </span>
      ) : (
        <span className="jv-children">
          {keys.map((key) => (
            <div key={key} className="jv-entry" style={{ paddingLeft: `${(depth + 1) * 16}px` }}>
              <JsonNode value={obj[key]} depth={depth + 1} keyLabel={key} />
              <span className="jv-comma">,</span>
            </div>
          ))}
        </span>
      )}
      <span className="jv-bracket">{'}'}</span>
    </span>
  )
}

function escapeJson(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
}
