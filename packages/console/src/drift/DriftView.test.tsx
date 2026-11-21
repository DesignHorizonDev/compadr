import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import {
  makeAnchoredReport,
  makeDriftReport,
  makeReport,
} from '../testing/report.ts'
import { DriftView } from './DriftView.tsx'

afterEach(cleanup)

function renderView(report = makeDriftReport()) {
  return { user: userEvent.setup(), ...render(<DriftView report={report} />) }
}

const tab = (name: RegExp) => screen.getByRole('tab', { name })

describe('DriftView', () => {
  it('states the scan and the size of the report', () => {
    renderView()
    expect(
      screen.getByText(
        'main at commit 4f1c2a9e · scanned Nov 2, 2026 · 5 decisions · 4 path links · 0 citations in code'
      )
    ).toBeTruthy()
  })

  it('shows one indicator per level and the anchoring', () => {
    renderView()
    const indicators = within(
      screen.getByRole('region', { name: 'Indicators' })
    )
    expect(indicators.getByText('5')).toBeTruthy()
    expect(
      indicators.getByText(
        '1 line out of file · 1 index mismatch · 1 missing path · 1 superseded citation · 1 unknown decision'
      )
    ).toBeTruthy()
    expect(indicators.getByText('0 %')).toBeTruthy()
    expect(
      indicators.getByText(/0 of 4 path links\. The others rely on a path/)
    ).toBeTruthy()
  })

  it('opens on the broken signals and switches level', async () => {
    const { user } = renderView()
    expect(tab(/^Broken/).getAttribute('aria-selected')).toBe('true')
    expect(tab(/^All/).textContent).toBe('All 8')
    expect(screen.getAllByRole('row')).toHaveLength(1 + 5)

    await user.click(tab(/^Review order/))
    expect(screen.getAllByRole('row')).toHaveLength(1 + 2)
    expect(
      screen.getByText('Changes that order the review, without alert.')
    ).toBeTruthy()

    await user.click(tab(/^All/))
    expect(screen.getAllByRole('row')).toHaveLength(1 + 8)
  })

  it('says when a level has no signal', async () => {
    const { user } = renderView(makeReport())
    expect(screen.getByText('No signal at this level.')).toBeTruthy()
    await user.click(tab(/^All/))
    expect(screen.getByText('No signal at this level.')).toBeTruthy()
    expect(screen.getByText('–')).toBeTruthy()
  })

  it('shows the detail of the selected signal and closes it', async () => {
    const { user } = renderView()
    await user.click(tab(/^Review order/))
    await user.click(
      screen.getByRole('button', {
        name: 'Cited file changed since the citation',
      })
    )
    const detail = within(
      screen.getByRole('complementary', { name: 'Signal detail' })
    )
    expect(detail.getByText('Signal · Review order')).toBeTruthy()
    expect(detail.getByText('ADR-0037 · Payment provider')).toBeTruthy()
    expect(detail.getAllByText('services/billing.ts:116')).toHaveLength(2)
    expect(detail.getByText('src/services/billing.ts')).toBeTruthy()
    expect(detail.getByText('Oct 4, 2026')).toBeTruthy()
    expect(detail.getByText('7')).toBeTruthy()
    expect(
      screen
        .getByRole('button', { name: 'Cited file changed since the citation' })
        .getAttribute('aria-pressed')
    ).toBe('true')

    await user.click(detail.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('details the fingerprints of an anchored reference', async () => {
    const { user } = renderView(makeAnchoredReport())
    await user.click(tab(/^To review/))
    await user.click(
      screen.getByRole('button', {
        name: 'Anchored symbol changed since its fingerprint',
      })
    )
    const detail = within(
      screen.getByRole('complementary', { name: 'Signal detail' })
    )
    expect(detail.getByText('sha256:0123456789abcdef')).toBeTruthy()
    expect(detail.getByText('sha256:fedcba9876543210')).toBeTruthy()
  })

  it('hides the detail of a signal that the open tab does not list', async () => {
    const { user } = renderView()
    await user.click(
      screen.getByRole('button', { name: 'Status differs from the index' })
    )
    expect(screen.getByRole('complementary')).toBeTruthy()
    await user.click(tab(/^Review order/))
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('details the signals that carry their own facts', async () => {
    const { user } = renderView()
    await user.click(tab(/^All/))
    const detail = () =>
      within(screen.getByRole('complementary', { name: 'Signal detail' }))

    await user.click(
      screen.getByRole('button', { name: 'Status differs from the index' })
    )
    expect(detail().getByText('Proposed')).toBeTruthy()
    expect(detail().getByText('Record says').nextSibling?.textContent).toBe(
      'Accepted'
    )

    await user.click(
      screen.getByRole('button', {
        name: 'Superseded decision still cited in code',
      })
    )
    expect(detail().getByText('ADR-0027')).toBeTruthy()

    await user.click(
      screen.getByRole('button', {
        name: 'Linked files changed since their citation',
      })
    )
    expect(
      detail()
        .getAllByRole('listitem')
        .map(item => item.textContent)
    ).toEqual(['src/storage 12 commits', 'src/storage/s3.ts 1 commit'])

    await user.click(
      screen.getByRole('button', {
        name: 'Cited line is beyond the end of the file',
      })
    )
    expect(detail().getByText('File length').nextSibling?.textContent).toBe(
      '1 line'
    )

    await user.click(
      screen.getByRole('button', { name: 'Code cites an unknown decision' })
    )
    expect(detail().getByText('ADR-0099')).toBeTruthy()
  })
})

describe('DriftView, with the findings of a semantic check', () => {
  const report = makeDriftReport()
  const findings = (commit: string) => ({
    schemaVersion: 1 as const,
    repository: { name: report.repository.name, commit, adrDir: 'docs/adr' },
    base: 'b'.repeat(40),
    generatedAt: '2026-11-16T10:00:00.000Z',
    model: 'compadr-assist-1',
    promptVersion: 'check-3',
    findings: [
      {
        decision: 11,
        verdict: 'violated' as const,
        quote: 'parameters pinned explicitly',
        evidence: { path: 'src/password.ts', text: '+  timeCost: 1,' },
        explanation: 'The change lowers the cost of a hash.',
        title: 'Authentication',
        line: 51,
        notices: [],
      },
    ],
    rejected: 1,
    excluded: [],
  })
  const source = (value: unknown) => ({
    list: () => Promise.resolve([]),
    get: () => Promise.resolve(report),
    findings: () =>
      value instanceof Error
        ? Promise.reject(value)
        : Promise.resolve(value as ReturnType<typeof findings> | null),
  })

  it('lists each finding with the rule it quotes', async () => {
    render(
      <DriftView
        report={report}
        findingsOf={{
          source: source(findings(report.repository.commit)),
          id: 'r',
        }}
      />
    )
    const section = within(
      await screen.findByRole('region', { name: 'Suggested by a model' })
    )
    expect(section.getByText('Violated')).toBeTruthy()
    expect(section.getByText('parameters pinned explicitly')).toBeTruthy()
    expect(section.getByText('src/password.ts:51')).toBeTruthy()
    expect(
      section.getByText('The change lowers the cost of a hash.')
    ).toBeTruthy()
    expect(section.getByText(/The guard removed 1 finding\./)).toBeTruthy()
    expect(section.queryByText(/These findings are for commit/)).toBeNull()
  })

  it('says when the findings are for another commit', async () => {
    render(
      <DriftView
        report={report}
        findingsOf={{ source: source(findings('c'.repeat(40))), id: 'r' }}
      />
    )
    expect(
      await screen.findByText(/These findings are for commit cccccccc/)
    ).toBeTruthy()
  })

  it('shows nothing without findings, and says when they cannot be read', async () => {
    const { unmount } = render(
      <DriftView
        report={report}
        findingsOf={{ source: source(null), id: 'r' }}
      />
    )
    await screen.findByText(/scanned/)
    expect(
      screen.queryByRole('region', { name: 'Suggested by a model' })
    ).toBeNull()
    unmount()
    render(
      <DriftView
        report={report}
        findingsOf={{ source: source(new Error('500')), id: 'r' }}
      />
    )
    expect(
      await screen.findByText('The findings cannot be read: 500')
    ).toBeTruthy()
  })
})
