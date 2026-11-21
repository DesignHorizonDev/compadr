// @vitest-environment node
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createFixtureRepo, type FixtureRepo } from '@compadr/engine/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openPullRequests } from './pull-requests.ts'
import { repositoryReports } from './repository-reports.ts'
import { branchesOf, findReviews } from './reviews.ts'

const record = (number: number, title: string, status: string) =>
  `# ADR ${String(number).padStart(4, '0')} — ${title}\n\n- **Status:** ${status}\n\nSee \`src/mail.ts\`.\n`

let fixture: FixtureRepo
let main: string

function commitOn(branch: string, from: string, files: Record<string, string>) {
  fixture.git('checkout', '-q', '-b', branch, from)
  for (const [file, content] of Object.entries(files)) {
    writeFileSync(join(fixture.path, file), content)
    fixture.git('add', '--', file)
  }
  fixture.git('commit', '-q', '-m', branch)
  fixture.git('checkout', '-q', 'main')
}

beforeAll(() => {
  fixture = createFixtureRepo([
    {
      date: '2026-01-10T09:00:00Z',
      files: {
        'docs/adr/0001-mail.md': record(1, 'Mail sender', 'Accepted'),
        'docs/adr/0002-reply.md': record(2, 'Reply address', 'Proposed'),
        'src/mail.ts': 'export {}\n',
      },
    },
    {
      date: '2026-02-10T09:00:00Z',
      files: { 'docs/adr/0004-later.md': record(4, 'Later', 'Accepted') },
    },
  ])
  fixture.git('config', 'user.name', 'Compadr')
  fixture.git('config', 'user.email', 'fixture@example.com')
  main = fixture.git('rev-parse', 'HEAD').trim()
  commitOn('feat/reply-to', 'main', {
    'docs/adr/0003-reply-to.md': record(
      3,
      'Reply-to of team mails',
      'Proposed'
    ),
  })
  commitOn('docs/reword', 'main', {
    'docs/adr/0002-reply.md': `${record(2, 'Reply address', 'Proposed')}More.\n`,
  })
  commitOn('fix/code', 'main', { 'src/mail.ts': 'export const a = 1\n' })
  // A branch behind main proposes nothing of its own.
  fixture.git('branch', 'old', 'main~1')
})

afterAll(() => fixture.remove())

describe('branchesOf', () => {
  it('keeps one remote branch per name, the one of origin first', async () => {
    fixture.git('update-ref', 'refs/remotes/fork/feat/x', main)
    fixture.git('update-ref', 'refs/remotes/origin/feat/x', main)
    fixture.git('update-ref', 'refs/remotes/origin/feat/reply-to', main)
    try {
      const branches = await branchesOf(fixture.path)
      expect(branches.filter(b => b.name === 'feat/x').map(b => b.ref)).toEqual(
        ['refs/remotes/origin/feat/x']
      )
      expect(
        branches.filter(b => b.name === 'feat/reply-to').map(b => b.ref)
      ).toEqual(['refs/heads/feat/reply-to'])
    } finally {
      for (const ref of [
        'refs/remotes/fork/feat/x',
        'refs/remotes/origin/feat/x',
        'refs/remotes/origin/feat/reply-to',
      ]) {
        fixture.git('update-ref', '-d', ref)
      }
    }
  })
})

describe('findReviews', () => {
  it('lists the branches ahead of the base, with the records they propose', async () => {
    const found = await findReviews(fixture.path, 'docs/adr', main)
    expect(
      found.map(({ branch, proposed }) => [
        branch.name,
        proposed.map(p => [p.number, p.title, p.change]),
      ])
    ).toEqual([
      ['docs/reword', [[2, 'Reply address', 'changed']]],
      ['feat/reply-to', [[3, 'Reply-to of team mails', 'added']]],
      // A branch that changes the code only proposes nothing.
      ['fix/code', []],
    ])
    // Each branch names the commit where it leaves the base.
    for (const { from } of found) expect(from).toMatch(/^[0-9a-f]{40}$/)
  })

  it('names the local branches without refs/heads', async () => {
    const names = (await branchesOf(fixture.path)).map(b => b.name).sort()
    expect(names).toEqual([
      'docs/reword',
      'feat/reply-to',
      'fix/code',
      'main',
      'old',
    ])
  })
})

describe('the reviews of the console server', () => {
  it('names the pull request and serves the report of a branch', async () => {
    const reports = repositoryReports(
      [{ repository: fixture.path, ref: 'main', generatorVersion: '0.0.0' }],
      {
        pullRequests: () =>
          Promise.resolve([
            {
              number: 12,
              title: 'Reply-to of team mails',
              url: 'https://github.com/o/r/pull/12',
              draft: false,
              branch: 'feat/reply-to',
            },
          ]),
      }
    )
    const { reviews, problems } = await reports.reviews()
    expect(problems).toEqual([])
    const review = reviews.find(r => r.branch === 'feat/reply-to')!
    expect(review.reportId).toMatch(/^.+--feat-reply-to$/)
    expect(review.baseReportId).not.toBe(review.reportId)
    expect(review.pullRequest).toEqual({
      number: 12,
      title: 'Reply-to of team mails',
      url: 'https://github.com/o/r/pull/12',
      draft: false,
    })
    const report = await reports.get(review.reportId)
    expect(report?.repository.ref).toBe('refs/heads/feat/reply-to')
    expect(report?.decisions.map(d => d.number)).toEqual([1, 2, 3, 4])
    // A branch that changes the code only is listed apart, with its source.
    const { changes } = await reports.reviews()
    expect(changes.map(c => c.branch)).toEqual(['fix/code'])
    const source = await reports.branchSource(changes[0]!.reportId)
    expect(source).toMatchObject({
      branch: 'fix/code',
      commit: changes[0]!.commit,
    })
    expect(await reports.branchSource(review.baseReportId)).toBeUndefined()
    // The list of reports keeps the followed reference only.
    const { reports: listed } = await reports.list()
    expect(listed.map(r => r.repository.ref)).toEqual(['main'])
  })

  it('finds the report of a branch before the list of reviews', async () => {
    const first = repositoryReports([
      { repository: fixture.path, ref: 'main', generatorVersion: '0.0.0' },
    ])
    const { reviews } = await first.reviews()
    const id = reviews.find(r => r.branch === 'feat/reply-to')!.reportId
    const fresh = repositoryReports([
      { repository: fixture.path, ref: 'main', generatorVersion: '0.0.0' },
    ])
    expect((await fresh.get(id))?.repository.ref).toBe(
      'refs/heads/feat/reply-to'
    )
    expect(await fresh.get('no-such-report')).toBeUndefined()
  })

  it('looks for an unknown branch report once, without gh', async () => {
    let asked = 0
    const reports = repositoryReports(
      [{ repository: fixture.path, ref: 'main', generatorVersion: '0.0.0' }],
      {
        pullRequests: () => {
          asked++
          return Promise.resolve([])
        },
      }
    )
    const { reviews } = await reports.reviews()
    const prefix = reviews[0]!.reportId.split('--')[0]!
    asked = 0
    expect(await reports.get(`${prefix}--gone`)).toBeUndefined()
    expect(await reports.get(`${prefix}--gone`)).toBeUndefined()
    expect(asked).toBe(0)
  })
})

describe('openPullRequests', () => {
  it('reads the open pull requests that gh lists', async () => {
    const prs = await openPullRequests('/repo', (_repository, args) => {
      expect(args.slice(0, 3)).toEqual(['pr', 'list', '--state'])
      return Promise.resolve(
        JSON.stringify([
          {
            number: 7,
            title: 'T',
            url: 'u',
            isDraft: true,
            headRefName: 'feat/x',
          },
        ])
      )
    })
    expect(prs).toEqual([
      { number: 7, title: 'T', url: 'u', draft: true, branch: 'feat/x' },
    ])
  })

  it('gives none when gh fails', async () => {
    await expect(
      openPullRequests('/repo', () => {
        throw new Error('no gh')
      })
    ).resolves.toEqual([])
  })
})
