import { describe, expect, it } from 'vitest'
import { locateQuote, readDecisionText } from './record-text.ts'

const DETAIL = [
  '---',
  'status: accepted',
  '---',
  '# ADR 0012 — Partial refunds',
  '',
  '- **Status:** Accepted',
  '- **Date:** 2026-03-02',
  '- Amends ADR 0003. Replaces its rule « a refund always covers the whole invoice ».',
  '- Completes ADR 0005 and ADR 0007. Replaces two rules:',
  '  - in ADR 0005, « the support team approves every refund […] before noon » ;',
  '  - in ADR 0007, « refunds are paid by cheque only ».',
  '- See also ADR 0009, which keeps « Invoice numbers » as written.',
  '',
  '## Context',
  '',
  'Customers ask for partial refunds.',
  '',
  '## Decision',
  '',
  'A refund covers part of an invoice.',
  '',
  '### Amount',
  '',
  '- The amount is at most the invoice total.',
  '',
  '### Approval',
  '',
  'The billing lead approves a refund above 500 euros.',
  '',
  '## Consequences',
  '',
  'The ledger records partial refunds.',
].join('\n')

describe('readDecisionText', () => {
  it('reads the relations, the subsections and the quoted rules', () => {
    const text = readDecisionText(DETAIL)
    expect(text.relations).toEqual([
      'Amends ADR 0003. Replaces its rule « a refund always covers the whole invoice ».',
      [
        'Completes ADR 0005 and ADR 0007. Replaces two rules:',
        '  - in ADR 0005, « the support team approves every refund […] before noon » ;',
        '  - in ADR 0007, « refunds are paid by cheque only ».',
      ].join('\n'),
    ])
    expect(text.sections).toEqual([
      {
        heading: null,
        line: 20,
        markdown: 'A refund covers part of an invoice.',
      },
      {
        heading: 'Amount',
        line: 22,
        markdown: '- The amount is at most the invoice total.',
      },
      {
        heading: 'Approval',
        line: 26,
        markdown: 'The billing lead approves a refund above 500 euros.',
      },
    ])
    expect(text.replaces).toEqual([
      { quote: 'a refund always covers the whole invoice', decisions: [3] },
      {
        quote: 'the support team approves every refund […] before noon',
        decisions: [5],
      },
      { quote: 'refunds are paid by cheque only', decisions: [7] },
    ])
  })

  it('reads a French record and a decision without subsections', () => {
    const text = readDecisionText(
      [
        '# ADR 0004 — Factures',
        '',
        '- **Statut** : acceptée',
        "- Complète l'ADR 0002. Remplace sa règle « une facture part le premier du mois ».",
        '',
        '## Décision',
        '',
        'Une facture part le jour de la commande.',
        '',
        '## Conséquences',
      ].join('\n')
    )
    expect(text.relations).toHaveLength(1)
    expect(text.sections).toEqual([
      {
        heading: null,
        line: 8,
        markdown: 'Une facture part le jour de la commande.',
      },
    ])
    expect(text.replaces).toEqual([
      { quote: 'une facture part le premier du mois', decisions: [2] },
    ])
  })

  it('has no section when the record has no Decision section', () => {
    expect(readDecisionText('# 1. Billing\n\nStatus: accepted\n')).toEqual({
      relations: [],
      sections: [],
      replaces: [],
    })
  })
})

describe('locateQuote', () => {
  const markdown = [
    'The **support team** approves every refund (by mail) before noon.',
    "It doesn't apply to gift cards. Refunds are paid by `cheque` only.",
  ].join('\n')

  it('ignores emphasis, punctuation, parentheses, case and apostrophes', () => {
    const at = locateQuote(markdown, 'it doesn’t apply to gift cards ; refunds')
    expect(at).not.toBeNull()
    expect(markdown.slice(at!.start, at!.end)).toBe(
      "It doesn't apply to gift cards. Refunds"
    )
    expect(locateQuote(markdown, 'refunds are paid by cheque only')).toEqual({
      start: markdown.indexOf('Refunds are'),
      end: markdown.indexOf(' only.') + 5,
    })
  })

  it('follows the parts of a quote split by an ellipsis', () => {
    const at = locateQuote(
      markdown,
      'the support team approves […] before noon'
    )
    expect(markdown.slice(at!.start, at!.end)).toBe(
      'The **support team** approves every refund (by mail) before noon'
    )
    expect(locateQuote(markdown, 'before noon […] the support team')).toBeNull()
  })

  it('finds nothing for a quote absent or found twice', () => {
    expect(locateQuote(markdown, 'refunds by transfer')).toBeNull()
    expect(
      locateQuote('Refunds wait. Refunds wait.', 'refunds wait')
    ).toBeNull()
  })
})

describe('readDecisionText on other layouts', () => {
  it('takes the MADR Decision Outcome, not the Decision Drivers', () => {
    const text = readDecisionText(
      [
        '# 3. Billing',
        '',
        '## Context and Problem Statement',
        '',
        '## Decision Drivers',
        '',
        '* driver one',
        '',
        '## Considered Options',
        '',
        '## Decision Outcome',
        '',
        'Chosen option: monthly invoices.',
      ].join('\n')
    )
    expect(text.sections).toEqual([
      { heading: null, line: 13, markdown: 'Chosen option: monthly invoices.' },
    ])
  })

  it('keeps a relation that follows status and date lines without bullets', () => {
    const text = readDecisionText(
      [
        '# 4. Refunds',
        '',
        'Status: Accepted',
        'Date: 2025-01-01',
        'Amends ADR 0003',
        '',
        '## Decision',
      ].join('\n')
    )
    expect(text.relations).toEqual(['Amends ADR 0003'])
  })

  it('reads no heading inside a fenced code block', () => {
    const text = readDecisionText(
      [
        '# 5. Exports',
        '',
        '## Decision',
        '',
        '```sh',
        '### a comment',
        '## another comment',
        '```',
        '',
        '### Format',
        '',
        'CSV only.',
      ].join('\n')
    )
    expect(text.sections).toEqual([
      {
        heading: null,
        line: 5,
        markdown: '```sh\n### a comment\n## another comment\n```',
      },
      { heading: 'Format', line: 10, markdown: 'CSV only.' },
    ])
  })
})

describe('locateQuote with an ellipsis', () => {
  it('needs the whole quote once, not its first part', () => {
    const markdown = 'A refund covers part. A refund covers the whole invoice.'
    const at = locateQuote(markdown, 'a refund covers […] whole invoice')
    expect(markdown.slice(at!.start, at!.end)).toBe(
      'A refund covers the whole invoice'
    )
    expect(
      locateQuote(
        'A refund covers y. A refund covers y.',
        'a refund covers […] y'
      )
    ).toBeNull()
  })
})
