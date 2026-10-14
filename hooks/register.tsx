import { atom, read, update } from 'claude-code'
import type { EngineInterface, ProcessRunResult, Register } from 'claude-code'

import type { Clone, LocalState, OwnerState } from '../types'
import { collapse, dueToasts } from './changes'
import { readConfig, ownersFor } from './config'
import type { Config } from './config'
import { expandRoot, findClones } from './discover'
import { GH_TIMEOUT_MS, LOGIN_ARGS, MAX_PAGES, describeGhFailure, ghArgs, parsePage } from './github'
import {
  FETCH_ARGS,
  FETCH_TIMEOUT_MS,
  QUIET_ENV,
  STATUS_ARGS,
  STATUS_TIMEOUT_MS,
  UNPUSHED_ARGS,
  parseStatus,
} from './local'
import { mapLimit } from './pool'
import { buildGroups } from './rows'
import type { Group } from './rows'
import { statusText } from './status'
import { boardView } from './view'

const PANE_ID = 'repo-board'
const PANE_MS = 30_000
const CHECK_MS = 300_000
const WORKERS = 4

const home = atom({ plugin: 'repo-board', key: 'home' } as const, null as string | null)
const login = atom({ plugin: 'repo-board', key: 'login' } as const, null as string | null)
const clones = atom({ plugin: 'repo-board', key: 'clones' } as const, {} as Record<string, Clone>)
const local = atom({ plugin: 'repo-board', key: 'local' } as const, {} as Record<string, LocalState>)
const github = atom({ plugin: 'repo-board', key: 'github' } as const, {} as Record<string, OwnerState>)
const githubError = atom({ plugin: 'repo-board', key: 'githubError' } as const, null as string | null)
const fetching = atom({ plugin: 'repo-board', key: 'fetching' } as const, null as { done: number; total: number } | null)
const fetchedAt = atom({ plugin: 'repo-board', key: 'fetchedAt' } as const, 0)
const fetchFailed = atom({ plugin: 'repo-board', key: 'fetchFailed' } as const, [] as string[])
const checkedAt = atom({ plugin: 'repo-board', key: 'checkedAt' } as const, 0)
const isGitMissing = atom({ plugin: 'repo-board', key: 'isGitMissing' } as const, false)
const isPaneOpen = atom({ plugin: 'repo-board', key: 'isPaneOpen' } as const, false)

/** Which runs are under way, so a timer never starts one twice. */
const running = { local: false, github: false, refresh: false }

type Dollar = Pick<EngineInterface, 'state' | 'process' | 'fs' | 'ui' | 'clock'>

/** The home folder for `~`: Windows first, then a POSIX shell, with `/` separators. */
async function resolveHome($: Dollar): Promise<string | null> {
  const tries: string[][] = [
    ['cmd', '/c', 'echo', '%USERPROFILE%'],
    ['sh', '-c', 'echo $HOME'],
  ]
  for (const argv of tries) {
    try {
      const result = await $.process.run(argv, { timeoutMs: 5_000 })
      const path = result.stdout.trim().replace(/\\/g, '/')
      if (result.exitCode === 0 && path !== '' && !path.includes('%')) return path
    } catch {
      // try the next shell
    }
  }
  return null
}

/** The account gh is signed in as, or null when gh is missing or signed out. */
async function readLogin($: Dollar): Promise<string | null> {
  try {
    const result = await $.process.run(LOGIN_ARGS, { timeoutMs: GH_TIMEOUT_MS })
    const name = result.stdout.trim()
    return result.exitCode === 0 && name !== '' ? name : null
  } catch {
    return null
  }
}

async function ensureLogin($: Dollar, config: Config): Promise<string | null> {
  const known = await read($, login)
  if (known !== null || !config.includeMyAccount) return known
  const found = await readLogin($)
  if (found !== null) await update($, login, () => found)
  return found
}

async function scan($: Dollar, config: Config): Promise<void> {
  let homePath = await read($, home)
  if (homePath === null) {
    const found = await resolveHome($)
    homePath = found
    if (found !== null) await update($, home, () => found)
  }
  const roots = config.roots.map(root => expandRoot(root, homePath)).filter((root): root is string => root !== null)
  const found = await findClones(roots, config.scanDepth, {
    list: path => $.fs.list(path),
    read: path => $.fs.read(path),
  })
  await update($, clones, () => found)
}

/** The first clone of each repo whose owner is listed: the clones the board checks and fetches. */
async function clonePaths($: Dollar, config: Config): Promise<string[]> {
  const owners = new Set(ownersFor(config, await read($, login)).map(owner => owner.toLowerCase()))
  return Object.values(await read($, clones))
    .filter(clone => owners.has(clone.owner.toLowerCase()))
    .map(clone => clone.paths[0])
    .filter((path): path is string => path !== undefined)
}

async function checkOne($: Dollar, path: string, previous: LocalState | undefined): Promise<{ state: LocalState | null; isRejected: boolean }> {
  const stale = previous === undefined ? null : { ...previous, isStale: true }
  try {
    const result = await $.process.run(['git', ...STATUS_ARGS], { cwd: path, timeoutMs: STATUS_TIMEOUT_MS, env: QUIET_ENV })
    if (result.exitCode !== 0) return { state: stale, isRejected: false }
    const status = parseStatus(result.stdout)
    let ahead = status.ahead
    if (status.upstream === null && status.branch !== null) {
      const count = await $.process.run(['git', ...UNPUSHED_ARGS], { cwd: path, timeoutMs: STATUS_TIMEOUT_MS, env: QUIET_ENV })
      ahead = count.exitCode === 0 ? Number(count.stdout.trim()) || 0 : 0
    }
    return { state: { ...status, ahead, isStale: false }, isRejected: false }
  } catch {
    return { state: stale, isRejected: true }
  }
}

async function gitWorks($: Dollar): Promise<boolean> {
  try {
    await $.process.run(['git', '--version'], { timeoutMs: STATUS_TIMEOUT_MS })
    return true
  } catch {
    return false
  }
}

/** Runs `git status` on every listed clone, then updates the status line. */
async function checkLocal($: Dollar, config: Config): Promise<void> {
  if (running.local) return
  running.local = true
  try {
    const paths = await clonePaths($, config)
    const previous = await read($, local)
    const results = await mapLimit(paths, WORKERS, path => checkOne($, path, previous[path]))
    const next: Record<string, LocalState> = {}
    results.forEach((result, index) => {
      const path = paths[index]
      if (path !== undefined && result.state !== null) next[path] = result.state
    })
    const isMissing = paths.length > 0 && results.every(result => result.isRejected) && !(await gitWorks($))
    const now = await $.clock.now()
    await update($, local, () => next)
    await update($, isGitMissing, () => isMissing)
    await update($, checkedAt, () => now)
    await showStatus($, config)
  } finally {
    running.local = false
  }
}

/** Every page of one owner's repos. Throws an Error with a short reason. */
async function queryOwner($: Dollar, owner: string, now: number): Promise<OwnerState> {
  const repos: OwnerState['repos'] = []
  let after: string | null = null
  for (let page = 0; page < MAX_PAGES; page += 1) {
    let result: ProcessRunResult
    try {
      result = await $.process.run(ghArgs(owner, after), { timeoutMs: GH_TIMEOUT_MS })
    } catch {
      throw new Error('gh not found or timed out')
    }
    if (result.exitCode !== 0) {
      if (result.stdout.trim().startsWith('{')) parsePage(result.stdout, owner)
      throw new Error(describeGhFailure(result.stderr))
    }
    const parsed = parsePage(result.stdout, owner)
    repos.push(...parsed.repos)
    after = parsed.after
    if (after === null) break
  }
  return { repos, checkedAt: now }
}

/** Queries every owner, toasts what changed since its last good query, then updates the status line. */
async function checkGithub($: Dollar, config: Config): Promise<void> {
  if (running.github) return
  running.github = true
  try {
    const me = await ensureLogin($, config)
    const owners = ownersFor(config, me)
    const previous = await read($, github)
    const next = { ...previous }
    const toasts: string[] = []
    let error: string | null = null
    for (const owner of owners) {
      try {
        const state = await queryOwner($, owner, await $.clock.now())
        toasts.push(...dueToasts(previous[owner.toLowerCase()], state, me))
        next[owner.toLowerCase()] = state
      } catch (failure) {
        error = failure instanceof Error ? failure.message : String(failure)
      }
    }
    await update($, github, () => next)
    await update($, githubError, () => error)
    for (const toast of collapse(toasts)) $.ui.toast(toast)
    await showStatus($, config)
  } finally {
    running.github = false
  }
}

async function fetchOne($: Dollar, path: string): Promise<boolean> {
  try {
    const result = await $.process.run(['git', ...FETCH_ARGS], { cwd: path, timeoutMs: FETCH_TIMEOUT_MS, env: QUIET_ENV })
    return result.exitCode === 0
  } catch {
    return false
  }
}

/** Opening the pane and Refresh: rescan, fetch every clone, then check local state and GitHub. */
export async function refreshAll($: Dollar, config: Config): Promise<void> {
  if (running.refresh) return
  running.refresh = true
  try {
    await ensureLogin($, config)
    await scan($, config)
    const paths = await clonePaths($, config)
    await update($, fetching, () => ({ done: 0, total: paths.length }))
    const failed: string[] = []
    await mapLimit(paths, WORKERS, async path => {
      if (!(await fetchOne($, path))) failed.push(path)
      await update($, fetching, progress => (progress === null ? null : { ...progress, done: progress.done + 1 }))
    })
    const now = await $.clock.now()
    await update($, fetchFailed, () => failed)
    await update($, fetching, () => null)
    await update($, fetchedAt, () => now)
    await checkLocal($, config)
    await checkGithub($, config)
  } finally {
    running.refresh = false
  }
}

/** The pane's rows from what is known now. */
export async function groupsNow($: Dollar, config: Config): Promise<Group[]> {
  return buildGroups({
    owners: ownersFor(config, await read($, login)),
    github: await read($, github),
    clones: await read($, clones),
    local: await read($, local),
    fetchFailed: await read($, fetchFailed),
  })
}

async function showStatus($: Dollar, config: Config): Promise<void> {
  $.ui.status(statusText(await groupsNow($, config)))
}

async function startup($: Dollar, config: Config): Promise<void> {
  try {
    await ensureLogin($, config)
    await scan($, config)
    await checkLocal($, config)
    await checkGithub($, config)
  } catch {
    // the board never disturbs the session
  }
}

async function paneTick($: Dollar, config: Config): Promise<void> {
  try {
    if (await read($, isPaneOpen)) await checkLocal($, config)
  } catch {
    // the board never disturbs the session
  }
}

async function backgroundTick($: Dollar, config: Config): Promise<void> {
  try {
    await checkLocal($, config)
    await checkGithub($, config)
  } catch {
    // the board never disturbs the session
  }
}

async function safeRefresh($: Dollar, config: Config): Promise<void> {
  try {
    await refreshAll($, config)
  } catch {
    // the board never disturbs the session
  }
}

export const register: Register = (on, options) => {
  const config = readConfig(options)

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'repos', description: 'Open or close the repo board' })
    $.clock.every(PANE_MS, () => {
      void paneTick($, config)
    })
    $.clock.every(CHECK_MS, () => {
      void backgroundTick($, config)
    })
    void startup($, config)
    return next(e)
  })

  on('command.run', { command: 'repos' }, async $ => {
    if (await read($, isPaneOpen)) {
      await $.ui.close({ id: PANE_ID })
      await update($, isPaneOpen, () => false)
      return { text: 'Pane closed.' }
    }
    await $.ui.open({ id: PANE_ID, title: 'Repos' })
    await update($, isPaneOpen, () => true)
    void safeRefresh($, config)
    return { text: 'Pane opened.' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE_ID) await update($, isPaneOpen, () => false)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: 'repo-board' }, async ($, e) => {
    const els = $.ui.resolve(e)
    const known = await read($, github)
    return boardView(
      { Box: els.Box, Text: els.Text, Link: els.Link, Button: els.Button },
      {
        groups: await groupsNow($, config),
        login: await read($, login),
        now: await read($, checkedAt),
        columns: e.props.bodyColumns,
        fetching: await read($, fetching),
        fetchedAt: await read($, fetchedAt),
        githubError: await read($, githubError),
        hasGithub: Object.keys(known).length > 0,
        isGitMissing: await read($, isGitMissing),
        onRefresh: () => {
          void safeRefresh($, config)
        },
      },
    )
  })
}
