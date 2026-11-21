import {
  ASSIST_SCHEMA_VERSION,
  AssistRequestSchema,
  type AssistSuggestion,
  type CheckRequest,
  type DriftReport,
} from '@compadr/format'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  amendmentChain,
  assistDiff,
  assistInputHash,
  buildAcceptRequest,
  buildCheckRequest,
  buildConsolidateRequest,
  buildDraftRequest,
  buildPlainRequest,
  verifySuggestion,
} from './assist.ts'
import { createDriftReport } from './report.ts'
import { createFixtureRepo, type FixtureRepo } from './testing/fixture-repo.ts'

const record = (
  number: number,
  title: string,
  header: string[],
  decision: string
) =>
  [
    `# ${number}. ${title}`,
    '',
    ...header,
    '',
    '## Context',
    '',
    'Some context.',
    '',
    '## Decision',
    '',
    decision,
    '',
  ].join('\n')

const fileDiff = (path: string, removed: string, added: string) => [
  `diff --git a/${path} b/${path}`,
  `--- a/${path}`,
  `+++ b/${path}`,
  '@@ -2 +2 @@',
  `-${removed}`,
  `+${added}`,
]

describe('assist requests', () => {
  let fixture: FixtureRepo
  let report: DriftReport
  const read = (file: string) =>
    Promise.resolve(fixture.git('show', `HEAD:${file}`))

  beforeAll(async () => {
    fixture = createFixtureRepo([
      {
        date: '2026-01-10T09:00:00Z',
        files: {
          'docs/adr/0001-pool.md': record(
            1,
            'Pool',
            ['Status: Accepted'],
            'The pool keeps at most ten connections, in `src/db/pool.ts:2-3`.'
          ),
          'docs/adr/0002-settings.md': record(
            2,
            'Settings',
            ['Status: Accepted'],
            'Settings are read once, from `src/db/settings.ts`, and the pool reads them in `src/db/pool.ts`.'
          ),
          'docs/adr/0003-reload.md': record(
            3,
            'Reload',
            ['Status: Accepted', '', '- Amends ADR-0002'],
            'Settings are read again on SIGHUP.'
          ),
          'docs/adr/0004-retry.md': record(
            4,
            'Retry',
            ['Status: Accepted', '', '- Amends ADR-0003'],
            'A failed reload keeps the previous settings.'
          ),
          'docs/adr/0005-sibling.md': record(
            5,
            'Sibling',
            ['Status: Accepted', '', '- Amends ADR-0002'],
            'Settings may come from the environment.'
          ),
          'docs/adr/0006-old.md': record(
            6,
            'Old',
            ['Status: Superseded by ADR-0001'],
            'One connection.'
          ),
          'src/db/pool.ts':
            'import x\nexport function pool() {\n  return 10\n}\n',
          'src/db/settings.ts': 'export const size = 10\nexport {}\n',
          'README.md': '# App\n\nOld text.\n',
          'yarn.lock': 'a\nb\n',
          'src/gql/graphql.ts': 'export type A = 1\nexport {}\n',
        },
      },
    ])
    report = await createDriftReport(fixture.path, {
      generatorVersion: '0.0.0',
    })
  })
  afterAll(() => fixture.remove())

  it('leaves documentation, lock files, generated code and deleted content out of the diff', () => {
    const diff = [
      ...fileDiff('src/db/settings.ts', 'export {}', 'export const x = 1'),
      ...fileDiff('README.md', 'Old text.', 'New text.'),
      ...fileDiff('yarn.lock', 'b', 'c'),
      ...fileDiff('src/gql/graphql.ts', 'export {}', 'export type B = 2'),
      'diff --git a/src/db/gone.ts b/src/db/gone.ts',
      'deleted file mode 100644',
      '--- a/src/db/gone.ts',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-secret content',
      '',
    ].join('\n')
    const { diff: kept, omittedFiles } = assistDiff(diff)
    expect(kept).toContain('src/db/settings.ts')
    expect(kept).toContain('deleted file mode 100644')
    expect(kept).not.toMatch(/README|yarn\.lock|gql\/graphql|secret content/)
    expect(omittedFiles).toEqual([])

    // The first file does not fit; the next one, smaller, still does.
    const small = assistDiff(diff, 120)
    expect(small.diff).toMatch(/^diff --git a\/src\/db\/gone\.ts/)
    expect(small.omittedFiles).toEqual(['src/db/settings.ts'])
  })

  it('sends first the decision that a signal names, then the heaviest links', () => {
    const request = buildCheckRequest(
      report,
      [
        ...fileDiff(
          'src/db/pool.ts',
          'export function pool() {',
          'export function pool(n) {'
        ),
        '',
      ].join('\n')
    )
    expect(AssistRequestSchema.parse(request)).toEqual(request)
    expect(request.signals).toEqual([
      {
        type: 'cited-lines-changed',
        level: 'review',
        decision: 1,
        path: 'src/db/pool.ts',
      },
    ])
    expect(request.decisions.map(d => d.number)).toEqual([1, 2])
    expect(request.decisions[0]).toMatchObject({
      title: 'Pool',
      status: 'accepted',
      files: ['src/db/pool.ts'],
      truncated: false,
    })
    expect(request.decisions[0]!.text).toContain('at most ten connections')
    expect(request.memoryCard).toContain('Generated by Compadr')

    const one = buildCheckRequest(
      report,
      fileDiff('src/db/pool.ts', 'export function pool() {', 'x').join('\n'),
      { maxDecisions: 1, maxDecisionChars: 10 }
    )
    expect(one.decisions).toHaveLength(1)
    expect(one.decisions[0]).toMatchObject({ number: 1, truncated: true })
    expect(one.decisions[0]!.text).toHaveLength(10)
  })

  it('follows the amendments up and down, but not to a sibling', async () => {
    expect(amendmentChain(report, 3)).toEqual([2, 3, 4])
    expect(amendmentChain(report, 2)).toEqual([2, 3, 4, 5])
    expect(amendmentChain(report, 99)).toEqual([])

    const request = await buildConsolidateRequest(report, 3, read)
    expect(request.records.map(r => r.number)).toEqual([2, 3, 4])
    expect(request.records[0]!.text).toContain('Settings are read once')
    expect(request.omittedRecords).toEqual([])

    const small = await buildConsolidateRequest(report, 2, read, {
      maxRecords: 2,
    })
    expect(small.records.map(r => r.number)).toEqual([2, 3])
    expect(small.omittedRecords).toEqual([4, 5])
    await expect(buildConsolidateRequest(report, 99, read)).rejects.toThrow()
  })

  it('builds the plain and draft requests', async () => {
    const plain = await buildPlainRequest(report, 1, read)
    expect(plain.record).toMatchObject({
      number: 1,
      file: 'docs/adr/0001-pool.md',
    })
    const draft = buildDraftRequest(
      report,
      fileDiff('src/db/pool.ts', 'export function pool() {', 'x').join('\n')
    )
    expect(draft.nextNumber).toBe(7)
    expect(AssistRequestSchema.parse(draft)).toEqual(draft)
  })

  it('leaves secret files out and masks the secrets of the diff that is sent', () => {
    // Built at run time, so that no scanner reads a token in the sources.
    const token = 'ghp_' + 'A1b2C3d4'.repeat(5)
    const diff = [
      ...fileDiff(
        'src/db/pool.ts',
        'export function pool() {',
        `const t = "${token}"`
      ),
      ...fileDiff('.env', 'A=1', `TOKEN=${token}`),
      ...fileDiff('.env.example', 'A=1', 'TOKEN=<your token>'),
      '',
    ].join('\n')
    const request = buildCheckRequest(report, diff)
    expect(request.diff).not.toContain(token)
    expect(request.diff).toContain('+const t = "[masked:github-token]"')
    expect(request.diff).not.toMatch(/^diff --git a\/\.env b/m)
    expect(request.diff).toContain('.env.example')
    expect(buildDraftRequest(report, diff).diff).toBe(request.diff)

    // The guard reads the request as it was sent: a quote of the masked line
    // is kept.
    const verdict = verifySuggestion(
      request,
      {
        kind: 'check',
        schemaVersion: ASSIST_SCHEMA_VERSION,
        status: 'suggested',
        provenance: {
          model: 'test-model',
          promptVersion: 'check-1',
          inputHash: assistInputHash(request),
          createdAt: '2026-11-11T10:00:00Z',
        },
        findings: [
          {
            decision: 1,
            verdict: 'at-risk',
            quote: 'The pool keeps at most ten connections',
            evidence: {
              path: 'src/db/pool.ts',
              text: '+const t = "[masked:github-token]"',
            },
            explanation: 'A token is written in the code of the pool.',
          },
        ],
      },
      report
    )
    expect(verdict).toEqual({ ok: true, problems: [] })
  })

  describe('verifySuggestion', () => {
    let request: CheckRequest
    const provenance = (r: Parameters<typeof assistInputHash>[0]) => ({
      model: 'test-model',
      promptVersion: 'check-1',
      inputHash: assistInputHash(r),
      createdAt: '2026-11-11T10:00:00Z',
    })
    const check = (
      findings: Extract<AssistSuggestion, { kind: 'check' }>['findings']
    ): AssistSuggestion => ({
      kind: 'check',
      schemaVersion: ASSIST_SCHEMA_VERSION,
      status: 'suggested',
      provenance: provenance(request),
      findings,
    })
    const finding = (
      decision: number,
      quote: string,
      path = 'src/db/pool.ts'
    ) => ({
      decision,
      verdict: 'violated' as const,
      quote,
      evidence: { path, text: '+  return 20' },
      explanation: 'The pool grows past ten.',
    })

    beforeAll(() => {
      request = buildCheckRequest(
        report,
        fileDiff('src/db/pool.ts', 'export function pool() {', 'x').join('\n')
      )
    })

    it('accepts a quote copied from the decision that was sent', () => {
      const verdict = verifySuggestion(
        request,
        check([finding(1, 'The pool keeps at most ten connections')]),
        report
      )
      expect(verdict).toEqual({ ok: true, problems: [] })
    })

    it('rejects a quote changed by one letter, and a path outside the change', () => {
      const { problems } = verifySuggestion(
        request,
        check([
          finding(1, 'The pool keeps at most tan connections'),
          finding(1, 'The pool keeps at most ten connections', 'src/other.ts'),
        ]),
        report
      )
      expect(problems.map(p => [p.level, p.code, p.item])).toEqual([
        ['error', 'quote-not-found', 'findings[0]'],
        ['error', 'evidence-outside-change', 'findings[1]'],
      ])
    })

    it('rejects an unknown or superseded decision, and flags a decision whose text was not sent', () => {
      const { problems } = verifySuggestion(
        request,
        check([
          finding(42, 'Anything'),
          finding(6, 'One connection.'),
          finding(3, 'Settings are read again on SIGHUP.'),
        ]),
        report
      )
      expect(problems.map(p => [p.level, p.code])).toEqual([
        ['error', 'unknown-decision'],
        ['error', 'decision-not-in-force'],
        ['notice', 'quote-unverified'],
      ])
    })

    it('flags a quote of a decision that the report gives without text', () => {
      const bare = structuredClone(report)
      bare.decisions.find(d => d.number === 1)!.text = undefined
      const sent = buildCheckRequest(
        bare,
        fileDiff('src/db/pool.ts', 'export function pool() {', 'x').join('\n')
      )
      expect(sent.decisions[0]).toMatchObject({ number: 1, text: '' })
      const suggestion = {
        ...check([finding(1, 'The pool keeps at most ten connections')]),
        provenance: provenance(sent),
      }
      expect(
        verifySuggestion(sent, suggestion, bare).problems.map(p => p.code)
      ).toEqual(['quote-unverified'])
    })

    it('rejects a suggestion that answers another request', () => {
      const other = buildCheckRequest(
        report,
        fileDiff('src/db/settings.ts', 'export {}', 'y').join('\n')
      )
      expect(verifySuggestion(other, check([]), report).problems[0]?.code).toBe(
        'input-hash-mismatch'
      )
      const plain = {
        ...check([]),
        kind: 'plain',
        summary: 'x',
      } as AssistSuggestion
      expect(verifySuggestion(request, plain, report).problems[0]?.code).toBe(
        'kind-mismatch'
      )
    })

    it('checks the quotes and the records of a consolidated rule', async () => {
      const consolidate = await buildConsolidateRequest(report, 3, read)
      const suggestion: AssistSuggestion = {
        kind: 'consolidate',
        schemaVersion: ASSIST_SCHEMA_VERSION,
        status: 'suggested',
        provenance: provenance(consolidate),
        rules: [
          {
            rule: 'Reload on SIGHUP.',
            sources: [3],
            quote: 'Settings are read again on SIGHUP.',
          },
          {
            rule: 'Keep the old ones.',
            sources: [4],
            quote: 'A failed reload keeps the newest settings.',
          },
          {
            rule: 'From the environment.',
            sources: [5],
            quote: 'Settings may come from the environment.',
          },
        ],
        replaced: [
          { rule: 'Read once.', record: 2, replacedBy: 3 },
          // A later section of record 3 amends an earlier one.
          { rule: 'Reload by hand.', record: 3, replacedBy: 3 },
        ],
        conflicts: [{ point: 'x', records: [2, 9] }],
      }
      const { ok, problems } = verifySuggestion(consolidate, suggestion, report)
      expect(ok).toBe(true)
      expect(problems.map(p => [p.code, p.item])).toEqual([
        ['quote-not-found', 'rules[1]'],
        ['record-outside-chain', 'rules[2]'],
        ['record-outside-chain', 'conflicts[0]'],
      ])
    })

    it('says when a proposed record replaces a rule', async () => {
      const consolidate = await buildConsolidateRequest(report, 3, read)
      const suggestion: AssistSuggestion = {
        kind: 'consolidate',
        schemaVersion: ASSIST_SCHEMA_VERSION,
        status: 'suggested',
        provenance: provenance(consolidate),
        rules: [],
        replaced: [
          { rule: 'Read once.', record: 2, replacedBy: 3 },
          { rule: 'Keep the old ones.', record: 3, replacedBy: 4 },
        ],
        conflicts: [],
      }
      // Record 4 waits for a person to accept it. Record 3 replaced its
      // rule, then was superseded: that replacement took place.
      const statuses = { 3: 'superseded', 4: 'proposed' } as const
      const proposed = {
        ...report,
        decisions: report.decisions.map(d =>
          d.number === 3 || d.number === 4
            ? { ...d, status: statuses[d.number] }
            : d
        ),
      }
      const { ok, problems } = verifySuggestion(
        consolidate,
        suggestion,
        proposed
      )
      expect(ok).toBe(true)
      expect(problems.map(p => [p.level, p.code, p.item])).toEqual([
        ['notice', 'record-not-accepted', 'replaced[1]'],
      ])
    })

    it('checks the decisions and the files of a draft', () => {
      const draft = buildDraftRequest(
        report,
        fileDiff('src/db/pool.ts', 'export function pool() {', 'x').join('\n')
      )
      const suggestion: AssistSuggestion = {
        kind: 'draft',
        schemaVersion: ASSIST_SCHEMA_VERSION,
        status: 'suggested',
        provenance: provenance(draft),
        notNeeded: null,
        title: 'Pool size',
        rule: 'The pool keeps twenty connections.',
        amends: [1, 6],
        supersedes: [],
        context: '',
        decision: [
          { heading: 'Twenty connections', text: 'In `src/db/pool.ts`.' },
        ],
        consequences: '',
        codeRefs: [
          'src/db/pool.ts#pool',
          'src/elsewhere.ts',
          '`src/db/pool.ts`',
        ],
      }
      expect(
        verifySuggestion(draft, suggestion, report).problems.map(p => [
          p.level,
          p.code,
          p.item,
        ])
      ).toEqual([
        ['error', 'decision-not-in-force', 'amends[1]'],
        ['notice', 'code-ref-outside-change', 'codeRefs[1]'],
      ])
    })
  })
})

describe('accept requests', () => {
  let repo: FixtureRepo
  let report: DriftReport
  const lines = (count: number, at: Record<number, string>) =>
    Array.from(
      { length: count },
      (_, i) => at[i + 1] ?? `const x${i + 1} = ${i + 1}`
    ).join('\n')
  const read = (file: string) =>
    Promise.resolve(repo.git('show', `HEAD:${file}`))

  beforeAll(async () => {
    repo = createFixtureRepo([
      {
        date: '2026-01-10T09:00:00Z',
        files: {
          'docs/adr/0001-retry.md': [
            '# 1. Retry',
            '',
            'Status: Proposed',
            '',
            '## Decision',
            '',
            'A failed job is retried three times, then it waits for a person.',
            '',
          ].join('\n'),
          'docs/adr/compadr.yml': 'assist:\n  exclude:\n    - src/secret\n',
          // Two citations far apart give two excerpts.
          'src/a.ts': lines(120, {
            3: '// ADR-0001',
            4: 'export const RETRIES = 3',
            100: '// ADR-0001: then a person decides',
          }),
          'src/b.ts': lines(5, { 1: '// ADR-0001' }),
          'src/secret/c.ts': '// ADR-0001\nexport const key = "do-not-send"\n',
          'docs/guide.md': 'See ADR-0001.\n',
        },
      },
    ])
    report = await createDriftReport(repo.path, { generatorVersion: '0.0.0' })
  })
  afterAll(() => repo.remove())

  it('sends the lines around each citation, without the excluded files', async () => {
    const request = await buildAcceptRequest(report, 1, read)
    expect(AssistRequestSchema.parse(request)).toEqual(request)
    expect(request.record.text).toContain('retried three times')
    expect(
      request.code.map(e => [e.path, e.startLine, e.text.split('\n').length])
    ).toEqual([
      ['src/a.ts', 1, 33],
      ['src/a.ts', 90, 31],
      ['src/b.ts', 1, 5],
    ])
    expect(JSON.stringify(request)).not.toContain('do-not-send')
    expect(request.omittedFiles).toEqual([])

    const small = await buildAcceptRequest(report, 1, read, { maxFiles: 1 })
    expect(new Set(small.code.map(e => e.path))).toEqual(new Set(['src/a.ts']))
    expect(small.omittedFiles).toEqual(['src/b.ts'])
  })

  it('checks the quotes and the evidence of a recommendation', async () => {
    const request = await buildAcceptRequest(report, 1, read)
    const suggestion: AssistSuggestion = {
      kind: 'accept',
      schemaVersion: ASSIST_SCHEMA_VERSION,
      status: 'suggested',
      provenance: {
        model: 'test-model',
        promptVersion: 'accept-1',
        inputHash: assistInputHash(request),
        createdAt: '2026-11-17T10:00:00Z',
      },
      recommendation: 'amend-then-accept',
      explanation: 'The code retries three times.',
      points: [
        {
          quote: 'A failed job is retried three times',
          evidence: { path: 'src/a.ts', text: 'export const RETRIES = 3' },
          finding: 'Applied.',
        },
        {
          quote: 'then it waits for a person',
          evidence: null,
          finding: 'No excerpt shows it.',
        },
        {
          quote: 'A failed job is retried five times',
          evidence: null,
          finding: 'Invented.',
        },
        {
          quote: 'A failed job is retried three times',
          evidence: { path: 'src/secret/c.ts', text: 'export const key' },
          finding: 'Not sent.',
        },
        {
          quote: 'A failed job is retried three times',
          evidence: { path: 'src/a.ts', text: 'export const RETRIES = 5' },
          finding: 'Changed.',
        },
        {
          quote: 'A failed job is retried three times',
          // A part of a line is not the line.
          evidence: { path: 'src/a.ts', text: 'RETRIES' },
          finding: 'Part of a line.',
        },
      ],
      amendments: [],
    }
    const { ok, problems } = verifySuggestion(request, suggestion, report)
    expect(ok).toBe(true)
    expect(problems.map(p => [p.level, p.code, p.item])).toEqual([
      ['error', 'quote-not-found', 'points[2]'],
      ['error', 'evidence-not-sent', 'points[3]'],
      ['error', 'evidence-not-sent', 'points[4]'],
      ['error', 'evidence-not-sent', 'points[5]'],
      ['notice', 'amendments-missing', 'amendments'],
    ])
  })
})

describe('check requests and the decisions that the diff cites', () => {
  let repo: FixtureRepo
  let report: DriftReport
  const pool = Array.from({ length: 12 }, (_, i) => `const p${i + 1} = ${i}`)

  beforeAll(async () => {
    const heavy = (n: number) =>
      [
        `docs/adr/000${n}-heavy-${n}.md`,
        record(
          n,
          `Heavy ${n}`,
          ['Status: Accepted'],
          `See \`src/db/pool.ts:1-2\`.`
        ),
      ] as const
    repo = createFixtureRepo([
      {
        date: '2026-01-10T09:00:00Z',
        files: {
          ...Object.fromEntries([1, 2, 3].map(heavy)),
          'docs/adr/0004-cap.md': record(
            4,
            'Cap',
            ['Status: Accepted'],
            'The cap lives in `src/db/cap.ts`.'
          ),
          'docs/adr/0005-old.md': record(
            5,
            'Old',
            ['Status: Superseded by ADR-0004'],
            'No cap.'
          ),
          'docs/adr/0006-format.md': record(
            6,
            'Format',
            ['Status: Accepted'],
            'Dates are written in UTC, in `src/time.ts`.'
          ),
          'src/db/pool.ts': `${pool.join('\n')}\n`,
          'src/db/cap.ts': 'export const cap = 10\n',
          'src/time.ts': 'export {}\n',
        },
      },
    ])
    report = await createDriftReport(repo.path, { generatorVersion: '0.0.0' })
  })
  afterAll(() => repo.remove())

  const hunk = (lines: string[]) =>
    [
      'diff --git a/src/db/pool.ts b/src/db/pool.ts',
      '--- a/src/db/pool.ts',
      '+++ b/src/db/pool.ts',
      '@@ -9,3 +9,4 @@',
      ...lines,
      '',
    ].join('\n')

  it('sends a decision that the diff cites before the heaviest links', () => {
    const diff = hunk([
      ' const p9 = 8',
      '-const p10 = 9',
      '+const p10 = 10 // keeps the cap (ADR 0004)',
      '+// ADR-0005 and ADR-0099 are not in force',
      ' const p11 = 10',
    ])
    const request = buildCheckRequest(report, diff, { maxDecisions: 2 })
    expect(request.decisions.map(d => d.number)).toEqual([4, 1])
    expect(request.decisions[0]).toMatchObject({
      title: 'Cap',
      status: 'accepted',
      files: ['src/db/pool.ts'],
      weight: 0,
    })
    expect(request.decisions[0]!.text).toContain('The cap lives')
  })

  it('reads the context lines of a hunk, but not the removed ones', () => {
    const diff = hunk([
      ' // Dates follow ADR 0006.',
      '-const p10 = 9 // ADR-0004',
      '+const p10 = 10',
      ' const p11 = 10',
    ])
    const request = buildCheckRequest(report, diff, { maxDecisions: 2 })
    expect(request.decisions.map(d => d.number)).toEqual([6, 1])
  })
})

describe('accept requests and the code that the record cites', () => {
  let repo: FixtureRepo
  let report: DriftReport
  const numbered = (count: number, at: Record<number, string> = {}) =>
    Array.from(
      { length: count },
      (_, i) => at[i + 1] ?? `const x${i + 1} = ${i + 1}`
    ).join('\n')
  const read = (file: string) =>
    Promise.resolve(repo.git('show', `HEAD:${file}`))

  beforeAll(async () => {
    repo = createFixtureRepo([
      {
        date: '2026-01-10T09:00:00Z',
        files: {
          'docs/adr/0001-flow.md': [
            '# 1. Flow engine',
            '',
            'Status: Proposed',
            '',
            '## Decision',
            '',
            'Flows are compiled by `compileFlow`, in `src/flow/compile.ts`.',
            'The pruner keeps the fields of `src/flow/prune.ts:60-70`.',
            'The pages live in `src/pages/`.',
            '',
          ].join('\n'),
          'src/flow/compile.ts': numbered(200, {
            150: 'export function compileFlow() {',
          }),
          'src/flow/prune.ts': numbered(100),
          'src/pages/a.ts': numbered(5),
          'src/other.ts': numbered(5, { 2: '// ADR-0001' }),
        },
      },
    ])
    report = await createDriftReport(repo.path, { generatorVersion: '0.0.0' })
  })
  afterAll(() => repo.remove())

  it('sends the code that the record cites, after the code that cites it', async () => {
    const isFile = (path: string) =>
      Promise.resolve(
        repo.git('cat-file', '-t', `HEAD:${path}`).trim() === 'blob'
      )
    const request = await buildAcceptRequest(report, 1, read, {}, isFile)
    expect(AssistRequestSchema.parse(request)).toEqual(request)
    expect(
      request.code.map(e => [e.path, e.startLine, e.text.split('\n').length])
    ).toEqual([
      ['src/other.ts', 1, 5],
      // A cited file without lines gives its start, and a cited symbol its
      // declaration, each with the window of a citation.
      ['src/flow/compile.ts', 1, 31],
      ['src/flow/compile.ts', 140, 41],
      // Cited lines keep the same window around them. The folder gives nothing.
      ['src/flow/prune.ts', 50, 51],
    ])
    expect(request.omittedFiles).toEqual([])

    // Without isFile, a path cited whole gives nothing.
    const plain = await buildAcceptRequest(report, 1, read)
    expect(plain.code.map(e => [e.path, e.startLine])).toEqual([
      ['src/other.ts', 1],
      ['src/flow/compile.ts', 140],
      ['src/flow/prune.ts', 50],
    ])
  })
})
