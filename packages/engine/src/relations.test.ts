import type { Decision } from '@compadr/format'
import { describe, expect, it } from 'vitest'
import { changedBy, computeFamilies } from './relations.ts'

function decision(
  number: number,
  links: Partial<Pick<Decision, 'amends' | 'amendedBy' | 'supersededBy'>> = {}
): Decision {
  return {
    number,
    file: `docs/adr/${String(number).padStart(4, '0')}-x.md`,
    title: `Decision ${number}`,
    status: 'accepted',
    rawStatus: 'Accepted',
    date: null,
    revisedAt: null,
    lineCount: 1,
    feature: null,
    parent: null,
    amends: [],
    amendedBy: [],
    supersededBy: [],
    codeArea: null,
    ...links,
  }
}

describe('changedBy', () => {
  it('merges the links declared on both sides', () => {
    const decisions = [
      decision(1, { amendedBy: [4] }),
      decision(2, { supersededBy: [3] }),
      decision(3, { amends: [1, 2] }),
      decision(4),
    ]
    expect([...changedBy(decisions)]).toEqual([
      [1, [3, 4]],
      [2, [3]],
    ])
  })

  it('ignores a link from an older decision to a newer one', () => {
    expect(changedBy([decision(1, { amends: [5] }), decision(5)]).size).toBe(0)
  })
})

describe('computeFamilies', () => {
  it('attaches each detail to the oldest decision it changes', () => {
    const decisions = [
      decision(1),
      decision(2),
      decision(3, { amends: [1, 2] }),
      decision(4, { amends: [2] }),
      decision(5, { amends: [4] }),
    ]
    expect(computeFamilies(decisions)).toEqual([
      { principal: 1, details: [3], principalIsDetail: false },
      { principal: 2, details: [4], principalIsDetail: false },
      { principal: 4, details: [5], principalIsDetail: true },
    ])
  })

  it('lists the largest families first and skips unknown decisions', () => {
    const decisions = [
      decision(2),
      decision(5, { amends: [2] }),
      decision(6, { amends: [3] }),
      decision(7, { amends: [3] }),
      decision(8, { amends: [9] }),
    ]
    expect(computeFamilies(decisions)).toEqual([
      { principal: 2, details: [5], principalIsDetail: false },
    ])
    const known = [...decisions, decision(3)]
    expect(computeFamilies(known).map(f => f.principal)).toEqual([3, 2])
  })
})
