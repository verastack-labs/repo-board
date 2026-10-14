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
