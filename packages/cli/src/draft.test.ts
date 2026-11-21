import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { createFixtureRepo, type FixtureRepo } from '@compadr/engine/testing'
import type { DriftReport } from '@compadr/format'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { checkDraftName, DraftError, draftClonePath } from './draft.ts'
import { main } from './main.ts'
import { runCommand, type CommandRunner } from './publish.ts'

let fixture: FixtureRepo
let remote: string
let cacheDir: string
let reference: string

beforeAll(async () => {
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
  remote = mkdtempSync(join(tmpdir(), 'compadr-remote-'))
  execFileSync('git', ['init', '--quiet', '--bare', remote])
  fixture.git('remote', 'add', 'origin', remote)
  fixture.git('config', 'user.name', 'Draft Author')
  fixture.git('config', 'user.email', 'draft@example.com')
  cacheDir = mkdtempSync(join(tmpdir(), 'compadr-cache-'))
  const drift = await run(['drift', fixture.path])
  const report = JSON.parse(drift.out) as DriftReport
  const signal = report.signals.find(s => s.type === 'cited-line-changed')!
  reference = (signal as { reference: string }).reference
})

afterAll(() => {
  fixture.remove()
  rmSync(remote, { recursive: true, force: true })
  rmSync(cacheDir, { recursive: true, force: true })
})

let state: { status: string; branches: string }
beforeEach(() => {
  state = {
    status: fixture.git('status', '--porcelain', '--ignored'),
    branches: fixture.git('branch', '--list', '--all'),
  }
})

function expectRepositoryUnchanged() {
  expect(fixture.git('status', '--porcelain', '--ignored')).toBe(state.status)
  expect(fixture.git('branch', '--list', '--all')).toBe(state.branches)
}

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

const inCache = (argv: string[]) => [...argv, '--cache-dir', cacheDir]

describe('compadr drafts', () => {
  it('adds the corrections of two commands to one draft', async () => {
    const checked = await run(
      inCache([
        'mark-checked',
        fixture.path,
        '--reference',
        reference,
        '--draft',
        'review',
      ])
    )
    expect(checked.code).toBe(0)
    expect(checked.out).toContain('docs(adr): mark a reference as checked')
    expect(checked.out).toContain('+      at: 2026-02-10T09:00:00Z')
    expect(checked.err).toContain('✔ draft review: 1 commit.')

    const index = await run(
      inCache(['index', fixture.path, '--draft', 'review'])
    )
    expect(index.code).toBe(0)
    expect(index.out).toContain('docs/adr/INDEX.md')
    expect(index.err).toContain('✔ draft review: 2 commits.')
    expectRepositoryUnchanged()
  })

  it('reads the records at the tip of the draft', async () => {
    // The draft already holds the index: a second index finds it up to date.
    const again = await run(
      inCache(['index', fixture.path, '--draft', 'review'])
    )
    expect(again.code).toBe(0)
    expect(again.err).toContain('docs/adr/INDEX.md is up to date')
    const drift = await run(
      inCache(['drift', fixture.path, '--draft', 'review'])
    )
    const report = JSON.parse(drift.out) as DriftReport
    expect(report.repository.name).toBe(fixture.path.split('/').at(-1))
    expect(
      report.signals.some(s => 'reference' in s && s.reference === reference)
    ).toBe(false)
    expect(report.references.find(r => r.id === reference)?.checkedAt).toBe(
      '2026-02-10T09:00:00Z'
    )
  })

  it('lists and shows the draft', async () => {
    const list = await run(inCache(['draft', 'list', fixture.path]))
    const base = fixture.git('rev-parse', 'HEAD').trim().slice(0, 8)
    expect(list.out).toBe(`review  2 commits  from ${base} (main)`)

    const show = await run(inCache(['draft', 'show', fixture.path, 'review']))
    expect(show.code).toBe(0)
    expect(show.out).toContain(`Draft review, from ${base} (main)`)
    expect(show.out).toMatch(
      /[0-9a-f]{8} docs\(adr\): mark a reference as checked\n[0-9a-f]{8} docs\(adr\): list the decisions in force/
    )
    expect(show.out).toContain('docs/adr/0001-pool.md')
    expect(show.out).toContain(`- cited-line-changed ${reference}`)
    expectRepositoryUnchanged()
  })

  it('refuses the options of a branch, and --ref on an existing draft', async () => {
    const pushed = await run(
      inCache(['index', fixture.path, '--draft', 'review', '--push'])
    )
    expect(pushed.code).toBe(2)
    expect(pushed.err).toContain('--push does not go with --draft')
    const ref = await run(
      inCache(['index', fixture.path, '--draft', 'review', '--ref', 'HEAD'])
    )
    expect(ref.code).toBe(2)
    expect(ref.err).toContain('--ref only applies to a new draft')
    const name = await run(
      inCache(['index', fixture.path, '--draft', '../escape'])
    )
    expect(name.code).toBe(1)
    expect(name.err).toContain('is not a draft name')
    const inside = await run([
      'index',
      fixture.path,
      '--draft',
      'review',
      '--cache-dir',
      join(fixture.path, '.cache'),
    ])
    expect(inside.code).toBe(2)
    expect(inside.err).toContain('is inside the analysed repository')
    expectRepositoryUnchanged()
  })

  it('pushes the draft as one branch and opens one pull request', async () => {
    const calls: string[][] = []
    const runner: CommandRunner = (program, args, cwd) => {
      if (program === 'gh') {
        calls.push(args)
        return Promise.resolve('https://github.com/acme/pool/pull/3\n')
      }
      return runCommand(program, args, cwd)
    }
    const { code, err } = await run(
      inCache([
        'draft',
        'publish',
        fixture.path,
        'review',
        '--open-pr',
        '--github',
        'acme/pool',
      ]),
      runner
    )
    expect(code).toBe(0)
    expect(err).toContain('✔ pull request https://github.com/acme/pool/pull/3')
    const log = execFileSync(
      'git',
      ['-C', remote, 'log', '--format=%s%x09%an', 'compadr/review'],
      { encoding: 'utf8' }
    )
    expect(log.split('\n').slice(0, 2)).toEqual([
      'docs(adr): list the decisions in force\tDraft Author',
      'docs(adr): mark a reference as checked\tDraft Author',
    ])
    expect(calls).toHaveLength(1)
    const args = calls[0]!
    expect(args.slice(0, 8)).toEqual([
      'pr',
      'create',
      '--repo',
      'acme/pool',
      '--base',
      'main',
      '--head',
      'compadr/review',
    ])
    expect(args[9]).toBe('docs(adr): 2 corrections of the decision records')
    expect(args[11]).toContain('- docs(adr): mark a reference as checked')
    expectRepositoryUnchanged()
  })

  it('discards the draft', async () => {
    const { code, err } = await run(
      inCache(['draft', 'discard', fixture.path, 'review'])
    )
    expect(code).toBe(0)
    expect(err).toContain('✔ draft review discarded (2 commits)')
    const list = await run(inCache(['draft', 'list', fixture.path]))
    expect(list.out).toBe('')
    expect(list.err).toContain('No draft.')
    const show = await run(inCache(['draft', 'show', fixture.path, 'review']))
    expect(show.code).toBe(1)
    expect(show.err).toContain('no draft review')
  })

  it('needs a known command and a draft name', async () => {
    expect((await run(inCache(['draft', 'merge', fixture.path]))).code).toBe(2)
    expect((await run(inCache(['draft', 'show', fixture.path]))).code).toBe(2)
    expect(
      (await run(inCache(['draft', 'list', fixture.path, 'extra']))).code
    ).toBe(2)
  })
})

describe('drafts from a detached HEAD, with a relative origin', () => {
  it('copies a commit that no ref carries, and pushes to ../origin', async () => {
    const repo = createFixtureRepo([
      {
        date: '2026-01-10T09:00:00Z',
        files: {
          'docs/adr/0001-pool.md':
            '# ADR 0001 — Pool\n\n- **Status:** Accepted\n\nSee `src/pool.ts`.\n',
          'src/pool.ts': 'one\n',
        },
      },
    ])
    const origin = mkdtempSync(join(tmpdir(), 'compadr-origin-'))
    const cache = mkdtempSync(join(tmpdir(), 'compadr-cache-'))
    try {
      execFileSync('git', ['init', '--quiet', '--bare', origin])
      repo.git('remote', 'add', 'origin', `../${basename(origin)}`)
      repo.git('config', 'user.name', 'Draft Author')
      repo.git('config', 'user.email', 'draft@example.com')
      const draft = (name: string, command = 'index') =>
        run([command, repo.path, '--draft', name, '--cache-dir', cache])
      // The first draft makes the clone.
      expect((await draft('first')).code).toBe(0)
      repo.git('checkout', '--quiet', '--detach')
      repo.git('commit', '--quiet', '--allow-empty', '-m', 'detached')
      const detached = repo.git('rev-parse', 'HEAD').trim()
      const second = await draft('second')
      expect(second.err).toContain('✔ draft second: 1 commit.')
      const list = await run(['draft', 'list', repo.path, '--cache-dir', cache])
      // A detached HEAD names no branch for the pull request.
      expect(list.out).toContain(
        `second  1 commit  from ${detached.slice(0, 8)}`
      )
      expect(list.out).not.toContain(`${detached.slice(0, 8)} (`)

      const published = await run([
        'draft',
        'publish',
        repo.path,
        'first',
        '--cache-dir',
        cache,
      ])
      expect(published.code).toBe(0)
      expect(
        execFileSync('git', ['-C', origin, 'branch', '--list'], {
          encoding: 'utf8',
        })
      ).toContain('compadr/first')
      const noBase = await run([
        'draft',
        'publish',
        repo.path,
        'second',
        '--open-pr',
        '--github',
        'acme/pool',
        '--cache-dir',
        cache,
      ])
      expect(noBase.code).toBe(1)
      expect(noBase.err).toContain('has no base branch: pass --base <branch>')
    } finally {
      repo.remove()
      rmSync(origin, { recursive: true, force: true })
      rmSync(cache, { recursive: true, force: true })
    }
  })
})

describe('draft names and folders', () => {
  it('accepts plain names only', () => {
    expect(checkDraftName('review-2026.11_a')).toBe('review-2026.11_a')
    for (const name of ['', '-x', 'a/b', 'a..b', 'x.lock', 'x.', 'é']) {
      expect(() => checkDraftName(name)).toThrow(DraftError)
    }
  })

  it('gives each repository its own clone', () => {
    const a = draftClonePath('/cache', '/work/shop')
    expect(a).toMatch(/^\/cache\/drafts\/shop-[0-9a-f]{12}$/)
    expect(draftClonePath('/cache', '/other/shop')).not.toBe(a)
  })
})
