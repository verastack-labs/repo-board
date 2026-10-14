import type { Clone, LocalState, OwnerState, Pull } from '../types'
import { repoKey } from './discover'

export type Marker = 'failing' | 'changes' | 'approved' | 'new' | 'open'

/** One row of the pane. `paths` is empty for a repo with no clone found; `local` is the first clone's state. */
export type Row = {
  key: string
  owner: string
  name: string
  url: string
  paths: string[]
  local: LocalState | null
  isFetchFailed: boolean
  pulls: Pull[]
  pullCount: number
}

export type Group = { owner: string; rows: Row[] }

/** Everything the rows are joined from. */
export type BoardData = {
  owners: readonly string[]
  github: Record<string, OwnerState>
  clones: Record<string, Clone>
  local: Record<string, LocalState>
  fetchFailed: readonly string[]
}

/** How long a PR from someone else counts as new. */
export const NEW_MS = 86_400_000

const MARKER_RANK: Record<Marker, number> = { failing: 0, changes: 1, approved: 2, new: 3, open: 4 }

export function marker(pull: Pull, login: string | null, now: number): Marker {
  if (pull.checks === 'failing') return 'failing'
  if (pull.review === 'changes') return 'changes'
  if (pull.review === 'approved') return 'approved'
  const isMine = login !== null && pull.author.toLowerCase() === login.toLowerCase()
  if (!isMine && now - Date.parse(pull.createdAt) < NEW_MS) return 'new'
  return 'open'
}

/** The open PR most needing attention: drafts after the others, then by marker, then newest. */
export function topPull(pulls: readonly Pull[], login: string | null, now: number): { pull: Pull; marker: Marker } | null {
  const ranked = pulls
    .map(pull => ({ pull, marker: marker(pull, login, now) }))
    .sort(
      (a, b) =>
        Number(a.pull.isDraft) - Number(b.pull.isDraft) || MARKER_RANK[a.marker] - MARKER_RANK[b.marker] || b.pull.number - a.pull.number,
    )
  return ranked[0] ?? null
}

/** Lower comes first: failing checks, unpushed, uncommitted, unpulled, the rest, then not cloned. */
export function attention(row: Row): number {
  if (row.pulls.some(pull => pull.checks === 'failing')) return 0
  if (row.paths.length === 0) return 5
  const local = row.local
  if (local === null) return 4
  if (local.ahead > 0) return 1
  if (local.changed > 0) return 2
  if (local.behind > 0 && !row.isFetchFailed) return 3
  return 4
}

function toRow(owner: string, name: string, url: string, pulls: Pull[], pullCount: number, data: BoardData): Row {
  const key = repoKey(owner, name)
  const paths = data.clones[key]?.paths ?? []
  const first = paths[0]
  return {
    key,
    owner,
    name,
    url,
    paths,
    local: first === undefined ? null : (data.local[first] ?? null),
    isFetchFailed: first !== undefined && data.fetchFailed.includes(first),
    pulls,
    pullCount,
  }
}

/** One group per owner with anything to show, rows ordered by attention then name. */
export function buildGroups(data: BoardData): Group[] {
  const seen = new Set<string>()
  const groups: Group[] = []
  for (const owner of data.owners) {
    const lower = owner.toLowerCase()
    if (seen.has(lower)) continue
    seen.add(lower)
    const state = data.github[lower]
    const rows =
      state === undefined
        ? Object.values(data.clones)
            .filter(clone => clone.owner.toLowerCase() === lower)
            .map(clone => toRow(clone.owner, clone.name, `https://github.com/${clone.owner}/${clone.name}`, [], 0, data))
        : state.repos.map(repo => toRow(repo.owner, repo.name, repo.url, repo.pulls, repo.pullCount, data))
    rows.sort((a, b) => attention(a) - attention(b) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
    if (rows.length > 0) groups.push({ owner, rows })
  }
  return groups
}
