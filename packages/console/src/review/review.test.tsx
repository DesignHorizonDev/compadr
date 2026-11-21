import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CodeReference, Decision, DriftReport } from '@compadr/format'
import { afterEach, describe, expect, it } from 'vitest'
import type { DraftDecisionOutcome, DraftDecisionSource } from '../assist.ts'
import type { ReportSource } from '../reports.ts'
import type { BranchChange, ReviewSource, ReviewSummary } from '../reviews.ts'
import { makeDecision, makeReport } from '../testing/report.ts'
import { reviewCommands, shellQuote } from './commands.ts'
import { reviewPage } from './overlaps.ts'
import { ReviewsView } from './ReviewsView.tsx'

afterEach(cleanup)

const text = (markdown: string): Decision['text'] => ({
  relations: [],
  sections: [{ heading: null, line: 10, markdown }],
})

function cites(decision: number, path: string): CodeReference {
  return {
    kind: 'path',
    id: `${decision}:${path}:1`,
    decision,
    adrLine: 12,
    column: 1,
    text: path,
    citedAt: null,
    path,
    lines: null,
    resolvedPaths: [path],
    anchor: null,
  }
}

function branchReport(): DriftReport {
  return makeReport(
    { ref: 'refs/heads/feat/reply-to' },
    {
      decisions: [
        makeDecision(16, { title: 'Grouped mails' }),
        makeDecision(20, { title: 'Mail templates' }),
        makeDecision(53, {
          title: 'Reply address of mails',
          status: 'proposed',
          rawStatus: 'Proposed',
          text: text('Set `Reply-To` when a contact exists.'),
        }),
        makeDecision(30, {
          title: 'Old sender',
          status: 'superseded',
          text: text('Uses `Reply-To`.'),
        }),
        makeDecision(41, { title: 'Sender', text: text('See `mail.ts`.') }),
        makeDecision(58, {
          title: 'Reply address of team mails',
          status: 'proposed',
          rawStatus: 'Proposed',
          amends: [20],
          text: text(
            'A team mail carries the `Reply-To` of its author. See `mail.ts`.'
          ),
        }),
      ],
      references: [cites(41, 'src/mail.ts'), cites(58, 'src/mail.ts')],
      features: [
        {
          id: 'mails',
          label: 'Mails',
          main: 16,
          source: 'declared',
          decisions: [16, 20, 53, 58],
        },
      ],
    }
  )
}

const review: ReviewSummary = {
  reportId: 'app--feat-reply-to',
  baseReportId: 'app',
  branch: 'feat/reply-to',
  commit: '9478833e619ea5eeea3c3df2bf4361a0c0db974c',
  pullRequest: {
    number: 12,
    title: 'Reply-to of team mails',
    url: 'https://github.com/o/r/pull/12',
    draft: false,
  },
  proposed: [
    {
      number: 58,
      title: 'Reply address of team mails',
      file: 'docs/adr/0058-reply.md',
      change: 'added',
    },
  ],
}

describe('reviewPage', () => {
  it('lists the overlaps by weight, and the rest of the feature apart', () => {
    const page = reviewPage(branchReport(), 58)!
    expect(page.detailOf?.number).toBe(16)
    expect(
      page.overlaps.map(o => [o.decision.number, o.reasons.map(r => r.kind)])
    ).toEqual([
      [20, ['relation']],
      [41, ['files', 'terms']],
      [53, ['terms']],
    ])
    // A superseded decision is history: it does not overlap.
    expect(page.overlaps.some(o => o.decision.number === 30)).toBe(false)
    expect(page.sameFeature.map(d => d.number)).toEqual([16])
    expect(page.files).toEqual(['src/mail.ts'])
    expect(reviewPage(branchReport(), 99)).toBeUndefined()
  })
})

describe('reviewCommands', () => {
  it('needs a reason to reject, and quotes it for the shell', () => {
    expect(reviewCommands(review, '')).toEqual({
      accept: 'gh pr review 12 --approve',
      requestChanges:
        "gh pr review 12 --request-changes --body '<what to change>'",
      reject: null,
    })
    expect(reviewCommands(review, "Covered by 0053's rule")?.reject).toBe(
      `gh pr close 12 --comment 'Rejected: Covered by 0053'\\''s rule'`
    )
    expect(shellQuote("a'b")).toBe(`'a'\\''b'`)
    expect(reviewCommands({ ...review, pullRequest: null }, 'x')).toBeNull()
  })
})

describe('ReviewsView', () => {
  const reviews: ReviewSource = {
    list: () => Promise.resolve({ reviews: [review], changes: [] }),
  }
  const reports: ReportSource = {
    list: () => Promise.resolve([]),
    get: id =>
      id === review.reportId
        ? Promise.resolve(branchReport())
        : Promise.reject(new Error('unknown')),
  }

  it('opens the review of a proposed decision', async () => {
    const user = userEvent.setup()
    render(
      <ReviewsView reviews={reviews} reports={reports} baseReportId="app" />
    )
    await user.click(await screen.findByRole('button', { name: /ADR-0058/ }))
    const overlaps = await screen.findByRole('region', {
      name: 'Overlaps found',
    })
    expect(within(overlaps).getByText(/Reply address of mails/)).toBeTruthy()
    // No criterion checked: the page proposes a code note.
    expect(screen.getByText(/Make it a code note/)).toBeTruthy()
    await user.click(screen.getByRole('checkbox', { name: 'Hard to reverse' }))
    expect(screen.queryByText(/Make it a code note/)).toBeNull()
    expect(screen.getByText('gh pr review 12 --approve')).toBeTruthy()
    expect(screen.getByText('A rejection carries its reason.')).toBeTruthy()
    await user.type(screen.getByLabelText('Reject'), 'Duplicate')
    expect(
      screen.getByText("gh pr close 12 --comment 'Rejected: Duplicate'")
    ).toBeTruthy()
  })

  it('explains where the reviews come from without the console server', async () => {
    render(
      <ReviewsView
        reviews={{ list: () => Promise.resolve(null) }}
        reports={reports}
        baseReportId="app"
      />
    )
    expect(await screen.findByText(/compadr console/)).toBeTruthy()
  })

  describe('the branches without a proposed decision', () => {
    const change = (branch: string): BranchChange => ({
      reportId: `app--${branch}`,
      baseReportId: 'app',
      branch,
      commit: 'c'.repeat(40),
      pullRequest: null,
    })
    const withChanges: ReviewSource = {
      list: () =>
        Promise.resolve({
          reviews: [],
          changes: [change('feat-receipts'), change('fix-secret')],
        }),
    }
    const outcome: DraftDecisionOutcome = {
      model: 'compadr-assist-1',
      promptVersion: 'draft-3',
      createdAt: '2026-11-19T10:00:00Z',
      commit: 'c'.repeat(40),
      excluded: [],
      problems: [
        {
          level: 'notice',
          code: 'close-decision',
          item: 'title',
          message: 'Decision 1 (Billing) shares charge, receipt.',
        },
      ],
      result: {
        kind: 'drafted',
        draft: 'propose-feat-receipts',
        reportId: 'app--draft.propose-feat-receipts',
        number: 2,
        path: 'docs/adr/0002-receipts.md',
        title: 'Receipts of a charge',
        notes: [],
      },
    }

    it('drafts a record on request, and never offers a change that stays', async () => {
      const asked: string[] = []
      const drafting: DraftDecisionSource = {
        available: () => Promise.resolve(true),
        cached: id =>
          Promise.resolve(id === 'app--fix-secret' ? 'excluded' : null),
        draft: id => {
          asked.push(id)
          return Promise.resolve(outcome)
        },
      }
      const user = userEvent.setup()
      render(
        <ReviewsView
          reviews={withChanges}
          reports={reports}
          baseReportId="app"
          drafting={drafting}
        />
      )
      const section = await screen.findByRole('region', {
        name: 'Branches without a proposed decision',
      })
      expect(within(section).getByText(/each draft costs/)).toBeTruthy()
      // One button: the change of fix-secret never leaves.
      const buttons = await within(section).findAllByRole('button', {
        name: /Draft a decision/,
      })
      expect(buttons).toHaveLength(1)
      expect(
        within(section).getByText(/Every file of the change stays/)
      ).toBeTruthy()
      expect(asked).toEqual([])
      await user.click(buttons[0]!)
      expect(asked).toEqual(['app--feat-receipts'])
      expect(
        await within(section).findByText(/is proposed in the local draft/)
      ).toBeTruthy()
      expect(within(section).getByText('propose-feat-receipts')).toBeTruthy()
      expect(within(section).getByText('Points to check (1)')).toBeTruthy()
    })

    it('shows the draft that waits for review instead of the button', async () => {
      const drafting: DraftDecisionSource = {
        available: () => Promise.resolve(true),
        cached: () =>
          Promise.resolve({
            waiting:
              'the draft propose-feat-receipts holds a record for this branch already: review it on the Draft page, then publish or discard it',
          }),
        draft: () => Promise.reject(new Error('never asked')),
      }
      render(
        <ReviewsView
          reviews={withChanges}
          reports={reports}
          baseReportId="app"
          drafting={drafting}
        />
      )
      expect(
        await screen.findAllByText(
          /The draft propose-feat-receipts holds a record/
        )
      ).toHaveLength(2)
      expect(
        screen.queryByRole('button', { name: /Draft a decision/ })
      ).toBeNull()
    })

    it('shows no section without the drafting of the server', async () => {
      render(
        <ReviewsView
          reviews={withChanges}
          reports={reports}
          baseReportId="app"
        />
      )
      expect(
        await screen.findByText(/No branch adds or changes a decision/)
      ).toBeTruthy()
      expect(
        screen.queryByRole('region', {
          name: 'Branches without a proposed decision',
        })
      ).toBeNull()
    })
  })
})
