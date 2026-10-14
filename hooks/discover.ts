import type { Clone } from '../types'

/** File access the scan needs: `$.fs.list` and `$.fs.read`, or a fake in tests. */
export type Io = {
  list: (path: string) => Promise<readonly { name: string; kind: string }[]>
  read: (path: string) => Promise<string>
}

const GITHUB_REMOTE =
  /^(?:https?:\/\/(?:[^@/]+@)?github\.com\/|ssh:\/\/git@github\.com(?::\d+)?\/|git@github\.com:)([^/]+)\/([^/]+?)(?:\.git)?\/?$/i

/** Folders the scan never enters, besides any whose name starts with a dot. */
const SKIPPED = new Set(['node_modules'])

/** The owner and name of a github.com remote URL, or null for any other URL. */
export function parseRemote(url: string): { owner: string; name: string } | null {
  const match = GITHUB_REMOTE.exec(url.trim())
  if (match === null) return null
  const [, owner, name] = match
  if (owner === undefined || name === undefined) return null
  return { owner, name }
}

/** The GitHub repo a `.git/config` points at: `origin` first, then any other remote. */
export function remoteFromConfig(text: string): { owner: string; name: string } | null {
  let remote: string | null = null
  const urls: { remote: string; url: string }[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('[')) {
      remote = /^\[remote\s+"([^"]+)"\]$/.exec(line)?.[1] ?? null
      continue
    }
    const url = /^url\s*=\s*(.+)$/.exec(line)?.[1]
    if (remote !== null && url !== undefined) urls.push({ remote, url })
  }
  const ordered = [...urls.filter(u => u.remote === 'origin'), ...urls.filter(u => u.remote !== 'origin')]
  for (const { url } of ordered) {
    const repo = parseRemote(url)
    if (repo !== null) return repo
  }
  return null
}

/** A root folder from settings as a path: `~` becomes the home folder, backslashes become `/`. */
export function expandRoot(root: string, home: string | null): string | null {
  const path = root.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  if (path === '') return null
  if (path === '~' || path.startsWith('~/')) return home === null ? null : `${home}${path.slice(1)}`
  return path
}

/** How repos are keyed everywhere: `owner/name` in lower case, since GitHub names ignore case. */
export function repoKey(owner: string, name: string): string {
  return `${owner}/${name}`.toLowerCase()
}

function byName(a: string, b: string): number {
  return a.toLowerCase().localeCompare(b.toLowerCase())
}

/**
 * Walks each root to `depth` folder levels for clones. A folder holding a `.git`
 * folder is a clone: its config names the repo, and the walk does not go inside it.
 */
export async function findClones(roots: readonly string[], depth: number, io: Io): Promise<Record<string, Clone>> {
  const clones: Record<string, Clone> = {}
  const add = (dir: string, repo: { owner: string; name: string }) => {
    const key = repoKey(repo.owner, repo.name)
    const found = clones[key]
    if (found === undefined) clones[key] = { owner: repo.owner, name: repo.name, paths: [dir] }
    else if (!found.paths.includes(dir)) found.paths.push(dir)
  }
  const visit = async (dir: string, level: number): Promise<void> => {
    let entries: readonly { name: string; kind: string }[]
    try {
      entries = await io.list(dir)
    } catch {
      return
    }
    if (entries.some(entry => entry.name === '.git' && entry.kind === 'dir')) {
      try {
        const repo = remoteFromConfig(await io.read(`${dir}/.git/config`))
        if (repo !== null) add(dir, repo)
      } catch {
        // a clone with no readable config is skipped
      }
      return
    }
    if (level >= depth) return
    const folders = entries
      .filter(entry => entry.kind === 'dir' && !entry.name.startsWith('.') && !SKIPPED.has(entry.name))
      .map(entry => entry.name)
      .sort(byName)
    for (const name of folders) await visit(`${dir}/${name}`, level + 1)
  }
  for (const root of roots) await visit(root, 0)
  return clones
}
