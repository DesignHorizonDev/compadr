import { describe, expect, it } from 'vitest'
import type { DriftReport } from '@compadr/format'
import { decisionsForSymbol, describeDecision, draftDecision } from './tools.ts'

const REPORT = {
  repository: { name: 'r', ref: 'main', commit: 'c', adrDir: 'docs/adr' },
  decisions: [{ number: 8 }, { number: 10 }],
  features: [
    {
      id: 'droits',
      label: 'Droits',
      main: 10,
      source: 'declared',
      decisions: [10],
    },
  ],
} as unknown as DriftReport

const FRENCH = [
  '# ADR 0010 — Admins',
  '',
  '- **Statut** : acceptée',
  '- **Date** : 2026-09-22',
  "- Complète l'ADR 0008.",
  '',
  '## Contexte',
  '',
  '## Décision',
  '',
].join('\n')

describe('draftDecision', () => {
  it('follows a French record and takes the feature of the parent', () => {
    const draft = draftDecision(
      REPORT,
      { title: 'Rôle de lecteur', context: 'Un besoin.', parent: 10 },
      FRENCH,
      '2026-11-03'
    )
    expect(draft.path).toBe('docs/adr/0011-role-de-lecteur.md')
    expect(draft.content).toBe(
      [
        '---',
        'compadr:',
        '  feature: droits',
        '  parent: 10',
        '---',
        '',
        '# ADR 0011 — Rôle de lecteur',
        '',
        '- **Statut** : proposée',
        '- **Date** : 2026-11-03',
        "- Complète l'ADR 0010.",
        '',
        '## Contexte',
        '',
        'Un besoin.',
        '',
        '## Décision',
        '',
        '_À compléter : une règle par sous-section (`###`), chacune avec les fichiers ou les symboles qu’elle vise, entre backticks._',
        '',
        '## Conséquences',
        '',
        '_À compléter._',
        '',
      ].join('\n')
    )
  })

  it('writes MADR without a record to follow and reports an unknown feature', () => {
    const draft = draftDecision(
      { ...REPORT, decisions: [] },
      { title: '—', feature: 'billing' },
      null,
      '2026-11-03'
    )
    expect(draft.path).toBe('docs/adr/0001-decision.md')
    expect(draft.content).toMatch(
      /^---\nstatus: proposed\ndate: 2026-11-03\ncompadr:\n {2}feature: billing\n---\n\n# 1\. —\n/
    )
    expect(draft.notes[0]).toBe(
      'The repository does not declare the feature "billing" yet.'
    )
  })
})

describe('describeDecision', () => {
  const intro = {
    repository: { name: 'r', ref: 'main', commit: 'c', adrDir: 'docs/adr' },
    decisions: [
      {
        number: 3,
        title: 'Providers',
        status: 'accepted',
        supersededBy: [],
        amends: [],
        parent: null,
        text: {
          relations: [],
          sections: [
            { heading: null, line: 8, markdown: 'This record replaces 2.' },
            { heading: '1. Two ports', line: 10, markdown: 'Ports.' },
            { heading: '2. Three adapters', line: 14, markdown: 'Adapters.' },
          ],
        },
      },
    ],
    references: [],
    citations: [],
    signals: [],
  } as unknown as DriftReport

  it('numbers the outline like the subsections, the introduction first', () => {
    const outline = describeDecision(intro, 3, { sections: 'none' })
    expect(outline?.outline).toEqual([
      { index: 1, heading: null },
      { index: 2, heading: 'Two ports' },
      { index: 3, heading: 'Three adapters' },
    ])
    expect(outline?.decision).toEqual([])
    // The index of a heading in the outline picks that subsection.
    expect(describeDecision(intro, 3, { sections: [2] })?.decision).toEqual([
      { index: 2, heading: '1. Two ports', markdown: 'Ports.' },
    ])
  })
})

describe('draftDecision and the length of a decision', () => {
  it('notes a decision too long for an agent to read whole', () => {
    const draft = draftDecision(
      REPORT,
      {
        title: 'Long',
        decision: 'word '.repeat(2500),
        rule: 'A long rule that stands alone here.',
      },
      null,
      '2026-11-06'
    )
    expect(draft.notes[0]).toMatch(
      /^The decision has more than 12000 characters/
    )
  })
})

describe('decisionsForSymbol', () => {
  const symbolReport = (declaredIn: { file: string; line: number }[]) =>
    ({
      repository: { name: 'r', ref: 'main', commit: 'c', adrDir: 'docs/adr' },
      decisions: [
        {
          number: 4,
          title: 'Retries',
          status: 'accepted',
          rule: { text: 'A charge is tried three times.', source: 'declared' },
        },
        { number: 7, title: 'Draft', status: 'proposed' },
      ],
      references: [
        {
          kind: 'symbol',
          id: '0007:retryCharge:1',
          decision: 7,
          symbol: 'retryCharge',
          declaredIn,
        },
        {
          kind: 'symbol',
          id: '0004:retryCharge:1',
          decision: 4,
          symbol: 'retryCharge',
          declaredIn,
        },
      ],
      citations: [],
      signals: [],
    }) as unknown as DriftReport

  it('gives the citing decisions, in force first, and the decisions of the declaring file', () => {
    const answer = decisionsForSymbol(
      symbolReport([{ file: 'src/charge.ts', line: 3 }]),
      'retryCharge'
    )
    expect(answer).toEqual({
      symbol: 'retryCharge',
      declaredIn: [{ file: 'src/charge.ts', line: 3 }],
      citedBy: [
        {
          decision: 4,
          title: 'Retries',
          status: 'accepted',
          rule: 'A charge is tried three times.',
        },
        { decision: 7, title: 'Draft', status: 'proposed' },
      ],
      fileDecisions: [
        {
          decision: 4,
          title: 'Retries',
          rule: 'A charge is tried three times.',
          weight: 2,
          read: 'lines',
        },
      ],
    })
  })

  it('leaves the file out when several files declare the name', () => {
    const answer = decisionsForSymbol(
      symbolReport([
        { file: 'src/a.ts', line: 1 },
        { file: 'src/b.ts', line: 1 },
      ]),
      'retryCharge'
    )
    expect(answer).not.toHaveProperty('fileDecisions')
    expect(decisionsForSymbol(symbolReport([]), 'unknownThing')).toBe(null)
  })
})
