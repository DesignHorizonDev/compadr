// The state of the rules in force that a person validated for a feature: each
// record of the amendment chain carries the fingerprint of its text at the
// validation, and a record that changes, joins or leaves the chain since then
// makes the rules stale. A stale rule is a notice: it never fails a check.
import { createHash } from 'node:crypto'
import type { DriftReport, ValidatedRules } from '@compadr/format'
import { amendmentChain } from './assist.ts'

/** Fingerprint of the text of a record, line endings aside. */
export function recordHash(markdown: string): string {
  const digest = createHash('sha256')
    .update(markdown.replace(/\r\n/g, '\n'))
    .digest('hex')
  return `sha256:${digest.slice(0, 16)}`
}

/**
 * The records that make validated rules stale: those of the chain whose text
 * changed or that joined it, those that left it, and the main decision when
 * the feature names another one. Empty when the rules are current.
 */
export function staleRecords(
  report: Pick<DriftReport, 'decisions'>,
  main: number | null,
  rules: ValidatedRules,
  texts: ReadonlyMap<number, string>
): number[] {
  const stored = new Map(rules.chain.map(entry => [entry.decision, entry.hash]))
  const chain = amendmentChain(report as DriftReport, rules.decision)
  const stale = new Set<number>()
  for (const number of chain) {
    const text = texts.get(number)
    if (text === undefined || stored.get(number) !== recordHash(text)) {
      stale.add(number)
    }
  }
  for (const number of stored.keys()) {
    if (!chain.includes(number)) stale.add(number)
  }
  if (main !== rules.decision && main !== null) stale.add(main)
  return [...stale].sort((a, b) => a - b)
}
