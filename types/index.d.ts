/** A repo found on disk: its owner and name as the remote spells them, and every folder holding a clone. */
export type Clone = { owner: string; name: string; paths: string[] }

/** One clone's `git status`. `branch` is null when detached; `upstream` is null when the branch was never pushed. */
export type LocalState = {
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  changed: number
  isStale: boolean
}

export type Checks = 'failing' | 'pending' | 'passing' | 'none'
export type Review = 'approved' | 'changes' | 'required' | 'none'

/** One open pull request, as the GraphQL answer gives it. `createdAt` is ISO 8601. */
export type Pull = {
  number: number
  title: string
  url: string
  author: string
  isDraft: boolean
  createdAt: string
  review: Review
  checks: Checks
}

/** One repo of an owner on GitHub, with its first 20 open PRs and the full open count. */
export type RemoteRepo = { owner: string; name: string; url: string; pulls: Pull[]; pullCount: number }

/** An owner's last successful query. */
export type OwnerState = { repos: RemoteRepo[]; checkedAt: number }

export type FetchProgress = { done: number; total: number }

declare module 'claude-code' {
  interface PluginState {
    'repo-board': {
      home: string | null
      login: string | null
      clones: Record<string, Clone>
      local: Record<string, LocalState>
      github: Record<string, OwnerState>
      githubError: string | null
      fetching: FetchProgress | null
      fetchedAt: number
      fetchFailed: string[]
      checkedAt: number
      isGitMissing: boolean
      isPaneOpen: boolean
    }
  }
}
