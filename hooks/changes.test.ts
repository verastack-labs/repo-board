import { describe, expect, test } from 'claude-code/testing'

import type { OwnerState, Pull } from '../types'
import { collapse, dueToasts } from './changes'

function pull(number: number, author: string, more: Partial<Pull> = {}): Pull {
  return {
    number,
    title: `Change ${number}`,
    url: `https://github.com/o/r/pull/${number}`,
    author,
    isDraft: false,
    createdAt: '2026-10-11T12:00:00.000Z',
    review: 'none',
    checks: 'passing',
    ...more,
  }
}

function owner(repos: Record<string, Pull[]>): OwnerState {
  return {
    checkedAt: 0,
    repos: Object.entries(repos).map(([name, pulls]) => ({ owner: 'o', name, url: `https://github.com/o/${name}`, pulls, pullCount: pulls.length })),
  }
}

describe('dueToasts', () => {
  test('the first query of an owner toasts nothing', () => {
    expect(dueToasts(undefined, owner({ r: [pull(1, 'bot', { checks: 'failing' })] }), 'me')).toEqual([])
  })
  test('checks turning failed toast once, for anyone\'s PR', () => {
    const before = owner({ r: [pull(1, 'me', { checks: 'pending' }), pull(2, 'bot')] })
    const after = owner({ r: [pull(1, 'me', { checks: 'failing' }), pull(2, 'bot', { checks: 'failing' })] })
    expect(dueToasts(before, after, 'me')).toEqual(['r #1: checks failing', 'r #2: checks failing'])
    expect(dueToasts(after, after, 'me')).toEqual([])
  })
  test('failing, recovering, then failing again toasts twice', () => {
    const failing = owner({ r: [pull(1, 'me', { checks: 'failing' })] })
    const passing = owner({ r: [pull(1, 'me', { checks: 'passing' })] })
    expect(dueToasts(passing, failing, 'me')).toEqual(['r #1: checks failing'])
    expect(dueToasts(failing, passing, 'me')).toEqual([])
    expect(dueToasts(passing, failing, 'me')).toEqual(['r #1: checks failing'])
  })
  test('a review decision on your PR toasts; on someone else\'s it does not', () => {
    const before = owner({ r: [pull(1, 'me'), pull(2, 'me'), pull(3, 'bot')] })
    const after = owner({
      r: [pull(1, 'me', { review: 'approved' }), pull(2, 'Me', { review: 'changes' }), pull(3, 'bot', { review: 'approved' })],
    })
    expect(dueToasts(before, after, 'me')).toEqual(['r #1: approved', 'r #2: changes requested'])
  })
  test('review required does not toast', () => {
    expect(dueToasts(owner({ r: [pull(1, 'me')] }), owner({ r: [pull(1, 'me', { review: 'required' })] }), 'me')).toEqual([])
  })
  test('a new PR from someone else toasts as new only, even when already failing', () => {
    const before = owner({ r: [] })
    const after = owner({ r: [pull(7, 'dependabot', { checks: 'failing' })] })
    expect(dueToasts(before, after, 'me')).toEqual(['r #7: new PR from dependabot'])
  })
  test('your own new PR is not news, but failing checks on it are', () => {
    const before = owner({ r: [] })
    expect(dueToasts(before, owner({ r: [pull(8, 'me')] }), 'me')).toEqual([])
    expect(dueToasts(before, owner({ r: [pull(8, 'me', { checks: 'failing' })] }), 'me')).toEqual(['r #8: checks failing'])
  })
  test('a PR in a repo new since the last query is new', () => {
    expect(dueToasts(owner({}), owner({ fresh: [pull(1, 'bot')] }), 'me')).toEqual(['fresh #1: new PR from bot'])
  })
  test('with no known login every PR counts as someone else\'s', () => {
    const before = owner({ r: [pull(1, 'me')] })
    expect(dueToasts(before, owner({ r: [pull(1, 'me', { review: 'approved' }), pull(2, 'me')] }), null)).toEqual(['r #2: new PR from me'])
  })
})

describe('collapse', () => {
  test('keeps up to 3 toasts and folds more into one', () => {
    expect(collapse(['a', 'b', 'c'])).toEqual(['a', 'b', 'c'])
    expect(collapse(['a', 'b', 'c', 'd'])).toEqual(['4 GitHub updates, open /repos'])
    expect(collapse([])).toEqual([])
  })
})
