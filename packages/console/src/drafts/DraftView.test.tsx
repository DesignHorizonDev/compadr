import type { DriftReport } from '@compadr/format'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { App } from '../App.tsx'
import type { CheckRequest, DraftSource, DraftState } from '../drafts.ts'
import { summarize, type ReportSource } from '../reports.ts'
import { makeCitedReport } from '../testing/report.ts'

afterEach(cleanup)

const BASE = 'b'.repeat(40)

/** A server with one repository and its draft, kept in memory. */
function memoryServer() {
  const reports: Record<string, DriftReport> = { shop: makeCitedReport() }
  const checks: { reportId: string; request: CheckRequest }[] = []
  let draft: DraftState = {
    name: 'console',
    repository: '/work/shop',
    baseReportId: 'shop',
    reportId: null,
    base: null,
    baseBranch: null,
    commits: [],
    drafts: [],
  }
  const source: ReportSource = {
    list: () =>
      Promise.resolve(
        Object.entries(reports).map(([id, report]) => summarize(id, report))
      ),
    get: id => Promise.resolve(reports[id]!),
  }
  const drafts: DraftSource = {
    get: () => Promise.resolve(draft),
    check(reportId, request) {
      checks.push({ reportId, request })
      const n = draft.commits.length + 1
      draft = {
        ...draft,
        reportId: 'shop--draft.console',
        base: BASE,
        baseBranch: 'main',
        commits: [
          ...draft.commits,
          {
            commit: String(n).repeat(40),
            subject: 'docs(adr): mark a reference as checked',
            author: 'Ann',
          },
        ],
        drafts: [
          {
            name: 'console',
            reportId: 'shop--draft.console',
            commits: n,
            authors: ['Ann'],
          },
        ],
      }
      const base = reports.shop!
      reports['shop--draft.console'] = {
        ...base,
        repository: {
          ...base.repository,
          ref: 'drafts/console',
          commit: String(n).repeat(40),
        },
      }
      return Promise.resolve(draft)
    },
    anchor: () => Promise.reject(new Error('not in this test')),
    accept: () => Promise.reject(new Error('not in this test')),
    validateRules: () => Promise.reject(new Error('not in this test')),
  }
  return { source, drafts, checks }
}

describe('the draft in the console', () => {
  it('adds checks to the draft, then lists its commits and its report', async () => {
    const user = userEvent.setup()
    const server = memoryServer()
    render(<App source={server.source} drafts={server.drafts} />)
    await user.click(await screen.findByRole('button', { name: 'Decisions' }))
    await user.click(
      await screen.findByRole('button', { name: /Payment provider/ })
    )
    const boxes = screen.getAllByRole('checkbox', { name: 'Mark as checked' })
    await user.click(boxes[0]!)
    await user.click(
      await screen.findByRole('button', { name: 'Add to the draft' })
    )
    expect((await screen.findByRole('status')).textContent).toContain(
      'Added to the draft console, which now holds 1 commit.'
    )
    await user.click(
      screen.getAllByRole('checkbox', { name: 'Mark as checked' })[1]!
    )
    await user.click(screen.getByRole('button', { name: 'Add to the draft' }))
    expect((await screen.findByRole('status')).textContent).toContain(
      'which now holds 2 commits.'
    )
    expect(server.checks).toEqual([
      {
        reportId: 'shop',
        request: { references: ['0037:services/billing.ts:116:1'] },
      },
      {
        reportId: 'shop',
        request: { references: ['0037:services/search.ts:20:1'] },
      },
    ])

    await user.click(screen.getByRole('button', { name: 'Draft' }))
    const commits = within(
      screen.getByRole('list', { name: 'Commits of the draft' })
    ).getAllByRole('listitem')
    expect(commits.map(item => item.textContent)).toEqual([
      '11111111 docs(adr): mark a reference as checked · Ann',
      '22222222 docs(adr): mark a reference as checked · Ann',
    ])
    expect(
      screen.getByText('compadr draft publish /work/shop console --open-pr')
    ).toBeTruthy()
    await user.click(
      screen.getByRole('button', { name: 'Show the report of the draft' })
    )
    const ref = screen.getByRole<HTMLSelectElement>('combobox', {
      name: 'Git reference',
    })
    expect(ref.value).toBe('shop--draft.console')
    expect(
      await screen.findByRole('button', {
        name: 'The report of the draft is on screen',
      })
    ).toBeTruthy()
  })

  it('gives the command when the server keeps no draft', async () => {
    const user = userEvent.setup()
    const server = memoryServer()
    const none: DraftSource = {
      ...server.drafts,
      get: () => Promise.resolve(null),
    }
    render(<App source={server.source} drafts={none} />)
    await user.click(await screen.findByRole('button', { name: 'Decisions' }))
    await user.click(
      await screen.findByRole('button', { name: /Payment provider/ })
    )
    await user.click(
      screen.getAllByRole('checkbox', { name: 'Mark as checked' })[0]!
    )
    expect(screen.queryByRole('button', { name: 'Add to the draft' })).toBe(
      null
    )
    expect(screen.getByText(/compadr mark-checked/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Draft' }))
    expect(screen.getByText(/This console keeps no draft/)).toBeTruthy()
  })
})

describe('the drafts of a repository', () => {
  it('lists the other drafts and fills the one the person picks', async () => {
    const user = userEvent.setup()
    const server = memoryServer()
    const asked: (string | undefined)[] = []
    const state = (name: string): DraftState => ({
      name,
      repository: '/work/shop',
      baseReportId: 'shop',
      reportId: null,
      base: null,
      baseBranch: null,
      commits: [],
      drafts: [
        {
          name: 'console',
          reportId: 'shop--draft.console',
          commits: 2,
          authors: ['Ann'],
        },
        {
          name: 'release',
          reportId: 'shop--draft.release',
          commits: 1,
          authors: ['Bob', 'Ann'],
        },
      ],
    })
    const drafts: DraftSource = {
      ...server.drafts,
      get: (_id, name) => {
        asked.push(name)
        return Promise.resolve(state(name ?? 'console'))
      },
    }
    render(<App source={server.source} drafts={drafts} />)
    await user.click(await screen.findByRole('button', { name: 'Draft' }))
    const others = within(
      await screen.findByRole('list', {
        name: 'Other drafts of the repository',
      })
    )
    expect(others.getByRole('listitem').textContent).toBe(
      'release · 1 commit by Bob, Ann'
    )
    await user.click(others.getByRole('button', { name: 'release' }))
    expect(
      await screen.findByText(
        (_, element) =>
          element?.tagName === 'P' &&
          element.textContent ===
            'The actions of the pages fill the draft release.'
      )
    ).toBeTruthy()
    expect(asked).toContain('release')

    await user.type(screen.getByLabelText('Fill another draft'), 'hotfix')
    await user.click(screen.getByRole('button', { name: 'Use this draft' }))
    expect(asked.at(-1)).toBe('hotfix')
  })
})
