import { describe, expect, it } from 'vitest'
import type { DraftSuggestion, DriftReport } from '@compadr/format'
import { closeDecisions, draftDecision, proposalOfDraft } from './propose.ts'

const decision = (
  number: number,
  title: string,
  status: string,
  rule: string | null
) => ({
  number,
  title,
  status,
  file: `docs/adr/${String(number).padStart(4, '0')}-x.md`,
  rule: rule === null ? null : { text: rule, source: 'declared' },
})

const REPORT = {
  repository: { name: 'r', ref: 'main', commit: 'c', adrDir: 'docs/adr' },
  decisions: [
    decision(
      8,
      'Jetons de partage',
      'accepted',
      'Un jeton de partage est haché en SHA-256 avant le stockage.'
    ),
    decision(9, 'Ancien partage', 'superseded', null),
    decision(10, 'Admins', 'accepted', null),
  ],
  features: [
    {
      id: 'partage',
      label: 'Partage',
      main: 8,
      source: 'declared',
      decisions: [8, 9],
    },
  ],
} as unknown as DriftReport

const FRENCH = [
  '# ADR 0010 — Admins',
  '',
  '- **Statut** : acceptée',
  '- **Date** : 2026-09-22',
  '',
  '## Contexte',
  '',
].join('\n')

describe('draftDecision with amendments and replacements', () => {
  it('writes one line per relation, in the language of the records', () => {
    const draft = draftDecision(
      REPORT,
      { title: 'Durée des jetons', amends: [8], supersedes: [9, 8] },
      FRENCH,
      '2026-11-18'
    )
    const header = draft.content.split('## Contexte')[0]!
    expect(header).toContain("- Complète l'ADR 0008.\n- Remplace l'ADR 0009.")
    // A decision both amended and replaced is written once, as amended.
    expect(header.match(/0008/g)).toHaveLength(1)
    // The decisions changed belong to one feature: the record joins it.
    expect(draft.content).toContain('  feature: partage\n')
    expect(draft.content).not.toContain('parent:')
    expect(draft.notes).not.toContain('ADR 0008 is not in the repository.')
  })

  it('leaves out a feature that Compadr only proposes', () => {
    const inferred = {
      ...REPORT,
      features: [{ ...REPORT.features![0]!, source: 'proposed' }],
    } as unknown as DriftReport
    const draft = draftDecision(
      inferred,
      { title: 'Durée des jetons', amends: [8] },
      FRENCH,
      '2026-11-18'
    )
    expect(draft.content).not.toContain('feature:')
  })

  it('names a relation to a decision that does not exist', () => {
    const draft = draftDecision(
      REPORT,
      { title: 'X', supersedes: [42] },
      null,
      '2026-11-18'
    )
    expect(draft.content).toContain('Supersedes ADR 0042.')
    expect(draft.notes).toContain('ADR 0042 is not in the repository.')
  })
})

describe('proposalOfDraft', () => {
  it('turns each section of the decision into a subsection', () => {
    const proposal = proposalOfDraft({
      title: 'T',
      rule: 'R',
      context: 'C',
      decision: [
        { heading: ' First rule ', text: 'One.\n' },
        { heading: 'Second rule', text: 'Two.' },
      ],
      consequences: 'Q',
      amends: [1],
      supersedes: [],
    } as unknown as DraftSuggestion)
    expect(proposal.decision).toBe(
      '### First rule\n\nOne.\n\n### Second rule\n\nTwo.'
    )
    expect(proposal.amends).toEqual([1])
  })
})

describe('closeDecisions', () => {
  it('finds a decision in force with the same subject', () => {
    const close = closeDecisions(REPORT, {
      title: 'Hachage des jetons de partage',
      rule: 'Les jetons de partage sont hachés en SHA-256.',
    })
    expect(close.map(c => c.number)).toEqual([8])
    expect(close[0]!.shared).toEqual(
      expect.arrayContaining(['jeton', 'partage', 'hache'])
    )
  })

  it('leaves out the decisions that the proposal names, and other subjects', () => {
    expect(
      closeDecisions(REPORT, {
        title: 'Hachage des jetons de partage',
        rule: 'Les jetons de partage sont hachés en SHA-256.',
        amends: [8],
      })
    ).toEqual([])
    expect(
      closeDecisions(REPORT, {
        title: 'Isolation des transactions',
        rule: 'Une transaction de paiement lit en READ COMMITTED.',
      })
    ).toEqual([])
  })

  it('never counts a decision that is no longer in force', () => {
    const report = {
      ...REPORT,
      decisions: [decision(9, 'Jetons de partage hachés', 'superseded', null)],
    } as unknown as DriftReport
    expect(
      closeDecisions(report, {
        title: 'Jetons de partage hachés',
        rule: 'Les jetons de partage sont hachés.',
      })
    ).toEqual([])
  })
})
