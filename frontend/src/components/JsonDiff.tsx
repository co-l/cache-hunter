import { useState, useCallback } from 'react'
import './JsonDiff.css'

interface JsonDiffProps {
  sourceA: string
  sourceB: string
}

type DiffType = 'added' | 'removed' | 'changed' | 'unchanged'

interface DiffEntry {
  type: DiffType
  path: string
  valueA?: unknown
  valueB?: unknown
}

export function JsonDiff({ sourceA, sourceB }: JsonDiffProps) {
  let parsedA: unknown
  let parsedB: unknown
  try { parsedA = JSON.parse(sourceA) } catch { parsedA = sourceA }
  try { parsedB = JSON.parse(sourceB) } catch { parsedB = sourceB }

  const diffs = computeDiff(parsedA, parsedB, '')

  if (diffs.length === 0) {
    return <div className="jd-empty">Identical</div>
  }

  return (
    <div className="jd-root">
      {diffs.map((entry, i) => (
        <DiffLine key={i} entry={entry} />
      ))}
    </div>
  )
}

function DiffLine({ entry }: { entry: DiffEntry }) {
  const [expanded, setExpanded] = useState(entry.type !== 'unchanged')
  const toggle = useCallback(() => setExpanded(e => !e), [])

  const hasChildren = entry.type === 'changed' &&
    typeof entry.valueA === 'object' && entry.valueA !== null &&
    typeof entry.valueB === 'object' && entry.valueB !== null

  const icon = entry.type === 'added' ? '+'
    : entry.type === 'removed' ? '−'
    : entry.type === 'changed' ? '∼'
    : ' '

  return (
    <div className={`jd-line jd-${entry.type}`}>
      <span className="jd-icon">{icon}</span>
      <span className="jd-path">{entry.path}</span>
      {hasChildren && (
        <span className="jd-toggle" onClick={toggle}>
          {expanded ? '▼' : '▶'}
        </span>
      )}
      {!hasChildren && entry.type === 'changed' && (
        <span className="jd-values">
          <span className="jd-val-old">{fmtValue(entry.valueA)}</span>
          <span className="jd-arrow">→</span>
          <span className="jd-val-new">{fmtValue(entry.valueB)}</span>
        </span>
      )}
      {entry.type === 'added' && !hasChildren && (
        <span className="jd-values">
          <span className="jd-val-new">{fmtValue(entry.valueB)}</span>
        </span>
      )}
      {entry.type === 'removed' && !hasChildren && (
        <span className="jd-values">
          <span className="jd-val-old">{fmtValue(entry.valueA)}</span>
        </span>
      )}
      {hasChildren && expanded && (
        <div className="jd-children">
          {computeDiff(entry.valueA, entry.valueB, entry.path).map((child, i) => (
            <DiffLine key={i} entry={child} />
          ))}
        </div>
      )}
    </div>
  )
}

function computeDiff(a: unknown, b: unknown, basePath: string): DiffEntry[] {
  const results: DiffEntry[] = []

  if (a === b) return results

  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
    results.push({ type: 'changed', path: basePath || '(root)', valueA: a, valueB: b })
    return results
  }

  const objA = a as Record<string, unknown>
  const objB = b as Record<string, unknown>
  const allKeys = [...new Set([...Object.keys(objA), ...Object.keys(objB)])].sort()

  for (const key of allKeys) {
    const path = basePath ? `${basePath}.${key}` : key
    const hasA = key in objA
    const hasB = key in objB

    if (!hasA) {
      results.push({ type: 'added', path, valueB: objB[key] })
    } else if (!hasB) {
      results.push({ type: 'removed', path, valueA: objA[key] })
    } else if (isEqual(objA[key], objB[key])) {
      results.push({ type: 'unchanged', path, valueA: objA[key], valueB: objB[key] })
    } else if (typeof objA[key] === 'object' && objA[key] !== null && typeof objB[key] === 'object' && objB[key] !== null) {
      results.push({ type: 'changed', path, valueA: objA[key], valueB: objB[key] })
    } else {
      results.push({ type: 'changed', path, valueA: objA[key], valueB: objB[key] })
    }
  }

  return results
}

function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    const objA = a as Record<string, unknown>
    const objB = b as Record<string, unknown>
    const keysA = Object.keys(objA)
    const keysB = Object.keys(objB)
    if (keysA.length !== keysB.length) return false
    return keysA.every(k => isEqual(objA[k], objB[k]))
  }
  return false
}

function fmtValue(val: unknown): string {
  if (val === null) return 'null'
  if (val === undefined) return 'undefined'
  if (typeof val === 'string') {
    if (val.length > 60) return `"${val.slice(0, 57)}..."`
    return `"${val}"`
  }
  if (typeof val === 'object') {
    const json = JSON.stringify(val)
    if (json.length > 60) return json.slice(0, 57) + '...'
    return json
  }
  return String(val)
}
