import type { Signal } from '@compadr/format'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readCorpus, type Corpus } from './read-corpus.ts'
import { Repository } from './repository.ts'
import { computeSignals } from './signals.ts'
import { createFixtureRepo, type FixtureRepo } from './testing/fixture-repo.ts'

const JAN = '2026-01-10T09:00:00Z'
const FEB = '2026-02-01T09:00:00Z'
const MAR = '2026-03-01T09:00:00Z'

const record = (title: string, status: string, body = '') =>
  `# ${title}\n\n- **Status:** ${status}\n\n## Decision\n\n${body}\n`

let fixture: FixtureRepo
let corpus: Corpus
let signals: Signal[]

beforeAll(async () => {
  fixture = createFixtureRepo([
    {
      date: JAN,
      files: {
        'docs/adr/0001-pool.md': record(
          'ADR 0001 — Pool',
          'Accepted',
          'Lines `server/db/pool.ts:2`, gone `server/db/gone.ts`, beyond `server/db/pool.ts:50`, folder `server/jobs`.'
        ),
        'docs/adr/0002-old.md': record(
          'ADR 0002 — Old',
          'Superseded by ADR-0003'
        ),
        'docs/adr/0003-new.md': `# ADR 0003 — New\n\n- **Status:** Accepted\n- Supersedes ADR-0002\n\n## Decision\n\nSee \`server/api/routes.ts:1\`.\n`,
        'docs/adr/0004-lonely.md': record('ADR 0004 — Lonely', 'Accepted'),
        'docs/adr/0005-base.md': record('ADR 0005 — Base', 'Accepted'),
        'docs/adr/0006-a.md': `# ADR 0006 — A\n\n- **Status:** Proposed\n- Amends ADR-0005\n`,
        'docs/adr/0007-b.md': `# ADR 0007 — B\n\n- **Status:** Proposed\n- Amends ADR-0005\n`,
        'docs/adr/0008-c.md': `# ADR 0008 — C\n\n- **Status:** Proposed\n- Amends ADR-0005\n`,
        'docs/adr/README.md':
          '| ADR | Status |\n|---|---|\n| 0001 | Accepted |\n| 0004 | Proposed |\n',
        'server/db/pool.ts': 'one\ntwo\nthree\n',
        'server/api/routes.ts': 'a\nb\n',
        'server/jobs/queue.ts': 'queue\n',
        'server/legacy.ts': '// ADR-0002, ADR-0099 and ADR-0002 again\n',
      },
    },
    { date: FEB, files: { 'server/db/pool.ts': 'one\nTWO\nthree\n' } },
    {
      date: MAR,
      files: {
        'server/api/routes.ts': 'a\nb\nc\n',
        'server/jobs/queue.ts': 'queue v2\n',
      },
    },
  ])
  const repo = await Repository.open(fixture.path)
  corpus = await readCorpus(repo)
  signals = await computeSignals(repo, corpus)
})

afterAll(() => fixture.remove())

function textOf(id: string): string {
  return corpus.references.find(reference => reference.id === id)!.text
}

describe('computeSignals', () => {
  it('lists every signal in a stable order', () => {
    expect(
      signals.map(signal => [
        signal.type,
        signal.level,
        signal.decision,
        'reference' in signal ? textOf(signal.reference) : null,
      ])
    ).toEqual([
      ['cited-line-changed', 'review', 1, 'server/db/pool.ts:2'],
      ['path-missing', 'broken', 1, 'server/db/gone.ts'],
      ['cited-line-out-of-range', 'broken', 1, 'server/db/pool.ts:50'],
      ['linked-files-changed', 'order', 1, null],
      ['cited-file-changed', 'order', 3, 'server/api/routes.ts:1'],
      ['linked-files-changed', 'order', 3, null],
      ['superseded-decision-cited', 'broken', 2, null],
      ['unknown-decision-cited', 'broken', 99, null],
      ['index-status-mismatch', 'broken', 4, null],
      ['amendment-chain', 'info', 5, null],
      ['decision-without-code', 'info', 4, null],
      ['decision-without-code', 'info', 5, null],
    ])
  })

  it('dates a changed line and its citation', () => {
    expect(signals[0]).toMatchObject({
      citedAt: JAN,
      lineChangedAt: FEB,
    })
  })

  it('gives the line count of a file cited beyond its end', () => {
    expect(signals[2]).toMatchObject({ fileLineCount: 3 })
  })

  it('counts the commits on the linked files and folders since their citation', () => {
    expect(signals[3]).toMatchObject({
      id: 'linked-files-changed:0001',
      oldestCitedAt: JAN,
      files: [
        { path: 'server/db/pool.ts', commitsSince: 1 },
        { path: 'server/jobs', commitsSince: 1 },
      ],
    })
    expect(signals[4]).toMatchObject({ citedAt: JAN, commitsSince: 1 })
  })

  it('locates the citations of a superseded or unknown decision', () => {
    expect(signals[6]).toEqual({
      type: 'superseded-decision-cited',
      level: 'broken',
      id: 'superseded-decision-cited:0002:server/legacy.ts:1',
      decision: 2,
      file: 'server/legacy.ts',
      line: 1,
      supersededBy: [3],
    })
    expect(signals[7]).toMatchObject({ file: 'server/legacy.ts', line: 1 })
  })

  it('compares the index and the record, and lists the chains', () => {
    expect(signals[8]).toMatchObject({
      indexStatus: 'Proposed',
      recordStatus: 'Accepted',
    })
    expect(signals[9]).toMatchObject({ amendedBy: [6, 7, 8] })
  })

  it('gives each signal a unique identifier', () => {
    expect(new Set(signals.map(signal => signal.id)).size).toBe(signals.length)
  })

  it('leaves the repository unchanged', async () => {
    const before = fixture.git('status', '--porcelain', '--ignored')
    const repo = await Repository.open(fixture.path)
    await computeSignals(repo, await readCorpus(repo))
    expect(fixture.git('status', '--porcelain', '--ignored')).toBe(before)
  })
})

describe('checked references', () => {
  const body = 'See `src/a.ts:2`.'
  const checked = (at: string) =>
    `---\ncompadr:\n  checked:\n    "src/a.ts:2": ${at}\n---\n${record('ADR 0001 — A', 'Accepted', body)}`

  async function signalsAt(at: string | null) {
    const repo = createFixtureRepo([
      {
        date: JAN,
        files: {
          'docs/adr/0001-a.md': record('ADR 0001 — A', 'Accepted', body),
          'src/a.ts': 'one\ntwo\n',
        },
      },
      { date: FEB, files: { 'src/a.ts': 'one\nTWO\n' } },
      ...(at === null
        ? []
        : [{ date: MAR, files: { 'docs/adr/0001-a.md': checked(at) } }]),
    ])
    try {
      const opened = await Repository.open(repo.path)
      const read = await readCorpus(opened)
      return {
        corpus: read,
        signals: (await computeSignals(opened, read)).map(s => s.type),
      }
    } finally {
      repo.remove()
    }
  }

  it('starts the signals of a reference from its last check', async () => {
    expect((await signalsAt(null)).signals).toContain('cited-line-changed')
    const after = await signalsAt('2026-02-02T09:00:00Z')
    expect(after.signals).not.toContain('cited-line-changed')
    expect(after.corpus.references[0]!.checkedAt).toBe('2026-02-02T09:00:00Z')
    // A check older than the change of the code leaves the signal.
    expect((await signalsAt('2026-01-20T09:00:00Z')).signals).toContain(
      'cited-line-changed'
    )
  })

  it('keeps the commits of each record, the most recent first', async () => {
    const { corpus: read } = await signalsAt('2026-02-02T09:00:00Z')
    expect(read.decisions[0]!.history?.map(c => c.date)).toEqual([
      '2026-03-01T09:00:00Z',
      '2026-01-10T09:00:00Z',
    ])
  })
})
