import { describe, expect, it } from 'vitest'
import { makeProposalReport, makeReport } from '../testing/report.ts'
import {
  anchorCommand,
  anchorEntry,
  linksToRepair,
  offersLines,
} from './proposals.ts'

const report = makeProposalReport()
const rows = linksToRepair(report)
const row = (id: string) => rows.find(r => r.reference.id === id)!

describe('linksToRepair', () => {
  it('lists the references that cite lines, proposals first', () => {
    expect(rows.map(r => r.reference.id)).toEqual([
      '0037:services/billing.ts:116:1',
      '0037:services/search.ts:20:1',
      '0037:services/short.ts:400:1',
    ])
    expect(row('0037:services/short.ts:400:1').proposal).toBeNull()
  })

  it('lists nothing for a report without line references', () => {
    expect(linksToRepair(makeReport())).toEqual([])
  })
})

describe('proposals', () => {
  it('offers the cited lines for a large symbol only', () => {
    expect(offersLines(row('0037:services/billing.ts:116:1').proposal!)).toBe(
      true
    )
    expect(offersLines(row('0037:services/search.ts:20:1').proposal!)).toBe(
      false
    )
  })

  it('writes the command, with or without the cited lines', () => {
    const { reference } = row('0037:services/billing.ts:116:1')
    expect(anchorCommand(report, reference, false)).toBe(
      'compadr anchor <path-to-billing-api> --ref main --adr-dir docs/adr --reference 0037:services/billing.ts:116:1 --open-pr'
    )
    expect(anchorCommand(report, reference, true)).toContain(
      '--reference 0037:services/billing.ts:116:1 --with-lines --open-pr'
    )
  })

  it('quotes a reference that the shell would split', () => {
    const quoted = makeProposalReport()
    quoted.repository.ref = "feature/it's done"
    expect(
      anchorCommand(
        quoted,
        row('0037:services/billing.ts:116:1').reference,
        false
      )
    ).toContain(`--ref 'feature/it'\\''s done'`)
  })

  it('shows the entry that the record receives', () => {
    const { proposal } = row('0037:services/billing.ts:116:1')
    expect(anchorEntry(proposal!, false)).toBe(
      [
        'compadr:',
        '  anchors:',
        '    "services/billing.ts#BillingService.charge":',
        '      fingerprint: sha256:0123456789abcdef',
      ].join('\n')
    )
    expect(anchorEntry(proposal!, true)).toContain(
      'lines: { count: 1, fingerprint: sha256:fedcba9876543210 }'
    )
  })
})
