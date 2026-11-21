import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDriftReport } from '@compadr/engine'
import { createFixtureRepo, type FixtureRepo } from '@compadr/engine/testing'
import { parseAdr } from '@compadr/format'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { main } from './main.ts'
import { githubRepository, runCommand, type CommandRunner } from './publish.ts'

const BILLING_V1 = `export class BillingService {
  charge(amount: number) {
    const fee = amount * 0.1
    return amount + fee
  }
}
`

const BILLING_V2 = `import { log } from './log'

export class BillingService {
  charge(amount: number) {
    const fee = amount * 0.1
    return amount + fee
  }
}
`

const RECORD = 'docs/adr/0001-billing.md'

let fixture: FixtureRepo
let remote: string
let ids: Record<string, string>

beforeAll(async () => {
  fixture = createFixtureRepo([
    {
      date: '2026-01-10T09:00:00Z',
      files: {
        'src/billing.ts': BILLING_V1,
        [RECORD]: [
          '# 1. Billing',
          '',
          'Status: accepted',
          '',
          'The fee is computed in `src/billing.ts:3-4`.',
          'The old module was `src/gone.ts:5`.',
          '',
        ].join('\n'),
      },
    },
    { date: '2026-02-10T09:00:00Z', files: { 'src/billing.ts': BILLING_V2 } },
  ])
  remote = mkdtempSync(join(tmpdir(), 'compadr-remote-'))
  execFileSync('git', ['init', '--quiet', '--bare', remote])
  fixture.git('remote', 'add', 'origin', remote)
  // The temporary clone commits with the identity of the analysed repository.
  fixture.git('config', 'user.name', 'Anchor Author')
  fixture.git('config', 'user.email', 'anchor@example.com')
  const report = await createDriftReport(fixture.path, {
    generatorVersion: '0.0.0',
  })
  ids = Object.fromEntries(report.references.map(r => [r.text, r.id]))
})

afterAll(() => {
  fixture.remove()
  rmSync(remote, { recursive: true, force: true })
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

const remoteBranches = () =>
  execFileSync('git', ['-C', remote, 'branch', '--list'], { encoding: 'utf8' })

describe('compadr anchor', () => {
  it('shows the change and pushes nothing by default', async () => {
    const { code, out, err } = await run([
      'anchor',
      fixture.path,
      '--reference',
      ids['src/billing.ts:3-4']!,
    ])
    expect(code).toBe(0)
    expect(out).toContain('docs(adr): anchor 1 reference on symbols')
    expect(out).toContain(
      '+The fee is computed in `src/billing.ts#BillingService.charge`.'
    )
    expect(err).toMatch(/^Nothing was pushed\./)
    expect(remoteBranches()).toBe('')
    expectRepositoryUnchanged()
  })

  it('pushes a branch with the anchored record', async () => {
    const { code, err } = await run([
      'anchor',
      fixture.path,
      '--reference',
      ids['src/billing.ts:3-4']!,
      '--with-lines',
      '--branch',
      'compadr/anchor-test',
      '--push',
    ])
    expect(code).toBe(0)
    expect(err).toBe(`✔ branch compadr/anchor-test pushed to ${remote}`)
    const record = execFileSync(
      'git',
      ['-C', remote, 'show', `compadr/anchor-test:${RECORD}`],
      { encoding: 'utf8' }
    )
    expect(parseAdr(RECORD, record)).toMatchObject({
      status: 'accepted',
      anchors: {
        'src/billing.ts#BillingService.charge': {
          fingerprint: expect.stringMatching(/^sha256:/) as string,
          lines: { count: 2 },
        },
      },
    })
    expect(record).toContain('The old module was `src/gone.ts:5`.')
    expect(
      execFileSync(
        'git',
        [
          '-C',
          remote,
          'log',
          '-1',
          '--format=%an <%ae>',
          'compadr/anchor-test',
        ],
        { encoding: 'utf8' }
      ).trim()
    ).toBe('Anchor Author <anchor@example.com>')
    expectRepositoryUnchanged()
  })

  it('opens a pull request with gh', async () => {
    const calls: string[][] = []
    const runner: CommandRunner = (program, args, cwd) => {
      if (program === 'gh') {
        calls.push(args)
        return Promise.resolve('https://github.com/acme/billing/pull/7\n')
      }
      return runCommand(program, args, cwd)
    }
    const { code, err } = await run(
      [
        'anchor',
        fixture.path,
        '--reference',
        ids['src/billing.ts:3-4']!,
        '--branch',
        'compadr/anchor-pr',
        '--open-pr',
        '--github',
        'acme/billing',
      ],
      runner
    )
    expect(code).toBe(0)
    expect(err).toBe('✔ pull request https://github.com/acme/billing/pull/7')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual(
      expect.arrayContaining([
        'pr',
        'create',
        '--repo',
        'acme/billing',
        '--base',
        'main',
        '--head',
        'compadr/anchor-pr',
      ])
    )
    expect(remoteBranches()).toContain('compadr/anchor-pr')
    expectRepositoryUnchanged()
  })

  it('refuses a reference without proposal or unknown', async () => {
    for (const reference of [ids['src/gone.ts:5']!, '0009:1:1']) {
      const { code, err } = await run([
        'anchor',
        fixture.path,
        '--reference',
        reference,
      ])
      expect(code).toBe(1)
      expect(err).toMatch(
        /^compadr anchor: (?:reference .* has no anchor proposal|no reference 0009:1:1 in the report)$/
      )
    }
    expectRepositoryUnchanged()
  })

  it('starts from a commit without needing a base when nothing is opened', async () => {
    const commit = fixture.git('rev-parse', 'HEAD~0').trim()
    const { code } = await run([
      'anchor',
      fixture.path,
      '--ref',
      commit,
      '--reference',
      ids['src/billing.ts:3-4']!,
    ])
    expect(code).toBe(0)
  })

  it('takes the base of a pull request from a branch only', async () => {
    const opened: string[][] = []
    const runner: CommandRunner = (program, args, cwd) => {
      if (program === 'gh') {
        opened.push(args)
        return Promise.resolve('https://github.com/acme/billing/pull/8\n')
      }
      return runCommand(program, args, cwd)
    }
    const commit = fixture.git('rev-parse', 'HEAD').trim()
    const refused = await run(
      [
        'anchor',
        fixture.path,
        '--ref',
        commit,
        '--reference',
        ids['src/billing.ts:3-4']!,
        '--branch',
        'compadr/anchor-sha',
        '--open-pr',
        '--github',
        'acme/billing',
      ],
      runner
    )
    expect(refused.code).toBe(2)
    expect(refused.err).toContain(`${commit} is not a branch: pass --base`)
    expect(remoteBranches()).not.toContain('compadr/anchor-sha')

    const accepted = await run(
      [
        'anchor',
        fixture.path,
        '--ref',
        'main',
        '--reference',
        ids['src/billing.ts:3-4']!,
        '--branch',
        'compadr/anchor-main',
        '--open-pr',
        '--github',
        'acme/billing',
      ],
      runner
    )
    expect(accepted.code).toBe(0)
    expect(opened[0]).toEqual(expect.arrayContaining(['--base', 'main']))
  })

  it('needs a GitHub repository to open a pull request', async () => {
    const { code, err } = await run([
      'anchor',
      fixture.path,
      '--reference',
      ids['src/billing.ts:3-4']!,
      '--branch',
      'compadr/anchor-no-github',
      '--open-pr',
    ])
    expect(code).toBe(1)
    expect(err).toMatch(/is not a GitHub repository: pass --github/)
  })

  it('needs a reference', async () => {
    const { code, err } = await run(['anchor', fixture.path])
    expect(code).toBe(2)
    expect(err).toContain('anchor needs at least one --reference')
    expect(err).toContain('Usage: compadr anchor')
  })
})

describe('githubRepository', () => {
  it.each([
    ['git@github.com:acme/billing.git', 'acme/billing'],
    ['https://github.com/acme/billing', 'acme/billing'],
    ['https://github.com/acme/billing.git', 'acme/billing'],
    ['ssh://git@github.com/acme/billing.git', 'acme/billing'],
    ['https://gitlab.com/acme/billing.git', null],
    ['/tmp/remote', null],
  ])('reads %s', (url, expected) => {
    expect(githubRepository(url)).toBe(expected)
  })
})
