import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { extractReferences, resolvePath } from './references.ts'
import { Repository } from './repository.ts'
import { createFixtureRepo, type FixtureRepo } from './testing/fixture-repo.ts'

const folders = new Set(['server', 'src', 'web'])

describe('extractReferences', () => {
  it('reads paths with optional lines, and their position', () => {
    const markdown =
      'Intro\nSee `server/src/pool.ts:20-30` and `web/app.tsx:7`.\n`README.md`'
    expect(extractReferences(markdown, folders)).toEqual([
      {
        kind: 'path',
        text: 'server/src/pool.ts:20-30',
        path: 'server/src/pool.ts',
        lines: { start: 20, end: 30 },
        symbol: null,
        adrLine: 2,
        column: 5,
      },
      {
        kind: 'path',
        text: 'web/app.tsx:7',
        path: 'web/app.tsx',
        lines: { start: 7, end: 7 },
        symbol: null,
        adrLine: 2,
        column: 36,
      },
      {
        kind: 'path',
        text: 'README.md',
        path: 'README.md',
        lines: null,
        symbol: null,
        adrLine: 3,
        column: 1,
      },
    ])
  })

  it('reads an anchored path and its symbol', () => {
    expect(
      extractReferences(
        'See `server/src/pool.ts#Pool.acquire` and `notes#Draft`.',
        folders
      )
    ).toEqual([
      {
        kind: 'path',
        text: 'server/src/pool.ts#Pool.acquire',
        path: 'server/src/pool.ts',
        lines: null,
        symbol: 'Pool.acquire',
        adrLine: 1,
        column: 5,
      },
    ])
  })

  it('accepts a folder of the repository without extension', () => {
    expect(extractReferences('`server/jobs`', folders)).toMatchObject([
      { kind: 'path', path: 'server/jobs' },
    ])
  })

  it('removes ./ and ../ but keeps a leading dot of a folder', () => {
    expect(
      extractReferences(
        '`./server/a.ts` `../../server/b.ts` `.github/workflows/ci.yml`',
        folders
      ).map(reference => (reference.kind === 'path' ? reference.path : null))
    ).toEqual(['server/a.ts', 'server/b.ts', '.github/workflows/ci.yml'])
  })

  it.each([
    'yarn install --immutable',
    '/login',
    'try/catch',
    'https://example.com/a.ts',
    '$HOME/x.sh',
    '@compadr/format',
    '.env.example',
    'src/**/*.ts',
    'packages/server/dist/server.js',
    'node:fs',
    'a/b',
    '.md',
    '.claude/skills/x/SKILL.md',
  ])('ignores %s', text => {
    expect(extractReferences(`\`${text}\``, folders)).toEqual([])
  })

  it('reads each symbol once per record', () => {
    const markdown = '`searchLexical()` then `MAX_RETRIES`\n`searchLexical`'
    expect(extractReferences(markdown, folders)).toEqual([
      {
        kind: 'symbol',
        text: 'searchLexical()',
        symbol: 'searchLexical',
        adrLine: 1,
        column: 1,
      },
      {
        kind: 'symbol',
        text: 'MAX_RETRIES',
        symbol: 'MAX_RETRIES',
        adrLine: 1,
        column: 24,
      },
    ])
  })

  it('keeps a symbol or a path that starts like a URL scheme', () => {
    expect(
      extractReferences('`httpClient` `httpServer/index.ts`', folders)
    ).toMatchObject([
      { kind: 'symbol', symbol: 'httpClient' },
      { kind: 'path', path: 'httpServer/index.ts' },
    ])
  })

  it.each(['lowercase', 'Pascal', 'ok'])('ignores the word %s', word => {
    expect(extractReferences(`\`${word}\``, folders)).toEqual([])
  })
})

describe('resolvePath', () => {
  let fixture: FixtureRepo
  let repo: Repository

  beforeAll(async () => {
    fixture = createFixtureRepo([
      {
        date: '2026-01-10T09:00:00Z',
        files: {
          'server/src/pool.ts': '',
          'web/src/pool.ts': '',
          'web/src/app.tsx': '',
          'server/jobs/queue.ts': '',
        },
      },
    ])
    repo = await Repository.open(fixture.path)
  })

  afterAll(() => fixture.remove())

  it('keeps an exact file or folder', () => {
    expect(resolvePath(repo, 'server/src/pool.ts')).toEqual([
      'server/src/pool.ts',
    ])
    expect(resolvePath(repo, 'server/jobs')).toEqual(['server/jobs'])
  })

  it('matches every file that ends with a partial path', () => {
    expect(resolvePath(repo, 'pool.ts')).toEqual([
      'server/src/pool.ts',
      'web/src/pool.ts',
    ])
    expect(resolvePath(repo, 'src/app.tsx')).toEqual(['web/src/app.tsx'])
  })

  it('matches a folder by its end', () => {
    expect(resolvePath(repo, 'jobs')).toEqual(['server/jobs'])
  })

  it('returns nothing for a missing path', () => {
    expect(resolvePath(repo, 'server/src/gone.ts')).toEqual([])
  })
})
