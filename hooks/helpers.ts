import type { On, ProcessRunResult } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'

/** The fixed time every test runs at: 12:00 UTC on 14 October 2026. */
export const NOW = Date.parse('2026-10-14T12:00:00Z')
export const HOUR = 3_600_000

/** The Documents folder of the fake home folder `C:/home`. */
export const DOCS = 'C:/home/Documents'

/** The clone folders of the standard fake tree. */
export const PATHS = {
  riggit: `${DOCS}/github/riggit`,
  rigseed: `${DOCS}/claude/rigs/rigseed-app`,
  meter: `${DOCS}/claude/mods/session-meter`,
  dotfiles: `${DOCS}/github/dotfiles`,
  deep: `${DOCS}/a/b/c/deep`,
}

/** A fake file tree: file path to content. Folders are implied by the paths. */
export type Tree = Readonly<Record<string, string>>

/** A `.git/config` with one `origin` remote. */
export function gitConfig(url: string): string {
  return `[core]\n\tbare = false\n[remote "origin"]\n\turl = ${url}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n[branch "main"]\n\tremote = origin\n`
}

/**
 * The standard tree: four clones of the two owners, one of someone else's repo,
 * one inside node_modules, one inside a hidden folder, one four levels deep, and a file.
 */
export const TREE: Tree = {
  [`${PATHS.riggit}/.git/config`]: gitConfig('https://github.com/verastack-labs/riggit-internal.git'),
  [`${PATHS.rigseed}/.git/config`]: gitConfig('git@github.com:verastack-labs/rigseed-app.git'),
  [`${PATHS.meter}/.git/config`]: gitConfig('https://github.com/verastack-labs/session-meter'),
  [`${PATHS.dotfiles}/.git/config`]: gitConfig('https://github.com/riganb/dotfiles.git'),
  [`${DOCS}/github/other/.git/config`]: gitConfig('https://github.com/someone/else.git'),
  [`${DOCS}/node_modules/x/.git/config`]: gitConfig('https://github.com/verastack-labs/hidden.git'),
  [`${DOCS}/.cache/y/.git/config`]: gitConfig('https://github.com/verastack-labs/cached.git'),
  [`${PATHS.deep}/.git/config`]: gitConfig('https://github.com/verastack-labs/deep.git'),
  [`${DOCS}/notes.txt`]: 'hello',
}

/** The entries of one folder of a fake tree, or undefined when it holds nothing. */
export function listTree(tree: Tree, path: string): { name: string; kind: 'file' | 'dir' }[] | undefined {
  const prefix = `${path.replace(/\/+$/, '')}/`
  const kinds = new Map<string, 'file' | 'dir'>()
  for (const file of Object.keys(tree)) {
    if (!file.startsWith(prefix)) continue
    const rest = file.slice(prefix.length)
    const slash = rest.indexOf('/')
    const name = slash === -1 ? rest : rest.slice(0, slash)
    kinds.set(name, slash === -1 && kinds.get(name) !== 'dir' ? 'file' : 'dir')
  }
  if (kinds.size === 0) return undefined
  return [...kinds].map(([name, kind]) => ({ name, kind }))
}

/** File access over a fake tree, recording each folder listed. */
export function treeIo(tree: Tree) {
  const listed: string[] = []
  return {
    listed,
    list: async (path: string) => {
      listed.push(path)
      const entries = listTree(tree, path)
      if (entries === undefined) throw new Error(`ENOENT: ${path}`)
      return entries
    },
    read: async (path: string) => {
      const text = tree[path]
      if (text === undefined) throw new Error(`ENOENT: ${path}`)
      return text
    },
  }
}

/** `git status --porcelain=v2 --branch` output: a head, an optional upstream with its counts, and changed files. */
export function porcelain(head: string, upstream: string | null, ahead = 0, behind = 0, changed = 0): string {
  const lines = ['# branch.oid 4ebac7ec1ca5b6e187f63fa467e8cedb8875ce4d', `# branch.head ${head}`]
  if (upstream !== null) lines.push(`# branch.upstream ${upstream}`, `# branch.ab +${ahead} -${behind}`)
  for (let i = 0; i < changed; i += 1) lines.push(`1 .M N... 100644 100644 100644 aaaa bbbb file${i}.ts`)
  return `${lines.join('\n')}\n`
}

/** A pull request for `ghPage`. `checks` undefined means no commit; null means a commit with no checks. */
export type FakePull = {
  number: number
  author: string
  checks?: 'SUCCESS' | 'FAILURE' | 'ERROR' | 'PENDING' | 'EXPECTED' | null
  review?: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null
  createdAt?: number
  isDraft?: boolean
  title?: string
}

/** A repo for `ghPage`; `owner` defaults to the queried owner. */
export type FakeRepo = { name: string; owner?: string; isArchived?: boolean; pulls?: FakePull[]; pullCount?: number }

/** One page of the GraphQL answer, as `gh api graphql` prints it. */
export function ghPage(owner: string, repos: readonly FakeRepo[], after: string | null = null): string {
  return JSON.stringify({
    data: {
      repositoryOwner: {
        repositories: {
          pageInfo: { hasNextPage: after !== null, endCursor: after },
          nodes: repos.map(repo => {
            const login = repo.owner ?? owner
            const pulls = repo.pulls ?? []
            return {
              name: repo.name,
              url: `https://github.com/${login}/${repo.name}`,
              isArchived: repo.isArchived ?? false,
              owner: { login },
              pullRequests: {
                totalCount: repo.pullCount ?? pulls.length,
                nodes: pulls.map(pull => ({
                  number: pull.number,
                  title: pull.title ?? `Change ${pull.number}`,
                  url: `https://github.com/${login}/${repo.name}/pull/${pull.number}`,
                  isDraft: pull.isDraft ?? false,
                  createdAt: new Date(pull.createdAt ?? NOW - 72 * HOUR).toISOString(),
                  reviewDecision: pull.review ?? null,
                  author: { login: pull.author },
                  commits: {
                    nodes:
                      pull.checks === undefined
                        ? []
                        : [{ commit: { statusCheckRollup: pull.checks === null ? null : { state: pull.checks } } }],
                  },
                })),
              },
            }
          }),
        },
      },
    },
  })
}

/** The org's repos: a dependabot PR an hour old, and the user's own PR with failing checks. */
export const ORG_REPOS: FakeRepo[] = [
  { name: 'oinkbuns', pulls: [{ number: 2, author: 'dependabot', checks: 'SUCCESS', createdAt: NOW - HOUR }] },
  { name: 'riggit-internal' },
  { name: 'rigseed-app', pulls: [{ number: 14, author: 'riganb', checks: 'FAILURE' }] },
  { name: 'session-meter' },
]

/** The signed-in account's repos. */
export const MY_REPOS: FakeRepo[] = [{ name: 'dotfiles' }]

/** The standard `git status` of each clone: riggit clean, rigseed 3 behind, session-meter 1 ahead, dotfiles 2 changed. */
export const STATUS: Readonly<Record<string, string>> = {
  [PATHS.riggit]: porcelain('main', 'origin/main'),
  [PATHS.rigseed]: porcelain('feat/flathub-manifest', 'origin/feat/flathub-manifest', 0, 3),
  [PATHS.meter]: porcelain('main', 'origin/main', 1, 0),
  [PATHS.dotfiles]: porcelain('main', 'origin/main', 0, 0, 2),
}

type Reply = Partial<ProcessRunResult> | 'reject'

function slashes(path: string): string {
  return path.replace(/\\/g, '/')
}

/** The world beneath the mod, changeable between checks. */
export type World = {
  statuses: (string | undefined)[]
  toasts: string[]
  calls: { argv: string; cwd: string | undefined; env: Record<string, string> | undefined }[]
  listed: string[]
  clock: MockClock
  pages: Record<string, FakeRepo[] | 'auth'>
  status: Record<string, string | 'timeout'>
  fetch: Record<string, number | 'slow'>
  gh: 'ok' | 'missing'
  git: 'ok' | 'missing'
  login: string
  graphqlDelayMs: number
}

async function reply(world: World, argv: readonly string[], cwd: string | undefined): Promise<Reply> {
  const [command, ...rest] = argv
  if (command === 'cmd') return { stdout: 'C:\\home\r\n' }
  if (command === 'git') {
    if (world.git === 'missing') return 'reject'
    if (rest[0] === '--version') return { stdout: 'git version 2.46.0\n' }
    if (rest[0] === 'status') {
      const status = world.status[cwd ?? '']
      return status === 'timeout' ? 'reject' : { stdout: status ?? porcelain('main', 'origin/main') }
    }
    if (rest[0] === 'rev-list') return { stdout: '0\n' }
    if (rest[0] === 'fetch') {
      const fetch = world.fetch[cwd ?? ''] ?? 0
      if (fetch === 'slow') {
        await world.clock.sleep(60_000)
        return {}
      }
      return { exitCode: fetch, stderr: fetch === 0 ? '' : 'fatal: could not read Username for https://github.com' }
    }
    return 'reject'
  }
  if (command === 'gh') {
    if (world.gh === 'missing') return 'reject'
    if (rest[1] === 'user') return { stdout: `${world.login}\n` }
    const owner = rest.find(arg => arg.startsWith('owner='))?.slice('owner='.length) ?? ''
    if (world.graphqlDelayMs > 0) await world.clock.sleep(world.graphqlDelayMs)
    const page = world.pages[owner]
    if (page === undefined) {
      return { exitCode: 1, stdout: JSON.stringify({ errors: [{ message: `Could not resolve to a RepositoryOwner with the login of '${owner}'.` }] }) }
    }
    if (page === 'auth') return { exitCode: 4, stderr: 'To get started with GitHub CLI, please run:  gh auth login\n' }
    return { stdout: ghPage(owner, page) }
  }
  return 'reject'
}

/** Stands in for everything beneath the mod. Call it before the test's first `$` call. */
export function stage(on: On, tree: Tree = TREE): World {
  const world: World = {
    statuses: [],
    toasts: [],
    calls: [],
    listed: [],
    clock: mock.clock(on, { now: NOW }),
    pages: { 'verastack-labs': ORG_REPOS, riganb: MY_REPOS },
    status: { ...STATUS },
    fetch: {},
    gh: 'ok',
    git: 'ok',
    login: 'riganb',
    graphqlDelayMs: 0,
  }
  // the engine hands paths beneath it in the platform's own form; the fake tree spells them with `/`
  on('fs.list', ($, e) => {
    const path = slashes(e.path)
    world.listed.push(path)
    const entries = listTree(tree, path)
    if (entries === undefined) return { deny: `ENOENT: ${path}` }
    return { value: entries.map(entry => ({ ...entry, size: 0, mtimeMs: 0, isLink: false })) }
  })
  on('fs.read', ($, e) => {
    const path = slashes(e.path)
    const text = tree[path]
    return text === undefined ? { deny: `ENOENT: ${path}` } : { value: text }
  })
  on('process.run', async ($, e) => {
    const cwd = e.init?.cwd === undefined ? undefined : slashes(e.init.cwd)
    world.calls.push({ argv: e.argv.join(' '), cwd, env: e.init?.env })
    const answer = await reply(world, e.argv, cwd)
    if (answer === 'reject') return { deny: 'cannot start' }
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false, ...answer } }
  })
  on('ui.status', ($, e) => {
    world.statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    world.toasts.push(e.text)
    return { value: undefined }
  })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  return world
}

/** Starts a session and lets the startup scan and checks finish. */
export async function start($: Engine, world: World): Promise<void> {
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true } as never)
  await world.clock.settle()
}

/** The arguments `$.command.run` needs for a slash command typed at the prompt. */
export function slash(command: string) {
  return {
    command,
    args: '',
    origin: { kind: 'composer' } as const,
    presentation: { isFullscreen: false, columns: 80 },
  }
}

/** Props for mounting the pane, 80 columns wide unless overridden. */
export function PANE_PROPS(bodyColumns = 80) {
  return {
    title: 'Repos',
    isFocused: false,
    bodyColumns,
    placement: 'dock' as const,
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  } as never
}

/** The git or gh calls made so far whose argv starts with `prefix`. */
export function callsOf(world: World, prefix: string) {
  return world.calls.filter(call => call.argv.startsWith(prefix))
}
