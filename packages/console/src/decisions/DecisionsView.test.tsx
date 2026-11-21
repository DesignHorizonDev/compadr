import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import type {
  AcceptSuggestion,
  DriftReport,
  PlainSuggestion,
} from '@compadr/format'
import type { PlainSource } from '../assist.ts'
import type { AcceptDecisionRequest, DraftState } from '../drafts.ts'
import { DraftContext } from '../drafts/draft-context.tsx'
import type { ReportSource } from '../reports.ts'
import { afterEach, describe, expect, it } from 'vitest'
import { makeCitedReport, makeFeatureReport } from '../testing/report.ts'
import { decisionPage, referenceSignals } from './decisions.ts'
import { DecisionsView } from './DecisionsView.tsx'

afterEach(cleanup)

function Controlled({ report }: { report: DriftReport }) {
  const [selected, setSelected] = useState<number>()
  return (
    <DecisionsView report={report} selected={selected} onSelect={setSelected} />
  )
}

describe('decisionPage', () => {
  it('dates each code link and gives its worst drift', () => {
    const page = decisionPage(makeCitedReport(), 37)!
    expect(
      page.links.map(link => [link.reference.adrLine, link.level, link.title])
    ).toEqual([
      [75, 'order', 'Cited file changed since the citation'],
      [82, 'review', 'Cited line changed after its citation'],
      [90, 'broken', 'Cited line is beyond the end of the file'],
      [95, null, 'Symbol found in the code'],
    ])
    expect(page.citedBy).toEqual([
      { file: 'src/services/billing.ts', lines: [10, 44], inCode: true },
      { file: 'docs/guide.md', lines: [2], inCode: false },
    ])
    expect(decisionPage(makeCitedReport(), 99)).toBeUndefined()
  })

  it('gives the main decision, the replaced rules and the struck rules', () => {
    const report = makeFeatureReport()
    const detail = decisionPage(report, 7)!
    expect(detail.main).toBe(3)
    expect(detail.replaces.map(rule => rule.quote)).toEqual([
      'an invoice is sent on the first day of the month',
      'refunds are paid in cash',
    ])
    const main = decisionPage(report, 3)!
    expect(main.main).toBeNull()
    expect(main.marks).toEqual([
      [expect.objectContaining({ note: 'ADR-0007' })],
    ])
  })

  it('keeps the worst signal of each reference', () => {
    const signals = referenceSignals(makeCitedReport())
    expect(signals.get('0037:services/short.ts:400:1')?.level).toBe('broken')
    expect(signals.has('0036')).toBe(false)
  })
})

describe('DecisionsView', () => {
  it('lists the proposed decisions that the code cites, and says it on their page', async () => {
    const user = userEvent.setup()
    const cited = makeCitedReport()
    const report: DriftReport = {
      ...cited,
      decisions: cited.decisions.map(d =>
        d.number === 37 ? { ...d, status: 'proposed', date: '2026-10-29' } : d
      ),
    }
    render(<Controlled report={report} />)
    const applied = within(
      screen.getByRole('region', { name: 'Proposed but applied' })
    )
    expect(applied.getAllByRole('listitem')).toHaveLength(1)
    expect(
      applied.getByText('· cited by 1 file of the code · proposed 2026-10-29')
    ).toBeTruthy()

    await user.click(applied.getByRole('button', { name: /Payment provider/ }))
    const page = within(screen.getByRole('article', { name: 'ADR-0037' }))
    expect(
      page.getByText(
        /This decision is proposed, and 1 file of the code cites it/
      )
    ).toBeTruthy()
  })

  it('shows the recommendation on a proposed decision, and accepts it in the draft', async () => {
    const user = userEvent.setup()
    const cited = makeCitedReport()
    const report: DriftReport = {
      ...cited,
      decisions: cited.decisions.map(d =>
        d.number === 37 ? { ...d, status: 'proposed' } : d
      ),
    }
    const suggestion: AcceptSuggestion = {
      kind: 'accept',
      schemaVersion: 1,
      status: 'suggested',
      provenance: {
        model: 'compadr-assist-1',
        promptVersion: 'accept-1',
        inputHash: 'c'.repeat(64),
        createdAt: '2026-11-17T10:00:00Z',
      },
      recommendation: 'accept',
      explanation: 'The code charges through the provider.',
      points: [
        {
          quote: 'Every charge goes through the provider',
          evidence: { path: 'src/services/billing.ts', text: 'charge()' },
          finding: 'The service calls the provider.',
        },
      ],
      amendments: [],
    }
    const source = {
      recommendation: (id: string, decision: number) =>
        Promise.resolve(id === 'shop' && decision === 37 ? suggestion : null),
    } as unknown as ReportSource
    const draft = {
      name: 'console',
      repository: '/repo',
      baseReportId: 'shop',
      reportId: null,
      base: null,
      baseBranch: null,
      commits: [],
      drafts: [],
    } satisfies DraftState
    const sent: AcceptDecisionRequest[] = []
    const reject = () => Promise.reject(new Error('not in this test'))
    render(
      <DraftContext.Provider
        value={{
          draft,
          check: reject,
          anchor: reject,
          validateRules: reject,
          accept: request => {
            sent.push(request)
            return Promise.resolve({
              ...draft,
              commits: [
                { commit: 'a'.repeat(40), subject: 'accept', author: 'Ana' },
              ],
            })
          },
          showReport: () => {},
          selectDraft: () => {},
        }}
      >
        <DecisionsView
          report={report}
          selected={37}
          onSelect={() => {}}
          recommendationOf={{ source, id: 'shop' }}
        />
      </DraftContext.Provider>
    )
    const section = within(
      await screen.findByRole('region', { name: 'Recommended by a model' })
    )
    expect(section.getByText('Accept')).toBeTruthy()
    expect(
      section.getByText('Every charge goes through the provider')
    ).toBeTruthy()
    await user.click(
      section.getByRole('button', { name: 'Accept as recommended' })
    )
    expect(sent).toEqual([
      {
        decision: 37,
        recommendation: {
          recommendation: 'accept',
          model: 'compadr-assist-1',
          promptVersion: 'accept-1',
        },
      },
    ])
    expect(
      await section.findByText(
        /Added to the draft console, which now holds 1 commit/
      )
    ).toBeTruthy()
  })

  it('hides the button when the record changed after the recommendation', async () => {
    const cited = makeCitedReport()
    const report: DriftReport = {
      ...cited,
      decisions: cited.decisions.map(d =>
        d.number === 37
          ? { ...d, status: 'proposed', revisedAt: '2026-11-18T09:00:00Z' }
          : d
      ),
    }
    const suggestion = {
      kind: 'accept',
      schemaVersion: 1,
      status: 'suggested',
      provenance: {
        model: 'compadr-assist-1',
        promptVersion: 'accept-1',
        inputHash: 'c'.repeat(64),
        createdAt: '2026-11-17T10:00:00Z',
      },
      recommendation: 'accept',
      explanation: 'The code applies it.',
      points: [],
      amendments: [],
    } satisfies AcceptSuggestion
    const source = {
      recommendation: () => Promise.resolve(suggestion),
    } as unknown as ReportSource
    render(
      <DecisionsView
        report={report}
        selected={37}
        onSelect={() => {}}
        recommendationOf={{ source, id: 'shop' }}
      />
    )
    expect(
      await screen.findByText(/after this recommendation\. Ask for a new/)
    ).toBeTruthy()
    expect(
      screen.queryByRole('button', { name: 'Accept as recommended' })
    ).toBeNull()
  })

  it('gives the command that writes a recommendation when there is none', async () => {
    const cited = makeCitedReport()
    const report: DriftReport = {
      ...cited,
      decisions: cited.decisions.map(d =>
        d.number === 37 ? { ...d, status: 'proposed' } : d
      ),
    }
    const source = {
      recommendation: () => Promise.resolve(null),
    } as unknown as ReportSource
    render(
      <DecisionsView
        report={report}
        selected={37}
        onSelect={() => {}}
        recommendationOf={{ source, id: 'shop' }}
      />
    )
    expect(
      await screen.findByText(
        'compadr assist accept . --decision 37 --out <findings-dir>/shop.accept-37.json'
      )
    ).toBeTruthy()
    expect(
      screen.queryByRole('button', { name: 'Accept as recommended' })
    ).toBeNull()
  })

  it('reads a decision in plain language once a person asks for it', async () => {
    const user = userEvent.setup()
    const version: PlainSuggestion = {
      kind: 'plain',
      schemaVersion: 1,
      status: 'suggested',
      provenance: {
        model: 'compadr-assist-1',
        promptVersion: 'plain-2',
        inputHash: 'd'.repeat(64),
        createdAt: '2026-11-17T10:00:00Z',
      },
      summary: 'Invoices go out once.\n\nA retry never charges twice.',
    }
    const asked: [string, number][] = []
    let answer: (value: PlainSuggestion) => void = () => {}
    const plain: PlainSource = {
      available: () => Promise.resolve(true),
      cached: () => Promise.resolve(null),
      read: (id, decision) => {
        asked.push([id, decision])
        return new Promise(done => (answer = done))
      },
    }
    render(
      <DecisionsView
        report={makeCitedReport()}
        selected={37}
        onSelect={() => {}}
        plainOf={{ source: plain, id: 'shop' }}
      />
    )
    const section = within(
      await screen.findByRole('region', { name: 'In plain language' })
    )
    expect(section.getByText(/each new version costs/)).toBeTruthy()
    await user.click(
      section.getByRole('button', { name: 'Read in plain language' })
    )
    expect(
      section.getByRole<HTMLButtonElement>('button', {
        name: 'Asking the assist service…',
      }).disabled
    ).toBe(true)
    expect(asked).toEqual([['shop', 37]])
    answer(version)
    expect(await section.findByText('Invoices go out once.')).toBeTruthy()
    expect(section.getByText('A retry never charges twice.')).toBeTruthy()
    expect(
      section.getByText(/compadr-assist-1 \(plain-2\) wrote this version on/)
    ).toBeTruthy()
    expect(section.getByText(/the record stays the reference/)).toBeTruthy()
    expect(section.queryByRole('button')).toBeNull()
    cleanup()

    // A version kept shows at once, and a failure says why.
    render(
      <DecisionsView
        report={makeCitedReport()}
        selected={37}
        onSelect={() => {}}
        plainOf={{
          source: { ...plain, cached: () => Promise.resolve(version) },
          id: 'shop',
        }}
      />
    )
    expect(await screen.findByText('Invoices go out once.')).toBeTruthy()
    cleanup()
    render(
      <DecisionsView
        report={makeCitedReport()}
        selected={37}
        onSelect={() => {}}
        plainOf={{
          source: {
            ...plain,
            read: () => Promise.reject(new Error('the service answered 503')),
          },
          id: 'shop',
        }}
      />
    )
    await user.click(
      await screen.findByRole('button', { name: 'Read in plain language' })
    )
    expect((await screen.findByRole('alert')).textContent).toBe(
      'No version: the service answered 503'
    )
    cleanup()

    // A record that never leaves the repository has no button.
    render(
      <DecisionsView
        report={makeCitedReport()}
        selected={37}
        onSelect={() => {}}
        plainOf={{
          source: { ...plain, cached: () => Promise.resolve('excluded') },
          id: 'shop',
        }}
      />
    )
    expect(
      await screen.findByText(/This record stays in the repository/)
    ).toBeTruthy()
    expect(
      screen.queryByRole('button', { name: 'Read in plain language' })
    ).toBeNull()
  })

  it('shows no list when no proposed decision is cited by the code', () => {
    render(<Controlled report={makeCitedReport()} />)
    expect(
      screen.queryByRole('region', { name: 'Proposed but applied' })
    ).toBeNull()
  })

  it('searches the decisions and opens one with its links', async () => {
    const user = userEvent.setup()
    render(<Controlled report={makeCitedReport()} />)
    expect(screen.getAllByRole('row')).toHaveLength(1 + 5)
    await user.type(
      screen.getByRole('searchbox', { name: 'Search the decisions' }),
      'payment'
    )
    expect(screen.getAllByRole('row')).toHaveLength(1 + 1)

    await user.click(screen.getByRole('button', { name: /Payment provider/ }))
    const page = within(screen.getByRole('article', { name: 'ADR-0037' }))
    const links = within(page.getByRole('region', { name: 'Code links' }))
    expect(links.getAllByRole('row')).toHaveLength(1 + 4)
    expect(links.getByText('services/billing.ts:116')).toBeTruthy()
    const cited = within(page.getByRole('region', { name: 'Cited by' }))
    expect(cited.getByText('lines 10, 44')).toBeTruthy()
    expect(cited.getByText('line 2 · documentation')).toBeTruthy()
    expect(page.getByRole('heading', { name: 'Cited by 3' })).toBeTruthy()

    await user.click(page.getByRole('button', { name: '← Decisions' }))
    expect(screen.getAllByRole('row')).toHaveLength(1 + 1)
  })

  it('gives the command that records checked references', async () => {
    const user = userEvent.setup()
    render(<Controlled report={makeCitedReport()} />)
    await user.click(screen.getByRole('button', { name: /Payment provider/ }))
    const boxes = screen.getAllByRole('checkbox', { name: 'Mark as checked' })
    // The links to review or to reorder can be checked; the broken one not.
    expect(boxes).toHaveLength(2)
    await user.click(boxes[1]!)
    await user.click(boxes[0]!)
    expect(
      screen.getByText(
        "compadr mark-checked . --ref 'main' --reference 0037:services/billing.ts:116:1 --reference 0037:services/search.ts:20:1 --open-pr"
      )
    ).toBeTruthy()
  })

  it('starts the page of another decision afresh', async () => {
    const user = userEvent.setup()
    render(<Controlled report={makeCitedReport()} />)
    await user.click(screen.getByRole('button', { name: /Old storage/ }))
    await user.click(screen.getByRole('tab', { name: 'History' }))
    await user.click(screen.getByRole('button', { name: 'ADR-0027' }))
    expect(
      screen
        .getByRole('tab', { name: 'Overview' })
        .getAttribute('aria-selected')
    ).toBe('true')
  })

  it('shows the commits of the record and the checks in History', async () => {
    const user = userEvent.setup()
    const report = makeCitedReport()
    const cited = {
      ...report,
      decisions: report.decisions.map(d =>
        d.number === 37
          ? {
              ...d,
              history: [
                {
                  commit: 'a'.repeat(40),
                  date: '2026-10-04T20:46:49Z',
                  subject: 'docs(adr): payment provider',
                },
              ],
            }
          : d
      ),
      references: report.references.map(r =>
        r.id === '0037:services/search.ts:20:1'
          ? { ...r, checkedAt: '2026-11-04T09:12:00Z' }
          : r
      ),
    }
    render(<Controlled report={cited} />)
    await user.click(screen.getByRole('button', { name: /Payment provider/ }))
    expect(screen.getByText('checked Nov 4, 2026')).toBeTruthy()
    await user.click(screen.getByRole('tab', { name: 'History' }))
    const rows = within(
      screen.getByRole('region', { name: 'History' })
    ).getAllByRole('row')
    expect(rows.map(row => row.textContent)).toEqual([
      'DateEvent',
      'Nov 4, 2026✓ Checked services/search.ts:20',
      'Oct 4, 2026docs(adr): payment provider aaaaaaaa',
    ])
  })

  it('names who decided, who wrote the commits and who checked', async () => {
    const user = userEvent.setup()
    const report = makeCitedReport()
    const cited = {
      ...report,
      decisions: report.decisions.map(d =>
        d.number === 37
          ? {
              ...d,
              attribution: {
                names: ['Ana Martin', 'Bo Lee'],
                source: 'declared' as const,
              },
              history: [
                {
                  commit: 'a'.repeat(40),
                  date: '2026-10-04T20:46:49Z',
                  subject: 'docs(adr): payment provider',
                  author: 'Bo Lee',
                },
              ],
            }
          : d
      ),
      references: report.references.map(r =>
        r.id === '0037:services/search.ts:20:1'
          ? {
              ...r,
              checkedAt: '2026-11-04T09:12:00Z',
              checkedBy: { names: ['Chloé Durand'], source: 'commit' as const },
            }
          : r
      ),
    }
    render(<Controlled report={cited} />)
    await user.click(screen.getByRole('button', { name: /Payment provider/ }))
    expect(screen.getByText('Decided by')).toBeTruthy()
    expect(screen.getByText('Ana Martin, Bo Lee')).toBeTruthy()
    expect(
      screen.getByText('checked Nov 4, 2026 by Chloé Durand (commit author)')
    ).toBeTruthy()
    await user.click(screen.getByRole('tab', { name: 'History' }))
    const rows = within(
      screen.getByRole('region', { name: 'History' })
    ).getAllByRole('row')
    expect(rows.map(row => row.textContent)).toEqual([
      'DateEvent',
      'Nov 4, 2026✓ Checked services/search.ts:20 by Chloé Durand (commit author)',
      'Oct 4, 2026docs(adr): payment provider aaaaaaaa · Bo Lee',
    ])
  })

  it('links the pull request that approved a record or a check', async () => {
    const user = userEvent.setup()
    const report = makeCitedReport()
    const pullRequest = {
      number: 12,
      title: 'Choose the payment provider',
      url: 'https://github.com/acme/shop/pull/12',
    }
    const cited = {
      ...report,
      decisions: report.decisions.map(d =>
        d.number === 37
          ? {
              ...d,
              attribution: {
                names: ['ana'],
                source: 'pull-request' as const,
                commit: 'b'.repeat(40),
                pullRequest: { ...pullRequest, role: 'approved' as const },
              },
            }
          : d
      ),
      references: report.references.map(r =>
        r.id === '0037:services/search.ts:20:1'
          ? {
              ...r,
              checkedAt: '2026-11-04T09:12:00Z',
              checkedBy: {
                names: ['bo'],
                source: 'pull-request' as const,
                commit: 'c'.repeat(40),
                pullRequest: { ...pullRequest, role: 'merged' as const },
              },
            }
          : r
      ),
    }
    render(<Controlled report={cited} />)
    await user.click(screen.getByRole('button', { name: /Payment provider/ }))
    expect(screen.getByText('Approved by')).toBeTruthy()
    expect(screen.getByText(/^ana \(pull request/).textContent).toBe(
      'ana (pull request #12)'
    )
    const links = screen.getAllByRole('link', { name: '#12' })
    expect(links.map(link => link.getAttribute('href'))).toEqual([
      pullRequest.url,
      pullRequest.url,
    ])
    expect(screen.getByText(/^checked Nov 4, 2026 by bo/).textContent).toBe(
      'checked Nov 4, 2026 by bo (merged #12)'
    )
  })

  it('leads from a superseded decision to its successor', async () => {
    const user = userEvent.setup()
    render(<Controlled report={makeCitedReport()} />)
    await user.click(screen.getByRole('button', { name: /Old storage/ }))
    await user.click(screen.getByRole('button', { name: 'ADR-0027' }))
    expect(screen.getByRole('article', { name: 'ADR-0027' })).toBeTruthy()
  })
})
