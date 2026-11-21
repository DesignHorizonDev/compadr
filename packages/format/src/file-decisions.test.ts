import { describe, expect, it } from 'vitest'
import {
  decisionsForFile,
  linkedPaths,
  normalizeRepositoryPath,
} from './file-decisions.ts'
import type { CodeReference, Decision, DriftReport } from './report-schema.ts'
import type { DecisionStatus } from './status.ts'

function decision(
  number: number,
  status: DecisionStatus = 'accepted',
  supersededBy: number[] = []
): Decision {
  return {
    number,
    file: `docs/adr/${String(number).padStart(4, '0')}-d.md`,
    title: `Decision ${number}`,
    status,
    rawStatus: status,
    date: null,
    revisedAt: null,
    lineCount: 10,
    feature: null,
    parent: null,
    amends: [],
    amendedBy: [],
    supersededBy,
    codeArea: null,
  }
}

function cites(
  number: number,
  line: number,
  path: string,
  fields: Partial<Extract<CodeReference, { kind: 'path' }>> = {}
): CodeReference {
  return {
    kind: 'path',
    id: `${String(number).padStart(4, '0')}:${fields.text ?? path}:1`,
    decision: number,
    adrLine: line,
    column: 1,
    text: path,
    citedAt: '2026-01-10T09:00:00Z',
    path,
    lines: null,
    resolvedPaths: [path],
    anchor: null,
    ...fields,
  }
}

const REPORT = {
  decisions: [
    decision(1),
    decision(2),
    decision(3, 'superseded', [5]),
    decision(4, 'proposed'),
    decision(5),
    decision(6, 'rejected'),
    decision(7, 'superseded'),
  ],
  references: [
    cites(1, 4, 'src'),
    cites(2, 8, 'src/billing/charge.ts', {
      lines: { start: 3, end: 9 },
      text: 'src/billing/charge.ts:3-9',
    }),
    cites(2, 9, 'src/billing'),
    cites(4, 3, 'src/billing/charge.ts'),
    cites(6, 3, 'src/billing/charge.ts'),
    cites(7, 3, 'src/billing/charge.ts'),
    cites(1, 5, 'src/other.ts'),
  ],
  citations: [
    { file: 'src/billing/charge.ts', line: 12, decision: 2, inCode: true },
    { file: 'src/billing/charge.ts', line: 40, decision: 3, inCode: true },
    { file: 'docs/guide.md', line: 2, decision: 1, inCode: false },
  ],
} as unknown as DriftReport

describe('decisionsForFile', () => {
  it('ranks the decisions and leads a superseded one to its successor', () => {
    const answer = decisionsForFile(REPORT, './src//billing/charge.ts')
    expect(answer.path).toBe('src/billing/charge.ts')
    expect(
      answer.inForce.map(e => [e.decision, e.scope, e.replaces, e.links.length])
    ).toEqual([
      // Both directions, on the file itself.
      [2, 'file', [], 3],
      // The file cites 3, which 5 replaces.
      [5, 'file', [3], 1],
      // Through the folder src only.
      [1, 'folder', [], 1],
    ])
    expect(answer.inForce[0]!.links[0]).toEqual({
      source: 'record-cites-path',
      decision: 2,
      reference: '0002:src/billing/charge.ts:3-9:1',
      text: 'src/billing/charge.ts:3-9',
      path: 'src/billing/charge.ts',
      lines: { start: 3, end: 9 },
      symbol: null,
      citedAt: '2026-01-10T09:00:00Z',
    })
    expect(answer.context.map(e => e.decision)).toEqual([4])
    // Rejected, and superseded without a known successor.
    expect(answer.outOfForce.map(e => e.decision)).toEqual([6, 7])
  })

  it('has nothing for a file without link', () => {
    expect(decisionsForFile(REPORT, 'README.md')).toEqual({
      path: 'README.md',
      inForce: [],
      context: [],
      outOfForce: [],
    })
  })

  it('follows a chain of successors and stops on a cycle', () => {
    const report = {
      ...REPORT,
      decisions: [
        decision(1, 'superseded', [2]),
        decision(2, 'superseded', [3, 1]),
        decision(3),
      ],
      references: [cites(1, 3, 'a.ts')],
      citations: [],
    } as unknown as DriftReport
    expect(
      decisionsForFile(report, 'a.ts').inForce.map(e => [
        e.decision,
        e.replaces,
      ])
    ).toEqual([[3, [1]]])
  })

  it('reaches a successor once through two replaced decisions', () => {
    const report = {
      ...REPORT,
      decisions: [
        decision(1, 'superseded', [2, 3]),
        decision(2, 'superseded', [4]),
        decision(3, 'superseded', [4]),
        decision(4),
      ],
      references: [],
      citations: [{ file: 'a.ts', line: 1, decision: 1, inCode: true }],
    } as unknown as DriftReport
    expect(decisionsForFile(report, 'a.ts').inForce).toMatchObject([
      { decision: 4, replaces: [1], links: [{ decision: 1, line: 1 }] },
    ])
  })
})

describe('linkedPaths', () => {
  it('counts the decisions of each linked path', () => {
    expect(linkedPaths(REPORT)).toEqual([
      { path: 'docs/guide.md', decisions: 1 },
      { path: 'src', decisions: 1 },
      { path: 'src/billing', decisions: 1 },
      { path: 'src/billing/charge.ts', decisions: 5 },
      { path: 'src/other.ts', decisions: 1 },
    ])
  })
})

describe('normalizeRepositoryPath', () => {
  it('keeps a path of the repository in one form', () => {
    expect(normalizeRepositoryPath('.\\src\\a.ts')).toBe('src/a.ts')
    expect(normalizeRepositoryPath('./src/')).toBe('src')
  })
})
