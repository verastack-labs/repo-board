import type { Elements, RenderElement } from 'claude-code'

import type { FetchProgress } from '../types'
import { topPull } from './rows'
import type { Group, Marker, Row } from './rows'

export type Els = Pick<Elements['terminal'], 'Box' | 'Text' | 'Link' | 'Button'>

/** What the pane draws from. `now` is the last local check. */
export type BoardInput = {
  groups: Group[]
  login: string | null
  now: number
  columns: number
  fetching: FetchProgress | null
  fetchedAt: number
  githubError: string | null
  hasGithub: boolean
  isGitMissing: boolean
  onRefresh: () => void
}

// Column widths in cells; fixed-width Boxes line up in the desktop's proportional font too.
const REPO = 22
const BRANCH = 16
const LOCAL = 14
const GAP = 2
const NARROW = 50
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const MARKER_TEXT: Record<Marker, string> = {
  failing: 'checks failing',
  changes: 'changes requested',
  approved: 'approved',
  new: 'new',
  open: 'open',
}
const MARKER_COLOUR = { failing: 'error', changes: 'warning', approved: 'success', new: undefined, open: undefined } as const

export function formatAge(ms: number): string {
  if (ms < MINUTE) return 'just now'
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m ago`
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h ago`
  return `${Math.floor(ms / DAY)}d ago`
}

export function fetchText(fetching: FetchProgress | null, fetchedAt: number, now: number): string {
  if (fetching !== null) return `fetching ${fetching.done} of ${fetching.total}…`
  if (fetchedAt === 0) return 'not fetched yet'
  return `fetched ${formatAge(now - fetchedAt)}`
}

export function truncate(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`
}

function localText(row: Row): string {
  if (row.paths.length === 0) return 'not cloned'
  const local = row.local
  if (local === null) return ''
  const parts: string[] = []
  if (local.ahead > 0) parts.push(`↑${local.ahead}`)
  if (row.isFetchFailed) parts.push('↓?')
  else if (local.behind > 0) parts.push(`↓${local.behind}`)
  if (local.changed > 0) parts.push(`${local.changed} changed`)
  return parts.length === 0 ? 'clean' : parts.join(' ')
}

function branchText(row: Row): { text: string; note: string } {
  const local = row.local
  if (row.paths.length === 0 || local === null) return { text: '', note: '' }
  if (local.branch === null) return { text: 'detached', note: '' }
  return { text: local.branch, note: local.upstream === null ? ' no upstream' : '' }
}

function repoCell(els: Els, row: Row) {
  const { Box, Text, Link } = els
  const extra = row.paths.length - 1
  const note = extra > 0 ? ` +${extra} clone${extra > 1 ? 's' : ''}` : ''
  return (
    <Box key={`${row.key}-repo`} flexDirection="row" width={REPO}>
      <Link href={row.url} label={truncate(row.name, REPO - note.length)} />
      {note !== '' && <Text dimColor>{note}</Text>}
    </Box>
  )
}

function githubCell(els: Els, row: Row, input: BoardInput) {
  const { Box, Text, Link } = els
  const top = topPull(row.pulls, input.login, input.now)
  return (
    <Box key={`${row.key}-github`} flexDirection="row" flexGrow={1}>
      {top !== null && <Link href={top.pull.url} label={`#${top.pull.number}`} />}
      {top !== null && (
        <Text color={MARKER_COLOUR[top.marker]} dimColor={top.marker === 'new'}>
          {` ${MARKER_TEXT[top.marker]}`}
        </Text>
      )}
      {top !== null && row.pullCount > 1 && <Text> </Text>}
      {top !== null && row.pullCount > 1 && <Link href={`${row.url}/pulls`} label={`+${row.pullCount - 1} more`} />}
    </Box>
  )
}

function rowView(els: Els, row: Row, input: BoardInput, hasBranch: boolean, hasGithub: boolean) {
  const { Box, Text } = els
  const branch = branchText(row)
  const local = localText(row)
  const isDim = local === 'clean' || local === 'not cloned' || row.local?.isStale === true
  return (
    <Box key={row.key} flexDirection="row" columnGap={GAP}>
      {repoCell(els, row)}
      {hasBranch && (
        <Box key={`${row.key}-branch`} width={BRANCH}>
          <Text wrap="truncate-end">
            {branch.text}
            {branch.note !== '' && <Text dimColor>{branch.note}</Text>}
          </Text>
        </Box>
      )}
      <Box key={`${row.key}-local`} width={LOCAL}>
        <Text dimColor={isDim}>{local}</Text>
      </Box>
      {hasGithub && githubCell(els, row, input)}
    </Box>
  )
}

function columnsRow(els: Els, owner: string, hasBranch: boolean, hasGithub: boolean) {
  const { Box, Text } = els
  return (
    <Box key={`columns-${owner}`} flexDirection="row" columnGap={GAP}>
      <Box width={REPO}>
        <Text dimColor>Repo</Text>
      </Box>
      {hasBranch && (
        <Box width={BRANCH}>
          <Text dimColor>Branch</Text>
        </Box>
      )}
      <Box width={LOCAL}>
        <Text dimColor>Local</Text>
      </Box>
      {hasGithub && (
        <Box flexGrow={1}>
          <Text dimColor>GitHub</Text>
        </Box>
      )}
    </Box>
  )
}

/** The pane, per the spec's layout and its planning amendments. */
export function boardView(els: Els, input: BoardInput): RenderElement {
  const { Box, Text, Button } = els
  const hasBranch = input.columns >= NARROW
  const hasGithub = input.hasGithub
  return (
    <Box flexDirection="column">
      <Box flexDirection="row" columnGap={GAP} justifyContent="flex-end">
        <Box key="fetched">
          <Text dimColor>{fetchText(input.fetching, input.fetchedAt, input.now)}</Text>
        </Box>
        <Button key="refresh" onPress={() => input.onRefresh()}>
          Refresh
        </Button>
      </Box>
      {input.isGitMissing && (
        <Box key="git-missing">
          <Text color="warning">git not found</Text>
        </Box>
      )}
      {input.githubError !== null && (
        <Box key="github-error">
          <Text dimColor>GitHub unavailable: {input.githubError}</Text>
        </Box>
      )}
      {input.groups.length === 0 && (
        <Box key="empty">
          <Text dimColor>No repos found. Check the roots and owners in /config.</Text>
        </Box>
      )}
      {input.groups.map(group => (
        <Box key={`owner-${group.owner}`} flexDirection="column" marginTop={1}>
          <Box key={`group-${group.owner}`}>
            <Text bold>{group.owner}</Text>
          </Box>
          {columnsRow(els, group.owner, hasBranch, hasGithub)}
          {group.rows.map(row => rowView(els, row, input, hasBranch, hasGithub))}
        </Box>
      ))}
    </Box>
  )
}
