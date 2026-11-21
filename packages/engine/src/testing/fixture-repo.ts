// Builds small git repositories for the tests, in a temporary folder. This
// helper writes and commits on purpose: it never touches a repository that
// the engine analyses outside the tests.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

export interface FixtureCommit {
  /** ISO date of the commit, used as author and committer date. */
  date: string
  /** Files to write. `null` deletes the file. */
  files: Record<string, string | null>
  message?: string
}

export interface FixtureRepo {
  path: string
  git: (...args: string[]) => string
  remove: () => void
}

export function createFixtureRepo(commits: FixtureCommit[]): FixtureRepo {
  const path = mkdtempSync(join(tmpdir(), 'compadr-fixture-'))
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', path, ...args], { encoding: 'utf8' })
  git('init', '-q', '-b', 'main')
  for (const [i, commit] of commits.entries()) {
    for (const [file, content] of Object.entries(commit.files)) {
      const target = join(path, file)
      if (content === null) {
        git('rm', '-q', '--', file)
      } else {
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, content)
        git('add', '--', file)
      }
    }
    execFileSync(
      'git',
      [
        '-C',
        path,
        '-c',
        'user.name=Compadr',
        '-c',
        'user.email=fixture@example.com',
        'commit',
        '-q',
        '--allow-empty',
        '-m',
        commit.message ?? `Commit ${i + 1}`,
      ],
      {
        env: {
          ...process.env,
          GIT_AUTHOR_DATE: commit.date,
          GIT_COMMITTER_DATE: commit.date,
        },
      }
    )
  }
  return {
    path,
    git,
    remove: () => rmSync(path, { recursive: true, force: true }),
  }
}
