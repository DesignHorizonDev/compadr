import type { Decision } from '@compadr/format'
import { afterAll, describe, expect, it } from 'vitest'
import { citedFiles, featureId, proposeFeatures } from './features.ts'
import { createDriftReport } from './report.ts'
import { createFixtureRepo, type FixtureRepo } from './testing/fixture-repo.ts'

function decision(
  number: number,
  amends: number[] = [],
  fields: Partial<Decision> = {}
): Decision {
  return {
    number,
    file: `docs/adr/${String(number).padStart(4, '0')}-decision-${number}.md`,
    title: `Decision ${number}`,
    status: 'accepted',
    rawStatus: 'Accepted',
    date: null,
    revisedAt: null,
    lineCount: 1,
    feature: null,
    parent: null,
    amends,
    amendedBy: [],
    supersededBy: [],
    codeArea: null,
    ...fields,
  }
}

describe('featureId', () => {
  it('makes an identifier from a file slug', () => {
    expect(featureId('Activités-et-Administration')).toBe(
      'activites-et-administration'
    )
    expect(featureId('l_équipe  (v2)')).toBe('l-equipe-v2')
    expect(featureId('—')).toBe('feature')
  })
})

const files = (entries: Record<number, string[]>) =>
  new Map(
    Object.entries(entries).map(([n, list]) => [Number(n), new Set(list)])
  )

describe('proposeFeatures', () => {
  it('groups the decisions linked by their relations', () => {
    const features = proposeFeatures([
      decision(1),
      decision(2, [1]),
      decision(3, [1]),
      decision(4, [1]),
      // A detail of two decisions of the feature joins it.
      decision(5, [1, 4]),
      decision(6),
      decision(7, [6]),
      decision(8, [6]),
      // A decision linked to no other stays out.
      decision(10),
    ])
    expect(features).toEqual([
      {
        id: 'decision-1',
        label: 'Decision 1',
        main: 1,
        source: 'proposed',
        decisions: [1, 2, 3, 4, 5],
      },
      {
        id: 'decision-6',
        label: 'Decision 6',
        main: 6,
        source: 'proposed',
        decisions: [6, 7, 8],
      },
    ])
  })

  it('links the decisions that cite the same code files', () => {
    const decisions = [1, 2, 3, 4, 5].map(n => decision(n))
    const features = proposeFeatures(
      decisions,
      files({
        1: ['src/pay.ts', 'src/refund.ts'],
        2: ['src/pay.ts', 'src/refund.ts', 'src/fees.ts'],
        3: ['src/mail.ts'],
        4: ['src/mail.ts', 'src/queue.ts'],
        5: ['README.txt'],
      })
    )
    expect(features.map(f => [f.main, f.decisions])).toEqual([
      [1, [1, 2]],
      [3, [3, 4]],
    ])
  })

  it('leaves out a file that many decisions cite', () => {
    const decisions = Array.from({ length: 12 }, (_, i) => decision(i + 1))
    // Every decision cites package.json: the file links none of them.
    const cited = Object.fromEntries(
      decisions.map(d => [d.number, ['package.json']])
    )
    expect(proposeFeatures(decisions, files(cited))).toEqual([])
  })

  it('takes as main decision the one that the group changes the most', () => {
    const features = proposeFeatures(
      [decision(1), decision(2), decision(3, [2]), decision(4, [2])],
      files({ 1: ['src/a.ts'], 2: ['src/a.ts'] })
    )
    expect(features.map(f => [f.main, f.decisions])).toEqual([
      [2, [1, 2, 3, 4]],
    ])
  })

  it('suffixes a repeated identifier and falls back on feature', () => {
    const named = (number: number, slug: string, amends: number[] = []) =>
      decision(number, amends, { file: `docs/adr/${number}-${slug}.md` })
    const features = proposeFeatures([
      named(1, 'billing'),
      ...[2, 3, 4].map(n => named(n, 'detail', [1])),
      named(5, 'billing'),
      ...[6, 7, 8].map(n => named(n, 'detail', [5])),
      named(9, '—'),
      ...[10, 11, 12].map(n => named(n, 'detail', [9])),
    ])
    expect(features.map(f => f.id)).toEqual([
      'billing',
      'billing-0005',
      'feature',
    ])
  })
})

describe('citedFiles', () => {
  it('reads the files that a record cites and the code that cites it', () => {
    const cited = citedFiles(
      {
        adrDir: 'docs/adr',
        references: [
          {
            kind: 'path',
            decision: 1,
            resolvedPaths: ['src/a.ts', 'src', 'docs/adr/0002-b.md'],
          },
          { kind: 'symbol', decision: 1 },
        ] as never,
        citations: [
          { file: 'src/b.ts', line: 3, decision: 1, inCode: true },
          { file: 'docs/guide.md', line: 1, decision: 1, inCode: false },
        ],
      },
      path => path.includes('.')
    )
    expect(cited).toEqual(new Map([[1, new Set(['src/a.ts', 'src/b.ts'])]]))
  })
})

const RECORDS = {
  'docs/adr/0001-invoices.md': [
    '# ADR 0001 — Invoices',
    '',
    '- **Status:** Accepted',
    '',
    '## Decision',
    '',
    '### Sending',
    '',
    'An invoice is sent on the first day of the month.',
    '',
    '## Consequences',
    '',
    'A refund always covers the whole invoice.',
    '',
  ].join('\n'),
  'docs/adr/0002-daily-invoices.md': [
    '---',
    'compadr:',
    '  feature: billing',
    '  parent: 1',
    '---',
    '# ADR 0002 — Daily invoices',
    '',
    '- **Status:** Accepted',
    '- Amends ADR 0001. Replaces its rule « an invoice is sent on the first day of the month ».',
    '- Amends ADR 0001. Replaces its rule « a refund always covers the whole invoice ».',
    '- Amends ADR 0001. Replaces its rule « invoices are printed on paper only ».',
    '',
    '## Decision',
    '',
    'An invoice is sent on the day of the order.',
    '',
  ].join('\n'),
  'docs/adr/0004-tax.md': [
    '---',
    'compadr:',
    '  feature: Tax Rules',
    '---',
    '# ADR 0004 — Tax',
    '',
  ].join('\n'),
  'docs/adr/0003-exports.md': [
    '---',
    'compadr:',
    '  feature: exports',
    '---',
    '# ADR 0003 — Exports',
    '',
    '- **Status:** Accepted',
    '',
  ].join('\n'),
  'docs/adr/features.yml': [
    'billing:',
    '  label: Billing and invoices',
    '  main: 1',
    'refunds:',
    '  label: Refunds',
    'Bad Id:',
    '  label: Left out',
    'audit:',
    '  main: 99',
    '',
  ].join('\n'),
}

describe('createDriftReport with features', () => {
  let fixture: FixtureRepo | undefined
  afterAll(() => fixture?.remove())

  it('reads the declared features and the replaced rules', async () => {
    fixture = createFixtureRepo([
      { date: '2026-01-10T09:00:00Z', files: RECORDS },
    ])
    const report = await createDriftReport(fixture.path, {
      generatorVersion: '0.0.0',
    })
    expect(report.features).toEqual([
      {
        id: 'billing',
        label: 'Billing and invoices',
        main: 1,
        source: 'declared',
        decisions: [1, 2],
      },
      {
        id: 'refunds',
        label: 'Refunds',
        main: null,
        source: 'declared',
        decisions: [],
      },
      {
        id: 'audit',
        label: 'audit',
        main: 99,
        source: 'declared',
        decisions: [],
      },
      {
        id: 'exports',
        label: 'exports',
        main: 3,
        source: 'declared',
        decisions: [3],
      },
    ])
    expect(report.featureProblems).toEqual([
      'Bad Id: not a feature identifier (lowercase-words)',
      'audit: main decision 0099 is not in the folder',
      'ADR 0004: compadr.feature "Tax Rules" is not a feature identifier (lowercase-words)',
    ])
    const section = report.decisions[0]!.text!.sections[0]!
    expect(section.heading).toBe('Sending')
    expect(report.replacedRules).toEqual([
      {
        decision: 2,
        quote: 'an invoice is sent on the first day of the month',
        target: 1,
        location: {
          section: 0,
          start: 0,
          end: 'An invoice is sent on the first day of the month'.length,
        },
      },
      {
        decision: 2,
        quote: 'a refund always covers the whole invoice',
        target: 1,
        location: null,
      },
      {
        decision: 2,
        quote: 'invoices are printed on paper only',
        target: null,
        location: null,
      },
    ])
  })
})
