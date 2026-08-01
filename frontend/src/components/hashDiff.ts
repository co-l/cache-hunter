export function computeIsDiffCell(
  rowHashes: (string | null)[],
  colThread: (number | undefined)[],
  excludedCols: ReadonlySet<number>,
  colIdx: number
): boolean {
  const cellHash = rowHashes[colIdx]?.trim()
  if (!cellHash) return false

  const tid = colThread[colIdx]
  for (let c = colIdx - 1; c >= 0; c--) {
    if (excludedCols.has(c)) continue
    if (tid !== undefined && colThread[c] !== tid) continue
    const prevHash = rowHashes[c]?.trim()
    if (!prevHash) return false
    return cellHash !== prevHash
  }
  return false
}
