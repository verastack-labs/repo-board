/** What one `git status --porcelain=v2 --branch` says. `branch` is null when detached. */
export type Status = { branch: string | null; upstream: string | null; ahead: number; behind: number; changed: number }

export const STATUS_ARGS = ['status', '--porcelain=v2', '--branch'] as const
/** Commits on HEAD that no remote-tracking ref holds: the unpushed count of a branch with no upstream. */
export const UNPUSHED_ARGS = ['rev-list', '--count', 'HEAD', '--not', '--remotes'] as const
export const FETCH_ARGS = ['fetch', '--quiet'] as const
/** Makes a fetch that needs credentials fail at once instead of asking. */
export const QUIET_ENV = { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' } as const
export const STATUS_TIMEOUT_MS = 10_000
export const FETCH_TIMEOUT_MS = 20_000

const HEAD = '# branch.head '
const UPSTREAM = '# branch.upstream '
const AB = '# branch.ab '

/** Reads porcelain v2 output; tracked changes, renames, conflicts and untracked files each count as one changed file. */
export function parseStatus(stdout: string): Status {
  const status: Status = { branch: null, upstream: null, ahead: 0, behind: 0, changed: 0 }
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith(HEAD)) {
      const head = line.slice(HEAD.length)
      status.branch = head === '(detached)' ? null : head
    } else if (line.startsWith(UPSTREAM)) {
      status.upstream = line.slice(UPSTREAM.length)
    } else if (line.startsWith(AB)) {
      const counts = /^\+(\d+) -(\d+)$/.exec(line.slice(AB.length))
      if (counts !== null) {
        status.ahead = Number(counts[1])
        status.behind = Number(counts[2])
      }
    } else if (/^[12u?] /.test(line)) {
      status.changed += 1
    }
  }
  return status
}
