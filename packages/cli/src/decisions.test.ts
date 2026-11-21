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
          '# ADR 0001 — Pool the connections',
          '',
          '- **Status:** Accepted',
          '',
          'The pool lives in `src/db/pool.ts:1` and in `src/db`.',
          '',
        ].join('\n'),
        'docs/adr/0002-old-pool.md': [
          '# ADR 0002 — Old pool',
          '',
          '- **Status:** Superseded by ADR-0001',
          '',
        ].join('\n'),
        'src/db/pool.ts':
          'export function createPool() {}\n// ADR-0002: one pool.\n',
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
  return { code, out: out.join('\n'), err: err.join('\n') }
}

describe('compadr decisions', () => {
  it('lists the decisions in force of a file', async () => {
    const { code, out } = await run([
      'decisions',
      fixture.path,
      'src/db/pool.ts',
    ])
    expect(code).toBe(0)
    expect(out).toMatch(
      /^src\/db\/pool\.ts at HEAD \([0-9a-f]{8}\)\n\nIn force\n/
    )
    expect(out).toContain(
      [
        '  ADR-0001  Pool the connections',
        '      the record cites this file (line 1), cited 2026-01-10',
        '      the record cites the folder src/db, cited 2026-01-10',
        '      the file cites ADR-0002 on line 2',
        '      replaces ADR-0002',
      ].join('\n')
    )
  })

  it('writes JSON and reads an absolute path', async () => {
    const { code, out } = await run([
      'decisions',
      fixture.path,
      `${fixture.path}/src/db/pool.ts`,
      '--json',
    ])
    expect(code).toBe(0)
    const answer = JSON.parse(out) as {
      path: string
      inForce: { decision: number; replaces: number[] }[]
    }
    expect(answer.path).toBe('src/db/pool.ts')
    expect(answer.inForce).toMatchObject([{ decision: 1, replaces: [2] }])
  })

  it('says when a file has no decision or is not in the repository', async () => {
    const none = await run([
      'decisions',
      fixture.path,
      'docs/adr/0002-old-pool.md',
    ])
    expect(none.out).toContain('No decision is linked to this file.')
    const missing = await run(['decisions', fixture.path, 'src/missing.ts'])
    expect(missing.code).toBe(1)
    expect(missing.err).toBe(
      'compadr decisions: src/missing.ts is not in the repository at HEAD'
    )
    const usage = await run(['decisions', fixture.path])
    expect(usage.code).toBe(2)
    expect(usage.err).toContain('decisions needs a repository and a file')
  })
})
