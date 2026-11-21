export const DECISION_STATUSES = [
  'proposed',
  'accepted',
  'rejected',
  'deprecated',
  'superseded',
  'unknown',
] as const

export type DecisionStatus = (typeof DECISION_STATUSES)[number]

// Keywords of each status, in English and in French. Log4brains `draft` counts
// as proposed.
const STATUS_KEYWORDS: readonly [DecisionStatus, RegExp][] = [
  ['superseded', /supersed|remplac[ée]+ par/g],
  ['deprecated', /deprecat|obsol[eè]te/g],
  ['rejected', /reject|rejet/g],
  ['proposed', /propos|draft|brouillon/g],
  ['accepted', /accept/g],
]

// A keyword right after a negation does not give the status: "not accepted",
// "no longer accepted", "pas acceptée".
const NEGATION = /\b(?:not|never|no longer|non|pas|jamais)\s+$/

/**
 * Reads the status of a decision from its raw text. The first keyword of the
 * text wins: "Accepted (proposed on 2026-01-02)" is accepted.
 */
export function normalizeStatus(
  raw: string | null | undefined
): DecisionStatus {
  const text = (raw ?? '').toLowerCase()
  let best: { index: number; status: DecisionStatus } | null = null
  for (const [status, keyword] of STATUS_KEYWORDS) {
    const match = [...text.matchAll(keyword)].find(
      m => !NEGATION.test(text.slice(0, m.index))
    )
    if (match && (best === null || match.index < best.index)) {
      best = { index: match.index, status }
    }
  }
  return best?.status ?? 'unknown'
}

/** A superseded or deprecated decision is no longer in force. */
export function isInForce(status: DecisionStatus): boolean {
  return status !== 'superseded' && status !== 'deprecated'
}
