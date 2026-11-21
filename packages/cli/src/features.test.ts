import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFixtureRepo, type FixtureRepo } from '@compadr/engine/testing'
import { parseAdr, parseFeatureGlossary } from '@compadr/format'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { main } from './main.ts'
import { runCommand, type CommandRunner } from './publish.ts'

function record(number: number, title: string, amends: number[] = []) {
  return [
    `# ADR ${String(number).padStart(4, '0')} — ${title}`,
    '',
    '- **Status:** Accepted',
    ...amends.map(n => `- Amends ADR ${String(n).padStart(4, '0')}.`),
    '',
    '## Decision',
    '',
    `${title} is decided.`,
    '',
  ].join('\n')
}

const FILES = {
  'docs/adr/0001-billing.md': record(1, 'Billing'),
  'docs/adr/0002-daily-invoices.md': record(2, 'Daily invoices', [1]),
  'docs/adr/0003-partial-refunds.md': record(3, 'Partial refunds', [1]),
  'docs/adr/0004-credit-notes.md': record(4, 'Credit notes', [1]),
  'docs/adr/0005-exports.md': record(5, 'Exports'),
}

let fixture: FixtureRepo
let remote: string
let scratch: string

beforeAll(() => {
  fixture = createFixtureRepo([{ date: '2026-01-10T09:00:00Z', files: FILES }])
  remote = mkdtempSync(join(tmpdir(), 'compadr-remote-'))
  scratch = mkdtempSync(join(tmpdir(), 'compadr-plan-'))
  execFileSync('git', ['init', '--quiet', '--bare', remote])
  fixture.git('remote', 'add', 'origin', remote)
  fixture.git('config', 'user.name', 'Plan Author')
  fixture.git('config', 'user.email', 'plan@example.com')
})

afterAll(() => {
  fixture.remove()
  rmSync(remote, { recursive: true, force: true })
  rmSync(scratch, { recursive: true, force: true })
})

let status: string
beforeEach(() => {
  status = fixture.git('status', '--porcelain', '--ignored')
})

async function run(argv: string[], runner: CommandRunner = runCommand) {
  const out: string[] = []
  const err: string[] = []
  const code = await main(
    argv,
    { out: line => out.push(line), err: line => err.push(line) },
    { run: runner }
  )
  return { code, out: out.join('\n'), err: err.join('\n') }
}

function planFile(text: string): string {
  const file = join(scratch, `plan-${Math.random().toString(36).slice(2)}.yml`)
  writeFileSync(file, text)
  return file
}

const show = (ref: string) =>
  execFileSync('git', ['-C', remote, 'show', ref], { encoding: 'utf8' })

describe('compadr features', () => {
  it('writes the proposed grouping as a plan', async () => {
    const { code, out } = await run(['features', fixture.path])
    expect(code).toBe(0)
    expect(out).toContain(
      'proposed by Compadr from the relations between the records and the code files they cite'
    )
    expect(out).toContain(
      [
        'features:',
        '  billing:',
        '    label: "Billing"',
        '    main: 1 # Billing',
        '    details:',
        '      - 2 # Daily invoices',
        '      - 3 # Partial refunds',
        '      - 4 # Credit notes',
      ].join('\n')
    )
    expect(out).toContain('#   0005 Exports')
    expect(fixture.git('status', '--porcelain', '--ignored')).toBe(status)
  })

  it('pushes a branch with the records and the glossary', async () => {
    const plan = planFile(
      [
        'features:',
        '  billing:',
        '    label: Billing and invoices',
        '    main: 1',
        '    details: [2, 3]',
        '  exports:',
        '    main: 5',
        '',
      ].join('\n')
    )
    const { code, err } = await run([
      'features',
      fixture.path,
      '--plan',
      plan,
      '--branch',
      'compadr/features-test',
      '--body',
      'Grouped by hand.',
      '--push',
    ])
    expect(code).toBe(0)
    expect(err).toBe(`✔ branch compadr/features-test pushed to ${remote}`)
    expect(
      parseFeatureGlossary(show('compadr/features-test:docs/adr/features.yml'))
        .features
    ).toEqual([
      { id: 'billing', label: 'Billing and invoices', main: 1 },
      { id: 'exports', label: 'exports', main: 5 },
    ])
    const detail = 'docs/adr/0002-daily-invoices.md'
    expect(
      parseAdr(detail, show(`compadr/features-test:${detail}`))
    ).toMatchObject({ status: 'accepted', feature: 'billing', parent: 1 })
    const main = 'docs/adr/0001-billing.md'
    expect(parseAdr(main, show(`compadr/features-test:${main}`))).toMatchObject(
      { feature: 'billing', parent: null }
    )
    // 0004 is left out of the plan, so its record does not change.
    expect(show('compadr/features-test:docs/adr/0004-credit-notes.md')).toBe(
      FILES['docs/adr/0004-credit-notes.md']
    )
    expect(
      execFileSync(
        'git',
        [
          '-C',
          remote,
          'log',
          '-1',
          '--format=%an%n%b',
          'compadr/features-test',
        ],
        { encoding: 'utf8' }
      ).trim()
    ).toBe('Plan Author\nGrouped by hand.')
    expect(fixture.git('status', '--porcelain', '--ignored')).toBe(status)
  })

  it('lists every problem of a plan', async () => {
    const plan = planFile(
      [
        'features:',
        '  Billing:',
        '    main: 1',
        '  billing:',
        '    main: 1',
        '    details: [2, 2, 9, 1]',
        '  refunds:',
        '    main: 2',
        '  exports:',
        '    details: [5]',
        '',
      ].join('\n')
    )
    const { code, err } = await run(['features', fixture.path, '--plan', plan])
    expect(code).toBe(1)
    expect(err).toBe(
      [
        'compadr features: the plan has 5 problems:',
        '  - Billing: not a feature identifier (lowercase-words)',
        '  - billing: ADR 0009 is not in the folder',
        '  - billing: ADR 0001 is both main decision and detail',
        '  - refunds: ADR 0002 is already in billing',
        '  - exports: main is not a decision number',
      ].join('\n')
    )
  })

  it('opens a pull request with gh', async () => {
    const calls: string[][] = []
    const runner: CommandRunner = (program, args, cwd) => {
      if (program === 'gh') {
        calls.push(args)
        return Promise.resolve('https://github.com/acme/billing/pull/9\n')
      }
      return runCommand(program, args, cwd)
    }
    const plan = planFile('features:\n  billing:\n    main: 1\n')
    const { code, err } = await run(
      [
        'features',
        fixture.path,
        '--plan',
        plan,
        '--branch',
        'compadr/features-pr',
        '--open-pr',
        '--github',
        'acme/billing',
      ],
      runner
    )
    expect(code).toBe(0)
    expect(err).toBe('✔ pull request https://github.com/acme/billing/pull/9')
    expect(calls[0]).toEqual(
      expect.arrayContaining([
        '--base',
        'main',
        '--title',
        'docs(adr): group the decision records into 1 feature',
      ])
    )
  })

  it('refuses --out with --plan and an unreadable plan', async () => {
    const both = await run([
      'features',
      fixture.path,
      '--plan',
      'a.yml',
      '--out',
      'b.yml',
    ])
    expect(both.code).toBe(2)
    expect(both.err).toContain('--out writes a plan')
    const missing = await run([
      'features',
      fixture.path,
      '--plan',
      join(scratch, 'missing.yml'),
    ])
    expect(missing.code).toBe(1)
    expect(missing.err).toMatch(/^compadr features: cannot read /)
  })
})
