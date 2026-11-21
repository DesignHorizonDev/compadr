import type { DriftReport } from '@compadr/format'
import { compactDecisionsForFile, decisionsForFile } from '@compadr/format'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDriftReport } from './report.ts'
import { createFixtureRepo, type FixtureRepo } from './testing/fixture-repo.ts'

let fixture: FixtureRepo
let report: DriftReport

beforeAll(async () => {
  fixture = createFixtureRepo([
    {
      date: '2026-01-10T09:00:00Z',
      files: {
        'docs/adr/0001-billing.md': [
          '---',
          'status: accepted',
          '---',
          '# 1. Billing',
          '',
          '## Decision',
          '',
          'Every charge goes through `chargeCustomer`, with `RETRY_LIMIT` tries and a `ChargeState`.',
          'Invoices use `InvoiceLine`, and `refundCharge` reverses a charge.',
          '',
        ].join('\n'),
        'server/billing/charge.ts': [
          'export async function chargeCustomer() {}',
          'export const RETRY_LIMIT = 3',
          'export const enum ChargeState { Open, Done }',
          'function local() {',
          '  const refundCharge = 1',
          '}',
          '',
        ].join('\n'),
        // A model and its generated GraphQL twin: only the source counts.
        'prisma/schema.prisma': 'model InvoiceLine {\n  id Int\n}\n',
        'server/gql/graphql.ts': 'export type InvoiceLine = { id: number }\n',
        'server/schema.graphql': 'type InvoiceLine {\n  id: Int\n}\n',
        // Two files declare refund: the name is ambiguous.
        'server/billing/refund.ts': 'export function refundCharge() {}\n',
        'web/refund.ts': 'export const refundCharge = () => {}\n',
        'README.md': 'export function chargeCustomer() {}\n',
      },
    },
  ])
  report = await createDriftReport(fixture.path, { generatorVersion: '0.0.0' })
})

afterAll(() => fixture.remove())

const declared = (symbol: string) =>
  report.references.find(r => r.kind === 'symbol' && r.symbol === symbol)

describe('declarations of the cited symbols', () => {
  it('finds the declarations at the start of a line, generated code and documents aside', () => {
    expect(declared('chargeCustomer')).toMatchObject({
      declaredIn: [{ file: 'server/billing/charge.ts', line: 1 }],
    })
    expect(declared('RETRY_LIMIT')).toMatchObject({
      declaredIn: [{ file: 'server/billing/charge.ts', line: 2 }],
    })
    // `const enum` declares the enum, not a constant named enum.
    expect(declared('ChargeState')).toMatchObject({
      declaredIn: [{ file: 'server/billing/charge.ts', line: 3 }],
    })
    expect(declared('InvoiceLine')).toMatchObject({
      declaredIn: [{ file: 'prisma/schema.prisma', line: 1 }],
    })
    // The indented local variable does not count.
    expect(declared('refundCharge')).toMatchObject({
      declaredIn: [
        { file: 'server/billing/refund.ts', line: 1 },
        { file: 'web/refund.ts', line: 1 },
      ],
    })
  })

  it('links the decision to the file that alone declares a cited symbol', () => {
    const answer = decisionsForFile(report, 'server/billing/charge.ts')
    expect(answer.inForce).toMatchObject([
      {
        decision: 1,
        scope: 'file',
        links: [
          { source: 'record-cites-symbol', symbol: 'chargeCustomer', line: 1 },
          { source: 'record-cites-symbol', symbol: 'RETRY_LIMIT', line: 2 },
          { source: 'record-cites-symbol', symbol: 'ChargeState', line: 3 },
        ],
      },
    ])
    // Each symbol weighs 2, and the record names lines of the file.
    expect(
      compactDecisionsForFile(report, 'server/billing/charge.ts').inForce
    ).toEqual([
      {
        decision: 1,
        title: 'Billing',
        rule: expect.any(String) as string,
        weight: 6,
        read: 'lines',
      },
    ])
    // An ambiguous name links no file.
    expect(decisionsForFile(report, 'web/refund.ts').inForce).toEqual([])
  })

  it('puts the declaring files in the zones', () => {
    const zone = report.zones?.find(z => z.path === 'server/billing')
    expect(zone).toMatchObject({ linkedFiles: 1, crossChecked: 0 })
  })
})
