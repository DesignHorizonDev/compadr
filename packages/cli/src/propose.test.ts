import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fakeAssistClient, type FakeAnswer } from '@compadr/assist'
import { createFixtureRepo, type FixtureRepo } from '@compadr/engine/testing'
import type { AssistRequest } from '@compadr/format'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { main } from './main.ts'

let fixture: FixtureRepo
let cache: string
let head: string

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
          'Charges go through `server/billing/charge.ts`, and never twice.'
        ),
        'docs/adr/0002-refunds.md': record(
          2,
          'Refunds',
          'Status: Accepted\n\n- Amends ADR-0001',
          'A refund cancels the charge it names, within thirty days.'
        ),
        'server/billing/charge.ts': '// ADR-0001\nexport const charge = 1\n',
        'docs/adr/compadr.yml': 'assist:\n  exclude:\n    - config/secrets\n',
      },
    },
    {
      date: '2026-01-11T09:00:00Z',
      files: {
        'server/billing/receipt.ts':
          'export const receipt = (id: string) => `receipt-${id}`\n',
        'config/secrets/keys.ts': 'export const key = "k"\n',
      },
    },
  ])
  // The runner of the CI has no identity: the draft takes the one of the
  // analysed repository.
  fixture.git('config', 'user.name', 'Draft Author')
  fixture.git('config', 'user.email', 'draft@example.com')
  head = fixture.git('rev-parse', 'HEAD').trim()
  cache = mkdtempSync(join(tmpdir(), 'compadr-propose-'))
})

afterAll(() => {
  fixture.remove()
  rmSync(cache, { recursive: true, force: true })
})

/** A draft of the service for the receipt of a charge. */
const receipt: FakeAnswer = () => ({
  notNeeded: null,
  title: 'Receipts of a charge',
  rule: 'Each charge gives one receipt, named after the charge.',
  amends: [1],
  supersedes: [],
  context: 'Customers ask for a proof of each charge.',
  decision: [
    {
      heading: 'One receipt per charge',
      text: '`server/billing/receipt.ts` names the receipt after the charge.',
    },
  ],
  consequences: 'Support finds a receipt from the charge alone.',
  codeRefs: ['server/billing/receipt.ts'],
})

async function run(
  argv: string[],
  /** null keeps the answer of the fake client, for another kind. */
  answer: FakeAnswer | null = receipt,
  stdin = ''
) {
  const out: string[] = []
  const err: string[] = []
  const sent: AssistRequest[] = []
  const code = await main(
    // The drafts stay outside the repository.
    argv.includes('--draft') || argv[0] === 'draft'
      ? [...argv, '--cache-dir', cache]
      : argv,
    { out: line => out.push(line), err: line => err.push(line) },
    {
      env: {
        COMPADR_ASSIST_URL: 'https://assist.test',
        COMPADR_ASSIST_TOKEN: 't',
      },
      today: () => '2026-11-18',
      readStdin: () => Promise.resolve(stdin),
      assistClient: () => {
        const fake = fakeAssistClient({
          ...(answer === null ? {} : { answer }),
          now: () => new Date('2026-11-18T10:00:00Z'),
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

function expectRepositoryUnchanged() {
  expect(fixture.git('rev-parse', 'HEAD').trim()).toBe(head)
  expect(fixture.git('status', '--porcelain')).toBe('')
  expect(fixture.git('branch', '--list').trim()).toBe('* main')
}

describe('compadr assist draft --draft', () => {
  it('writes the proposed record of a change into a local draft', async () => {
    const { code, out, err, sent } = await run([
      'assist',
      'draft',
      fixture.path,
      '--base',
      'HEAD~1',
      '--draft',
      'review',
    ])
    expect(code, err).toBe(0)
    expect(sent).toHaveLength(1)
    expect(sent[0]!.kind).toBe('draft')
    // The change as a pull request shows it, and nothing else.
    const diff = (sent[0] as { diff: string }).diff
    expect(diff).toContain('server/billing/receipt.ts')
    expect(diff).not.toContain('charge.ts')
    // compadr.yml keeps the secrets in the repository.
    expect(diff).not.toContain('config/secrets')
    expect(err).toContain(
      '◇ left out of the request, as assist.exclude of compadr.yml asks: config/secrets/keys.ts'
    )

    expect(out).toContain('docs(adr): propose ADR 0003')
    expect(out).toContain('docs/adr/0003-receipts-of-a-charge.md')
    expect(out).toContain('+# 3. Receipts of a charge')
    expect(out).toContain('+Status: Proposed')
    expect(out).toContain('+Amends ADR 0001.')
    expect(out).toContain('+### One receipt per charge')
    expect(out).toContain(
      '+  rule: Each charge gives one receipt, named after the charge.'
    )
    expect(err).toContain('✔ draft review: 1 commit.')
    expect(err).toContain('follows the last record of draft review:')
    expectRepositoryUnchanged()

    const show = await run(['draft', 'show', fixture.path, 'review'])
    expect(show.out).toContain('docs(adr): propose ADR 0003')
  })

  it('reads the records that the draft holds already', async () => {
    const args = [
      'assist',
      'draft',
      fixture.path,
      '--base',
      'HEAD~1',
      '--draft',
      'second',
    ]
    expect((await run(args)).code).toBe(0)
    const { code, out, err, sent } = await run(args, request => ({
      ...(receipt(request) as object),
      title: 'Copies of a receipt',
      rule: 'A copy of a receipt carries the word copy on each page.',
      amends: [3],
    }))
    expect(code, err).toBe(0)
    // The service and the guard see ADR 0003, written by the first run.
    expect(sent[0]).toMatchObject({ kind: 'draft', nextNumber: 4 })
    expect(err).toContain('0 item(s) rejected by the guard')
    expect(out).toContain('docs/adr/0004-copies-of-a-receipt.md')
    expect(out).toContain('+Amends ADR 0003.')
    expect(err).toContain('✔ draft second: 2 commits.')
    expectRepositoryUnchanged()
  })

  it('writes nothing when the change only applies a decision', async () => {
    const { code, err } = await run(
      ['assist', 'draft', fixture.path, '--base', 'HEAD~1', '--draft', 'none'],
      request => ({
        ...(receipt(request) as object),
        notNeeded: 'The change only applies ADR 0001.',
      })
    )
    expect(code).toBe(0)
    expect(err).toContain(
      'needs no new record, so the draft is unchanged: The change only applies ADR 0001.'
    )
    const list = await run(['draft', 'list', fixture.path])
    expect(list.out).not.toContain('none')
    expectRepositoryUnchanged()
  })

  it('says when a decision in force seems to say the same', async () => {
    const { code, err } = await run(
      ['assist', 'draft', fixture.path, '--base', 'HEAD~1'],
      request => ({
        ...(receipt(request) as object),
        title: 'Refunds within thirty days',
        rule: 'A refund is accepted within thirty days of the charge.',
        amends: [],
      })
    )
    expect(code).toBe(0)
    expect(err).toContain('◇ title: Decision 2 (Refunds) shares')
    // Named as amended, the decision is not close: it is the parent.
    const named = await run(
      ['assist', 'draft', fixture.path, '--base', 'HEAD~1'],
      request => ({
        ...(receipt(request) as object),
        title: 'Refunds within thirty days',
        rule: 'A refund is accepted within thirty days of the charge.',
        amends: [2],
      })
    )
    expect(named.err).not.toContain('shares')
  })

  it('sends nothing when every file of the change is excluded', async () => {
    const secret = [
      'diff --git a/config/secrets/keys.ts b/config/secrets/keys.ts',
      '--- a/config/secrets/keys.ts',
      '+++ b/config/secrets/keys.ts',
      '@@ -1 +1 @@',
      '-export const key = "k"',
      '+export const key = "l"',
      '',
    ].join('\n')
    for (const kind of ['draft', 'check']) {
      const { code, err, sent } = await run(
        ['assist', kind, fixture.path, '--diff', '-'],
        receipt,
        secret
      )
      expect(code).toBe(0)
      expect(err).toContain(
        'every file of the change stays in the repository, nothing was sent'
      )
      expect(sent).toEqual([])
    }
  })

  it('checks the change of a branch against its base', async () => {
    const { code, err, sent } = await run(
      ['assist', 'check', fixture.path, '--base', 'HEAD~1'],
      null
    )
    expect(code, err).toBe(0)
    expect(sent).toHaveLength(1)
    expect(sent[0]!.kind).toBe('check')
    const diff = (sent[0] as { diff: string }).diff
    expect(diff).toContain('server/billing/receipt.ts')
    expect(diff).not.toContain('config/secrets')
    expectRepositoryUnchanged()
  })

  it('sends nothing when the base holds the same files', async () => {
    const { code, err, sent } = await run([
      'assist',
      'draft',
      fixture.path,
      '--base',
      'HEAD',
    ])
    expect(code).toBe(0)
    expect(err).toContain('hold the same files, nothing was sent')
    expect(sent).toEqual([])
  })

  it('refuses the options that do not go together', async () => {
    const cases: [string[], string][] = [
      [
        ['check', fixture.path, '--base', 'HEAD~1', '--draft', 'x'],
        '--draft goes with assist draft',
      ],
      [
        [
          'draft',
          fixture.path,
          '--base',
          'HEAD~1',
          '--draft',
          'x',
          '--request',
        ],
        'writes no draft',
      ],
      [
        ['draft', fixture.path, '--base', 'HEAD~1', '--diff', '-'],
        '--diff and --base cannot be used together',
      ],
      [['draft', fixture.path, '--base', 'nowhere'], '--base nowhere is not'],
      [
        [
          'draft',
          fixture.path,
          '--base',
          'HEAD~1',
          '--draft',
          'refused',
          '--ref',
          'HEAD',
        ],
        '--ref only applies to a new draft',
      ],
    ]
    // The draft exists before --ref is refused on it.
    const created = await run([
      'assist',
      'draft',
      fixture.path,
      '--base',
      'HEAD~1',
      '--draft',
      'refused',
    ])
    expect(created.code, created.err).toBe(0)
    for (const [args, message] of cases) {
      const { code, err } = await run(['assist', ...args])
      expect(code, args.join(' ')).toBe(2)
      expect(err).toContain(message)
    }
  })
})
