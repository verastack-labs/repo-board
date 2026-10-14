import { describe, expect, test } from 'claude-code/testing'

import { QUERY, describeGhFailure, ghArgs, parsePage } from './github'
import { HOUR, NOW, ORG_REPOS, ghPage } from './helpers'

describe('ghArgs', () => {
  test('passes the query and owner, and the cursor only when there is one', () => {
    expect(ghArgs('verastack-labs', null)).toEqual(['gh', 'api', 'graphql', '-f', `query=${QUERY}`, '-f', 'owner=verastack-labs'])
    expect(ghArgs('riganb', 'Y3Vyc29y')).toEqual(['gh', 'api', 'graphql', '-f', `query=${QUERY}`, '-f', 'owner=riganb', '-f', 'after=Y3Vyc29y'])
  })
})

describe('parsePage', () => {
  test('reads repos, PRs, review decisions and check states', () => {
    const page = parsePage(ghPage('verastack-labs', ORG_REPOS), 'verastack-labs')
    expect(page.after).toBeNull()
    expect(page.repos.map(repo => repo.name)).toEqual(['oinkbuns', 'riggit-internal', 'rigseed-app', 'session-meter'])
    expect(page.repos[0]).toEqual({
      owner: 'verastack-labs',
      name: 'oinkbuns',
      url: 'https://github.com/verastack-labs/oinkbuns',
      pullCount: 1,
      pulls: [
        {
          number: 2,
          title: 'Change 2',
          url: 'https://github.com/verastack-labs/oinkbuns/pull/2',
          author: 'dependabot',
          isDraft: false,
          createdAt: new Date(NOW - HOUR).toISOString(),
          review: 'none',
          checks: 'passing',
        },
      ],
    })
    expect(page.repos[2]?.pulls[0]?.checks).toBe('failing')
  })
  test('maps every check state and review decision', () => {
    const page = parsePage(
      ghPage('o', [
        {
          name: 'r',
          pulls: [
            { number: 1, author: 'a', checks: 'ERROR', review: 'APPROVED' },
            { number: 2, author: 'a', checks: 'PENDING', review: 'CHANGES_REQUESTED' },
            { number: 3, author: 'a', checks: 'EXPECTED', review: 'REVIEW_REQUIRED' },
            { number: 4, author: 'a', checks: null },
            { number: 5, author: 'a' },
          ],
        },
      ]),
      'o',
    )
    const pulls = page.repos[0]?.pulls ?? []
    expect(pulls.map(pull => pull.checks)).toEqual(['failing', 'pending', 'pending', 'none', 'none'])
    expect(pulls.map(pull => pull.review)).toEqual(['approved', 'changes', 'required', 'none', 'none'])
  })
  test('gives the cursor of the next page', () => {
    expect(parsePage(ghPage('o', [{ name: 'r' }], 'Y3Vyc29y'), 'o').after).toBe('Y3Vyc29y')
  })
  test('leaves out archived repos and repos another account owns', () => {
    const page = parsePage(
      ghPage('riganb', [{ name: 'dotfiles' }, { name: 'old', isArchived: true }, { name: 'mehfil', owner: 'verastack-labs' }]),
      'riganb',
    )
    expect(page.repos.map(repo => repo.name)).toEqual(['dotfiles'])
  })
  test('matches the owner whatever its case', () => {
    expect(parsePage(ghPage('VeraStack-Labs', [{ name: 'r' }]), 'verastack-labs').repos).toHaveLength(1)
  })
  test('a deleted author reads as ghost', () => {
    const body = JSON.parse(ghPage('o', [{ name: 'r', pulls: [{ number: 1, author: 'x' }] }]))
    body.data.repositoryOwner.repositories.nodes[0].pullRequests.nodes[0].author = null
    expect(parsePage(JSON.stringify(body), 'o').repos[0]?.pulls[0]?.author).toBe('ghost')
  })
  test('throws a short message for an errors body, an unknown owner or bad JSON', () => {
    expect(() => parsePage(JSON.stringify({ errors: [{ message: 'API rate limit exceeded' }] }), 'o')).toThrow('API rate limit exceeded')
    expect(() => parsePage(JSON.stringify({ data: { repositoryOwner: null } }), 'nope')).toThrow('no GitHub account named nope')
    expect(() => parsePage('<html>', 'o')).toThrow('GitHub answered something unreadable')
  })
})

describe('describeGhFailure', () => {
  test('points at gh auth login when signed out, else gives the first line', () => {
    expect(describeGhFailure('To get started with GitHub CLI, please run:  gh auth login\n')).toBe('sign in with gh auth login')
    expect(describeGhFailure('HTTP 401: Bad credentials (https://api.github.com/graphql)\n')).toBe('sign in with gh auth login')
    expect(describeGhFailure('\nerror connecting to api.github.com\ncheck your internet connection\n')).toBe('error connecting to api.github.com')
    expect(describeGhFailure('')).toBe('gh failed')
  })
})

test('the query asks only for repos the owner owns', () => {
  expect(QUERY).toContain('ownerAffiliations: [OWNER]')
})
