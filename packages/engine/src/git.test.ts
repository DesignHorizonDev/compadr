import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  GitCommandFailedError,
  GitCommandRejectedError,
  READ_ONLY_SUBCOMMANDS,
  changeBetween,
  forEachGitLine,
  runGit,
  type ReadOnlySubcommand,
} from './git.ts'

let repo: string

function git(...args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'compadr-engine-'))
  git('init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'README.md'), '# Fixture\n')
  git('add', 'README.md')
  git(
    '-c',
    'user.name=Compadr',
    '-c',
    'user.email=fixture@example.com',
    'commit',
    '-q',
    '-m',
    'Add the fixture'
  )
})

afterAll(() => {
  rmSync(repo, { recursive: true, force: true })
})

describe('READ_ONLY_SUBCOMMANDS', () => {
  it('lists exactly the reviewed read-only subcommands', () => {
    expect([...READ_ONLY_SUBCOMMANDS]).toEqual([
      'blame',
      'diff',
      'grep',
      'log',
      'ls-tree',
      'merge-base',
      'rev-parse',
      'show',
    ])
  })
})

describe('runGit', () => {
  it('returns the output of a read-only subcommand', async () => {
    await expect(runGit(repo, 'log', ['--format=%s'])).resolves.toBe(
      'Add the fixture\n'
    )
  })

  it('leaves the repository unchanged', async () => {
    const before = git('status', '--porcelain', '--ignored')
    await runGit(repo, 'ls-tree', ['-r', 'HEAD'])
    await runGit(repo, 'blame', ['--porcelain', 'HEAD', '--', 'README.md'])
    expect(git('status', '--porcelain', '--ignored')).toBe(before)
  })

  it('rejects a subcommand outside the list', async () => {
    await expect(
      runGit(repo, 'commit' as ReadOnlySubcommand, ['-m', 'x'])
    ).rejects.toBeInstanceOf(GitCommandRejectedError)
  })

  it.each([
    ['log', '--output=/tmp/compadr-leak'],
    ['show', '--output'],
    ['grep', '-Ocat'],
    ['grep', '--open-files-in-pager=cat'],
    ['grep', '--open-files=cat'],
    ['grep', '--open'],
    ['log', '--ext-diff'],
    ['show', '--textconv'],
    ['grep', '--textc'],
  ] as const)('rejects git %s %s', async (subcommand, option) => {
    await expect(runGit(repo, subcommand, [option])).rejects.toBeInstanceOf(
      GitCommandRejectedError
    )
  })

  it('runs git diff only without external diff programs and filters', async () => {
    for (const args of [['HEAD'], ['--no-ext-diff', 'HEAD']]) {
      await expect(runGit(repo, 'diff', args)).rejects.toBeInstanceOf(
        GitCommandRejectedError
      )
    }
    await expect(
      runGit(repo, 'diff', ['--no-ext-diff', '--no-textconv', 'HEAD'])
    ).resolves.toBe('')
  })

  it('accepts an option that only starts like a forbidden one', async () => {
    await expect(
      runGit(repo, 'grep', ['--text', '-l', 'Fixture', 'HEAD'])
    ).resolves.toBe('HEAD:README.md\n')
  })

  it('returns the output of an allowed non-zero exit code', async () => {
    await expect(
      runGit(repo, 'grep', ['-l', 'absent-word', 'HEAD'], {
        okExitCodes: [1],
      })
    ).resolves.toBe('')
  })

  it('reports a failure with its exit code and its error output', async () => {
    const failure = runGit(repo, 'rev-parse', ['--verify', 'no-such-ref'])
    await expect(failure).rejects.toBeInstanceOf(GitCommandFailedError)
    await expect(failure).rejects.toMatchObject({
      exitCode: 128,
      message: expect.stringContaining('git rev-parse failed') as string,
    })
  })
})

describe('runGit, on a repository whose configuration names programs', () => {
  let configured: string
  let marker: string

  beforeAll(() => {
    configured = mkdtempSync(join(tmpdir(), 'compadr-configured-'))
    marker = join(configured, 'ran')
    const program = join(configured, 'program.sh')
    writeFileSync(program, `#!/bin/sh\necho "$@" >> '${marker}'\ncat "$1"\n`)
    chmodSync(program, 0o755)
    const repoGit = (...args: string[]) =>
      execFileSync('git', ['-C', configured, ...args], { encoding: 'utf8' })
    repoGit('init', '-q', '-b', 'main')
    writeFileSync(join(configured, '.gitattributes'), '* diff=configured\n')
    writeFileSync(join(configured, 'a.md'), 'one\n')
    repoGit('add', '.')
    repoGit(
      '-c',
      'user.name=Compadr',
      '-c',
      'user.email=fixture@example.com',
      'commit',
      '-q',
      '-m',
      'Add a.md'
    )
    // A commit that carries a signature, so that git log checks it.
    const tree = repoGit('rev-parse', 'HEAD^{tree}').trim()
    const signed = [
      `tree ${tree}`,
      `parent ${repoGit('rev-parse', 'HEAD').trim()}`,
      'author Compadr <fixture@example.com> 1767000000 +0000',
      'committer Compadr <fixture@example.com> 1767000000 +0000',
      'gpgsig -----BEGIN PGP SIGNATURE-----',
      ' AAAA',
      ' -----END PGP SIGNATURE-----',
      '',
      'Signed',
      '',
    ].join('\n')
    const commit = execFileSync(
      'git',
      ['-C', configured, 'hash-object', '-t', 'commit', '-w', '--stdin'],
      { input: signed, encoding: 'utf8' }
    ).trim()
    repoGit('update-ref', 'refs/heads/main', commit)
    repoGit('config', 'diff.configured.textconv', program)
    repoGit('config', 'log.showSignature', 'true')
    repoGit('config', 'gpg.program', program)
  })

  afterAll(() => rmSync(configured, { recursive: true, force: true }))

  it('runs none of them in blame, log, show and diff', async () => {
    await runGit(configured, 'blame', ['--porcelain', 'HEAD', '--', 'a.md'])
    await runGit(configured, 'log', ['-p', '--format=%H', 'HEAD'])
    await runGit(configured, 'show', ['HEAD'])
    await runGit(configured, 'diff', [
      '--no-ext-diff',
      '--no-textconv',
      'HEAD~1',
      'HEAD',
    ])
    expect(existsSync(marker)).toBe(false)
  })
})

describe('changeBetween', () => {
  it('gives the diff of a branch since it left its base', async () => {
    const base = git('rev-parse', 'HEAD').trim()
    git('checkout', '-q', '-b', 'topic')
    writeFileSync(join(repo, 'topic.ts'), 'export const topic = 1\n')
    git('add', 'topic.ts')
    git(
      '-c',
      'user.name=Compadr',
      '-c',
      'user.email=fixture@example.com',
      'commit',
      '-q',
      '-m',
      'Add a topic'
    )
    const head = git('rev-parse', 'HEAD').trim()
    git('checkout', '-q', 'main')
    const before = git('status', '--porcelain', '--ignored')
    const diff = await changeBetween(repo, base, head)
    expect(diff).toContain('diff --git a/topic.ts b/topic.ts')
    expect(diff).toContain('+export const topic = 1')
    expect(git('status', '--porcelain', '--ignored')).toBe(before)
  })

  it('takes commit hashes only', () => {
    expect(() => changeBetween(repo, '--output=x', 'HEAD')).toThrow(
      GitCommandRejectedError
    )
  })
})

describe('forEachGitLine', () => {
  it('hands each line of the output, the last one included', async () => {
    const lines: string[] = []
    await forEachGitLine(repo, 'log', ['--format=%s%n%an', '-1'], line =>
      lines.push(line)
    )
    expect(lines).toEqual(['Add the fixture', 'Compadr'])
  })

  it('applies the same checks as runGit', () => {
    expect(() =>
      forEachGitLine(repo, 'grep', ['--open-files=cat', 'x'], () => {})
    ).toThrow(GitCommandRejectedError)
  })

  it('accepts an allowed exit code and reports another one', async () => {
    await expect(
      forEachGitLine(repo, 'grep', ['absent-word', 'HEAD'], () => {}, {
        okExitCodes: [1],
      })
    ).resolves.toBeUndefined()
    await expect(
      forEachGitLine(repo, 'rev-parse', ['--verify', 'no-such-ref'], () => {})
    ).rejects.toMatchObject({ exitCode: 128 })
  })
})
