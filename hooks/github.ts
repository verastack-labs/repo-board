import type { Checks, Pull, RemoteRepo, Review } from '../types'

export const MAX_PAGES = 5
export const GH_TIMEOUT_MS = 20_000
export const LOGIN_ARGS = ['gh', 'api', 'user', '--jq', '.login'] as const

/** One page of an owner's unarchived repos, each with its first 20 open PRs and their review and check state. */
export const QUERY = `query($owner: String!, $after: String) {
  repositoryOwner(login: $owner) {
    repositories(first: 100, after: $after, isArchived: false, ownerAffiliations: [OWNER], orderBy: { field: NAME, direction: ASC }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        name url isArchived owner { login }
        pullRequests(states: OPEN, first: 20, orderBy: { field: CREATED_AT, direction: DESC }) {
          totalCount
          nodes {
            number title url isDraft createdAt reviewDecision
            author { login }
            commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
          }
        }
      }
    }
  }
}`

/** The `gh` command for one page; `-f` keeps an owner like `123` a string. */
export function ghArgs(owner: string, after: string | null): string[] {
  const args = ['gh', 'api', 'graphql', '-f', `query=${QUERY}`, '-f', `owner=${owner}`]
  if (after !== null) args.push('-f', `after=${after}`)
  return args
}

type PullNode = {
  number: number
  title: string
  url: string
  isDraft: boolean
  createdAt: string
  reviewDecision: string | null
  author: { login: string } | null
  commits: { nodes: { commit: { statusCheckRollup: { state: string } | null } }[] }
}

type RepoNode = {
  name: string
  url: string
  isArchived: boolean
  owner: { login: string }
  pullRequests: { totalCount: number; nodes: PullNode[] }
}

type Answer = {
  errors?: { message: string }[]
  data?: {
    repositoryOwner: {
      repositories: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: RepoNode[] }
    } | null
  }
}

function toChecks(state: string | undefined): Checks {
  if (state === 'FAILURE' || state === 'ERROR') return 'failing'
  if (state === 'PENDING' || state === 'EXPECTED') return 'pending'
  if (state === 'SUCCESS') return 'passing'
  return 'none'
}

function toReview(decision: string | null): Review {
  if (decision === 'APPROVED') return 'approved'
  if (decision === 'CHANGES_REQUESTED') return 'changes'
  if (decision === 'REVIEW_REQUIRED') return 'required'
  return 'none'
}

function toPull(node: PullNode): Pull {
  return {
    number: node.number,
    title: node.title,
    url: node.url,
    author: node.author?.login ?? 'ghost',
    isDraft: node.isDraft,
    createdAt: node.createdAt,
    review: toReview(node.reviewDecision),
    checks: toChecks(node.commits.nodes[0]?.commit.statusCheckRollup?.state),
  }
}

/**
 * One page of the answer: the owner's own unarchived repos, and the cursor of
 * the next page or null. Throws an Error with a short message when unusable.
 */
export function parsePage(stdout: string, owner: string): { repos: RemoteRepo[]; after: string | null } {
  let answer: Answer
  try {
    answer = JSON.parse(stdout) as Answer
  } catch {
    throw new Error('GitHub answered something unreadable')
  }
  const firstError = answer.errors?.[0]
  if (firstError !== undefined) throw new Error(firstError.message)
  const repositories = answer.data?.repositoryOwner?.repositories
  if (repositories === undefined) throw new Error(`no GitHub account named ${owner}`)
  const repos = repositories.nodes
    .filter(node => !node.isArchived && node.owner.login.toLowerCase() === owner.toLowerCase())
    .map(node => ({
      owner: node.owner.login,
      name: node.name,
      url: node.url,
      pulls: node.pullRequests.nodes.map(toPull),
      pullCount: node.pullRequests.totalCount,
    }))
  const { hasNextPage, endCursor } = repositories.pageInfo
  return { repos, after: hasNextPage ? endCursor : null }
}

/** A short reason from what `gh` printed on a failure. */
export function describeGhFailure(stderr: string): string {
  if (/gh auth login|bad credentials|not logged in|authentication/i.test(stderr)) return 'sign in with gh auth login'
  const line = stderr
    .split(/\r?\n/)
    .map(part => part.trim())
    .find(part => part !== '')
  return line === undefined ? 'gh failed' : shorten(line)
}

/** A message cut to `max` characters, ending in an ellipsis when cut. */
export function shorten(text: string, max = 80): string {
  const line = text.trim()
  return line.length <= max ? line : `${line.slice(0, max - 1).trimEnd()}…`
}

/**
 * The one line the pane shows for the owners that failed: the shared reason when
 * every owner failed alike, else each owner with its reason, unless the reason names it.
 */
export function failureLine(failures: readonly { owner: string; message: string }[], ownerCount: number): string | null {
  if (failures.length === 0) return null
  const messages = [...new Set(failures.map(failure => failure.message))]
  const [only] = messages
  if (failures.length === ownerCount && messages.length === 1 && only !== undefined) return only
  return failures
    .map(({ owner, message }) => (message.toLowerCase().includes(owner.toLowerCase()) ? message : `${owner}: ${message}`))
    .join('; ')
}
