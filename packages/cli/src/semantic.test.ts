import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AssistCapReachedError,
  AssistServiceError,
  fakeAssistClient,
  type FakeAnswer,
} from '@compadr/assist'
import { createFixtureRepo, type FixtureRepo } from '@compadr/engine/testing'
import { SemanticFindingsSchema, type CheckRequest } from '@compadr/format'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SEMANTIC_COMMENT_MARKER } from './check-command.ts'
import { main, type MainOptions } from './main.ts'

let fixture: FixtureRepo
let outside: string

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

beforeAll(() => {
  fixture = createFixtureRepo([
    {
      date: '2026-01-10T09:00:00Z',
      files: {
        'docs/adr/0001-billing.md': record(
          1,
          'Billing',
          'Charges go through `server/billing/charge.ts`, and never twice.'
        ),
        'server/billing/charge.ts': '// ADR-0001\nexport const charge = 1\n',
      },
    },
    {
      date: '2026-01-11T09:00:00Z',
      files: {
        'docs/adr/compadr.yml':
          'assist:\n  semantic: true\n  exclude:\n    - server/secrets\n',
      },
    },
    {
      date: '2026-01-12T09:00:00Z',
      files: {
        'server/billing/charge.ts':
          '// ADR-0001\nexport const charge = 1\nexport const again = charge\n',
        'server/secrets/key.ts': 'export const key = "do-not-send"\n',
      },
    },
  ])
  outside = mkdtempSync(join(tmpdir(), 'compadr-semantic-'))
})

afterAll(() => {
  fixture.remove()
  rmSync(outside, { recursive: true, force: true })
})

const diff = [
  'diff --git a/server/billing/charge.ts b/server/billing/charge.ts',
  '--- a/server/billing/charge.ts',
  '+++ b/server/billing/charge.ts',
  '@@ -2 +2,2 @@',
  ' export const charge = 1',
  '+export const again = charge',
  '',
].join('\n')

const removal = [
  'diff --git a/server/billing/charge.ts b/server/billing/charge.ts',
  'deleted file mode 100644',
  '--- a/server/billing/charge.ts',
  '+++ /dev/null',
  '@@ -1,2 +0,0 @@',
  '-// ADR-0001',
  '-export const charge = 1',
  '',
].join('\n')

const violation: FakeAnswer = request =>
  request.kind === 'check'
    ? {
        findings: [
          {
            decision: 1,
            verdict: 'violated',
            quote: 'and never twice',
            evidence: {
              path: 'server/billing/charge.ts',
              // A removed line first: the place is that of the added one.
              text: '-export const charge = 0\n+export const again = charge',
            },
            explanation:
              'The change charges a second time. Ask @billing. ![x](https://h.test/?q=1) about `@types/node` (or `a[0]`).',
          },
          {
            decision: 1,
            verdict: 'at-risk',
            quote: 'a sentence that the record does not hold',
            evidence: { path: 'server/billing/charge.ts', text: '' },
            explanation: 'Invented.',
          },
        ],
      }
    : undefined

const ON = {
  COMPADR_ASSIST_URL: 'https://assist.test',
  COMPADR_ASSIST_TOKEN: 't',
}

interface RunOptions {
  answer?: FakeAnswer
  env?: MainOptions['env']
  stdin?: string
  fail?: boolean
  /** The service answers 402: the customer is at its cap. */
  capped?: boolean
}

async function run(argv: string[], options: RunOptions = {}) {
  const out: string[] = []
  const err: string[] = []
  const sent: CheckRequest[] = []
  const code = await main(
    argv,
    { out: line => out.push(line), err: line => err.push(line) },
    {
      readStdin: () => Promise.resolve(options.stdin ?? diff),
      env: options.env ?? ON,
      assistClient: () => {
        const fake = fakeAssistClient({
          answer: options.answer ?? violation,
          now: () => new Date('2026-11-16T10:00:00Z'),
        })
        return {
          suggest: request => {
            if (request.kind === 'check') sent.push(request)
            if (options.fail) {
              return Promise.reject(
                new AssistServiceError('the service answered 502', 502)
              )
            }
            if (options.capped) {
              return Promise.reject(
                new AssistCapReachedError(
                  'the AI credits of 2026-11 are used: 4 of a cap of 4. Nothing was sent to the model: an administrator may raise the cap',
                  402
                )
              )
            }
            return fake.suggest(request)
          },
        }
      },
    }
  )
  return { code, out: out.join('\n'), err: err.join('\n'), sent }
}

describe('compadr check --semantic', () => {
  it('sends nothing when compadr.yml does not turn it on', async () => {
    const comment = join(outside, 'off.md')
    const result = await run([
      'check',
      fixture.path,
      '--ref',
      'HEAD~2',
      '--diff',
      '-',
      '--semantic',
      '--comment',
      comment,
    ])
    expect(result.code).toBe(0)
    expect(result.sent).toEqual([])
    expect(result.err).toContain(
      'Semantic check skipped: the semantic check is off for this repository'
    )
    expect(existsSync(comment)).toBe(false)
  })

  it('prints the findings that the guard keeps as notices, and writes the comment', async () => {
    const comment = join(outside, 'diff.md')
    const result = await run([
      'check',
      fixture.path,
      '--ref',
      'HEAD~1',
      '--diff',
      '-',
      '--semantic',
      '--comment',
      comment,
    ])
    expect(result.code, result.err).toBe(0)
    expect(result.sent).toHaveLength(1)
    expect(result.out).toContain(
      'server/billing/charge.ts:3  warning  semantic-violated  ADR 0001 (Billing) may be broken: "and never twice".'
    )
    expect(result.out).not.toContain('Invented')
    expect(result.err).toContain('1 removed by the guard')
    const text = readFileSync(comment, 'utf8')
    expect(text.startsWith(SEMANTIC_COMMENT_MARKER)).toBe(true)
    expect(text).toContain('#### ADR 0001 · Billing (violated)')
    expect(text).toContain('> and never twice')
    expect(text).toContain('`server/billing/charge.ts`, line 3:')
    expect(text).toContain('Ask &#64;billing.')
    expect(text).not.toContain('@billing')
    expect(text).toContain('\\!\\[x\\]\\(https://h.test/?q=1\\)')
    expect(text).not.toContain('![x]')
    expect(text).toContain('about `@types/node` \\(or `a[0]`\\).')
  })

  it('checks the commits since --base, without the excluded paths', async () => {
    const comment = join(outside, 'base.md')
    const findings = join(outside, 'base.findings.json')
    const result = await run([
      'check',
      fixture.path,
      '--base',
      'HEAD~1',
      '--format',
      'github',
      '--semantic',
      '--comment',
      comment,
      '--findings',
      findings,
    ])
    expect(result.code, result.err).toBe(0)
    expect(result.sent).toHaveLength(1)
    const written = SemanticFindingsSchema.parse(
      JSON.parse(readFileSync(findings, 'utf8'))
    )
    expect(written).toMatchObject({
      repository: { commit: fixture.git('rev-parse', 'HEAD').trim() },
      base: fixture.git('rev-parse', 'HEAD~1').trim(),
      rejected: 1,
      excluded: ['server/secrets/key.ts'],
      findings: [{ decision: 1, title: 'Billing', line: 3 }],
    })
    const request = result.sent[0]!
    expect(request.diff).toContain('+export const again = charge')
    expect(request.diff).not.toContain('server/secrets')
    expect(request.diff).not.toContain('do-not-send')
    expect(request.omittedFiles).toEqual([])
    expect(result.out).toContain(
      '::warning file=server/billing/charge.ts,line=3,title=compadr semantic-violated::'
    )
    expect(result.err).toContain('1 file(s) kept out by compadr.yml')
    expect(readFileSync(comment, 'utf8')).toContain(
      '1 changed file(s) stayed out, as compadr.yml asks.'
    )
  })

  it('keeps the exit code of the deterministic check', async () => {
    const result = await run(
      ['check', fixture.path, '--diff', '-', '--semantic'],
      { stdin: removal }
    )
    expect(result.code).toBe(1)
    expect(result.out).toContain('cited-path-removed')
  })

  it('says when the service fails, and the check stands', async () => {
    const comment = join(outside, 'failed.md')
    const findings = join(outside, 'failed.findings.json')
    const result = await run(
      [
        'check',
        fixture.path,
        '--diff',
        '-',
        '--semantic',
        '--comment',
        comment,
        '--findings',
        findings,
      ],
      { fail: true }
    )
    expect(existsSync(findings)).toBe(false)
    expect(result.code).toBe(0)
    expect(result.err).toContain(
      'Semantic check failed, the result above stands: the service answered 502'
    )
    expect(readFileSync(comment, 'utf8')).toContain(
      'The semantic check could not run'
    )
  })

  it('answers without the assist service at the cap, and says so', async () => {
    const comment = join(outside, 'capped.md')
    const findings = join(outside, 'capped.findings.json')
    const result = await run(
      [
        'check',
        fixture.path,
        '--diff',
        '-',
        '--semantic',
        '--comment',
        comment,
        '--findings',
        findings,
      ],
      { capped: true }
    )
    expect(result.code).toBe(0)
    expect(result.err).toContain(
      'Semantic check skipped: the AI credits of 2026-11 are used: 4 of a cap of 4'
    )
    expect(existsSync(findings)).toBe(false)
    expect(readFileSync(comment, 'utf8')).toContain(
      'The semantic check did not run: the AI credits of 2026-11 are used'
    )
    // The exit code stays the one of the deterministic check.
    const removed = await run(
      ['check', fixture.path, '--diff', '-', '--semantic'],
      { stdin: removal, capped: true }
    )
    expect(removed.code).toBe(1)
    expect(removed.out).toContain('cited-path-removed')
  })

  it('sends nothing without the address or the token of the service', async () => {
    for (const env of [{}, { COMPADR_ASSIST_URL: 'https://assist.test' }]) {
      const result = await run(
        ['check', fixture.path, '--diff', '-', '--semantic'],
        { env }
      )
      expect(result.code).toBe(0)
      expect(result.sent).toEqual([])
      expect(result.err).toContain('Semantic check skipped')
    }
  })

  it('needs a change, and --comment needs --semantic', async () => {
    const semantic = await run(['check', fixture.path, '--semantic'])
    expect(semantic.code).toBe(2)
    expect(semantic.err).toContain('--semantic needs the change')
    const comment = await run([
      'check',
      fixture.path,
      '--comment',
      join(outside, 'x.md'),
    ])
    expect(comment.code).toBe(2)
    expect(comment.err).toContain('--comment needs --semantic')
    const findings = await run([
      'check',
      fixture.path,
      '--findings',
      join(outside, 'x.json'),
    ])
    expect(findings.code).toBe(2)
    expect(findings.err).toContain('--findings needs --semantic')
  })
})
