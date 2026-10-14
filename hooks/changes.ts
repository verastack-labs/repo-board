import type { OwnerState, Pull } from '../types'

const MAX_TOASTS = 3

function pullsByKey(state: OwnerState): Map<string, Pull> {
  const pulls = new Map<string, Pull>()
  for (const repo of state.repos) for (const pull of repo.pulls) pulls.set(`${repo.name.toLowerCase()}#${pull.number}`, pull)
  return pulls
}

/**
 * The toasts due between an owner's previous successful query and this one:
 * checks turning failed on any PR, a review decision landing on the user's PR,
 * and a PR not seen before from someone else (which toasts as new only).
 * With no previous state the owner is being seeded, so nothing is due.
 */
export function dueToasts(previous: OwnerState | undefined, next: OwnerState, login: string | null): string[] {
  if (previous === undefined) return []
  const before = pullsByKey(previous)
  const me = login?.toLowerCase() ?? null
  const toasts: string[] = []
  for (const repo of next.repos) {
    for (const pull of repo.pulls) {
      const old = before.get(`${repo.name.toLowerCase()}#${pull.number}`)
      const isMine = me !== null && pull.author.toLowerCase() === me
      const label = `${repo.name} #${pull.number}`
      if (old === undefined && !isMine) {
        toasts.push(`${label}: new PR from ${pull.author}`)
        continue
      }
      if (pull.checks === 'failing' && old?.checks !== 'failing') toasts.push(`${label}: checks failing`)
      if (isMine && pull.review !== (old?.review ?? 'none')) {
        if (pull.review === 'approved') toasts.push(`${label}: approved`)
        if (pull.review === 'changes') toasts.push(`${label}: changes requested`)
      }
    }
  }
  return toasts
}

/** More than 3 toasts from one check become a single one. */
export function collapse(toasts: readonly string[]): string[] {
  return toasts.length > MAX_TOASTS ? [`${toasts.length} GitHub updates, open /repos`] : [...toasts]
}
