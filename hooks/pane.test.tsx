import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { PANE_PROPS, PATHS, TREE, callsOf, gitConfig, slash, stage, start } from './helpers'
import type { World } from './helpers'
import { fetchText, formatAge, truncate } from './view'

const SURFACES = ['terminal', 'desktop'] as const
type Surface = (typeof SURFACES)[number]

async function mount($: Engine, surface: Surface, columns = 80) {
  return $.ui.mount({ plugin: 'repo-board', surface, component: 'Pane', requestId: 'repo-board', props: PANE_PROPS(columns) })
}

async function text(ui: Awaited<ReturnType<typeof mount>>, key: string) {
  return (await ui.find({ key }))?.text
}

async function rowOrder(ui: Awaited<ReturnType<typeof mount>>) {
  return (await ui.findAll({ type: 'Box' }))
    .map(box => box.props.key)
    .filter((key): key is string => typeof key === 'string' && key.endsWith('-repo'))
}

async function opened($: Engine, world: World) {
  await $.command.run(slash('repos'))
  await world.clock.settle()
}

for (const surface of SURFACES) {
  test(`${surface}: draws each owner's rows in attention order`, async ($, on) => {
    const world = stage(on)
    await start($, world)
    const ui = await mount($, surface)
    expect(await rowOrder(ui)).toEqual([
      'verastack-labs/rigseed-app-repo',
      'verastack-labs/session-meter-repo',
      'verastack-labs/riggit-internal-repo',
      'verastack-labs/oinkbuns-repo',
      'riganb/dotfiles-repo',
    ])
    expect(await text(ui, 'group-verastack-labs')).toBe('verastack-labs')
    expect(await text(ui, 'group-riganb')).toBe('riganb')
  })

  test(`${surface}: fills the branch, local and GitHub columns`, async ($, on) => {
    const world = stage(on)
    await start($, world)
    const ui = await mount($, surface)
    expect(await text(ui, 'verastack-labs/rigseed-app-repo')).toBe('rigseed-app')
    expect(await text(ui, 'verastack-labs/rigseed-app-branch')).toBe('feat/flathub-manifest')
    expect(await text(ui, 'verastack-labs/rigseed-app-local')).toBe('↓3')
    expect(await text(ui, 'verastack-labs/rigseed-app-github')).toBe('#14 checks failing')
    expect(await text(ui, 'verastack-labs/session-meter-local')).toBe('↑1')
    expect(await text(ui, 'verastack-labs/riggit-internal-local')).toBe('clean')
    expect(await text(ui, 'verastack-labs/oinkbuns-local')).toBe('not cloned')
    expect(await text(ui, 'verastack-labs/oinkbuns-branch')).toBe('')
    expect(await text(ui, 'verastack-labs/oinkbuns-github')).toBe('#2 new')
    expect(await text(ui, 'riganb/dotfiles-local')).toBe('2 changed')
    expect(await text(ui, 'fetched')).toBe('not fetched yet')
  })

  test(`${surface}: links the repo and the PR`, async ($, on) => {
    const world = stage(on)
    await start($, world)
    const ui = await mount($, surface)
    const hrefs = (await ui.findAll({ type: 'Link' })).map(link => link.props.href)
    expect(hrefs).toContain('https://github.com/verastack-labs/rigseed-app')
    expect(hrefs).toContain('https://github.com/verastack-labs/rigseed-app/pull/14')
    expect(hrefs).toContain('https://github.com/riganb/dotfiles')
  })

  test(`${surface}: drops the branch column under 50 columns`, async ($, on) => {
    const world = stage(on)
    await start($, world)
    const ui = await mount($, surface, 46)
    expect(await ui.find({ key: 'verastack-labs/rigseed-app-branch' })).toBeUndefined()
    expect(await text(ui, 'verastack-labs/oinkbuns-local')).toBe('not cloned')
  })

  test(`${surface}: hides the GitHub column when gh is unavailable`, async ($, on) => {
    const world = stage(on)
    world.gh = 'missing'
    await start($, world)
    const ui = await mount($, surface)
    expect(await text(ui, 'github-error')).toBe('GitHub unavailable: gh not found or timed out')
    expect(await ui.find({ key: 'verastack-labs/rigseed-app-github' })).toBeUndefined()
    expect(await text(ui, 'verastack-labs/session-meter-local')).toBe('↑1')
  })
}

test('notes extra clones and extra PRs', async ($, on) => {
  const world = stage(on, { ...TREE, 'C:/home/Documents/aaa/session-meter/.git/config': gitConfig('https://github.com/verastack-labs/session-meter.git') })
  world.pages['verastack-labs'] = [
    { name: 'rigseed-app', pullCount: 3, pulls: [{ number: 14, author: 'riganb', checks: 'FAILURE' }, { number: 12, author: 'riganb' }, { number: 9, author: 'riganb' }] },
    { name: 'session-meter' },
  ]
  await start($, world)
  const ui = await mount($, 'terminal')
  expect(await text(ui, 'verastack-labs/session-meter-repo')).toBe('session-meter +1 clone')
  expect(await text(ui, 'verastack-labs/rigseed-app-github')).toBe('#14 checks failing +2 more')
  const hrefs = (await ui.findAll({ type: 'Link' })).map(link => link.props.href)
  expect(hrefs).toContain('https://github.com/verastack-labs/rigseed-app/pulls')
})

test('shows fetch progress, then when it finished', async ($, on) => {
  const world = stage(on)
  await start($, world)
  for (const path of Object.values(PATHS)) world.fetch[path] = 'slow'
  await opened($, world)
  const ui = await mount($, 'terminal')
  expect(await text(ui, 'fetched')).toBe('fetching 0 of 4…')
  await world.clock.advance(60_000)
  expect(await text(ui, 'fetched')).toBe('fetched just now')
})

test('a failed fetch shows an unknown behind count', async ($, on) => {
  const world = stage(on)
  await start($, world)
  world.fetch[PATHS.rigseed] = 128
  await opened($, world)
  const ui = await mount($, 'terminal')
  expect(await text(ui, 'verastack-labs/rigseed-app-local')).toBe('↓?')
})

test('Refresh fetches again', async ($, on) => {
  const world = stage(on)
  await start($, world)
  const ui = await mount($, 'terminal')
  await ui.press({ key: 'refresh' })
  await world.clock.settle()
  expect(callsOf(world, 'git fetch')).toHaveLength(4)
})

test('says when git is missing', async ($, on) => {
  const world = stage(on)
  world.git = 'missing'
  await start($, world)
  const ui = await mount($, 'terminal')
  expect(await text(ui, 'git-missing')).toBe('git not found')
})

test('says when there is nothing to show', { options: { roots: ['C:/nowhere'] } }, async ($, on) => {
  const world = stage(on)
  world.gh = 'missing'
  await start($, world)
  const ui = await mount($, 'terminal')
  expect(await text(ui, 'empty')).toBe('No repos found. Check the roots and owners in /config.')
})

test('formatAge, fetchText and truncate', () => {
  expect(formatAge(30_000)).toBe('just now')
  expect(formatAge(5 * 60_000)).toBe('5m ago')
  expect(formatAge(3 * 3_600_000)).toBe('3h ago')
  expect(formatAge(50 * 3_600_000)).toBe('2d ago')
  expect(fetchText({ done: 3, total: 9 }, 0, 0)).toBe('fetching 3 of 9…')
  expect(fetchText(null, 0, 1_000)).toBe('not fetched yet')
  expect(fetchText(null, 1_000, 121_000)).toBe('fetched 2m ago')
  expect(truncate('mehfil-internal', 18)).toBe('mehfil-internal')
  expect(truncate('a-very-long-repository-name', 10)).toBe('a-very-lo…')
})

test('a fresh start clears fetch progress left by a run that was cut off', async ($, on) => {
  const world = stage(on)
  await start($, world)
  for (const path of Object.values(PATHS)) world.fetch[path] = 'slow'
  await opened($, world)
  await start($, world)
  expect(await text(await mount($, 'terminal'), 'fetched')).toBe('not fetched yet')
})
