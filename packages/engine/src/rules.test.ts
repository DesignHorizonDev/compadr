import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { checkNotices } from './check.ts'
import { createDriftReport } from './report.ts'
import { recordHash } from './rules.ts'
import { createFixtureRepo, type FixtureRepo } from './testing/fixture-repo.ts'

const billing = [
  '---',
  'compadr:',
  '  feature: billing',
  '---',
  '# ADR 0001 — Billing',
  '',
  '- **Status:** Accepted',
  '',
  '## Decision',
  '',
  'An invoice is sent on the first day of the month.',
  '',
].join('\n')

const daily = (text: string) =>
  [
    '---',
    'compadr:',
    '  feature: billing',
    '  parent: 1',
    '---',
    '# ADR 0002 — Daily invoices',
    '',
    '- **Status:** Accepted',
    '- Amends ADR 0001.',
    '',
    '## Decision',
    '',
    text,
    '',
  ].join('\n')

const glossary = (hashes: [number, string][]) =>
  [
    'billing:',
    '  label: Billing',
    '  main: 1',
    '  rules:',
    '    decision: 1',
    '    validated: 2026-11-16',
    '    model: compadr-assist-1',
    '    promptVersion: consolidate-2',
    '    chain:',
    ...hashes.flatMap(([decision, hash]) => [
      `      - decision: ${decision}`,
      `        hash: "${hash}"`,
    ]),
    '    rules:',
    '      - rule: An invoice is sent on the day of the order.',
    '        sources: [2]',
    '        quote: An invoice is sent on the day of the order.',
    '    replaced: []',
    '    conflicts: []',
    '',
  ].join('\n')

let fixture: FixtureRepo
const first = daily('An invoice is sent on the day of the order.')

beforeAll(() => {
  fixture = createFixtureRepo([
    {
      date: '2026-01-10T09:00:00Z',
      files: {
        'docs/adr/0001-billing.md': billing,
        'docs/adr/0002-daily.md': first,
        'docs/adr/features.yml': glossary([
          [1, recordHash(billing)],
          [2, recordHash(first)],
        ]),
      },
    },
    {
      date: '2026-01-11T09:00:00Z',
      files: {
        'docs/adr/0002-daily.md': daily(
          'An invoice is sent on the day of the order, or the next day.'
        ),
      },
    },
  ])
})

afterAll(() => fixture.remove())

const report = (ref: string) =>
  createDriftReport(fixture.path, { ref, generatorVersion: '0.0.0' })

describe('validated rules', () => {
  it('are current while the records of the chain keep their text', async () => {
    const before = await report('HEAD~1')
    expect(before.features).toMatchObject([
      {
        id: 'billing',
        rules: { decision: 1, validated: '2026-11-16' },
        staleRecords: [],
      },
    ])
    expect(
      checkNotices(before).filter(n => n.rule === 'consolidated-rule-stale')
    ).toEqual([])
  })

  it('are stale once a record of the chain changes, which check notes', async () => {
    const after = await report('HEAD')
    expect(after.features?.[0]?.staleRecords).toEqual([2])
    expect(
      checkNotices(after).filter(n => n.rule === 'consolidated-rule-stale')
    ).toEqual([
      {
        rule: 'consolidated-rule-stale',
        decision: 1,
        file: 'docs/adr/features.yml',
        line: null,
        message:
          'The rules in force of Billing were validated on 2026-11-16, and ADR 0002 changed since: consolidate them again (compadr assist consolidate, then compadr rules)',
        key: 'consolidated-rule-stale:billing',
      },
    ])
  })

  it('give the same fingerprint whatever the line endings', () => {
    expect(recordHash('a\r\nb\n')).toBe(recordHash('a\nb\n'))
    expect(recordHash('a\nb\n')).toMatch(/^sha256:[0-9a-f]{16}$/)
  })
})
