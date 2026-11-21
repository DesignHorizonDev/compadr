import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DriftReportSchema,
  REPORT_SCHEMA_VERSION,
  driftReportJsonSchema,
  type DriftReport,
} from './report-schema.ts'

const report: DriftReport = {
  schemaVersion: REPORT_SCHEMA_VERSION,
  generator: { name: 'compadr', version: '0.0.0' },
  repository: {
    name: 'example',
    ref: 'HEAD',
    commit: 'a1b2c3d',
    adrDir: 'docs/adr',
  },
  generatedAt: '2026-10-31T09:00:00Z',
  decisions: [
    {
      number: 1,
      file: 'docs/adr/0001-use-postgres.md',
      title: 'Use PostgreSQL',
      status: 'accepted',
      rawStatus: 'Accepted',
      date: '2026-01-02',
      revisedAt: '2026-01-02T10:00:00Z',
      lineCount: 40,
      feature: null,
      parent: null,
      amends: [],
      amendedBy: [2],
      supersededBy: [],
      codeArea: 'server/db',
    },
  ],
  references: [
    {
      kind: 'path',
      id: '0001:server/db/pool.ts:20-30:1',
      decision: 1,
      adrLine: 12,
      column: 5,
      text: 'server/db/pool.ts:20-30',
      citedAt: '2026-01-02T10:00:00Z',
      path: 'server/db/pool.ts',
      lines: { start: 20, end: 30 },
      resolvedPaths: ['server/db/pool.ts'],
      anchor: null,
    },
    {
      kind: 'symbol',
      id: '0001:createPool:1',
      decision: 1,
      adrLine: 14,
      column: 3,
      text: 'createPool',
      citedAt: null,
      symbol: 'createPool',
      foundInCode: true,
    },
  ],
  citations: [
    { file: 'server/db/pool.ts', line: 3, decision: 1, inCode: true },
  ],
  signals: [
    {
      type: 'cited-line-changed',
      level: 'review',
      id: 'cited-line-changed:0001:server/db/pool.ts:20-30:1',
      decision: 1,
      reference: '0001:server/db/pool.ts:20-30:1',
      citedAt: '2026-01-02T10:00:00Z',
      lineChangedAt: '2026-05-01T08:00:00Z',
    },
    {
      type: 'decision-without-code',
      level: 'info',
      id: 'decision-without-code:0002',
      decision: 2,
    },
  ],
  families: [{ principal: 1, details: [2], principalIsDetail: false }],
}

describe('DriftReportSchema', () => {
  it('accepts a complete report', () => {
    expect(DriftReportSchema.parse(report)).toEqual(report)
  })

  it('refuses a signal whose level does not match its type', () => {
    const wrong = structuredClone(report) as unknown as {
      signals: { level: string }[]
    }
    wrong.signals[0]!.level = 'broken'
    expect(DriftReportSchema.safeParse(wrong).success).toBe(false)
  })

  it('reads an anchored reference and a proposal', () => {
    const anchored = {
      ...report,
      references: [
        {
          ...report.references[0]!,
          proposal: {
            symbol: 'createPool',
            text: 'server/db/pool.ts#createPool',
            fingerprint: 'sha256:0123456789abcdef',
            symbolLines: { start: 18, end: 42 },
            lines: {
              count: 11,
              fingerprint: 'sha256:fedcba9876543210',
              start: 20,
            },
          },
        },
        {
          kind: 'path',
          id: '0001:server/db/pool.ts#createPool:1',
          decision: 1,
          adrLine: 16,
          column: 3,
          text: 'server/db/pool.ts#createPool',
          citedAt: '2026-01-02T10:00:00Z',
          path: 'server/db/pool.ts',
          lines: null,
          resolvedPaths: ['server/db/pool.ts'],
          anchor: { symbol: 'createPool', fingerprint: null, lines: null },
          proposal: null,
        },
      ],
      signals: [
        {
          type: 'anchor-unverified',
          level: 'info',
          id: 'anchor-unverified:0001:server/db/pool.ts#createPool:1',
          decision: 1,
          reference: '0001:server/db/pool.ts#createPool:1',
          reason: 'no-fingerprint',
        },
      ],
    }
    expect(DriftReportSchema.parse(anchored)).toEqual(anchored)
  })

  it('reads a report written before the proposals', () => {
    const [path] = report.references
    expect(path).not.toHaveProperty('proposal')
    expect(DriftReportSchema.safeParse(report).success).toBe(true)
  })

  it('refuses a malformed proposal', () => {
    const proposal = {
      symbol: 'createPool',
      text: 'server/db/pool.ts#createPool',
      fingerprint: 'sha256:0123456789abcdef',
      symbolLines: { start: 18, end: 42 },
      lines: null,
    }
    const withoutLines: Partial<typeof proposal> = { ...proposal }
    delete withoutLines.symbolLines
    for (const malformed of [
      { ...proposal, fingerprint: 'sha256:0123' },
      withoutLines,
    ]) {
      const candidate = {
        ...report,
        references: [{ ...report.references[0]!, proposal: malformed }],
      }
      expect(DriftReportSchema.safeParse(candidate).success).toBe(false)
    }
  })

  it('refuses a malformed fingerprint', () => {
    const malformed = {
      ...report,
      references: [
        {
          ...report.references[0]!,
          anchor: {
            symbol: 'createPool',
            fingerprint: 'sha256:0123',
            lines: null,
          },
        },
      ],
    }
    expect(DriftReportSchema.safeParse(malformed).success).toBe(false)
  })

  it('refuses another schema version', () => {
    expect(
      DriftReportSchema.safeParse({ ...report, schemaVersion: 1 }).success
    ).toBe(false)
  })
})

describe('driftReportJsonSchema', () => {
  it('matches the committed schema (run `yarn workspace @compadr/format schema`)', () => {
    const committed: unknown = JSON.parse(
      readFileSync(
        new URL('../schema/drift-report.schema.json', import.meta.url),
        'utf8'
      )
    )
    expect(driftReportJsonSchema()).toEqual(committed)
  })
})
