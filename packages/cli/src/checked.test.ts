import { createFixtureRepo, type FixtureRepo } from '@compadr/engine/testing'
import type { DriftReport } from '@compadr/format'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { main } from './main.ts'

let fixture: FixtureRepo

beforeAll(() => {
  fixture = createFixtureRepo([
    {
      date: '2026-01-10T09:00:00Z',
      files: {
        'docs/adr/0001-pool.md':
          '# ADR 0001 — Pool\n\n- **Status:** Accepted\n\nSee `src/pool.ts:2`.\n',
        'src/pool.ts': 'one\ntwo\n',
      },
    },
    { date: '2026-02-10T09:00:00Z', files: { 'src/pool.ts': 'one\nTWO\n' } },
  ])
  // The branch of the correction takes the identity of the repository.
  fixture.git('config', 'user.name', 'Compadr')
  fixture.git('config', 'user.email', 'fixture@example.com')
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

describe('compadr mark-checked', () => {
  it('records the date of the checked commit in the record', async () => {
    const drift = await run(['drift', fixture.path])
    const report = JSON.parse(drift.out) as DriftReport
    const signal = report.signals.find(s => s.type === 'cited-line-changed')!
    const id = (signal as { reference: string }).reference
    const { code, out, err } = await run([
      'mark-checked',
      fixture.path,
      '--reference',
      id,
    ])
    expect(code).toBe(0)
    expect(out).toContain('docs(adr): mark a reference as checked')
    expect(out).toContain('+compadr:')
    expect(out).toContain('+  checked:')
    // Without --by, the name comes from git config user.name.
    expect(out).toContain(
      '+    src/pool.ts:2:\n+      at: 2026-02-10T09:00:00Z\n+      by: Compadr'
    )
    expect(err).toContain('Nothing was pushed')
  })

  it('records the person named by --by', async () => {
    const drift = await run(['drift', fixture.path])
    const report = JSON.parse(drift.out) as DriftReport
    const { code, out } = await run([
      'mark-checked',
      fixture.path,
      '--reference',
      report.references[0]!.id,
      '--by',
      'Ana Martin',
    ])
    expect(code).toBe(0)
    expect(out).toContain('+      by: Ana Martin')
  })

  it('refuses a reference that the report does not have', async () => {
    const { code, err } = await run([
      'mark-checked',
      fixture.path,
      '--reference',
      '0009:1:1',
    ])
    expect(code).toBe(1)
    expect(err).toContain('no reference 0009:1:1 in the report')
  })

  it('finds a reference by an identifier read before the record moved', async () => {
    const drift = await run(['drift', fixture.path])
    const report = JSON.parse(drift.out) as DriftReport
    const id = report.references[0]!.id
    expect(id).toBe('0001:src/pool.ts:2:1')
    // A feature added to the front matter moves every line of the body.
    const record = join(fixture.path, 'docs/adr/0001-pool.md')
    writeFileSync(
      record,
      `---\ncompadr:\n  feature: pool\n---\n${readFileSync(record, 'utf8')}`
    )
    fixture.git('commit', '-q', '-am', 'feature')
    const { code, out } = await run([
      'mark-checked',
      fixture.path,
      '--reference',
      id,
    ])
    expect(code).toBe(0)
    expect(out).toContain('+  checked:')
  })
})
