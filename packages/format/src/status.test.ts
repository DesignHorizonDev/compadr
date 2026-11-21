import { describe, expect, it } from 'vitest'
import { isInForce, normalizeStatus } from './status.ts'

describe('normalizeStatus', () => {
  it.each([
    ['Accepted', 'accepted'],
    ['accepted', 'accepted'],
    ['Acceptée', 'accepted'],
    ['Proposed', 'proposed'],
    ['Proposée', 'proposed'],
    ['draft', 'proposed'],
    ['Brouillon', 'proposed'],
    ['Rejected', 'rejected'],
    ['Rejetée', 'rejected'],
    ['Deprecated', 'deprecated'],
    ['Obsolète', 'deprecated'],
    ['Superseded by ADR-0012', 'superseded'],
    ['Remplacée par l’ADR 0012', 'superseded'],
    ['Decided', 'accepted'],
    ['Approved', 'accepted'],
    ['Approuvée', 'accepted'],
    ['Merged', 'accepted'],
    ['Pending', 'proposed'],
    ['Pending review', 'proposed'],
    ['Pending approval', 'proposed'],
    ['En attente', 'proposed'],
    ['To be decided', 'proposed'],
  ] as const)('reads "%s" as %s', (raw, status) => {
    expect(normalizeStatus(raw)).toBe(status)
  })

  it('keeps the first keyword of the text', () => {
    expect(normalizeStatus('Accepted (proposed on 2026-01-02)')).toBe(
      'accepted'
    )
    expect(normalizeStatus('Proposed, then accepted')).toBe('proposed')
  })

  it.each([
    ['Not accepted', 'unknown'],
    ['No longer accepted, superseded by ADR-0004', 'superseded'],
    ['Pas acceptée', 'unknown'],
    ['Never proposed, rejected', 'rejected'],
  ] as const)('does not read a negated keyword in "%s"', (raw, status) => {
    expect(normalizeStatus(raw)).toBe(status)
  })

  it.each(['', 'In progress', 'Undecided', 'Unapproved', null, undefined])(
    'returns unknown for %j',
    raw => {
      expect(normalizeStatus(raw)).toBe('unknown')
    }
  )
})

describe('isInForce', () => {
  it('excludes superseded and deprecated decisions', () => {
    expect(isInForce('accepted')).toBe(true)
    expect(isInForce('proposed')).toBe(true)
    expect(isInForce('superseded')).toBe(false)
    expect(isInForce('deprecated')).toBe(false)
  })
})
