import { describe, it, expect } from 'vitest';
import { computeIsDiffCell } from './hashDiff.js';

const HASH_A = 'aaaa'
const HASH_B = 'bbbb'
const HASH_C = 'cccc'

function set(...cols: number[]): ReadonlySet<number> {
  return new Set(cols)
}

describe('computeIsDiffCell', () => {
  it('marks a change within the same continuous thread', () => {
    expect(computeIsDiffCell([HASH_A, HASH_B], [0, 0], set(), 1)).toBe(true)
  })

  it('does not mark a change against a column from another thread', () => {
    expect(computeIsDiffCell([HASH_A, HASH_B], [0, 1], set(), 1)).toBe(false)
  })

  it('marks an interrupted-thread resume that differs from its end-of-context', () => {
    const rowHashes = [HASH_A, HASH_B, HASH_B, HASH_C]
    const colThread = [0, 1, 1, 0]
    expect(computeIsDiffCell(rowHashes, colThread, set(), 3)).toBe(true)
  })

  it('does not mark an interrupted-thread resume identical to its end-of-context', () => {
    const rowHashes = [HASH_A, HASH_B, HASH_B, HASH_A]
    const colThread = [0, 1, 1, 0]
    expect(computeIsDiffCell(rowHashes, colThread, set(), 3)).toBe(false)
  })

  it('skips excluded intervening columns and compares to the earlier same-thread column', () => {
    expect(computeIsDiffCell([HASH_A, HASH_B, HASH_C], [0, 0, 0], set(1), 2)).toBe(true)
    expect(computeIsDiffCell([HASH_A, HASH_B, HASH_A], [0, 0, 0], set(1), 2)).toBe(false)
  })

  it('does not mark the first column of a thread (no same-thread predecessor)', () => {
    expect(computeIsDiffCell([HASH_A, HASH_B], [0, 1], set(), 1)).toBe(false)
    expect(computeIsDiffCell([HASH_A, HASH_B], [0, 0], set(), 0)).toBe(false)
  })

  it('does not mark empty or null cells', () => {
    expect(computeIsDiffCell([null, HASH_B], [0, 0], set(), 1)).toBe(false)
    expect(computeIsDiffCell([HASH_A, null], [0, 0], set(), 1)).toBe(false)
    expect(computeIsDiffCell(['', HASH_B], [0, 0], set(), 1)).toBe(false)
  })

  it('falls back to cross-thread comparison when thread metadata is missing', () => {
    expect(computeIsDiffCell([HASH_A, HASH_B], [undefined, undefined], set(), 1)).toBe(true)
    expect(computeIsDiffCell([HASH_A, HASH_B], [], set(), 1)).toBe(true)
  })

  describe('tools row invalidation (isToolsRow)', () => {
    it('marks an empty tools cell as diff when the previous same-thread column had tools', () => {
      expect(computeIsDiffCell([HASH_A, null], [0, 0], set(), 1, true)).toBe(true)
      expect(computeIsDiffCell([HASH_A, ''], [0, 0], set(), 1, true)).toBe(true)
    })

    it('does not mark an empty tools cell when the previous same-thread column had no tools', () => {
      expect(computeIsDiffCell([null, null], [0, 0], set(), 1, true)).toBe(false)
      expect(computeIsDiffCell(['', null], [0, 0], set(), 1, true)).toBe(false)
    })

    it('does not mark an empty tools cell when there is no same-thread predecessor', () => {
      expect(computeIsDiffCell([HASH_A, null], [0, 1], set(), 1, true)).toBe(false)
      expect(computeIsDiffCell([null], [0], set(), 0, true)).toBe(false)
    })

    it('skips excluded intervening tools columns and compares to the earlier same-thread column', () => {
      expect(computeIsDiffCell([HASH_A, HASH_B, null], [0, 0, 0], set(1), 2, true)).toBe(true)
      expect(computeIsDiffCell([HASH_A, null, null], [0, 0, 0], set(1), 2, true)).toBe(true)
      expect(computeIsDiffCell([null, HASH_B, null], [0, 0, 0], set(1), 2, true)).toBe(false)
    })

    it('keeps normal non-empty diff behavior on the tools row', () => {
      expect(computeIsDiffCell([HASH_A, HASH_B], [0, 0], set(), 1, true)).toBe(true)
      expect(computeIsDiffCell([HASH_A, HASH_A], [0, 0], set(), 1, true)).toBe(false)
    })
  })
});
