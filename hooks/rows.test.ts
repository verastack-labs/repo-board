import { describe, expect, test } from 'claude-code/testing'

import type { LocalState, OwnerState, Pull } from '../types'
import { ownersFor, readConfig } from './config'
import { HOUR, NOW } from './helpers'
import { attention, buildGroups, marker, topPull } from './rows'
import type { BoardData } from './rows'
import { statusText } from './status'

const CLEAN: LocalState = { branch: 'main', upstream: 'origin/main', ahead: 0, behind: 0, changed: 0, isStale: false }

function pull(number: number, more: Partial<Pull> = {}): Pull {
  return {
    number,
    title: `Change ${number}`,
    url: `https://github.com/o/r/pull/${number}`,
    author: 'me',
    isDraft: false,
    createdAt: new Date(NOW - 72 * HOUR).toISOString(),
    review: 'none',
    checks: 'passing',
    ...more,
  }
}

function owner(name: string, repos: Record<string, Pull[]>): OwnerState {
  return {
    checkedAt: NOW,
    repos: Object.entries(repos).map(([repo, pulls]) => ({
      owner: name,
      name: repo,
      url: `https://github.com/${name}/${repo}`,
      pulls,
      pullCount: pulls.length,
    })),
  }
}

describe('readConfig and ownersFor', () => {
  test('fills defaults, trims lists and bounds the depth', () => {
    expect(readConfig({ owners: [' verastack-labs ', ''], roots: ['~/Documents'], scanDepth: 9.7, includeMyAccount: true })).toEqual({
      owners: ['verastack-labs'],
      includeMyAccount: true,
      roots: ['~/Documents'],
      scanDepth: 6,
    })
    expect(readConfig({})).toEqual({ owners: [], includeMyAccount: true, roots: [], scanDepth: 3 })
    expect(readConfig({ includeMyAccount: false, scanDepth: -2 }).scanDepth).toBe(0)
  })
  test('adds the login once, after the configured owners', () => {
    const config = readConfig({ owners: ['verastack-labs'] })
    expect(ownersFor(config, 'riganb')).toEqual(['verastack-labs', 'riganb'])
    expect(ownersFor(config, null)).toEqual(['verastack-labs'])
    expect(ownersFor(readConfig({ owners: ['RigAnB'] }), 'riganb')).toEqual(['RigAnB'])
    expect(ownersFor(readConfig({ owners: ['verastack-labs'], includeMyAccount: false }), 'riganb')).toEqual(['verastack-labs'])
  })
})

describe('marker and topPull', () => {
  test('ranks failing, changes requested, approved, new, open, and drafts last', () => {
    expect(marker(pull(1, { checks: 'failing', review: 'approved' }), 'me', NOW)).toBe('failing')
    expect(marker(pull(1, { review: 'changes' }), 'me', NOW)).toBe('changes')
    expect(marker(pull(1, { review: 'approved' }), 'me', NOW)).toBe('approved')
    expect(marker(pull(1, { author: 'bot', createdAt: new Date(NOW - HOUR).toISOString() }), 'me', NOW)).toBe('new')
    expect(marker(pull(1, { author: 'bot', createdAt: new Date(NOW - 25 * HOUR).toISOString() }), 'me', NOW)).toBe('open')
    expect(marker(pull(1, { createdAt: new Date(NOW - HOUR).toISOString() }), 'me', NOW)).toBe('open')
    const pulls = [pull(1), pull(2, { review: 'approved' }), pull(3, { checks: 'failing', isDraft: true }), pull(4, { review: 'changes' })]
    expect(topPull(pulls, 'me', NOW)).toEqual({ pull: pulls[3], marker: 'changes' })
    expect(topPull([], 'me', NOW)).toBeNull()
  })
})

describe('buildGroups', () => {
  const data: BoardData = {
    owners: ['verastack-labs', 'riganb'],
    github: {
      'verastack-labs': owner('verastack-labs', {
        oinkbuns: [],
        'riggit-internal': [],
        'rigseed-app': [pull(14, { checks: 'failing' })],
        'session-meter': [],
        studio: [],
        'social-docs': [],
      }),
      riganb: owner('riganb', { dotfiles: [] }),
    },
    clones: {
      'verastack-labs/riggit-internal': { owner: 'Verastack-Labs', name: 'Riggit-Internal', paths: ['C:/r/riggit'] },
      'verastack-labs/rigseed-app': { owner: 'verastack-labs', name: 'rigseed-app', paths: ['C:/r/rigseed-app'] },
      'verastack-labs/session-meter': { owner: 'verastack-labs', name: 'session-meter', paths: ['C:/r/a', 'C:/r/b'] },
      'verastack-labs/studio': { owner: 'verastack-labs', name: 'studio', paths: ['C:/r/studio'] },
      'verastack-labs/social-docs': { owner: 'verastack-labs', name: 'social-docs', paths: ['C:/r/social-docs'] },
      'riganb/dotfiles': { owner: 'riganb', name: 'dotfiles', paths: ['C:/r/dotfiles'] },
      'someone/else': { owner: 'someone', name: 'else', paths: ['C:/r/else'] },
    },
    local: {
      'C:/r/riggit': CLEAN,
      'C:/r/rigseed-app': { ...CLEAN, behind: 3 },
      'C:/r/a': { ...CLEAN, ahead: 1 },
      'C:/r/studio': { ...CLEAN, behind: 2 },
      'C:/r/social-docs': { ...CLEAN, changed: 2 },
      'C:/r/dotfiles': { ...CLEAN, changed: 1 },
    },
    fetchFailed: ['C:/r/studio'],
  }

  test('groups by owner in order and sorts by what needs attention', () => {
    const groups = buildGroups(data)
    expect(groups.map(group => group.owner)).toEqual(['verastack-labs', 'riganb'])
    expect(groups[0]?.rows.map(row => row.name)).toEqual(['rigseed-app', 'session-meter', 'social-docs', 'riggit-internal', 'studio', 'oinkbuns'])
  })
  test('joins clones whatever the case of their remote, using the first clone', () => {
    const rows = buildGroups(data)[0]?.rows ?? []
    expect(rows.find(row => row.name === 'riggit-internal')?.local).toEqual(CLEAN)
    expect(rows.find(row => row.name === 'session-meter')?.paths).toEqual(['C:/r/a', 'C:/r/b'])
    expect(rows.find(row => row.name === 'oinkbuns')).toMatchObject({ paths: [], local: null })
  })
  test('marks a failed fetch, and an unknown behind count does not rank as unpulled', () => {
    const studio = buildGroups(data)[0]?.rows.find(row => row.name === 'studio')
    expect(studio?.isFetchFailed).toBe(true)
    expect(studio === undefined ? -1 : attention(studio)).toBe(4)
  })
  test('without GitHub, rows come from the owner\'s clones', () => {
    const groups = buildGroups({ ...data, github: {} })
    expect(groups[0]?.rows.map(row => row.name)).toEqual(['session-meter', 'social-docs', 'rigseed-app', 'Riggit-Internal', 'studio'])
    expect(groups[0]?.rows.find(row => row.name === 'Riggit-Internal')?.url).toBe('https://github.com/Verastack-Labs/Riggit-Internal')
    expect(groups.flatMap(group => group.rows).some(row => row.name === 'else')).toBe(false)
  })
  test('an owner with nothing to show has no group', () => {
    expect(buildGroups({ ...data, owners: ['nobody'] })).toEqual([])
  })
})

describe('statusText', () => {
  test('counts failing, unpushed and dirty repos in that order', () => {
    const groups = buildGroups({
      owners: ['o'],
      github: { o: owner('o', { a: [pull(1, { checks: 'failing' }), pull(2, { checks: 'failing' })], b: [], c: [], d: [] }) },
      clones: {
        'o/b': { owner: 'o', name: 'b', paths: ['C:/b'] },
        'o/c': { owner: 'o', name: 'c', paths: ['C:/c'] },
        'o/d': { owner: 'o', name: 'd', paths: ['C:/d'] },
      },
      local: { 'C:/b': { ...CLEAN, ahead: 2, changed: 1 }, 'C:/c': { ...CLEAN, upstream: null, ahead: 1 }, 'C:/d': { ...CLEAN, behind: 9 } },
      fetchFailed: [],
    })
    expect(statusText(groups)).toBe('1 failing · 2 unpushed · 1 dirty')
  })
  test('clears when nothing needs attention', () => {
    expect(statusText([])).toBeUndefined()
    expect(statusText(buildGroups({ owners: ['o'], github: { o: owner('o', { a: [] }) }, clones: {}, local: {}, fetchFailed: [] }))).toBeUndefined()
  })
})

test('ownersFor drops an owner listed twice in any case', () => {
  expect(ownersFor(readConfig({ owners: ['verastack-labs', 'Verastack-Labs', 'riganb'] }), 'RigAnB')).toEqual(['verastack-labs', 'riganb'])
})
