import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { codeArea, readCorpus, type Corpus } from './read-corpus.ts'
import { Repository } from './repository.ts'
import { createFixtureRepo, type FixtureRepo } from './testing/fixture-repo.ts'

const RECORD = `# ADR 0001 — Pool the connections

- **Status:** Accepted
- **Date:** 2026-01-10

## Decision

The pool lives in \`server/src/db/pool.ts:1\` and uses \`createPool\`.
`

let fixture: FixtureRepo
let corpus: Corpus

beforeAll(async () => {
  fixture = createFixtureRepo([
    {
      date: '2026-01-10T09:00:00Z',
      files: {
        'docs/adr/0001-pool.md': RECORD,
        'docs/adr/README.md':
          '| ADR | Status |\n|---|---|\n| 0001 | Accepted |\n| 0002 | Proposed |\n',
        'docs/adr/template.md': '# ADR-00NN — Title\n',
        'server/src/db/pool.ts':
          'export function createPool() {}\n// ADR-0001: one pool per process.\n',
      },
    },
    {
      date: '2026-02-20T10:00:00Z',
      files: {
        'docs/adr/0001-pool.md': `${RECORD}\nLater note: see \`server/src/db/gone.ts\` and \`MissingThing\`.\n`,
        'docs/adr/0002-queue.md':
          '# ADR 0002 — Queue\n\n- **Status:** Proposed\n\nSee `server/jobs`.\n',
        'server/jobs/queue.ts': 'export const QUEUE_NAME = "jobs"\n',
        'docs/guide.md': 'Read ADR 2 before adding a job.\n',
      },
    },
  ])
  corpus = await readCorpus(await Repository.open(fixture.path))
})

afterAll(() => fixture.remove())

describe('readCorpus', () => {
  it('reads the decisions with the date of their last change', () => {
    expect(corpus.decisions).toEqual([
      {
        number: 1,
        file: 'docs/adr/0001-pool.md',
        title: 'Pool the connections',
        status: 'accepted',
        rawStatus: 'Accepted',
        date: '2026-01-10',
        revisedAt: '2026-02-20T10:00:00Z',
        history: [
          expect.objectContaining({ date: '2026-02-20T10:00:00Z' }),
          expect.objectContaining({ subject: expect.any(String) as unknown }),
        ] as unknown,
        lineCount: 10,
        feature: null,
        parent: null,
        amends: [],
        amendedBy: [],
        supersededBy: [],
        codeArea: 'server/db',
        // The fixture commits as Compadr, and the first commit added the file.
        attribution: {
          names: ['Compadr'],
          source: 'commit',
          commit: fixture.git('rev-list', '--max-parents=0', 'HEAD').trim(),
        },
        text: {
          relations: [],
          sections: [
            {
              heading: null,
              line: 8,
              markdown: [
                'The pool lives in `server/src/db/pool.ts:1` and uses `createPool`.',
                '',
                'Later note: see `server/src/db/gone.ts` and `MissingThing`.',
              ].join('\n'),
            },
          ],
        },
        rule: {
          text: 'The pool lives in `server/src/db/pool.ts:1` and uses `createPool`.',
          source: 'first-sentence',
        },
      },
      expect.objectContaining({
        number: 2,
        status: 'proposed',
        codeArea: 'server/jobs',
      }) as unknown,
    ])
  })

  it('dates each reference by the line of the record that carries it', () => {
    expect(corpus.references.filter(r => r.decision === 1)).toEqual([
      {
        kind: 'path',
        id: '0001:server/src/db/pool.ts:1:1',
        decision: 1,
        adrLine: 8,
        column: 19,
        text: 'server/src/db/pool.ts:1',
        citedAt: '2026-01-10T09:00:00Z',
        path: 'server/src/db/pool.ts',
        lines: { start: 1, end: 1 },
        resolvedPaths: ['server/src/db/pool.ts'],
        anchor: null,
      },
      {
        kind: 'symbol',
        id: '0001:createPool:1',
        decision: 1,
        adrLine: 8,
        column: 54,
        text: 'createPool',
        citedAt: '2026-01-10T09:00:00Z',
        symbol: 'createPool',
        foundInCode: true,
        declaredIn: [{ file: 'server/src/db/pool.ts', line: 1 }],
      },
      {
        kind: 'path',
        id: '0001:server/src/db/gone.ts:1',
        decision: 1,
        adrLine: 10,
        column: 17,
        text: 'server/src/db/gone.ts',
        citedAt: '2026-02-20T10:00:00Z',
        path: 'server/src/db/gone.ts',
        lines: null,
        resolvedPaths: [],
        anchor: null,
      },
      {
        kind: 'symbol',
        id: '0001:MissingThing:1',
        decision: 1,
        adrLine: 10,
        column: 45,
        text: 'MissingThing',
        citedAt: '2026-02-20T10:00:00Z',
        symbol: 'MissingThing',
        foundInCode: false,
      },
    ])
  })

  it('resolves a cited folder', () => {
    expect(corpus.references.filter(r => r.decision === 2)).toMatchObject([
      {
        kind: 'path',
        id: '0002:server/jobs:1',
        path: 'server/jobs',
        resolvedPaths: ['server/jobs'],
        citedAt: '2026-02-20T10:00:00Z',
      },
    ])
  })

  it('finds the citations of decisions outside the ADR folder', () => {
    expect(corpus.citations).toEqual([
      { file: 'docs/guide.md', line: 1, decision: 2, inCode: false },
      { file: 'server/src/db/pool.ts', line: 2, decision: 1, inCode: true },
    ])
  })

  it('reads the statuses of the index', () => {
    expect([...corpus.indexStatuses]).toEqual([
      [1, 'Accepted'],
      [2, 'Proposed'],
    ])
  })

  it('reads an older reference with a trailing slash on the folder', async () => {
    const older = await readCorpus(
      await Repository.open(fixture.path, 'HEAD~1'),
      'docs/adr/'
    )
    expect(older.adrDir).toBe('docs/adr')
    expect(older.decisions.map(d => [d.number, d.revisedAt])).toEqual([
      [1, '2026-01-10T09:00:00Z'],
    ])
  })

  it('leaves the repository unchanged', async () => {
    const before = fixture.git('status', '--porcelain', '--ignored')
    await readCorpus(await Repository.open(fixture.path))
    expect(fixture.git('status', '--porcelain', '--ignored')).toBe(before)
  })
})

describe('readCorpus with two records of the same number', () => {
  it('keeps the first record in path order', async () => {
    const duplicate = createFixtureRepo([
      {
        date: '2026-01-10T09:00:00Z',
        files: {
          'docs/adr/0001-a.md': '# 1. First\n\nStatus: accepted\n',
          'docs/adr/0001-b.md': '# 1. Second\n\nStatus: proposed\n',
        },
      },
    ])
    try {
      const read = await readCorpus(await Repository.open(duplicate.path))
      expect(read.decisions.map(d => d.title)).toEqual(['First'])
    } finally {
      duplicate.remove()
    }
  })
})

describe('codeArea', () => {
  it.each([
    ['packages/server/src/db/pool.ts', 'server/db'],
    ['web/app.tsx', 'web'],
    ['README.md', '(root)'],
    ['src/index.ts', '(root)'],
  ])('reads %s as %s', (file, area) => {
    expect(codeArea(file)).toBe(area)
  })
})

describe('readCorpus edge cases', () => {
  let edge: FixtureRepo
  let read: Corpus

  beforeAll(async () => {
    edge = createFixtureRepo([
      {
        date: '2026-01-10T09:00:00Z',
        files: {
          'docs/adr/0001-short.md':
            '# 1. Short\n\nStatus: accepted\r old note\n\nUses `onX`, `OnlyInText` and `server/ui.ts`.\n',
          'docs/adr/0002-empty.md': '# 2. Empty\n\nStatus: proposed\n',
          'server/ui.ts':
            'onX()\nconst quadr12 = 1 // see ADR-12345, then ADR-0001 and ADR-0002\n',
          'notes/todo.txt': 'OnlyInText\n',
        },
      },
    ])
    read = await readCorpus(await Repository.open(edge.path))
  })

  afterAll(() => edge.remove())

  it('finds a short symbol and ignores one found only in a text file', () => {
    expect(
      read.references.flatMap(r =>
        r.kind === 'symbol' ? [[r.symbol, r.foundInCode]] : []
      )
    ).toEqual([
      ['onX', true],
      ['OnlyInText', false],
    ])
  })

  it('checks the boundaries of each citation and keeps two on one line', () => {
    expect(
      read.citations.map(c => [c.file, c.line, c.decision, c.inCode])
    ).toEqual([
      ['server/ui.ts', 2, 1, true],
      ['server/ui.ts', 2, 2, true],
    ])
  })

  it('keeps the line numbers of git blame when a line holds a lone \\r', () => {
    expect(read.references.map(r => [r.text, r.adrLine])).toEqual([
      ['onX', 5],
      ['OnlyInText', 5],
      ['server/ui.ts', 5],
    ])
    expect(
      read.references.every(r => r.citedAt === '2026-01-10T09:00:00Z')
    ).toBe(true)
  })

  it('reads a record that cites no code', () => {
    expect(read.decisions.map(d => [d.number, d.codeArea])).toEqual([
      [1, 'server'],
      [2, 'server'],
    ])
  })
})

describe('the identifier of a reference', () => {
  const body =
    '# ADR 0003 — Retry\n\n- **Status:** Accepted\n\nRetry in `server/retry.ts`, then in `server/retry.ts` again.\n'
  let edited: FixtureRepo

  beforeAll(() => {
    edited = createFixtureRepo([
      {
        date: '2026-01-10T09:00:00Z',
        files: { 'docs/adr/0003-retry.md': body, 'server/retry.ts': 'x\n' },
      },
      {
        date: '2026-02-10T09:00:00Z',
        files: {
          'docs/adr/0003-retry.md': `---\ncompadr:\n  feature: jobs\n---\n${body}`,
        },
      },
    ])
  })

  afterAll(() => edited.remove())

  it('keeps its value when the lines of the record move', async () => {
    const read = async (ref: string) =>
      (await readCorpus(await Repository.open(edited.path, ref))).references
    const before = await read('HEAD~1')
    const after = await read('HEAD')
    expect(before.map(r => r.id)).toEqual([
      '0003:server/retry.ts:1',
      '0003:server/retry.ts:2',
    ])
    expect(after.map(r => r.id)).toEqual(before.map(r => r.id))
    expect(after.map(r => r.adrLine)).toEqual([9, 9])
    expect(after.map(r => r.column)).toEqual([10, 37])
  })
})

describe('the attribution of a check and of a decision', () => {
  const record = [
    '---',
    'decision-makers: Ana Martin, Bo Lee',
    'compadr:',
    '  checked:',
    '    server/a.ts: 2026-01-10T09:00:00Z',
    '    server/b.ts:',
    '      at: 2026-01-10T09:00:00Z',
    '      by: Chloé Durand',
    '---',
    '# ADR 0004 — Files',
    '',
    '- **Status:** Accepted',
    '',
    'See `server/a.ts` and `server/b.ts`.',
    '',
  ].join('\n')
  let checked: FixtureRepo
  let read: Corpus

  beforeAll(async () => {
    checked = createFixtureRepo([
      {
        date: '2026-01-10T09:00:00Z',
        files: {
          'docs/adr/0004-files.md': record,
          'server/a.ts': 'a\n',
          'server/b.ts': 'b\n',
        },
      },
    ])
    read = await readCorpus(await Repository.open(checked.path))
  })

  afterAll(() => checked.remove())

  it('names the person of the entry, or else the author of its line', () => {
    expect(read.references.map(r => [r.text, r.checkedBy])).toEqual([
      [
        'server/a.ts',
        {
          names: ['Compadr'],
          source: 'commit',
          commit: checked.git('rev-parse', 'HEAD').trim(),
        },
      ],
      ['server/b.ts', { names: ['Chloé Durand'], source: 'declared' }],
    ])
  })

  it('names the deciders that the record declares', () => {
    expect(read.decisions[0]!.attribution).toEqual({
      names: ['Ana Martin', 'Bo Lee'],
      source: 'declared',
    })
    expect(read.decisions[0]!.history?.[0]?.author).toBe('Compadr')
  })
})
