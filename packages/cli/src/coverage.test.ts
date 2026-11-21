import { createFixtureRepo, type FixtureRepo } from '@compadr/engine/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { main } from './main.ts'

let fixture: FixtureRepo

beforeAll(() => {
  fixture = createFixtureRepo([
    {
      date: '2026-01-10T09:00:00Z',
      files: {
        'docs/adr/0001-billing.md': [
          '# 1. Billing',
          '',
          'Status: Accepted',
          '',
          '## Decision',
          '',
          'Charges go through `server/billing/charge.ts`.',
          '',
        ].join('\n'),
        'server/billing/charge.ts': '// ADR-0001\nexport {}\n',
        'web/app.ts': 'export {}\n',
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

describe('compadr coverage', () => {
  it('lists the zones under decisions, then the largest without', async () => {
    const { code, out } = await run(['coverage', fixture.path])
    expect(code).toBe(0)
    expect(out.slice(1)).toEqual([
      '2 zones: 1 strong, 0 partial, 0 thin, 0 folder-only, 1 none',
      '',
      'Zones under decisions:',
      '  strong   server/billing  1/1 files, 1 cross-checked  ADR-0001',
      '',
      'Largest zones without a decision on their files:',
      '  none        web  1 files',
    ])
  })

  it('writes the zones as JSON', async () => {
    const { out } = await run(['coverage', fixture.path, '--json'])
    expect(JSON.parse(out.join('\n'))).toMatchObject({
      zones: [
        { path: 'server/billing', coverage: 'strong', weight: 5 },
        { path: 'web', coverage: 'none' },
      ],
    })
  })

  it('needs one repository', async () => {
    const { code, err } = await run(['coverage'])
    expect(code).toBe(2)
    expect(err).toContain('coverage needs exactly one repository')
  })
})
