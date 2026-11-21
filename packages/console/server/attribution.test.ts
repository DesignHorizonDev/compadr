// @vitest-environment node
import { createFixtureRepo } from '@compadr/engine/testing'
import type { DriftReport } from '@compadr/format'
import { describe, expect, it } from 'vitest'
import {
  approvers,
  attributeToPullRequests,
  commitLookup,
  pullRequestOfCommit,
  type PullRequestAttribution,
} from './attribution.ts'
import type { GhRunner } from './pull-requests.ts'
import { repositoryReports } from './repository-reports.ts'

const COMMIT = 'a'.repeat(40)
const OTHER = 'b'.repeat(40)

/** A gh that answers the two calls of pullRequestOfCommit. */
function fakeGh(
  pulls: object[],
  view: object,
  calls: string[][] = []
): GhRunner {
  return (_repository, args) => {
    calls.push(args)
    return Promise.resolve(JSON.stringify(args[0] === 'api' ? pulls : view))
  }
}

const pull = (number: number, merged: boolean, mergeCommit = OTHER) => ({
  number,
  title: `PR ${number}`,
  html_url: `https://github.com/acme/shop/pull/${number}`,
  merged_at: merged ? '2026-10-01T10:00:00Z' : null,
  merge_commit_sha: mergeCommit,
})

describe('approvers', () => {
  it('keeps the reviewers whose last verdict is an approval', () => {
    expect(
      approvers([
        { author: { login: 'ana' }, state: 'APPROVED' },
        { author: { login: 'bo' }, state: 'APPROVED' },
        { author: { login: 'bo' }, state: 'CHANGES_REQUESTED' },
        { author: { login: 'ana' }, state: 'COMMENTED' },
        { author: null, state: 'APPROVED' },
        { author: { login: 'cy' }, state: 'DISMISSED' },
      ])
    ).toEqual(['ana'])
  })
})

describe('pullRequestOfCommit', () => {
  it('names the approvers of the merged pull request', async () => {
    const calls: string[][] = []
    const found = await pullRequestOfCommit(
      '/repo',
      COMMIT,
      fakeGh(
        [pull(3, false), pull(7, true), pull(9, true, COMMIT)],
        {
          reviews: [{ author: { login: 'ana' }, state: 'APPROVED' }],
          mergedBy: { login: 'bo' },
        },
        calls
      )
    )
    expect(found).toEqual({
      names: ['ana'],
      pullRequest: {
        number: 9,
        title: 'PR 9',
        url: 'https://github.com/acme/shop/pull/9',
        role: 'approved',
      },
    })
    expect(calls).toEqual([
      ['api', `repos/{owner}/{repo}/commits/${COMMIT}/pulls`],
      ['pr', 'view', '9', '--json', 'reviews,mergedBy'],
    ])
  })

  it('names the person who merged it when nobody approved', async () => {
    const found = await pullRequestOfCommit(
      '/repo',
      COMMIT,
      fakeGh([pull(7, true)], { reviews: [], mergedBy: { login: 'bo' } })
    )
    expect(found?.names).toEqual(['bo'])
    expect(found?.pullRequest.role).toBe('merged')
    expect(found?.pullRequest.number).toBe(7)
  })

  it('finds nothing without a merged pull request, and fails without gh', async () => {
    expect(
      await pullRequestOfCommit(
        '/repo',
        COMMIT,
        fakeGh([pull(3, false)], { reviews: [], mergedBy: null })
      )
    ).toBeNull()
    await expect(
      pullRequestOfCommit('/repo', COMMIT, () =>
        Promise.reject(new Error('gh: command not found'))
      )
    ).rejects.toThrow('gh: command not found')
  })
})

describe('commitLookup', () => {
  it('asks once per commit and repository', async () => {
    const asked: string[] = []
    const lookup = commitLookup((repository, commit) => {
      asked.push(`${repository} ${commit}`)
      return Promise.resolve(null)
    })
    await Promise.all([
      lookup('/a', COMMIT),
      lookup('/a', COMMIT),
      lookup('/b', COMMIT),
    ])
    await lookup('/a', COMMIT)
    expect(asked).toEqual([`/a ${COMMIT}`, `/b ${COMMIT}`])
  })

  it('asks again after a failure, once the delay is over', async () => {
    let calls = 0
    const lookup = commitLookup(() => {
      calls++
      return calls === 1
        ? Promise.reject(new Error('offline'))
        : Promise.resolve(null)
    }, 20)
    await expect(lookup('/a', COMMIT)).rejects.toThrow('offline')
    // Within the delay, the failure stands without a new call.
    await expect(lookup('/a', COMMIT)).rejects.toThrow('offline')
    expect(calls).toBe(1)
    await new Promise(done => setTimeout(done, 40))
    expect(await lookup('/a', COMMIT)).toBeNull()
    expect(calls).toBe(2)
  })

  it('keeps a freed slot for the next waiter', async () => {
    let running = 0
    let most = 0
    const finish: (() => void)[] = []
    const lookup = commitLookup(() => {
      running++
      most = Math.max(most, running)
      return new Promise(done =>
        finish.push(() => {
          running--
          done(null)
        })
      )
    })
    const commit = (i: number) => i.toString(16).padStart(40, '0')
    const first = Array.from({ length: 5 }, (_, i) => lookup('/a', commit(i)))
    await new Promise(done => setTimeout(done, 0))
    // One lookup ends, and a new call comes before the waiter runs.
    finish.shift()!()
    const late = lookup('/a', commit(9))
    for (let n = 0; n < 10; n++) {
      await new Promise(done => setTimeout(done, 0))
      finish.shift()?.()
    }
    await Promise.all([...first, late])
    expect(most).toBe(4)
  })

  it('runs at most four lookups at a time', async () => {
    let running = 0
    let most = 0
    const lookup = commitLookup(async () => {
      running++
      most = Math.max(most, running)
      await new Promise(done => setTimeout(done, 5))
      running--
      return null
    })
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        lookup('/a', i.toString(16).padStart(40, '0'))
      )
    )
    expect(most).toBe(4)
  })
})

describe('attributeToPullRequests', () => {
  const found: PullRequestAttribution = {
    names: ['ana'],
    pullRequest: {
      number: 9,
      title: 'PR 9',
      url: 'https://github.com/acme/shop/pull/9',
      role: 'approved',
    },
  }
  const report = {
    decisions: [
      {
        number: 1,
        attribution: { names: ['Ada'], source: 'commit', commit: COMMIT },
      },
      { number: 2, attribution: { names: ['Board'], source: 'declared' } },
      {
        number: 3,
        attribution: { names: ['Bo'], source: 'commit', commit: OTHER },
      },
      { number: 4 },
    ],
    references: [
      {
        id: 'r1',
        checkedBy: { names: ['Cy'], source: 'commit', commit: COMMIT },
      },
      { id: 'r2' },
    ],
  } as unknown as DriftReport

  it('replaces the commit authors whose commit has a pull request', async () => {
    const asked: string[] = []
    const { report: attributed, complete } = await attributeToPullRequests(
      '/repo',
      report,
      (_repository, commit) => {
        asked.push(commit)
        return Promise.resolve(commit === COMMIT ? found : null)
      }
    )
    expect(asked.sort()).toEqual([COMMIT, OTHER])
    expect(attributed.decisions.map(d => d.attribution)).toEqual([
      { ...found, source: 'pull-request', commit: COMMIT },
      { names: ['Board'], source: 'declared' },
      { names: ['Bo'], source: 'commit', commit: OTHER },
      undefined,
    ])
    expect(attributed.references.map(r => r.checkedBy)).toEqual([
      { ...found, source: 'pull-request', commit: COMMIT },
      undefined,
    ])
    expect(complete).toBe(true)
    // The report of the cache is left as it was.
    expect(report.decisions[0]!.attribution?.source).toBe('commit')
  })

  it('keeps the commit author when gh fails, and says so', async () => {
    const { report: attributed, complete } = await attributeToPullRequests(
      '/repo',
      report,
      (_repository, commit) =>
        commit === COMMIT
          ? Promise.reject(new Error('offline'))
          : Promise.resolve(null)
    )
    expect(complete).toBe(false)
    expect(attributed.decisions[0]!.attribution?.source).toBe('commit')
  })
})

describe('repositoryReports with a commit lookup', () => {
  it('serves the report with the people of the pull request', async () => {
    const fixture = createFixtureRepo([
      {
        date: '2026-01-10T09:00:00Z',
        files: {
          'docs/adr/0001-pool.md':
            '# ADR 0001 — Pool\n\n- **Status:** Accepted\n\nSee `src/pool.ts`.\n',
          'src/pool.ts': 'export {}\n',
        },
      },
    ])
    try {
      const commit = fixture.git('rev-parse', 'HEAD').trim()
      const asked: string[] = []
      const options = [
        { repository: fixture.path, ref: 'HEAD', generatorVersion: '0.0.0' },
      ]
      const lookup = (repository: string, at: string) => {
        asked.push(at)
        return Promise.resolve(
          repository === fixture.path && at === commit
            ? {
                names: ['ana'],
                pullRequest: {
                  number: 9,
                  title: 'PR 9',
                  url: 'https://github.com/acme/shop/pull/9',
                  role: 'approved' as const,
                },
              }
            : null
        )
      }
      const reports = repositoryReports(options, { commitPullRequest: lookup })
      const [id] = (await reports.list()).reports.map(r => r.id)
      const report = await reports.get(id!)
      expect(report?.decisions[0]?.attribution).toEqual({
        names: ['ana'],
        source: 'pull-request',
        commit,
        pullRequest: {
          number: 9,
          title: 'PR 9',
          url: 'https://github.com/acme/shop/pull/9',
          role: 'approved',
        },
      })
      // A second page asks gh nothing more.
      expect(await reports.get(id!)).toBe(report)
      expect(asked).toEqual([commit])
      // Without the lookup, as with --no-github, the commit author stays.
      const plain = await repositoryReports(options).get(id!)
      expect(plain?.decisions[0]?.attribution).toEqual({
        names: ['Compadr'],
        source: 'commit',
        commit,
      })
    } finally {
      fixture.remove()
    }
  })

  it('looks up on warm, and again after gh failed', async () => {
    const fixture = createFixtureRepo([
      {
        date: '2026-01-10T09:00:00Z',
        files: {
          'docs/adr/0001-pool.md':
            '# ADR 0001 — Pool\n\n- **Status:** Accepted\n\nSee `src/pool.ts`.\n',
          'src/pool.ts': 'export {}\n',
        },
      },
    ])
    try {
      let calls = 0
      const lookup = () => {
        calls++
        return calls === 1
          ? Promise.reject(new Error('offline'))
          : Promise.resolve({
              names: ['bo'],
              pullRequest: {
                number: 4,
                title: 'PR 4',
                url: 'https://github.com/acme/shop/pull/4',
                role: 'merged' as const,
              },
            })
      }
      const options = [
        { repository: fixture.path, ref: 'HEAD', generatorVersion: '0.0.0' },
      ]
      const reports = repositoryReports(options, { commitPullRequest: lookup })
      const [id] = (await reports.list()).reports.map(r => r.id)
      const failed = await reports.get(id!)
      expect(failed?.decisions[0]?.attribution?.source).toBe('commit')
      const named = await reports.get(id!)
      expect(named?.decisions[0]?.attribution?.names).toEqual(['bo'])
      expect(calls).toBe(2)

      // The warm-up asks gh before any page does.
      const warmed = new Promise<void>(done =>
        repositoryReports(options, {
          commitPullRequest: () => {
            done()
            return Promise.resolve(null)
          },
        }).warm()
      )
      await warmed
    } finally {
      fixture.remove()
    }
  })
})
