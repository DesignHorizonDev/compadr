import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DriftReportSchema } from '@compadr/format'
import { createFixtureRepo, type FixtureRepo } from '@compadr/engine/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import packageJson from '../package.json' with { type: 'json' }
import { main } from './main.ts'

async function run(...argv: string[]) {
  const out: string[] = []
  const err: string[] = []
  const code = await main(argv, {
    out: line => out.push(line),
    err: line => err.push(line),
  })
  return { code, out, err }
}

describe('main', () => {
  it.each([[], ['--help'], ['-h']])(
    'prints the usage for %j',
    async (...argv) => {
      const { code, out, err } = await run(...argv)
      expect(code).toBe(0)
      expect(out.join('\n')).toMatch(/^Usage: compadr/)
      expect(err).toEqual([])
    }
  )

  it.each(['--version', '-v'])('prints the version for %s', async flag => {
    expect(await run(flag)).toEqual({
      code: 0,
      out: [packageJson.version],
      err: [],
    })
  })

  it('fails with exit code 2 on an unknown command', async () => {
    const { code, out, err } = await run('deploy')
    expect(code).toBe(2)
    expect(out).toEqual([])
    expect(err[0]).toBe('compadr: unknown command or option "deploy"')
  })
})

describe('compadr mcp', () => {
  it('prints its usage and needs one repository', async () => {
    const help = await run('mcp', '--help')
    expect(help.code).toBe(0)
    expect(help.out.join('\n')).toMatch(/^Usage: compadr mcp <repository>/)
    const missing = await run('mcp')
    expect(missing.code).toBe(2)
    expect(missing.err[0]).toBe('compadr mcp: mcp needs exactly one repository')
  })

  it('refuses a reference that is not a commit, before serving', async () => {
    const fixture = createFixtureRepo([
      { date: '2026-01-10T09:00:00Z', files: { 'a.txt': 'a\n' } },
    ])
    try {
      expect(await run('mcp', fixture.path, '--ref', 'nope-branch')).toEqual({
        code: 1,
        out: [],
        err: [`compadr mcp: nope-branch is not a commit of ${fixture.path}`],
      })
    } finally {
      fixture.remove()
    }
  })

  it('refuses a cache folder inside the repository', async () => {
    const fixture = createFixtureRepo([
      { date: '2026-01-10T09:00:00Z', files: { 'a.txt': 'a\n' } },
    ])
    try {
      const inside = join(fixture.path, '.cache')
      const answer = await run('mcp', fixture.path, '--cache-dir', inside)
      expect(answer.code).toBe(2)
      expect(answer.err[0]).toBe(
        `compadr mcp: --cache-dir ${inside} is inside the analysed repository`
      )
      const both = await run(
        'mcp',
        fixture.path,
        '--no-cache',
        '--cache-dir',
        '/tmp/x'
      )
      expect(both.code).toBe(2)
      expect(both.err[0]).toBe(
        'compadr mcp: --no-cache does not go with --cache-dir'
      )
    } finally {
      fixture.remove()
    }
  })
})

describe('compadr drift', () => {
  let fixture: FixtureRepo
  let outside: string

  beforeAll(() => {
    fixture = createFixtureRepo([
      {
        date: '2026-01-10T09:00:00Z',
        files: {
          'docs/adr/0001-base.md':
            '# 1. Base\n\nStatus: accepted\n\nSee `src/gone.ts`.\n',
          'decisions/0001-other.md': '# 1. Other\n\nStatus: proposed\n',
        },
      },
    ])
    outside = mkdtempSync(join(tmpdir(), 'compadr-out-'))
  })

  afterAll(() => {
    fixture.remove()
    rmSync(outside, { recursive: true, force: true })
  })

  it('prints the report on the standard output', async () => {
    const { code, out, err } = await run(
      'drift',
      fixture.path,
      '--name',
      'fixture'
    )
    expect(code).toBe(0)
    expect(err).toEqual([])
    const report = DriftReportSchema.parse(JSON.parse(out.join('\n')))
    expect(report.repository.name).toBe('fixture')
    expect(report.generator.version).toBe(packageJson.version)
    expect(report.signals.map(s => s.type)).toEqual([
      'path-missing',
      'decision-without-code',
    ])
  })

  it('writes the report to a file outside the repository', async () => {
    const before = fixture.git('status', '--porcelain', '--ignored')
    const { code, out, err } = await run(
      'drift',
      fixture.path,
      '--adr-dir',
      'decisions',
      '--ref',
      'main',
      '--out',
      join(outside, 'drift.json')
    )
    expect(code).toBe(0)
    expect(out).toEqual([])
    expect(err[0]).toMatch(/drift\.json: 1 decisions, 0 signals \(0 broken\)/)
    const report = DriftReportSchema.parse(
      JSON.parse(readFileSync(join(outside, 'drift.json'), 'utf8'))
    )
    expect(report.repository).toMatchObject({
      ref: 'main',
      adrDir: 'decisions',
    })
    expect(fixture.git('status', '--porcelain', '--ignored')).toBe(before)
  })

  it.each([
    ['in the repository', (repo: string) => join(repo, 'drift.json')],
    [
      'in a new folder of the repository',
      (repo: string) => join(repo, 'new', 'drift.json'),
    ],
  ])('refuses to write %s', async (_, target) => {
    const { code, err } = await run(
      'drift',
      fixture.path,
      '--out',
      target(fixture.path)
    )
    expect(code).toBe(2)
    expect(err[0]).toMatch(/is inside the analysed repository/)
    expect(fixture.git('status', '--porcelain', '--ignored')).toBe('')
  })

  it('refuses to write through a link to the repository', async () => {
    const link = join(outside, 'link')
    symlinkSync(fixture.path, link)
    const { code } = await run(
      'drift',
      fixture.path,
      '--out',
      join(link, 'drift.json')
    )
    expect(code).toBe(2)
  })

  it.each([
    ['a tracked file', 'docs/adr/0001-base.md'],
    ['a missing file of the repository', 'new.json'],
    ['a file outside the repository', '../elsewhere.json'],
  ])('refuses an --out link to %s', async (_, target) => {
    const link = join(outside, `link-${target.replace(/\W/g, '-')}.json`)
    symlinkSync(join(fixture.path, target), link)
    const { code, err } = await run('drift', fixture.path, '--out', link)
    expect(code).toBe(2)
    expect(err[0]).toMatch(/is a symbolic link/)
    expect(fixture.git('status', '--porcelain', '--ignored')).toBe('')
  })

  it('reports a write failure with exit code 1', async () => {
    const { code, err } = await run('drift', fixture.path, '--out', outside)
    expect(code).toBe(1)
    expect(err[0]).toMatch(/^compadr drift: cannot write .*EISDIR/)
  })

  it('fails when the folder holds no decision record', async () => {
    const { code, out, err } = await run(
      'drift',
      fixture.path,
      '--adr-dir',
      'nope'
    )
    expect(code).toBe(1)
    expect(out).toEqual([])
    expect(err).toEqual(['compadr drift: no decision record in nope at HEAD'])
  })

  it('reports a git failure with exit code 1', async () => {
    const { code, err } = await run(
      'drift',
      fixture.path,
      '--ref',
      'no-such-ref'
    )
    expect(code).toBe(1)
    expect(err[0]).toMatch(/^compadr drift: git rev-parse failed/)
  })

  it.each([
    [['drift'], 'drift needs exactly one repository'],
    [['drift', 'a', 'b'], 'drift needs exactly one repository'],
    [['drift', '.', '--unknown'], "Unknown option '--unknown'"],
  ])('fails with exit code 2 on %j', async (argv, message) => {
    const { code, err } = await run(...argv)
    expect(code).toBe(2)
    expect(err[0]).toContain(message)
  })
})
