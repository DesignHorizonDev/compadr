import {
  DriftReportSchema,
  REPORT_SCHEMA_VERSION,
  type CodeReference,
  type Decision,
  type DriftReport,
} from '@compadr/format'

/** A valid drift report with no decision, for the tests. */
export function makeReport(
  repository: Partial<DriftReport['repository']> = {},
  rest: Partial<Omit<DriftReport, 'repository'>> = {}
): DriftReport {
  return DriftReportSchema.parse({
    schemaVersion: REPORT_SCHEMA_VERSION,
    generator: { name: 'compadr', version: '0.0.0' },
    repository: {
      name: 'billing-api',
      ref: 'main',
      commit: '4f1c2a9e0b7d3c5a8e6f1d2c3b4a5968778695a4',
      adrDir: 'docs/adr',
      ...repository,
    },
    generatedAt: '2026-11-02T09:00:00.000Z',
    decisions: [],
    references: [],
    citations: [],
    signals: [],
    families: [],
    ...rest,
  })
}

/** A decision record with no relation, for the tests. */
export function makeDecision(
  number: number,
  fields: Partial<Decision> = {}
): Decision {
  return {
    number,
    file: `docs/adr/${String(number).padStart(4, '0')}-decision.md`,
    title: `Decision ${number}`,
    status: 'accepted',
    rawStatus: 'Accepted',
    date: null,
    revisedAt: null,
    lineCount: 40,
    feature: null,
    parent: null,
    amends: [],
    amendedBy: [],
    supersededBy: [],
    codeArea: null,
    ...fields,
  }
}

const CITED_AT = '2026-10-04T20:46:49Z'

function pathReference(
  decision: number,
  adrLine: number,
  path: string,
  lines: { start: number; end: number } | null = null
): CodeReference {
  const number = String(decision).padStart(4, '0')
  const text = lines ? `${path}:${lines.start}` : path
  return {
    kind: 'path',
    id: `${number}:${text}:1`,
    decision,
    adrLine,
    column: 3,
    text,
    citedAt: CITED_AT,
    path,
    lines,
    resolvedPaths: [`src/${path}`],
    anchor: null,
  }
}

/**
 * A report with one signal of each type of the Drift view, and one `info`
 * signal that the view leaves out.
 */
export function makeDriftReport(): DriftReport {
  return makeReport(
    {},
    {
      decisions: [
        makeDecision(3, {
          title: 'Old storage',
          status: 'superseded',
          supersededBy: [27],
        }),
        makeDecision(12, { title: 'Mail sending', feature: 'Mail' }),
        makeDecision(27, { title: 'Storage', codeArea: 'server/storage' }),
        makeDecision(36, { title: 'Trash' }),
        makeDecision(37, {
          title: 'Payment provider',
          codeArea: 'server/billing',
        }),
      ],
      references: [
        pathReference(12, 8, 'utils/mail.ts'),
        pathReference(37, 75, 'services/billing.ts', {
          start: 116,
          end: 116,
        }),
        pathReference(37, 82, 'services/search.ts', { start: 20, end: 30 }),
        pathReference(37, 90, 'services/short.ts', { start: 400, end: 400 }),
        {
          kind: 'symbol',
          id: '0037:searchLexical:1',
          decision: 37,
          adrLine: 95,
          column: 7,
          text: 'searchLexical',
          citedAt: CITED_AT,
          symbol: 'searchLexical',
          foundInCode: true,
        },
      ],
      signals: [
        {
          type: 'cited-file-changed',
          level: 'order',
          id: 'cited-file-changed:0037:services/billing.ts:116:1',
          decision: 37,
          reference: '0037:services/billing.ts:116:1',
          citedAt: CITED_AT,
          commitsSince: 7,
        },
        {
          type: 'path-missing',
          level: 'broken',
          id: 'path-missing:0012:utils/mail.ts:1',
          decision: 12,
          reference: '0012:utils/mail.ts:1',
        },
        {
          type: 'superseded-decision-cited',
          level: 'broken',
          id: 'superseded-decision-cited:0003:src/a.ts:50',
          decision: 3,
          file: 'src/a.ts',
          line: 50,
          supersededBy: [27],
        },
        {
          type: 'index-status-mismatch',
          level: 'broken',
          id: 'index-status-mismatch:0036',
          decision: 36,
          indexStatus: 'Proposed',
          recordStatus: 'Accepted',
        },
        {
          type: 'unknown-decision-cited',
          level: 'broken',
          id: 'unknown-decision-cited:0099:src/b.ts:4',
          decision: 99,
          file: 'src/b.ts',
          line: 4,
        },
        {
          type: 'cited-line-out-of-range',
          level: 'broken',
          id: 'cited-line-out-of-range:0037:services/short.ts:400:1',
          decision: 37,
          reference: '0037:services/short.ts:400:1',
          fileLineCount: 1,
        },
        {
          type: 'cited-line-changed',
          level: 'review',
          id: 'cited-line-changed:0037:services/search.ts:20:1',
          decision: 37,
          reference: '0037:services/search.ts:20:1',
          citedAt: CITED_AT,
          lineChangedAt: '2026-10-11T10:29:04Z',
        },
        {
          type: 'linked-files-changed',
          level: 'order',
          id: 'linked-files-changed:0027',
          decision: 27,
          oldestCitedAt: CITED_AT,
          files: [
            { path: 'src/storage', commitsSince: 12 },
            { path: 'src/storage/s3.ts', commitsSince: 1 },
          ],
        },
        {
          type: 'decision-without-code',
          level: 'info',
          id: 'decision-without-code:0036',
          decision: 36,
        },
      ],
    }
  )
}

/** The report of makeDriftReport, with one anchored reference and its drift. */
export function makeAnchoredReport(): DriftReport {
  const report = makeDriftReport()
  report.references.push({
    kind: 'path',
    id: '0027:src/storage/s3.ts#S3Store.put:1',
    decision: 27,
    adrLine: 14,
    column: 3,
    text: 'src/storage/s3.ts#S3Store.put',
    citedAt: CITED_AT,
    path: 'src/storage/s3.ts',
    lines: null,
    resolvedPaths: ['src/storage/s3.ts'],
    anchor: {
      symbol: 'S3Store.put',
      fingerprint: 'sha256:0123456789abcdef',
      lines: null,
    },
  })
  report.signals.push(
    {
      type: 'anchor-content-changed',
      level: 'review',
      id: 'anchor-content-changed:0027:src/storage/s3.ts#S3Store.put:1',
      decision: 27,
      reference: '0027:src/storage/s3.ts#S3Store.put:1',
      currentFingerprint: 'sha256:fedcba9876543210',
    },
    {
      type: 'anchor-symbol-ambiguous',
      level: 'review',
      id: 'anchor-symbol-ambiguous:0027:src/storage/s3.ts#S3Store.put:1',
      decision: 27,
      reference: '0027:src/storage/s3.ts#S3Store.put:1',
      matches: 2,
    },
    {
      type: 'anchor-lines-changed',
      level: 'review',
      id: 'anchor-lines-changed:0027:src/storage/s3.ts#S3Store.put:1',
      decision: 27,
      reference: '0027:src/storage/s3.ts#S3Store.put:1',
    },
    {
      type: 'anchor-symbol-missing',
      level: 'broken',
      id: 'anchor-symbol-missing:0027:src/storage/s3.ts#S3Store.put:1',
      decision: 27,
      reference: '0027:src/storage/s3.ts#S3Store.put:1',
    }
  )
  return DriftReportSchema.parse(report)
}

/**
 * The report of makeDriftReport, with anchor proposals: a large symbol whose
 * cited lines were found, a small symbol, and a reference without proposal.
 */
export function makeProposalReport(): DriftReport {
  const report = makeDriftReport()
  for (const reference of report.references) {
    if (reference.kind !== 'path') continue
    if (reference.id === '0037:services/billing.ts:116:1') {
      reference.proposal = {
        symbol: 'BillingService.charge',
        text: 'services/billing.ts#BillingService.charge',
        fingerprint: 'sha256:0123456789abcdef',
        symbolLines: { start: 100, end: 180 },
        lines: { count: 1, fingerprint: 'sha256:fedcba9876543210', start: 130 },
      }
    } else if (reference.id === '0037:services/search.ts:20:1') {
      reference.proposal = {
        symbol: 'search',
        text: 'services/search.ts#search',
        fingerprint: 'sha256:00112233445566ff',
        symbolLines: { start: 18, end: 32 },
        lines: null,
      }
    } else {
      reference.proposal = null
    }
  }
  return DriftReportSchema.parse(report)
}

const INVOICES = [
  '- An invoice is sent on the **first day** of the month.',
  '- Refunds are paid by `cheque` only.',
].join('\n')

/**
 * A report with one declared feature: a main decision, two details, and a
 * rule of the main decision that the first detail replaces.
 */
export function makeFeatureReport(): DriftReport {
  const start = INVOICES.indexOf('An invoice')
  const end = INVOICES.indexOf(' of the month') + ' of the month'.length
  return makeReport(
    {},
    {
      decisions: [
        makeDecision(3, {
          title: 'Monthly invoices',
          feature: 'billing',
          text: {
            relations: [],
            sections: [{ heading: 'Sending', line: 9, markdown: INVOICES }],
          },
        }),
        makeDecision(7, {
          title: 'Daily invoices',
          feature: 'billing',
          parent: 3,
          amends: [3],
          text: {
            relations: [
              'Amends ADR 0003. Replaces its rule « an invoice is sent on the first day of the month ».',
            ],
            sections: [
              {
                heading: null,
                line: 12,
                markdown: 'An invoice is sent on the day of the order.',
              },
            ],
          },
        }),
        makeDecision(9, {
          title: 'Credit notes',
          feature: 'billing',
          parent: 3,
          text: { relations: [], sections: [] },
        }),
        makeDecision(12, { title: 'Exports', amends: [3] }),
      ],
      signals: [
        {
          type: 'path-missing',
          level: 'broken',
          id: 'path-missing:0009:src/credit.ts:1',
          decision: 9,
          reference: '0009:src/credit.ts:1',
        },
      ],
      features: [
        {
          id: 'billing',
          label: 'Billing',
          main: 3,
          source: 'declared',
          decisions: [3, 7, 9],
        },
      ],
      replacedRules: [
        {
          decision: 7,
          quote: 'an invoice is sent on the first day of the month',
          target: 3,
          location: { section: 0, start, end },
        },
        {
          decision: 7,
          quote: 'refunds are paid in cash',
          target: null,
          location: null,
        },
      ],
      featureProblems: ['Bad Id: not a feature identifier (lowercase-words)'],
    }
  )
}

/** The report of makeDriftReport, with citations of decisions in files. */
export function makeCitedReport(): DriftReport {
  return {
    ...makeDriftReport(),
    citations: [
      { file: 'src/services/billing.ts', line: 10, decision: 37, inCode: true },
      { file: 'src/services/billing.ts', line: 44, decision: 37, inCode: true },
      { file: 'src/a.ts', line: 50, decision: 3, inCode: true },
      { file: 'docs/guide.md', line: 2, decision: 37, inCode: false },
    ],
  }
}
