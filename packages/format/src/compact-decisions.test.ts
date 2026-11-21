import { describe, expect, it } from 'vitest'
import { compactDecisionsForFile } from './compact-decisions.ts'
import type { CodeReference, Decision, DriftReport } from './report-schema.ts'

function decision(number: number, fields: Partial<Decision> = {}): Decision {
  return {
    number,
    file: `docs/adr/${String(number).padStart(4, '0')}-d.md`,
    title: `Decision ${number}`,
    status: 'accepted',
    rawStatus: 'accepted',
    date: null,
    revisedAt: null,
    lineCount: 10,
    feature: null,
    parent: null,
    amends: [],
    amendedBy: [],
    supersededBy: [],
    codeArea: null,
    ...fields,
  }
}

function cites(
  number: number,
  path: string,
  fields: Partial<Extract<CodeReference, { kind: 'path' }>> = {}
): CodeReference {
  const text = fields.text ?? path
  return {
    kind: 'path',
    id: `${String(number).padStart(4, '0')}:${text}:1`,
    decision: number,
    adrLine: 5,
    column: 1,
    text,
    citedAt: '2026-01-10T09:00:00Z',
    path,
    lines: null,
    resolvedPaths: [path],
    anchor: null,
    ...fields,
  }
}

const FILE = 'src/billing/charge.ts'
const sections = [
  { heading: '1. Scope', line: 8, markdown: 'a' },
  { heading: '2. Charges', line: 12, markdown: 'b' },
]

const REPORT = {
  decisions: [
    decision(1, {
      rule: {
        text: 'Every charge goes through the ledger.',
        source: 'declared',
      },
      text: { relations: [], sections },
    }),
    decision(2, { rule: null }),
    decision(3, { text: { relations: [], sections } }),
    decision(4, { status: 'proposed' }),
    decision(5),
    decision(6),
  ],
  references: [
    cites(1, FILE, {
      text: `${FILE}:3-9`,
      lines: { start: 3, end: 9 },
    }),
    cites(2, 'src/billing'),
    cites(3, FILE, {
      text: `${FILE}#charge`,
      anchor: { symbol: 'charge', fingerprint: null, lines: null },
    }),
    cites(3, FILE),
    cites(4, FILE),
    cites(5, FILE),
    cites(5, FILE, { text: 'charge.ts' }),
    cites(5, FILE, { text: 'billing/charge.ts' }),
    cites(6, FILE, { text: `${FILE}:900`, lines: { start: 900, end: 900 } }),
  ],
  citations: [
    { file: FILE, line: 12, decision: 1, inCode: true },
    { file: FILE, line: 40, decision: 1, inCode: true },
  ],
  signals: [
    {
      type: 'cited-line-out-of-range',
      level: 'broken',
      id: 's0',
      decision: 6,
      reference: `0006:${FILE}:900:1`,
    },
    {
      type: 'anchor-content-changed',
      level: 'review',
      id: 's1',
      decision: 3,
      reference: `0003:${FILE}#charge:1`,
    },
  ],
} as unknown as DriftReport

describe('compactDecisionsForFile', () => {
  it('gives the rule, the weight and what to read of each decision', () => {
    expect(compactDecisionsForFile(REPORT, FILE)).toEqual({
      path: FILE,
      inForce: [
        // Lines (2), the file cites it twice (2 once), both ways (2).
        {
          decision: 1,
          title: 'Decision 1',
          rule: 'Every charge goes through the ledger.',
          weight: 6,
          read: 'lines',
        },
        // Three citations of the file: worth opening.
        { decision: 5, title: 'Decision 5', weight: 3, read: 'record' },
        // An anchor to review counts half (1.5), the file 1.
        {
          decision: 3,
          title: 'Decision 3',
          weight: 2.5,
          read: 'lines',
        },
        // A broken citation of lines weighs nothing and gives nothing to read.
        { decision: 6, title: 'Decision 6', weight: 0, read: 'rule' },
        // A cited folder says little about the file.
        {
          decision: 2,
          title: 'Decision 2',
          weight: 0,
          read: 'rule',
          scope: 'folder',
        },
      ],
      context: [{ decision: 4, title: 'Decision 4', status: 'proposed' }],
      outOfForce: [],
    })
  })
})
