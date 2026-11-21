import { createDriftReport } from './report.ts'
import { createFixtureRepo, type FixtureRepo } from './testing/fixture-repo.ts'
import type { DriftReport } from '@compadr/format'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { checkChange, parseUnifiedDiff } from './change.ts'

describe('parseUnifiedDiff', () => {
  it('reads the files, the removed runs and the added lines of git diff', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 1111111..2222222 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -2,3 +2,2 @@ export function a() {',
      ' one',
      '-two',
      '--- a SQL comment, not a header',
      '+three',
      '@@ -10,0 +10,1 @@',
      '+// ADR-0007',
      'diff --git a/old.ts b/new.ts',
      'similarity index 100%',
      'rename from old.ts',
      'rename to new.ts',
      'diff --git a/gone.ts b/gone.ts',
      'deleted file mode 100644',
      'index 3333333..0000000',
      '--- a/gone.ts',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-x',
      'diff --git a/logo.png b/logo.png',
      'new file mode 100644',
      'Binary files /dev/null and b/logo.png differ',
      '',
    ].join('\n')
    expect(parseUnifiedDiff(diff)).toEqual([
      {
        path: 'src/a.ts',
        from: 'src/a.ts',
        status: 'modified',
        removed: [{ start: 3, end: 4 }],
        insertedBefore: [11],
        added: [
          { line: 3, text: 'three' },
          { line: 10, text: '// ADR-0007' },
        ],
      },
      {
        path: 'new.ts',
        from: 'old.ts',
        status: 'renamed',
        removed: [],
        insertedBefore: [],
        added: [],
      },
      {
        path: 'gone.ts',
        from: 'gone.ts',
        status: 'deleted',
        removed: [{ start: 1, end: 1 }],
        insertedBefore: [],
        added: [],
      },
      {
        path: 'logo.png',
        from: null,
        status: 'added',
        removed: [],
        insertedBefore: [],
        added: [],
      },
    ])
  })

  it('reads a diff without git headers and without prefixes', () => {
    const diff = [
      '--- src/a.ts\t2026-01-01 10:00:00',
      '+++ src/a.ts\t2026-01-02 10:00:00',
      '@@ -1 +1 @@',
      '-a',
      '+b',
      '--- /dev/null',
      '+++ src/b.ts',
      '@@ -0,0 +1 @@',
      '+b',
    ].join('\n')
    expect(
      parseUnifiedDiff(diff).map(({ path, from, status }) => ({
        path,
        from,
        status,
      }))
    ).toEqual([
      { path: 'src/a.ts', from: 'src/a.ts', status: 'modified' },
      { path: 'src/b.ts', from: null, status: 'added' },
    ])
  })

  it('reads the paths that git writes between quotes', () => {
    const diff = [
      String.raw`diff --git "a/src/priv\303\251/a.ts" "b/src/priv\303\251/a.ts"`,
      'index 1111111..2222222 100644',
      String.raw`--- "a/src/priv\303\251/a.ts"`,
      String.raw`+++ "b/src/priv\303\251/a.ts"`,
      '@@ -1 +1 @@',
      '-old',
      '+new',
      // A binary file has no --- and +++ lines: the header alone names it.
      String.raw`diff --git "a/src/tab\tdir/g.bin" "b/src/tab\tdir/g.bin"`,
      'index 3333333..4444444 100644',
      'Binary files differ',
      // Git quotes each path on its own.
      String.raw`diff --git a/src/plain.ts "b/src/\346\227\245\346\234\254/say \"hi\".ts"`,
      'similarity index 100%',
      'rename from src/plain.ts',
      String.raw`rename to "src/\346\227\245\346\234\254/say \"hi\".ts"`,
      String.raw`diff --git "a/src/\303\251t\303\251.ts" b/src/summer.ts`,
      'similarity index 100%',
      String.raw`rename from "src/\303\251t\303\251.ts"`,
      'rename to src/summer.ts',
      '',
    ].join('\n')
    expect(
      parseUnifiedDiff(diff).map(({ path, from, status }) => ({
        path,
        from,
        status,
      }))
    ).toEqual([
      { path: 'src/privé/a.ts', from: 'src/privé/a.ts', status: 'modified' },
      {
        path: 'src/tab\tdir/g.bin',
        from: 'src/tab\tdir/g.bin',
        status: 'modified',
      },
      { path: 'src/日本/say "hi".ts', from: 'src/plain.ts', status: 'renamed' },
      { path: 'src/summer.ts', from: 'src/été.ts', status: 'renamed' },
    ])
  })

  it('reads a quoted path in linear time', () => {
    const started = performance.now()
    parseUnifiedDiff(`diff --git a/x ${' "b/'.repeat(100_000)}\n`)
    parseUnifiedDiff(`diff --git "a/${'\\'.repeat(100_001)}\n`)
    expect(performance.now() - started).toBeLessThan(1000)
  })

  it('finds no file in a text that is not a diff', () => {
    expect(parseUnifiedDiff('Some prose.\n')).toEqual([])
  })
})

describe('checkChange', () => {
  let fixture: FixtureRepo
  let report: DriftReport

  beforeAll(async () => {
    fixture = createFixtureRepo([
      {
        date: '2026-01-10T09:00:00Z',
        files: {
          'docs/adr/0001-pool.md':
            '# 1. Pool\n\nStatus: Accepted\n\nThe pool is in `src/db/pool.ts:2-3`. Settings live in `src/db/settings.ts`.\n',
          'docs/adr/0002-old.md':
            '# 2. Old\n\nStatus: Superseded by ADR-0001\n',
          'docs/adr/0003-idea.md':
            '# 3. Idea\n\nStatus: Proposed\n\nSee `src/db`.\n',
          'src/db/pool.ts':
            'import x\nexport function pool() {\n  return 1\n}\n',
          'src/db/settings.ts': 'export const size = 1\n',
          'docs/history.md': '# History\n\nADR-0001 pooled the connections.\n',
          'src/db/use.ts': '// ADR-0001\nexport {}\n',
        },
      },
    ])
    report = await createDriftReport(fixture.path, {
      generatorVersion: '0.0.0',
    })
  })
  afterAll(() => fixture.remove())

  const check = (lines: string[]) =>
    checkChange(report, parseUnifiedDiff(lines.join('\n')))

  it('flags cited lines that the change modifies, not the lines around them', () => {
    const inside = check([
      'diff --git a/src/db/pool.ts b/src/db/pool.ts',
      '--- a/src/db/pool.ts',
      '+++ b/src/db/pool.ts',
      '@@ -3 +3 @@',
      '-  return 1',
      '+  return 2',
    ])
    expect(inside.signals).toEqual([
      expect.objectContaining({
        type: 'cited-lines-changed',
        level: 'review',
        decision: 1,
        path: 'src/db/pool.ts',
        lines: { start: 2, end: 3 },
      }),
    ])
    expect(inside.inForce).toEqual([
      expect.objectContaining({
        decision: 1,
        scope: 'file',
        files: ['src/db/pool.ts'],
      }),
    ])
    expect(inside.context).toEqual([
      expect.objectContaining({ decision: 3, scope: 'folder' }),
    ])
    const above = check([
      'diff --git a/src/db/pool.ts b/src/db/pool.ts',
      '--- a/src/db/pool.ts',
      '+++ b/src/db/pool.ts',
      '@@ -1,0 +2 @@',
      '+// a new line above the cited block',
    ])
    expect(above.signals).toEqual([])
    const between = check([
      'diff --git a/src/db/pool.ts b/src/db/pool.ts',
      '--- a/src/db/pool.ts',
      '+++ b/src/db/pool.ts',
      '@@ -2,0 +3 @@',
      '+  log()',
    ])
    expect(between.signals.map(signal => signal.type)).toEqual([
      'cited-lines-changed',
    ])
  })

  it('keeps the decisions that code cites, not those that a Markdown file lists', () => {
    const edit = (path: string) => [
      `diff --git a/${path} b/${path}`,
      `--- a/${path}`,
      `+++ b/${path}`,
      '@@ -1 +1 @@',
      '-a',
      '+b',
    ]
    expect(check(edit('docs/history.md')).inForce).toEqual([])
    expect(check(edit('src/db/use.ts')).inForce).toEqual([
      expect.objectContaining({ decision: 1, files: ['src/db/use.ts'] }),
    ])
  })

  it('flags a cited path that the change renames, with its new path', () => {
    const { signals, files } = check([
      'diff --git a/src/db/settings.ts b/src/config/settings.ts',
      'similarity index 100%',
      'rename from src/db/settings.ts',
      'rename to src/config/settings.ts',
    ])
    expect(files).toEqual([
      {
        path: 'src/config/settings.ts',
        from: 'src/db/settings.ts',
        status: 'renamed',
      },
    ])
    expect(signals).toEqual([
      expect.objectContaining({
        type: 'cited-path-removed',
        level: 'broken',
        decision: 1,
        path: 'src/db/settings.ts',
        renamedTo: 'src/config/settings.ts',
      }),
    ])
  })

  it('flags added citations of superseded and unknown decisions in code only', () => {
    const { signals } = check([
      'diff --git a/src/db/settings.ts b/src/db/settings.ts',
      '--- a/src/db/settings.ts',
      '+++ b/src/db/settings.ts',
      '@@ -1 +1,3 @@',
      ' export const size = 1',
      '+// ADR-0002, ADR-0009 and ADR-0004',
      '+// ADR-0001',
      'diff --git a/docs/adr/0004-new.md b/docs/adr/0004-new.md',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/docs/adr/0004-new.md',
      '@@ -0,0 +1 @@',
      '+# 4. New, see ADR-0008',
      'diff --git a/README.md b/README.md',
      '--- a/README.md',
      '+++ b/README.md',
      '@@ -0,0 +1 @@',
      '+ADR-0008',
    ])
    expect(signals).toEqual([
      {
        type: 'superseded-decision-cited',
        level: 'broken',
        decision: 2,
        path: 'src/db/settings.ts',
        line: 2,
        supersededBy: [1],
      },
      {
        type: 'unknown-decision-cited',
        level: 'broken',
        decision: 9,
        path: 'src/db/settings.ts',
        line: 2,
        supersededBy: [],
      },
    ])
  })
})
