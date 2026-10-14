import { describe, expect, test } from 'claude-code/testing'

import { porcelain } from './helpers'
import { parseStatus } from './local'
import { mapLimit } from './pool'

describe('parseStatus', () => {
  test('reads a clean branch with an upstream', () => {
    expect(parseStatus(porcelain('main', 'origin/main'))).toEqual({ branch: 'main', upstream: 'origin/main', ahead: 0, behind: 0, changed: 0 })
  })
  test('reads ahead, behind and changed files', () => {
    expect(parseStatus(porcelain('feat/x', 'origin/feat/x', 2, 3, 4))).toEqual({
      branch: 'feat/x',
      upstream: 'origin/feat/x',
      ahead: 2,
      behind: 3,
      changed: 4,
    })
  })
  test('reads a branch with no upstream', () => {
    expect(parseStatus(porcelain('spike', null))).toEqual({ branch: 'spike', upstream: null, ahead: 0, behind: 0, changed: 0 })
  })
  test('reads a detached head as no branch', () => {
    expect(parseStatus(porcelain('(detached)', null)).branch).toBeNull()
  })
  test('counts renamed, unmerged and untracked entries, and ignores ignored ones', () => {
    const out = [
      '# branch.head main',
      '1 M. N... 100644 100644 100644 a b one.ts',
      '2 R. N... 100644 100644 100644 a b R100 new.ts\told.ts',
      'u UU N... 100644 100644 100644 100644 a b c both.ts',
      '? notes.md',
      '! dist/out.js',
    ].join('\n')
    expect(parseStatus(out).changed).toBe(4)
  })
  test('reads CRLF output', () => {
    expect(parseStatus(porcelain('main', 'origin/main', 1, 0, 1).replace(/\n/g, '\r\n'))).toEqual({
      branch: 'main',
      upstream: 'origin/main',
      ahead: 1,
      behind: 0,
      changed: 1,
    })
  })
  test('an upstream that is gone keeps zero counts', () => {
    expect(parseStatus('# branch.head main\n# branch.upstream origin/main\n')).toEqual({
      branch: 'main',
      upstream: 'origin/main',
      ahead: 0,
      behind: 0,
      changed: 0,
    })
  })
})

describe('mapLimit', () => {
  test('keeps the order and never runs more than the limit at once', async () => {
    let running = 0
    let most = 0
    const results = await mapLimit([5, 1, 4, 2, 3], 2, async (n, index) => {
      running += 1
      most = Math.max(most, running)
      await Promise.resolve()
      await Promise.resolve()
      running -= 1
      return n * 10 + index
    })
    expect(results).toEqual([50, 11, 42, 23, 34])
    expect(most).toBe(2)
  })
  test('handles an empty list', async () => {
    expect(await mapLimit([], 4, async () => 1)).toEqual([])
  })
})
