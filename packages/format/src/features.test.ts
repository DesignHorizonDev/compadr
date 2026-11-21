import { describe, expect, it } from 'vitest'
import {
  applyFeatureEdit,
  FeatureGlossaryError,
  parseFeatureGlossary,
  writeFeatureGlossary,
  writeValidatedRules,
} from './features.ts'
import { FrontmatterEditError } from './frontmatter-edit.ts'
import { parseAdr } from './parse-adr.ts'

describe('parseFeatureGlossary', () => {
  it('reads the label and the main decision of each feature', () => {
    const glossary = parseFeatureGlossary(
      [
        'billing:',
        '  label: Billing and invoices',
        '  main: 3',
        'refunds:',
        "  main: '0012'",
        'Bad Id:',
        '  label: Left out',
      ].join('\n')
    )
    expect(glossary.features).toEqual([
      { id: 'billing', label: 'Billing and invoices', main: 3 },
      { id: 'refunds', label: 'refunds', main: 12 },
    ])
    expect(glossary.problems).toEqual([
      'Bad Id: not a feature identifier (lowercase-words)',
    ])
  })

  it('has no feature for an empty file and a problem for a list', () => {
    expect(parseFeatureGlossary('')).toEqual({ features: [], problems: [] })
    expect(parseFeatureGlossary('- billing').problems).toEqual([
      'features.yml is not a map',
    ])
    expect(parseFeatureGlossary('billing: [').problems[0]).toMatch(
      /^features\.yml is not valid YAML/
    )
  })
})

describe('writeFeatureGlossary', () => {
  it('starts a new glossary with a comment', () => {
    const text = writeFeatureGlossary(null, [
      { id: 'billing', label: 'Billing', main: 3 },
    ])
    expect(text).toMatch(/^# Features of the decision records/)
    expect(parseFeatureGlossary(text).features).toEqual([
      { id: 'billing', label: 'Billing', main: 3 },
    ])
  })

  it('keeps the other features and the comments', () => {
    const text = writeFeatureGlossary(
      ['# Ours', 'billing:', '  label: Billing # kept', '  main: 3', ''].join(
        '\n'
      ),
      [
        { id: 'refunds', label: 'Refunds', main: 12 },
        { id: 'billing', label: 'Billing', main: null },
      ]
    )
    expect(text).toContain('# Ours')
    expect(text).toContain('# kept')
    expect(parseFeatureGlossary(text).features).toEqual([
      { id: 'billing', label: 'Billing', main: null },
      { id: 'refunds', label: 'Refunds', main: 12 },
    ])
  })

  it('refuses an invalid identifier', () => {
    expect(() =>
      writeFeatureGlossary(null, [{ id: 'Billing', label: 'B', main: 1 }])
    ).toThrow(FeatureGlossaryError)
  })
})

describe('applyFeatureEdit', () => {
  const RECORD = 'docs/adr/0012-refunds.md'

  it('adds a frontmatter to a record without one', () => {
    const markdown = '# 12. Refunds\n\nStatus: accepted\n'
    const result = applyFeatureEdit(markdown, { feature: 'billing', parent: 3 })
    expect(result).toMatch(
      /^---\ncompadr:\n {2}feature: billing\n {2}parent: 3\n---\n\n# 12/
    )
    expect(parseAdr(RECORD, result)).toMatchObject({
      status: 'accepted',
      feature: 'billing',
      parent: 3,
    })
  })

  it('keeps the other keys and removes the parent of a main decision', () => {
    const markdown = [
      '---',
      'status: accepted # kept',
      'compadr:',
      '  feature: old',
      '  parent: 7',
      '  anchors:',
      '    "src/a.ts#charge":',
      '      fingerprint: sha256:0123456789abcdef',
      '---',
      '# 12. Refunds',
      '',
    ].join('\n')
    const result = applyFeatureEdit(markdown, {
      feature: 'billing',
      parent: null,
    })
    expect(result).toContain('status: accepted # kept')
    expect(parseAdr(RECORD, result)).toMatchObject({
      feature: 'billing',
      parent: null,
      anchors: {
        'src/a.ts#charge': { fingerprint: 'sha256:0123456789abcdef' },
      },
    })
  })

  it('refuses a frontmatter that is not a map', () => {
    expect(() =>
      applyFeatureEdit('---\n- a\n---\n# 12. Refunds\n', {
        feature: 'billing',
        parent: null,
      })
    ).toThrow(FrontmatterEditError)
  })
})

describe('glossary entries that are not maps', () => {
  it('reads a bare entry and leaves out a scalar or a bad number', () => {
    const glossary = parseFeatureGlossary(
      ['billing:', 'refunds: 3', 'tax:', '  main: 10000'].join('\n')
    )
    expect(glossary.features).toEqual([
      { id: 'billing', label: 'billing', main: null },
      { id: 'tax', label: 'tax', main: null },
    ])
    expect(glossary.problems).toEqual([
      'refunds: not a map of label and main',
      'tax: main is not a decision number',
    ])
  })

  it('replaces such an entry when it writes the feature', () => {
    const text = writeFeatureGlossary('billing:\nrefunds: 3\n', [
      { id: 'billing', label: 'Billing', main: 3 },
      { id: 'refunds', label: 'Refunds', main: null },
    ])
    expect(parseFeatureGlossary(text)).toEqual({
      features: [
        { id: 'billing', label: 'Billing', main: 3 },
        { id: 'refunds', label: 'Refunds', main: null },
      ],
      problems: [],
    })
  })

  it('writes into an empty compadr key and refuses a scalar one', () => {
    const empty = applyFeatureEdit('---\ncompadr:\n---\n# 12. Refunds\n', {
      feature: 'billing',
      parent: 3,
    })
    expect(parseAdr('docs/adr/0012-refunds.md', empty)).toMatchObject({
      feature: 'billing',
      parent: 3,
    })
    expect(() =>
      applyFeatureEdit('---\ncompadr: yes\n---\n# 12. Refunds\n', {
        feature: 'billing',
        parent: null,
      })
    ).toThrow('compadr is not a map')
  })
})

describe('validated rules in the glossary', () => {
  const rules = {
    decision: 1,
    validated: '2026-11-16',
    model: 'compadr-assist-1',
    promptVersion: 'consolidate-2',
    chain: [{ decision: 1, hash: 'sha256:0123456789abcdef' }],
    rules: [
      {
        rule: 'An invoice is sent on the day of the order.',
        sources: [1],
        quote: 'An invoice is sent on the day of the order.',
      },
    ],
    replaced: [],
    conflicts: [],
  }

  it('writes them under the feature and reads them back', () => {
    const text = writeValidatedRules(
      '# Features\nbilling:\n  label: Billing\n  main: 1\n',
      'billing',
      rules
    )
    expect(text.startsWith('# Features\nbilling:\n  label: Billing\n')).toBe(
      true
    )
    expect(parseFeatureGlossary(text)).toEqual({
      features: [{ id: 'billing', label: 'Billing', main: 1, rules }],
      problems: [],
    })
  })

  it('leaves out rules that do not follow the schema, and keeps the feature', () => {
    const text = writeValidatedRules(
      'billing:\n  main: 1\n',
      'billing',
      rules
    ).replace('sha256:0123456789abcdef', 'md5:1')
    expect(parseFeatureGlossary(text)).toEqual({
      features: [{ id: 'billing', label: 'billing', main: 1 }],
      problems: [
        expect.stringMatching(
          /^billing: rules are left out \(chain\.0\.hash: /
        ),
      ],
    })
  })

  it('needs an entry for the feature', () => {
    expect(() =>
      writeValidatedRules('other:\n  main: 2\n', 'billing', rules)
    ).toThrow(FeatureGlossaryError)
  })
})
