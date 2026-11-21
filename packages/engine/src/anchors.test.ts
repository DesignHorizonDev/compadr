import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { anchorProposals, anchorSignals, symbolIndex } from './anchors.ts'
import { readCorpus } from './read-corpus.ts'
import { Repository } from './repository.ts'
import { fingerprint, SymbolReader } from './symbols.ts'
import { createFixtureRepo, type FixtureRepo } from './testing/fixture-repo.ts'

const BILLING_V1 = `export class BillingService {
  charge(amount: number) {
    const fee = amount * 0.1
    return amount + fee
  }
}
`

// Three lines inserted above the class: the cited lines move down.
const BILLING_V2 = `import { log } from './log'

export const VAT = 0.2
export class BillingService {
  charge(amount: number) {
    const fee = amount * 0.1
    return amount + fee
  }
}
export function total() {}
export function total() {}
`

const LEGACY = 'export function legacy() {\n  return 1\n}\n'

let fixture: FixtureRepo
let reader: SymbolReader

beforeAll(async () => {
  reader = await SymbolReader.load()
  const symbol = (source: string, name: string) =>
    reader.symbols('src/a.ts', source)!.find(s => s.name === name)!
  const charge = fingerprint(symbol(BILLING_V2, 'BillingService.charge').text)
  const chargeLines = fingerprint(
    'const fee = amount * 0.1\n    return amount + fee'
  )
  const legacy = fingerprint(symbol(LEGACY, 'legacy').text)

  fixture = createFixtureRepo([
    {
      date: '2026-01-10T09:00:00Z',
      files: {
        'src/billing.ts': BILLING_V1,
        'src/legacy.ts': LEGACY,
        'src/style.css': '.button {}\n',
        'docs/adr/0001-billing.md': [
          '# 1. Billing',
          '',
          'Status: accepted',
          '',
          'The fee is computed in `src/billing.ts:3-4`.',
          'The service starts at `src/billing.ts:1`.',
          'The class ends at `src/billing.ts:6`.',
          'Styles live in `src/style.css:1`.',
          'The old module was `src/gone.ts:5`.',
          '',
        ].join('\n'),
      },
    },
    {
      date: '2026-02-10T09:00:00Z',
      files: {
        'src/billing.ts': BILLING_V2,
        'docs/adr/0002-anchors.md': [
          '---',
          'compadr:',
          '  anchors:',
          '    "src/billing.ts#BillingService.charge":',
          `      fingerprint: ${charge}`,
          `      lines: { count: 2, fingerprint: ${chargeLines} }`,
          '    "src/billing.ts#BillingService":',
          '      fingerprint: sha256:0000000000000000',
          '    "src/legacy.ts#legacy":',
          `      fingerprint: ${legacy}`,
          '      lines: { count: 1, fingerprint: sha256:0000000000000000 }',
          '    "src/billing.ts#BillingService.refund":',
          '      fingerprint: sha256:0000000000000000',
          '---',
          '# 2. Anchors',
          '',
          'Status: accepted',
          '',
          '- `src/billing.ts#BillingService.charge` is unchanged.',
          '- `src/billing.ts#BillingService` changed.',
          '- `src/legacy.ts#legacy` lost its tracked line.',
          '- `src/billing.ts#BillingService.refund` is gone.',
          '- `src/billing.ts#total` is declared twice.',
          '- `src/billing.ts#VAT` has no fingerprint.',
          '- `src/style.css#button` is not code that the engine reads.',
          '',
        ].join('\n'),
      },
    },
  ])
})

afterAll(() => fixture.remove())

async function analyse() {
  const repo = await Repository.open(fixture.path, 'HEAD')
  const corpus = await readCorpus(repo)
  return { repo, corpus, index: symbolIndex(repo, reader) }
}

describe('anchorSignals', () => {
  it('checks each anchored reference', async () => {
    const { repo, corpus, index } = await analyse()
    const signals = await anchorSignals(repo, corpus, index)
    const byText = (text: string) =>
      corpus.references.find(reference => reference.text === text)!.id
    expect(
      signals
        .map(signal => [
          signal.type,
          'reference' in signal ? signal.reference : null,
        ])
        .sort()
    ).toEqual(
      [
        ['anchor-content-changed', byText('src/billing.ts#BillingService')],
        ['anchor-lines-changed', byText('src/legacy.ts#legacy')],
        [
          'anchor-symbol-missing',
          byText('src/billing.ts#BillingService.refund'),
        ],
        ['anchor-symbol-ambiguous', byText('src/billing.ts#total')],
        ['anchor-unverified', byText('src/billing.ts#VAT')],
        ['anchor-unverified', byText('src/style.css#button')],
      ].sort()
    )
    expect(
      signals.find(s => s.type === 'anchor-symbol-ambiguous')
    ).toMatchObject({ level: 'review', matches: 2 })
    expect(
      signals
        .filter(s => s.type === 'anchor-unverified')
        .map(s => s.type === 'anchor-unverified' && s.reason)
        .sort()
    ).toEqual(['no-fingerprint', 'unsupported-language'])
  })

  it('reads the anchors of the frontmatter into the references', async () => {
    const { corpus } = await analyse()
    expect(
      corpus.references.find(
        reference => reference.text === 'src/billing.ts#BillingService.charge'
      )
    ).toMatchObject({
      kind: 'path',
      path: 'src/billing.ts',
      lines: null,
      anchor: {
        symbol: 'BillingService.charge',
        fingerprint: expect.stringMatching(/^sha256:/) as string,
        lines: { count: 2 },
      },
    })
  })
})

describe('anchorProposals', () => {
  it('proposes the symbol that held the cited lines, at its new place', async () => {
    const { repo, corpus, index } = await analyse()
    const proposals = await anchorProposals(repo, corpus, index)
    const proposal = (text: string) =>
      proposals.get(corpus.references.find(r => r.text === text)!.id)

    expect(proposal('src/billing.ts:3-4')).toEqual({
      symbol: 'BillingService.charge',
      text: 'src/billing.ts#BillingService.charge',
      fingerprint: expect.stringMatching(/^sha256:[0-9a-f]{16}$/) as string,
      symbolLines: { start: 5, end: 8 },
      lines: {
        count: 2,
        fingerprint: fingerprint(
          'const fee = amount * 0.1\n    return amount + fee'
        ),
        start: 6,
      },
    })
    expect(proposal('src/billing.ts:1')).toMatchObject({
      symbol: 'BillingService',
      symbolLines: { start: 4, end: 9 },
    })
    // `}` closes both the method and the class: the line is not unique.
    expect(proposal('src/billing.ts:6')).toMatchObject({
      symbol: 'BillingService',
      lines: null,
    })
  })

  it('proposes nothing for a missing file or another language', async () => {
    const { repo, corpus, index } = await analyse()
    const proposals = await anchorProposals(repo, corpus, index)
    const ids = (texts: string[]) =>
      corpus.references.filter(r => texts.includes(r.text)).map(r => r.id)
    for (const id of ids(['src/gone.ts:5', 'src/style.css:1'])) {
      expect(proposals.has(id)).toBe(false)
    }
    expect(proposals.size).toBe(3)
  })

  it('leaves the analysed repository unchanged', async () => {
    const before = fixture.git('status', '--porcelain', '--ignored')
    const { repo, corpus, index } = await analyse()
    await anchorProposals(repo, corpus, index)
    await anchorSignals(repo, corpus, index)
    expect(fixture.git('status', '--porcelain', '--ignored')).toBe(before)
  })
})
