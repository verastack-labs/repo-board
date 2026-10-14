import { expect, test } from 'claude-code/testing'

import { DOCS, ORG_REPOS, PATHS, callsOf, slash, stage, start } from './helpers'

const FIVE_MINUTES = 300_000
const CLONES = [PATHS.meter, PATHS.rigseed, PATHS.dotfiles, PATHS.riggit].sort()

test('startup finds clones under the home folder, checks them and GitHub, and toasts nothing', async ($, on) => {
  const world = stage(on)
  await start($, world)
  expect(callsOf(world, 'git status').map(call => call.cwd).sort()).toEqual(CLONES)
  expect(callsOf(world, 'gh api graphql').map(call => call.argv.match(/owner=(\S+)/)?.[1])).toEqual(['verastack-labs', 'riganb'])
  expect(callsOf(world, 'git fetch')).toHaveLength(0)
  expect(world.statuses.at(-1)).toBe('1 failing · 1 unpushed · 1 dirty')
  expect(world.toasts).toEqual([])
})

test('the scan skips node_modules and hidden folders and stops at the depth', async ($, on) => {
  const world = stage(on)
  await start($, world)
  expect(world.listed[0]).toBe(DOCS)
  expect(world.listed.some(path => path.includes('node_modules') || path.includes('/.cache'))).toBe(false)
  expect(world.listed).not.toContain(PATHS.deep)
  expect(callsOf(world, 'git status').some(call => call.cwd === `${DOCS}/github/other`)).toBe(false)
})

test('a deeper scan depth reaches the deep clone', { options: { scanDepth: 4 } }, async ($, on) => {
  const world = stage(on)
  world.pages['verastack-labs'] = [...ORG_REPOS, { name: 'deep' }]
  await start($, world)
  expect(callsOf(world, 'git status').some(call => call.cwd === PATHS.deep)).toBe(true)
})

test('without my account, only the configured owners are read', { options: { includeMyAccount: false } }, async ($, on) => {
  const world = stage(on)
  await start($, world)
  expect(callsOf(world, 'gh api graphql')).toHaveLength(1)
  expect(callsOf(world, 'git status').some(call => call.cwd === PATHS.dotfiles)).toBe(false)
  expect(world.statuses.at(-1)).toBe('1 failing · 1 unpushed')
})

test('without my account in the list, my own PRs are still known as mine', { options: { includeMyAccount: false } }, async ($, on) => {
  const world = stage(on)
  await start($, world)
  world.pages['verastack-labs'] = [
    ...ORG_REPOS.filter(repo => repo.name !== 'rigseed-app' && repo.name !== 'session-meter'),
    { name: 'rigseed-app', pulls: [{ number: 14, author: 'riganb', checks: 'FAILURE', review: 'APPROVED' }] },
    { name: 'session-meter', pulls: [{ number: 6, author: 'riganb' }] },
  ]
  await world.clock.advance(FIVE_MINUTES)
  expect(world.toasts).toEqual(['rigseed-app #14: approved'])
})

test('the 5-minute check toasts failing checks, a review on my PR and a new PR', async ($, on) => {
  const world = stage(on)
  await start($, world)
  world.pages['verastack-labs'] = [
    { name: 'oinkbuns', pulls: [{ number: 2, author: 'dependabot', checks: 'FAILURE' }] },
    { name: 'riggit-internal' },
    { name: 'rigseed-app', pulls: [{ number: 14, author: 'riganb', checks: 'FAILURE', review: 'APPROVED' }] },
    { name: 'session-meter', pulls: [{ number: 5, author: 'dependabot', checks: 'PENDING' }] },
  ]
  await world.clock.advance(FIVE_MINUTES)
  expect(world.toasts).toEqual(['oinkbuns #2: checks failing', 'rigseed-app #14: approved', 'session-meter #5: new PR from dependabot'])
  expect(world.statuses.at(-1)).toBe('2 failing · 1 unpushed · 1 dirty')
  await world.clock.advance(FIVE_MINUTES)
  expect(world.toasts).toHaveLength(3)
})

test('more than 3 updates collapse into one toast', async ($, on) => {
  const world = stage(on)
  await start($, world)
  world.pages['verastack-labs'] = [
    ...ORG_REPOS.filter(repo => repo.name !== 'session-meter'),
    { name: 'session-meter', pulls: [1, 2, 3, 4].map(number => ({ number, author: 'dependabot' })) },
  ]
  await world.clock.advance(FIVE_MINUTES)
  expect(world.toasts).toEqual(['4 GitHub updates, open /repos'])
})

test('a failed query keeps the last state and toasts nothing; the next compares with the kept state', async ($, on) => {
  const world = stage(on)
  await start($, world)
  world.pages['verastack-labs'] = 'auth'
  await world.clock.advance(FIVE_MINUTES)
  expect(world.toasts).toEqual([])
  expect(world.statuses.at(-1)).toBe('1 failing · 1 unpushed · 1 dirty')
  world.pages['verastack-labs'] = [...ORG_REPOS.filter(repo => repo.name !== 'session-meter'), { name: 'session-meter', pulls: [{ number: 5, author: 'bot' }] }]
  await world.clock.advance(FIVE_MINUTES)
  expect(world.toasts).toEqual(['session-meter #5: new PR from bot'])
})

test('an unknown owner fails alone; the others still update', { options: { owners: ['verastack-labs', 'nope'] } }, async ($, on) => {
  const world = stage(on)
  await start($, world)
  expect(callsOf(world, 'gh api graphql').map(call => call.argv.match(/owner=(\S+)/)?.[1])).toEqual(['verastack-labs', 'nope', 'riganb'])
  expect(world.statuses.at(-1)).toBe('1 failing · 1 unpushed · 1 dirty')
})

test('with gh missing, the local parts still show and nothing toasts', async ($, on) => {
  const world = stage(on)
  world.gh = 'missing'
  await start($, world)
  expect(world.statuses.at(-1)).toBe('1 unpushed')
  await world.clock.advance(FIVE_MINUTES)
  expect(world.toasts).toEqual([])
})

test('a slow GitHub check is never run twice at once', async ($, on) => {
  const world = stage(on)
  await start($, world)
  world.graphqlDelayMs = 6 * 60_000
  await world.clock.advance(FIVE_MINUTES)
  await world.clock.advance(FIVE_MINUTES)
  expect(callsOf(world, 'gh api graphql -f query').filter(call => call.argv.includes('owner=verastack-labs'))).toHaveLength(2)
})

test('/repos opens the pane and fetches every clone without prompting; again closes it', async ($, on) => {
  const world = stage(on)
  await start($, world)
  expect((await $.command.run(slash('repos'))).text).toBe('Pane opened.')
  await world.clock.settle()
  const fetches = callsOf(world, 'git fetch --quiet')
  expect(fetches.map(call => call.cwd).sort()).toEqual(CLONES)
  expect(fetches.every(call => call.env?.GIT_TERMINAL_PROMPT === '0' && call.env?.GCM_INTERACTIVE === 'never')).toBe(true)
  expect((await $.command.run(slash('repos'))).text).toBe('Pane closed.')
})

test('local checks run every 30 seconds only while the pane is open', async ($, on) => {
  const world = stage(on)
  await start($, world)
  const before = callsOf(world, 'git status').length
  await world.clock.advance(30_000)
  expect(callsOf(world, 'git status')).toHaveLength(before)
  await $.command.run(slash('repos'))
  await world.clock.settle()
  const opened = callsOf(world, 'git status').length
  await world.clock.advance(30_000)
  expect(callsOf(world, 'git status')).toHaveLength(opened + 4)
  await $.command.run(slash('repos'))
  await world.clock.advance(30_000)
  expect(callsOf(world, 'git status')).toHaveLength(opened + 4)
})

test('a branch with no upstream counts its commits not on any remote', async ($, on) => {
  const world = stage(on)
  world.status[PATHS.riggit] = '# branch.head spike\n'
  await start($, world)
  expect(callsOf(world, 'git rev-list --count HEAD --not --remotes').map(call => call.cwd)).toEqual([PATHS.riggit])
})
