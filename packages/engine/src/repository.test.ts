import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GitCommandFailedError } from './git.ts'
import { Repository, toTimestamp } from './repository.ts'
import { createFixtureRepo, type FixtureRepo } from './testing/fixture-repo.ts'

let fixture: FixtureRepo

beforeAll(() => {
  fixture = createFixtureRepo([
    {
      date: '2026-01-10T09:00:00Z',
      files: {
        'docs/adr/0001-record.md': '# 1. Record\n\nStatus: accepted\n',
        'server/src/pool.ts': 'export const size = 1\n',
      },
    },
    {
      date: '2026-03-05T14:30:00Z',
      files: {
        'docs/adr/0001-record.md':
          '# 1. Record\n\nStatus: accepted\n\nSee `server/src/pool.ts`.\n',
        'server/src/pool.ts': 'export const size = 2\n',
      },
    },
    {
      date: '2026-04-01T08:00:00Z',
      files: { 'web/index.html': '<p></p>\n' },
    },
  ])
})

afterAll(() => fixture.remove())

describe('Repository', () => {
  it('lists the tracked files and folders of the commit', async () => {
    const repo = await Repository.open(fixture.path)
    expect(repo.commit).toBe(fixture.git('rev-parse', 'HEAD').trim())
    expect([...repo.files].sort()).toEqual([
      'docs/adr/0001-record.md',
      'server/src/pool.ts',
      'web/index.html',
    ])
    expect([...repo.folders].sort()).toEqual([
      'docs',
      'docs/adr',
      'server',
      'server/src',
      'web',
    ])
    expect(repo.folderNames.has('src')).toBe(true)
  })

  it('finds the files and folders by their last segment', async () => {
    const repo = await Repository.open(fixture.path)
    expect(repo.filesNamed('pool.ts')).toEqual(['server/src/pool.ts'])
    expect(repo.foldersNamed('src')).toEqual(['server/src'])
    expect(repo.filesNamed('absent.ts')).toEqual([])
  })

  it('reads an older reference, not the working tree', async () => {
    const repo = await Repository.open(fixture.path, 'HEAD~2')
    expect(repo.files.has('web/index.html')).toBe(false)
    await expect(repo.read('server/src/pool.ts')).resolves.toBe(
      'export const size = 1\n'
    )
  })

  it('dates the last change of a file and of a folder', async () => {
    const repo = await Repository.open(fixture.path)
    await expect(repo.lastChange('server/src/pool.ts')).resolves.toBe(
      '2026-03-05T14:30:00Z'
    )
    await expect(repo.lastChange('web')).resolves.toBe('2026-04-01T08:00:00Z')
    await expect(repo.lastChange('absent.txt')).resolves.toBeNull()
  })

  it('dates each line by the commit that wrote it', async () => {
    const repo = await Repository.open(fixture.path)
    await expect(
      repo
        .lineOrigins('docs/adr/0001-record.md')
        .then(origins => origins.map(origin => origin.date))
    ).resolves.toEqual([
      '2026-01-10T09:00:00Z',
      '2026-01-10T09:00:00Z',
      '2026-01-10T09:00:00Z',
      '2026-03-05T14:30:00Z',
      '2026-03-05T14:30:00Z',
    ])
  })

  it('counts the lines of a file and dates one line', async () => {
    const repo = await Repository.open(fixture.path)
    await expect(repo.lineCount('docs/adr/0001-record.md')).resolves.toBe(5)
    await expect(repo.lineDate('docs/adr/0001-record.md', 5)).resolves.toBe(
      '2026-03-05T14:30:00Z'
    )
    await expect(repo.lineDate('docs/adr/0001-record.md', 1)).resolves.toBe(
      '2026-01-10T09:00:00Z'
    )
    await expect(
      repo.lineDate('docs/adr/0001-record.md', 99)
    ).resolves.toBeNull()
  })

  it('counts the commits that changed a file or a folder after a date', async () => {
    const repo = await Repository.open(fixture.path)
    const history = await repo.history('2026-01-01')
    expect(
      history.commitsSince('server/src/pool.ts', '2026-01-10T09:00:00Z')
    ).toBe(1)
    expect(history.commitsSince('server', '2026-01-01T00:00:00Z')).toBe(2)
    expect(history.commitsSince('web', '2026-04-01T08:00:00Z')).toBe(0)
    expect(history.commitsSince('absent.txt', '2026-01-01T00:00:00Z')).toBe(0)
    const recent = await repo.history('2026-03-01')
    expect(recent.commitsSince('server', '2026-01-01T00:00:00Z')).toBe(1)
  })

  it('refuses an unknown reference', async () => {
    await expect(
      Repository.open(fixture.path, 'no-such-branch')
    ).rejects.toBeInstanceOf(GitCommandFailedError)
  })

  it('treats a reference that looks like an option as a reference', async () => {
    await expect(Repository.open(fixture.path, '--all')).rejects.toBeInstanceOf(
      GitCommandFailedError
    )
  })

  it('leaves the repository unchanged', async () => {
    const before = fixture.git('status', '--porcelain', '--ignored')
    const repo = await Repository.open(fixture.path)
    await repo.read('web/index.html')
    await repo.lineOrigins('server/src/pool.ts')
    await repo.lastChange('server')
    expect(fixture.git('status', '--porcelain', '--ignored')).toBe(before)
  })
})

describe('toTimestamp', () => {
  it('writes a UTC date without milliseconds', () => {
    expect(toTimestamp(0)).toBe('1970-01-01T00:00:00Z')
  })
})

describe('Repository.lineCount', () => {
  it('counts a last line without newline', async () => {
    const small = createFixtureRepo([
      {
        date: '2026-01-10T09:00:00Z',
        files: { 'a.txt': 'a\nb', 'b.txt': 'a\nb\n', 'empty.txt': '' },
      },
    ])
    try {
      const repo = await Repository.open(small.path)
      await expect(repo.lineCount('a.txt')).resolves.toBe(2)
      await expect(repo.lineCount('b.txt')).resolves.toBe(2)
      await expect(repo.lineCount('empty.txt')).resolves.toBe(0)
    } finally {
      small.remove()
    }
  })
})

describe('Repository.history', () => {
  it('finds the commits on paths with non-ASCII characters or quotes', async () => {
    const named = createFixtureRepo([
      {
        date: '2026-01-10T09:00:00Z',
        files: { 'dé/é.ts': 'a\n', 'q"t.ts': 'a\n' },
      },
      {
        date: '2026-02-10T09:00:00Z',
        files: { 'dé/é.ts': 'b\n', 'q"t.ts': 'b\n' },
      },
    ])
    try {
      const repo = await Repository.open(named.path)
      expect(repo.files.has('dé/é.ts')).toBe(true)
      const history = await repo.history('2026-01-01')
      const january = '2026-01-10T09:00:00Z'
      expect(history.commitsSince('dé/é.ts', january)).toBe(1)
      expect(history.commitsSince('dé', january)).toBe(1)
      expect(history.commitsSince('q"t.ts', january)).toBe(1)
    } finally {
      named.remove()
    }
  })
})
