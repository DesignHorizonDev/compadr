import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fakeAssistClient, type FakeAnswer } from '@compadr/assist'
import { createFixtureRepo, type FixtureRepo } from '@compadr/engine/testing'
import {
  AssistRequestSchema,
  AssistSuggestionSchema,
  type AssistRequest,
} from '@compadr/format'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { main, type MainOptions } from './main.ts'

let fixture: FixtureRepo
let outside: string

const record = (number: number, title: string, header: string, text: string) =>
  [`# ${number}. ${title}`, '', header, '', '## Decision', '', text, ''].join(
    '\n'
  )

beforeAll(() => {
  fixture = createFixtureRepo([
    {
      date: '2026-01-10T09:00:00Z',
      files: {
        'docs/adr/0001-billing.md': record(
          1,
          'Billing',
          'Status: Accepted',
          'Charges go through `server/billing/charge.ts:1-2`, and never twice.'
        ),
        'docs/adr/0002-refunds.md': record(
          2,
          'Refunds',
          'Status: Accepted\n\n- Amends ADR-0001',
          'A refund cancels the charge it names, within thirty days.'
        ),
        'server/billing/charge.ts': '// ADR-0001\nexport const charge = 1\n',
        'docs/adr/0003-retries.md': record(
          3,
          'Retries',
          'Status: Proposed',
          'A failed charge is retried three times, then a person decides.'
        ),
        'server/billing/retry.ts': '// ADR-0003\nexport const retries = 3\n',
      },
    },
  ])
  outside = mkdtempSync(join(tmpdir(), 'compadr-assist-'))
})

afterAll(() => {
  fixture.remove()
  rmSync(outside, { recursive: true, force: true })
})

const diff = [
  'diff --git a/server/billing/charge.ts b/server/billing/charge.ts',
  '--- a/server/billing/charge.ts',
  '+++ b/server/billing/charge.ts',
  '@@ -2 +2 @@',
  '-export const charge = 1',
  '+export const charge = 2',
  '',
].join('\n')

interface RunOptions {
  /** Content that the fake service answers. */
  answer?: FakeAnswer
  env?: MainOptions['env']
}

async function run(argv: string[], options: RunOptions = {}) {
  const out: string[] = []
  const err: string[] = []
  const sent: AssistRequest[] = []
  const code = await main(
    argv,
    { out: line => out.push(line), err: line => err.push(line) },
    {
      readStdin: () => Promise.resolve(diff),
      env: options.env ?? {
        COMPADR_ASSIST_URL: 'https://assist.test',
        COMPADR_ASSIST_TOKEN: 't',
      },
      assistClient: () => {
        const fake = fakeAssistClient({
          answer: options.answer,
          now: () => new Date('2026-11-11T10:00:00Z'),
        })
        return {
          suggest: request => {
            sent.push(request)
            return fake.suggest(request)
          },
        }
      },
    }
  )
  return { code, out: out.join('\n'), err: err.join('\n'), sent }
}

describe('compadr assist', () => {
  it('answers the five kinds with a suggestion that passes the guard', async () => {
    const runs = [
      ['check', fixture.path, '--diff', '-'],
      ['draft', fixture.path, '--diff', '-'],
      ['consolidate', fixture.path, '--decision', '2'],
      ['plain', fixture.path, '--decision', '1'],
      ['accept', fixture.path, '--decision', '3'],
    ]
    for (const args of runs) {
      const { code, out, err, sent } = await run(['assist', ...args])
      expect(code, err).toBe(0)
      const outcome = JSON.parse(out) as {
        suggestion: unknown
        problems: unknown[]
        rejected: number
      }
      const suggestion = AssistSuggestionSchema.parse(outcome.suggestion)
      expect(suggestion).toMatchObject({ kind: args[0], status: 'suggested' })
      expect(outcome).toMatchObject({ problems: [], rejected: 0 })
      expect(sent).toHaveLength(1)
      expect(err).toContain('0 item(s) rejected by the guard')
    }
  })

  it('sends the decisions of the change and the chain of amendments', async () => {
    const check = await run(['assist', 'check', fixture.path, '--diff', '-'])
    const request = check.sent[0]!
    expect(request.kind).toBe('check')
    if (request.kind === 'check') {
      expect(request.decisions.map(d => d.number)).toEqual([1])
      expect(request.signals).toEqual([
        expect.objectContaining({ decision: 1, type: 'cited-lines-changed' }),
      ])
    }
    const consolidate = await run([
      'assist',
      'consolidate',
      fixture.path,
      '--decision',
      '2',
    ])
    const chain = consolidate.sent[0]!
    expect(
      chain.kind === 'consolidate' && chain.records.map(r => r.number)
    ).toEqual([1, 2])
  })

  it('removes what the guard rejects, and says so', async () => {
    const { code, out, err } = await run(
      ['assist', 'check', fixture.path, '--diff', '-'],
      {
        answer: () => ({
          findings: [
            {
              decision: 1,
              verdict: 'violated',
              quote: 'Charges go through and never twice, always.',
              evidence: {
                path: 'server/billing/charge.ts',
                text: '+export const charge = 2',
              },
              explanation: 'Invented quote.',
            },
            {
              decision: 1,
              verdict: 'at-risk',
              quote: 'and never twice.',
              evidence: {
                path: 'server/billing/charge.ts',
                text: '+export const charge = 2',
              },
              explanation: 'Real quote.',
            },
          ],
        }),
      }
    )
    expect(code).toBe(0)
    const outcome = JSON.parse(out) as {
      suggestion: { findings: { explanation: string }[] }
      problems: { code: string; item: string }[]
      rejected: number
    }
    expect(outcome.rejected).toBe(1)
    expect(outcome.problems).toEqual([
      expect.objectContaining({ code: 'quote-not-found', item: 'findings[0]' }),
    ])
    expect(outcome.suggestion.findings.map(f => f.explanation)).toEqual([
      'Real quote.',
    ])
    expect(err).toContain('1 item(s) rejected by the guard')
  })

  it('writes the request without sending it', async () => {
    const out = join(outside, 'request.json')
    const { code, sent } = await run([
      'assist',
      'plain',
      fixture.path,
      '--decision',
      '1',
      '--request',
      '--out',
      out,
    ])
    expect(code).toBe(0)
    expect(sent).toHaveLength(0)
    const request = AssistRequestSchema.parse(
      JSON.parse(readFileSync(out, 'utf8'))
    )
    expect(request).toMatchObject({ kind: 'plain', record: { number: 1 } })
  })

  it('sends nothing without the address of a service', async () => {
    const { code, err, sent } = await run(
      ['assist', 'check', fixture.path, '--diff', '-'],
      {
        env: {},
      }
    )
    expect(code).toBe(0)
    expect(sent).toHaveLength(0)
    expect(err).toContain('no assist service is configured')
  })

  it('refuses a missing token, kind, diff or decision', async () => {
    const cases: [string[], RunOptions, string][] = [
      [
        ['check', fixture.path, '--diff', '-'],
        { env: { COMPADR_ASSIST_URL: 'https://a.test' } },
        'COMPADR_ASSIST_TOKEN',
      ],
      [['guess', fixture.path], {}, 'assist needs a kind'],
      [['check', fixture.path], {}, 'needs the change: --diff or --base'],
      [['plain', fixture.path], {}, 'needs --decision'],
      [['plain', fixture.path, '--decision', '9'], {}, 'is not a decision'],
      [
        ['accept', fixture.path, '--decision', '1'],
        {},
        'assist accept reads a proposed decision, and 1 is accepted',
      ],
      [
        ['plain', fixture.path, '--decision', '1', '--diff', '-'],
        {},
        'not a change',
      ],
      [
        [
          'plain',
          fixture.path,
          '--decision',
          '1',
          '--out',
          join(fixture.path, 'x.json'),
        ],
        {},
        'inside the analysed repository',
      ],
    ]
    for (const [args, options, message] of cases) {
      const { code, err } = await run(['assist', ...args], options)
      expect(code, args.join(' ')).toBe(2)
      expect(err).toContain(message)
    }
  })
})
