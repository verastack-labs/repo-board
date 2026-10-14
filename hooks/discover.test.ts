import { describe, expect, test } from 'claude-code/testing'

import { expandRoot, findClones, parseRemote, remoteFromConfig, repoKey } from './discover'
import { DOCS, PATHS, TREE, gitConfig, treeIo } from './helpers'

describe('parseRemote', () => {
  test('reads https, ssh and ssh:// forms, with or without .git', () => {
    const repo = { owner: 'verastack-labs', name: 'rigseed-app' }
    expect(parseRemote('https://github.com/verastack-labs/rigseed-app.git')).toEqual(repo)
    expect(parseRemote('https://github.com/verastack-labs/rigseed-app')).toEqual(repo)
    expect(parseRemote('https://github.com/verastack-labs/rigseed-app/')).toEqual(repo)
    expect(parseRemote('https://riganb@github.com/verastack-labs/rigseed-app.git')).toEqual(repo)
    expect(parseRemote('git@github.com:verastack-labs/rigseed-app.git')).toEqual(repo)
    expect(parseRemote('ssh://git@github.com/verastack-labs/rigseed-app.git')).toEqual(repo)
    expect(parseRemote('  https://github.com/verastack-labs/rigseed-app.git\r')).toEqual(repo)
  })
  test('gives nothing for other hosts and odd paths', () => {
    expect(parseRemote('https://gitlab.com/verastack-labs/rigseed-app.git')).toBeNull()
    expect(parseRemote('https://github.com/verastack-labs')).toBeNull()
    expect(parseRemote('C:/repos/rigseed-app')).toBeNull()
  })
})

describe('remoteFromConfig', () => {
  test('reads origin', () => {
    expect(remoteFromConfig(gitConfig('git@github.com:riganb/dotfiles.git'))).toEqual({ owner: 'riganb', name: 'dotfiles' })
  })
  test('prefers origin, then any other GitHub remote', () => {
    const both = '[remote "upstream"]\n\turl = https://github.com/a/one.git\n[remote "origin"]\n\turl = https://github.com/b/two.git\n'
    expect(remoteFromConfig(both)).toEqual({ owner: 'b', name: 'two' })
    const noOrigin = '[remote "upstream"]\n\turl = https://github.com/a/one.git\n'
    expect(remoteFromConfig(noOrigin)).toEqual({ owner: 'a', name: 'one' })
    const gitlabOrigin = '[remote "origin"]\n\turl = https://gitlab.com/b/two.git\n[remote "mirror"]\n\turl = https://github.com/a/one.git\n'
    expect(remoteFromConfig(gitlabOrigin)).toEqual({ owner: 'a', name: 'one' })
  })
  test('ignores url keys outside a remote section and reads CRLF files', () => {
    expect(remoteFromConfig('[submodule "x"]\n\turl = https://github.com/a/one.git\n')).toBeNull()
    expect(remoteFromConfig('[remote "origin"]\r\n\turl = https://github.com/a/one.git\r\n')).toEqual({ owner: 'a', name: 'one' })
  })
})

describe('expandRoot', () => {
  test('expands ~ and turns backslashes to slashes', () => {
    expect(expandRoot('~/Documents', 'C:/home')).toBe('C:/home/Documents')
    expect(expandRoot('~', 'C:/home')).toBe('C:/home')
    expect(expandRoot('D:\\code\\', 'C:/home')).toBe('D:/code')
  })
  test('gives nothing for ~ with no home, or a blank root', () => {
    expect(expandRoot('~/Documents', null)).toBeNull()
    expect(expandRoot('  ', 'C:/home')).toBeNull()
  })
})

describe('repoKey', () => {
  test('is lower case owner/name', () => {
    expect(repoKey('Verastack-Labs', 'Riggit-Internal')).toBe('verastack-labs/riggit-internal')
  })
})

describe('findClones', () => {
  test('finds clones to the depth, skipping node_modules, hidden folders and files', async () => {
    const io = treeIo(TREE)
    const clones = await findClones([DOCS], 3, io)
    expect(Object.keys(clones).sort()).toEqual([
      'riganb/dotfiles',
      'someone/else',
      'verastack-labs/riggit-internal',
      'verastack-labs/rigseed-app',
      'verastack-labs/session-meter',
    ])
    expect(clones['verastack-labs/riggit-internal']).toEqual({ owner: 'verastack-labs', name: 'riggit-internal', paths: [PATHS.riggit] })
    expect(io.listed.some(path => path.includes('node_modules') || path.includes('.cache'))).toBe(false)
    expect(io.listed).not.toContain(`${PATHS.riggit}/.git`)
  })
  test('a deeper scan finds the deep clone', async () => {
    const clones = await findClones([DOCS], 4, treeIo(TREE))
    expect(clones['verastack-labs/deep']?.paths).toEqual([PATHS.deep])
  })
  test('lists every clone of a repo, in the order found', async () => {
    const tree = { ...TREE, [`${DOCS}/aaa/session-meter/.git/config`]: gitConfig('https://github.com/verastack-labs/session-meter.git') }
    const clones = await findClones([DOCS], 3, treeIo(tree))
    expect(clones['verastack-labs/session-meter']?.paths).toEqual([`${DOCS}/aaa/session-meter`, PATHS.meter])
  })
  test('overlapping roots do not count a clone twice', async () => {
    const clones = await findClones([DOCS, `${DOCS}/github`], 3, treeIo(TREE))
    expect(clones['verastack-labs/riggit-internal']?.paths).toEqual([PATHS.riggit])
  })
  test('a missing root, an unreadable config or a non-GitHub remote is skipped', async () => {
    const tree = {
      ...TREE,
      [`${DOCS}/broken/.git/HEAD`]: 'ref: refs/heads/main',
      [`${DOCS}/gitlab/.git/config`]: gitConfig('https://gitlab.com/a/b.git'),
    }
    const clones = await findClones(['C:/nowhere', DOCS], 3, treeIo(tree))
    expect(Object.keys(clones)).toHaveLength(5)
  })
  test('a root that is itself a clone is found', async () => {
    const clones = await findClones([PATHS.meter], 3, treeIo(TREE))
    expect(Object.keys(clones)).toEqual(['verastack-labs/session-meter'])
  })
})
