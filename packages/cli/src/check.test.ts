import { createFixtureRepo, type FixtureRepo } from '@compadr/engine/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { main } from './main.ts'

let fixture: FixtureRepo

beforeAll(() => {
  fixture = createFixtureRepo([
    {
      date: '2026-01-10T09:00:00Z',
      files: {
        'docs/adr/0001-pool.md': [
          '# ADR 0001 — Pool',
          '',
          '- **Status:** Accepted',
          '',
          'See `src/pool.ts` and `src/gone.ts`.',
          '',
        ].join('\n'),
        'src/pool.ts': 'export {}\n',
      },
    },
    {
      date: '2026-02-10T09:00:00Z',
      files: {
        'docs/adr/0002-mail.md': [
          '# ADR 0002 — Mail, sent: daily',
          '',
          '- **Status:** Accepted',
          '',
          'See `src/mail.ts`.',
          '',
        ].join('\n'),
      },
    },
  ])
})

afterAll(() => fixture.remove())

async function run(argv: string[]) {
  const out: string[] = []
  const err: string[] = []
  const code = await main(argv, {
    out: line => out.push(line),
    err: line => err.push(line),
  })
  return { code, out, err: err.join('\n') }
}

describe('compadr check', () => {
  it('fails on every certain problem without a base', async () => {
    const { code, out } = await run(['check', fixture.path])
    expect(code).toBe(1)
    expect(out).toEqual([
      'docs/adr/0001-pool.md:5  path-missing  ADR 0001 cites `src/gone.ts`, which no longer exists',
      'docs/adr/0002-mail.md:5  path-missing  ADR 0002 cites `src/mail.ts`, which no longer exists',
      // The records have no rule that stands alone: notices, which do not fail.
      'docs/adr/0001-pool.md  warning  rule-missing  ADR 0001 has no rule that an agent can read alone: add compadr.rule to its record',
      'docs/adr/0002-mail.md  warning  rule-missing  ADR 0002 has no rule that an agent can read alone: add compadr.rule to its record',
      '✖ 2 problems (2 notices)',
    ])
  })

  it('counts only what the base does not have', async () => {
    const { code, out } = await run(['check', fixture.path, '--base', 'HEAD~1'])
    expect(code).toBe(1)
    expect(out).toEqual([
      'docs/adr/0002-mail.md:5  path-missing  ADR 0002 cites `src/mail.ts`, which no longer exists',
      // The notice of 0001 is in the base too: only the new one shows.
      'docs/adr/0002-mail.md  warning  rule-missing  ADR 0002 has no rule that an agent can read alone: add compadr.rule to its record',
      '✖ 1 problem since HEAD~1 (1 already in HEAD~1, not counted; 1 notice)',
    ])
  })

  it('passes when the base has the same problems', async () => {
    const { code, out } = await run([
      'check',
      fixture.path,
      '--ref',
      'HEAD~1',
      '--base',
      'HEAD~1',
    ])
    expect(code).toBe(0)
    expect(out).toEqual([
      '✔ No new problem since HEAD~1 (1 already in HEAD~1, not counted)',
    ])
  })

  it('writes GitHub annotations', async () => {
    const { out } = await run([
      'check',
      fixture.path,
      '--base',
      'HEAD~1',
      '--format',
      'github',
    ])
    expect(out[0]).toBe(
      '::error file=docs/adr/0002-mail.md,line=5,title=compadr path-missing::ADR 0002 cites `src/mail.ts`, which no longer exists'
    )
    // A notice is a warning, which does not fail the job.
    expect(out[1]).toBe(
      '::warning file=docs/adr/0002-mail.md,title=compadr rule-missing::ADR 0002 has no rule that an agent can read alone: add compadr.rule to its record'
    )
  })

  it('refuses an unknown format and a base that is not a commit', async () => {
    const format = await run(['check', fixture.path, '--format', 'xml'])
    expect(format.code).toBe(2)
    expect(format.err).toContain('--format xml is not one of text, github')
    const base = await run(['check', fixture.path, '--base', 'nowhere'])
    expect(base.code).toBe(2)
    expect(base.err).toContain('--base nowhere is not a commit')
  })
})

describe('compadr check --diff', () => {
  async function runDiff(argv: string[], diff: string) {
    const out: string[] = []
    const err: string[] = []
    const code = await main(
      argv,
      { out: line => out.push(line), err: line => err.push(line) },
      { readStdin: () => Promise.resolve(diff) }
    )
    return { code, out, err: err.join('\n') }
  }

  const removePool = [
    'diff --git a/src/pool.ts b/src/pool.ts',
    'deleted file mode 100644',
    '--- a/src/pool.ts',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-export {}',
    '',
  ].join('\n')

  const citeUnknown = [
    'diff --git a/src/queue.ts b/src/queue.ts',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/src/queue.ts',
    '@@ -0,0 +1,2 @@',
    '+// ADR-0009',
    '+export {}',
    '',
  ].join('\n')

  it('fails on a change that removes a cited path', async () => {
    const { code, out } = await runDiff(
      ['check', fixture.path, '--diff', '-'],
      removePool
    )
    expect(out).toEqual([
      'docs/adr/0001-pool.md:5  cited-path-removed  ADR 0001 cites `src/pool.ts`, which the change removes',
      '✖ 1 problem in 1 changed file',
    ])
    expect(code).toBe(1)
  })

  it('writes an annotation for a citation of an unknown decision', async () => {
    const { code, out } = await runDiff(
      ['check', fixture.path, '--diff', '-', '--format', 'github'],
      citeUnknown
    )
    expect(out).toEqual([
      '::error file=src/queue.ts,line=1,title=compadr unknown-decision-cited::The change cites ADR 0009, which does not exist',
      '✖ 1 problem in 1 changed file',
    ])
    expect(code).toBe(1)
  })

  it('passes on a change that no decision cites', async () => {
    const { code, out } = await runDiff(
      ['check', fixture.path, '--diff', '-'],
      citeUnknown.replace('// ADR-0009', '// queue')
    )
    expect(out).toEqual(['✔ No problem in 1 changed file'])
    expect(code).toBe(0)
  })

  it('says that an empty diff checks nothing', async () => {
    const { code, out, err } = await runDiff(
      ['check', fixture.path, '--diff', '-'],
      ''
    )
    expect(code).toBe(0)
    expect(out).toEqual([])
    expect(err).toBe('compadr check: the diff is empty, nothing was checked')
  })

  it('refuses a diff that holds no file', async () => {
    const { code, err } = await runDiff(
      ['check', fixture.path, '--diff', '-'],
      'fatal: bad revision\n'
    )
    expect(code).toBe(2)
    expect(err).toContain('--diff - holds no file of a unified diff')
  })

  it('refuses --diff with --base', async () => {
    const { code, err } = await runDiff(
      ['check', fixture.path, '--diff', '-', '--base', 'HEAD~1'],
      ''
    )
    expect(code).toBe(2)
    expect(err).toContain('--diff and --base cannot be used together')
  })
})

describe('compadr check --diff on cited lines', () => {
  let cited: FixtureRepo

  beforeAll(() => {
    cited = createFixtureRepo([
      {
        date: '2026-01-10T09:00:00Z',
        files: {
          'docs/adr/0001-pool.md': [
            '# ADR 0001 — Pool',
            '',
            '- **Status:** Accepted',
            '',
            'See `src/pool.ts:2-3`.',
            '',
          ].join('\n'),
          'src/pool.ts':
            'export const a = 1\nexport const b = 2\nexport const c = 3\n',
        },
      },
    ])
  })

  afterAll(() => cited.remove())

  it('warns on cited lines that the change modifies, without failing', async () => {
    const out: string[] = []
    const code = await main(
      ['check', cited.path, '--diff', '-', '--format', 'github'],
      { out: line => out.push(line), err: () => undefined },
      {
        readStdin: () =>
          Promise.resolve(
            [
              '--- a/src/pool.ts',
              '+++ b/src/pool.ts',
              '@@ -2 +2 @@',
              '-export const b = 2',
              '+export const b = 20',
              '',
            ].join('\n')
          ),
      }
    )
    expect(out).toEqual([
      '::warning file=docs/adr/0001-pool.md,line=5,title=compadr cited-lines-changed::ADR 0001 cites `src/pool.ts:2-3`, whose lines the change modifies: reread the decision',
      '✔ No problem in 1 changed file (1 cited block to review)',
    ])
    expect(code).toBe(0)
  })
})
