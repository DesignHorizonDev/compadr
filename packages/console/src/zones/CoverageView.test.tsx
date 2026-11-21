import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Zone } from '@compadr/format'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeDecision, makeReport } from '../testing/report.ts'
import { zoneFiles } from './zones.ts'
import { CoverageView } from './CoverageView.tsx'

afterEach(cleanup)

const zone = (path: string, fields: Partial<Zone>): Zone => ({
  path,
  own: false,
  files: 4,
  linkedFiles: 0,
  crossChecked: 0,
  weight: 0,
  decisions: [],
  folderCited: [],
  coverage: 'none',
  ...fields,
})

const REPORT = makeReport(
  {},
  {
    decisions: [
      makeDecision(1, { title: 'Charges go through the ledger' }),
      makeDecision(2, { title: 'Mails leave from one queue' }),
      makeDecision(3, { status: 'proposed', rawStatus: 'Proposed' }),
    ],
    references: [
      {
        kind: 'path',
        id: '0001:src/billing/legacy:1',
        decision: 1,
        adrLine: 9,
        column: 1,
        text: 'src/billing/legacy',
        citedAt: null,
        path: 'src/billing/legacy',
        lines: null,
        resolvedPaths: ['src/billing/legacy'],
        anchor: null,
      },
    ],
    citations: [
      { file: 'src/billing/charge.ts', line: 3, decision: 1, inCode: true },
      { file: 'src/billing/refund.ts', line: 1, decision: 1, inCode: true },
      { file: 'src/billing/legacy/old.ts', line: 1, decision: 1, inCode: true },
      { file: 'src/billing/README.md', line: 1, decision: 1, inCode: false },
      { file: 'src/billing/tax/rate.ts', line: 1, decision: 1, inCode: true },
      // A proposed decision does not count in a zone.
      { file: 'src/billing/draft.ts', line: 1, decision: 3, inCode: true },
    ],
    zones: [
      zone('src/billing', {
        linkedFiles: 2,
        crossChecked: 1,
        weight: 6,
        decisions: [{ number: 1, weight: 6 }],
        coverage: 'strong',
      }),
      zone('src/billing/tax', {
        files: 1,
        linkedFiles: 1,
        weight: 2,
        decisions: [{ number: 1, weight: 2 }],
        coverage: 'partial',
      }),
      zone('src/mail', { files: 9, folderCited: [2], coverage: 'folder-only' }),
      zone('web', { files: 20 }),
    ],
  }
)

describe('CoverageView', () => {
  it('lists the zones under decisions, then those without', async () => {
    const user = userEvent.setup()
    render(
      <CoverageView
        report={REPORT}
        onOpenDecision={vi.fn()}
        onOpenFile={vi.fn()}
      />
    )
    expect(screen.getByText(/4 zones · 3 of 34 code files linked/)).toBeTruthy()
    const rows = () =>
      within(screen.getByRole('tabpanel'))
        .getAllByRole('row')
        .slice(1)
        .map(row => row.textContent)
    expect(rows()).toEqual([
      'Strongsrc/billing2 of 41ADR-0001',
      'Partialsrc/billing/tax1 of 10ADR-0001',
    ])
    await user.click(screen.getByRole('tab', { name: /Without decision/ }))
    expect(rows()).toEqual([
      'Noneweb0 of 200',
      'Folder onlysrc/mail0 of 90Folder cited by ADR-0002',
    ])
  })

  it('opens a zone, its decisions and its files', async () => {
    const user = userEvent.setup()
    const onOpenDecision = vi.fn()
    const onOpenFile = vi.fn()
    render(
      <CoverageView
        report={REPORT}
        onOpenDecision={onOpenDecision}
        onOpenFile={onOpenFile}
      />
    )
    await user.click(screen.getByRole('button', { name: 'src/billing' }))
    const panel = within(screen.getByRole('complementary', { name: 'Zone' }))
    expect(
      panel.getByText(
        '2 of 4 code files linked, 1 both ways. Weight of the links: 6.'
      )
    ).toBeTruthy()
    await user.click(
      panel.getByRole('button', { name: /Charges go through the ledger/ })
    )
    expect(onOpenDecision).toHaveBeenCalledWith(1)
    // The file of the inner zone, the cited folder, the Markdown file and the
    // file of a proposed decision stay out.
    const files = within(panel.getByRole('region', { name: 'Linked files' }))
    expect(files.getAllByRole('button').map(b => b.textContent)).toEqual([
      'src/billing/charge.ts',
      'src/billing/legacy/old.ts',
      'src/billing/refund.ts',
    ])
    await user.click(
      files.getByRole('button', { name: 'src/billing/charge.ts' })
    )
    expect(onOpenFile).toHaveBeenCalledWith('src/billing/charge.ts')
  })

  it('says when the report has no zones', () => {
    render(
      <CoverageView
        report={makeReport({}, { zones: undefined })}
        onOpenDecision={vi.fn()}
        onOpenFile={vi.fn()}
      />
    )
    expect(screen.getByText(/This report has no zones/)).toBeTruthy()
  })
})

describe('zoneFiles', () => {
  it('keeps the files directly in the folder for a zone of its own files', () => {
    const own = zone('src/billing', { own: true })
    expect(
      zoneFiles({ ...REPORT, zones: [own, ...(REPORT.zones ?? [])] }, own)
    ).toEqual([
      { path: 'src/billing/charge.ts', decisions: 1 },
      { path: 'src/billing/refund.ts', decisions: 1 },
    ])
  })
})
