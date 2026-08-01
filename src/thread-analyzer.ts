import { createHash } from 'crypto'

export const MAX_TITLE_LEN = 60

export type ThreadKind = 'primary' | 'subagent' | 'title'

export interface ThreadInfo {
  id: number
  kind: ThreadKind
  label: string
  callIndices: number[]
  hashCount: number
}

export interface ThreadAnalysis {
  threads: ThreadInfo[]
  columnThread: number[]
  primaryThread: number
}

export interface CompletionLike {
  messages: Array<Record<string, unknown>>
  tools?: any[]
}

function serializeMessage(msg: Record<string, unknown>): string {
  return JSON.stringify(msg, Object.keys(msg).sort())
}

function fullHash(value: string): string {
  return createHash('md5').update(value).digest('hex')
}

function nonSystemHashes(messages: Array<Record<string, unknown>>): Set<string> {
  const hashes = new Set<string>()
  for (const m of messages) {
    if (m.role === 'system') continue
    hashes.add(fullHash(serializeMessage(m)))
  }
  return hashes
}

function contentToString(content: unknown): string | null {
  if (typeof content === 'string' && content.trim()) return content
  if (Array.isArray(content)) {
    const parts = content
      .map((part: any) => (part && typeof part.text === 'string' ? part.text : ''))
      .filter(Boolean)
    if (parts.length) return parts.join('\n')
  }
  return null
}

function titleCandidateFrom(content: string): string | null {
  const lines = content.split('\n')
  let inTagBlock = false
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (!inTagBlock && line.startsWith('<') && !line.includes('</')) {
      inTagBlock = true
      continue
    }
    if (inTagBlock) {
      if (line.includes('</')) inTagBlock = false
      continue
    }
    if (line.startsWith('<') && line.endsWith('>')) continue
    const cleaned = line.replace(/^#{1,6}\s*/, '').replace(/^[-*+]\s*/, '').trim()
    if (cleaned.length >= 10) return cleaned
  }
  return null
}

export function generateSessionTitle(
  completions: CompletionLike[],
  analysis?: ThreadAnalysis
): string {
  const resolved = analysis ?? analyzeThreads(completions)
  const primary = resolved.threads.find(t => t.kind === 'primary')
  if (!primary) return 'Untitled session'

  for (const idx of primary.callIndices) {
    const completion = completions[idx]
    if (!completion) continue
    for (const m of completion.messages) {
      if (m.role !== 'user') continue
      const content = contentToString(m.content)
      if (!content) continue
      const candidate = titleCandidateFrom(content)
      if (candidate) {
        if (candidate.length > MAX_TITLE_LEN) return candidate.slice(0, MAX_TITLE_LEN) + '…'
        return candidate
      }
    }
  }

  for (const idx of primary.callIndices) {
    const completion = completions[idx]
    if (!completion) continue
    for (const m of completion.messages) {
      if (m.role !== 'user') continue
      const content = contentToString(m.content)
      if (content) {
        const fallback = content.replace(/\s+/g, ' ').trim()
        if (fallback.length > MAX_TITLE_LEN) return fallback.slice(0, MAX_TITLE_LEN) + '…'
        if (fallback) return fallback
      }
    }
  }

  return 'Untitled session'
}

export function isTitleGenCall(completion: CompletionLike): boolean {
  if (completion.tools && completion.tools.length > 0) return false
  const texts = completion.messages
    .map(m => contentToString(m.content) || '')
    .join(' ')
  if (!texts.trim()) return false
  if (/title generator/i.test(texts)) return true
  if (/generate.{0,40}session name/i.test(texts)) return true
  if (/generate.{0,50}title.{0,60}(conversation|thread|session)/i.test(texts)) return true
  if (/session name.{0,50}(max|up to).{0,20}\bcharacter/i.test(texts)) return true
  return false
}

interface InternalThread {
  id: number
  kind: ThreadKind
  hashes: Set<string>
  callIndices: number[]
  hashCount: number
  last: number
}

export function analyzeThreads(completions: CompletionLike[]): ThreadAnalysis {
  const threads: InternalThread[] = []
  const columnThread: number[] = new Array(completions.length).fill(-1)

  completions.forEach((completion, idx) => {
    const hashes = nonSystemHashes(completion.messages)

    if (isTitleGenCall(completion)) {
      const thread: InternalThread = {
        id: threads.length,
        kind: 'title',
        hashes: new Set(),
        callIndices: [idx],
        hashCount: 0,
        last: idx,
      }
      threads.push(thread)
      columnThread[idx] = thread.id
      return
    }

    if (hashes.size === 0) {
      return
    }

    let best = -1
    let bestOverlap = 0
    let bestLast = -1
    threads.forEach((thread, ti) => {
      if (thread.kind === 'title') return
      let overlap = 0
      for (const h of hashes) {
        if (thread.hashes.has(h)) overlap++
      }
      if (overlap > bestOverlap || (overlap === bestOverlap && overlap > 0 && thread.last > bestLast)) {
        best = ti
        bestOverlap = overlap
        bestLast = thread.last
      }
    })

    if (bestOverlap > 0 && best !== -1) {
      const thread = threads[best]
      for (const h of hashes) {
        if (!thread.hashes.has(h)) {
          thread.hashes.add(h)
          thread.hashCount++
        }
      }
      thread.callIndices.push(idx)
      thread.last = idx
      columnThread[idx] = thread.id
    } else {
      const thread: InternalThread = {
        id: threads.length,
        kind: 'subagent',
        hashes: hashes,
        callIndices: [idx],
        hashCount: hashes.size,
        last: idx,
      }
      threads.push(thread)
      columnThread[idx] = thread.id
    }
  })

  const orphanIndices = completions
    .map((_, idx) => idx)
    .filter(idx => columnThread[idx] === -1)
  const isNonTitleAssigned = (j: number): boolean =>
    columnThread[j] !== -1 && threads[columnThread[j]].kind !== 'title'
  for (const idx of orphanIndices) {
    const fwd = completions.findIndex((_, j) => j > idx && isNonTitleAssigned(j))
    let anchor = -1
    if (fwd !== -1) {
      anchor = fwd
    } else {
      for (let j = idx - 1; j >= 0; j--) {
        if (isNonTitleAssigned(j)) { anchor = j; break }
      }
    }
    if (anchor === -1 || columnThread[anchor] === -1) continue
    const tid = columnThread[anchor]
    const thread = threads[tid]
    thread.callIndices.push(idx)
    thread.callIndices.sort((a, b) => a - b)
    columnThread[idx] = tid
  }

  const nonTitle = threads.filter(t => t.kind !== 'title')
  let primaryThread = -1
  let primaryScore = -1
  let primaryFirst = Infinity
  for (const t of nonTitle) {
    const first = t.callIndices[0]
    const score = t.hashCount
    if (score > primaryScore || (score === primaryScore && first < primaryFirst)) {
      primaryThread = t.id
      primaryScore = score
      primaryFirst = first
    }
  }

  if (primaryThread !== -1) {
    threads[primaryThread].kind = 'primary'
  }

  let subCounter = 0
  const infos: ThreadInfo[] = threads.map(t => {
    let label: string
    if (t.kind === 'primary') label = 'main'
    else if (t.kind === 'title') label = 'title'
    else {
      subCounter++
      label = `sub #${subCounter}`
    }
    return {
      id: t.id,
      kind: t.kind,
      label,
      callIndices: [...t.callIndices],
      hashCount: t.hashCount,
    }
  })

  return {
    threads: infos,
    columnThread,
    primaryThread,
  }
}
