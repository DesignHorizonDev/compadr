import { createDriftReport } from '@compadr/engine'
import { createFixtureRepo, type FixtureRepo } from '@compadr/engine/testing'
import type { DriftReport } from '@compadr/format'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fakeAssistClient } from './fake.ts'
import { semanticCheck, withoutExcluded } from './semantic.ts'

let fixture: FixtureRepo
let report: DriftReport

const record = (number: number, title: string, text: string) =>
  [
    `# ${number}. ${title}`,
    '',
    'Status: Accepted',
    '',
    '## Decision',
    '',
    text,
    '',
  ].join('\n')

beforeAll(async () => {
  fixture = createFixtureRepo([
    {
      date: '2026-01-10T09:00:00Z',
      files: {
        'docs/adr/0001-billing.md': record(
          1,
          'Billing',
          'Charges go through `server/billing/charge.ts`, and never twice.'
        ),
        'docs/adr/0002-refunds.md': record(
          2,
          'Refunds within thirty days',
          'A refund names the charge it cancels.'
        ),
        'docs/adr/compadr.yml':
          'assist:\n  semantic: true\n  exclude:\n    - server/secrets\n',
        'server/billing/charge.ts': 'export const charge = 1\n',
      },
    },
  ])
  report = await createDriftReport(fixture.path, { generatorVersion: '0.0.0' })
})

afterAll(() => fixture.remove())

const diff = [
  'diff --git a/server/billing/charge.ts b/server/billing/charge.ts',
  '--- a/server/billing/charge.ts',
  '+++ b/server/billing/charge.ts',
  '@@ -1 +1,2 @@',
  ' export const charge = 1',
  '+export const refund = () => charge',
  '',
].join('\n')

const moved = [
  'diff --git a/server/secrets/key.ts b/server/keys/key.ts',
  'similarity index 100%',
  'rename from server/secrets/key.ts',
  'rename to server/keys/key.ts',
  '',
].join('\n')

describe('withoutExcluded', () => {
  it('keeps out a file whose old or new path is excluded', () => {
    expect(withoutExcluded(`${diff}${moved}`, report)).toEqual({
      diff,
      excluded: ['server/keys/key.ts'],
    })
  })
})

describe('withoutExcluded, on a diff without diff --git lines', () => {
  it('keeps out the part that holds an excluded file', () => {
    const plain = [
      '--- a/server/billing/charge.ts',
      '+++ b/server/billing/charge.ts',
      '@@ -1 +1,2 @@',
      ' export const charge = 1',
      '+export const twice = 2',
      '--- a/server/secrets/key.env',
      '+++ b/server/secrets/key.env',
      '@@ -1 +1 @@',
      '-A=OLD',
      '+A=SECRETVALUE',
      '',
    ].join('\n')
    for (const text of [plain, `${diff}${plain}`]) {
      const result = withoutExcluded(text, report)
      expect(result.diff).not.toContain('SECRETVALUE')
      expect(result.excluded).toContain('server/secrets/key.env')
    }
  })
})

describe('semanticCheck', () => {
  it('keeps the notices of the guard on the findings they concern', async () => {
    const result = await semanticCheck(report, diff, {
      url: 'https://assist.test',
      token: 't',
      client: () =>
        fakeAssistClient({
          answer: () => ({
            findings: [
              {
                decision: 1,
                verdict: 'violated',
                quote: 'a rule that no record holds',
                evidence: { path: 'server/billing/charge.ts', text: '' },
                explanation: 'Invented.',
              },
              {
                decision: 2,
                verdict: 'at-risk',
                quote: 'Refunds within thirty days',
                evidence: {
                  path: 'server/billing/charge.ts',
                  text: '+export const refund = () => charge',
                },
                explanation: 'A refund without the charge it cancels.',
              },
              {
                decision: 1,
                verdict: 'violated',
                quote: 'and never twice',
                evidence: { path: 'server/billing/charge.ts', text: '' },
                explanation: 'A second charge.',
              },
            ],
          }),
        }),
    })
    expect(result).toMatchObject({
      status: 'done',
      rejected: 1,
      findings: [
        {
          decision: 2,
          title: 'Refunds within thirty days',
          line: 2,
          notices: [
            'The text of decision 2 was not sent: its quote cannot be checked.',
          ],
        },
        { decision: 1, title: 'Billing', line: null, notices: [] },
      ],
    })
  })

  it('reports a failure of the service without throwing', async () => {
    const result = await semanticCheck(report, diff, {
      url: 'http://assist.example.com',
      token: 't',
    })
    expect(result).toMatchObject({ status: 'failed' })
  })

  it('sends nothing when the change holds only excluded files', async () => {
    let sent = 0
    const result = await semanticCheck(
      report,
      moved.replace('similarity index 100%', 'similarity index 90%'),
      {
        url: 'https://assist.test',
        token: 't',
        client: () => ({
          suggest: () => {
            sent++
            return Promise.reject(new Error('not expected'))
          },
        }),
      }
    )
    expect(result).toEqual({
      status: 'skipped',
      reason: 'the change holds no code that compadr.yml lets the service read',
    })
    expect(sent).toBe(0)
  })
})
