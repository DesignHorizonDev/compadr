import { describe, expect, it } from 'vitest'
import { proposedApplied } from './proposed-applied.ts'
import type { Decision } from './report-schema.ts'

const decision = (number: number, status: Decision['status']) =>
  ({ number, status, title: `Decision ${number}` }) as Decision

describe('proposedApplied', () => {
  it('lists the proposed decisions that files of the code cite', () => {
    const found = proposedApplied({
      decisions: [
        decision(3, 'proposed'),
        decision(1, 'accepted'),
        decision(2, 'proposed'),
        decision(4, 'proposed'),
      ],
      citations: [
        { file: 'src/b.ts', line: 1, decision: 2, inCode: true },
        { file: 'src/a.ts', line: 4, decision: 2, inCode: true },
        { file: 'src/a.ts', line: 9, decision: 2, inCode: true },
        { file: 'src/a.ts', line: 1, decision: 1, inCode: true },
        // A guide that cites a decision is no sign that the code applies it.
        { file: 'docs/guide.md', line: 2, decision: 4, inCode: false },
      ],
    })
    expect(found.map(f => [f.decision.number, f.files])).toEqual([
      [2, ['src/a.ts', 'src/b.ts']],
    ])
  })
})
