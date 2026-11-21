import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fakeAssistClient } from '@compadr/assist'
import { createFixtureRepo, type FixtureRepo } from '@compadr/engine/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { main } from './main.ts'

let fixture: FixtureRepo
let outside: string

const record = (head: string[], text: string) =>
  [...head, '', '## Decision', '', text, ''].join('\n')

beforeAll(() => {
  fixture = createFixtureRepo([
    {
      date: '2026-01-10T09:00:00Z',
      files: {
        'docs/adr/0001-billing.md': record(
          [
            '---',
            'compadr:',
            '  feature: billing',
            '---',
            '# ADR 0001 — Billing',
            '',
            '- **Status:** Accepted',
          ],
          'An invoice is sent on the first day of the month.'
        ),
        'docs/adr/0002-daily.md': record(
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
          ],
          'An invoice is sent on the day of the order.'
        ),
        'docs/adr/features.yml':
          '# Features\nbilling:\n  label: Billing\n  main: 1\n',
      },
    },
    {
      date: '2026-01-11T09:00:00Z',
      files: {
        'docs/adr/0002-daily.md': record(
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
          ],
          'An invoice is sent on the day of the order, or the next day.'
        ),
      },
    },
  ])
  fixture.git('config', 'user.name', 'Rules')
  fixture.git('config', 'user.email', 'rules@example.com')
  outside = mkdtempSync(join(tmpdir(), 'compadr-rules-'))
})

afterAll(() => {
  fixture.remove()
  rmSync(outside, { recursive: true, force: true })
})

async function run(argv: string[]) {
  const out: string[] = []
  const err: string[] = []
  const code = await main(
    argv,
    { out: line => out.push(line), err: line => err.push(line) },
    {
      env: {
        COMPADR_ASSIST_URL: 'https://assist.test',
        COMPADR_ASSIST_TOKEN: 't',
      },
      assistClient: () =>
        fakeAssistClient({ now: () => new Date('2026-11-16T10:00:00Z') }),
      today: () => '2026-11-16',
    }
  )
  return { code, out: out.join('\n'), err: err.join('\n') }
}

describe('compadr rules', () => {
  it('validates a suggestion on the chain it answers', async () => {
    const suggestion = join(outside, 'rules.json')
    const consolidated = await run([
      'assist',
      'consolidate',
      fixture.path,
      '--ref',
      'HEAD~1',
      '--decision',
      '1',
      '--out',
      suggestion,
    ])
    expect(consolidated.code, consolidated.err).toBe(0)
    const result = await run([
      'rules',
      fixture.path,
      '--ref',
      'HEAD~1',
      '--feature',
      'billing',
      '--suggestion',
      suggestion,
    ])
    expect(result.code, result.err).toBe(0)
    expect(result.out).toContain(
      'docs(adr): validate the rules in force of Billing'
    )
    expect(result.out).toContain('+  rules:')
    expect(result.out).toContain('+    validated: 2026-11-16')
    expect(result.out).toMatch(/\+ {8}hash: sha256:[0-9a-f]{16}/)
    // The comment and the entry stay as they are.
    expect(result.out).not.toMatch(/^-(# Features| {2}label)/m)
  })

  it('refuses a suggestion made on another state of the chain', async () => {
    const suggestion = join(outside, 'old.json')
    await run([
      'assist',
      'consolidate',
      fixture.path,
      '--ref',
      'HEAD~1',
      '--decision',
      '1',
      '--out',
      suggestion,
    ])
    const result = await run([
      'rules',
      fixture.path,
      '--feature',
      'billing',
      '--suggestion',
      suggestion,
    ])
    expect(result.code).toBe(1)
    expect(result.err).toContain(
      'the suggestion does not answer the chain of ADR 0001 at commit'
    )
  })

  it('names what it cannot use', async () => {
    const other = join(outside, 'other.json')
    writeFileSync(other, '{"suggestion": {"kind": "plain"}}')
    const unknown = await run([
      'rules',
      fixture.path,
      '--feature',
      'shipping',
      '--suggestion',
      other,
    ])
    expect(unknown.code).toBe(1)
    expect(unknown.err).toContain('the repository declares no feature shipping')
    const wrong = await run([
      'rules',
      fixture.path,
      '--feature',
      'billing',
      '--suggestion',
      other,
    ])
    expect(wrong.err).toContain('the file holds no assist suggestion')
    const usage = await run(['rules', fixture.path, '--feature', 'billing'])
    expect(usage.code).toBe(2)
  })
})
