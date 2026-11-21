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
// as proposed, and so does a decision that waits for a review ("Pending
// review", "To be decided"). "Decided", "Approved" and "Merged" (the pull
// request of the record) count as accepted. A keyword starts a word:
// "Undecided" and "Unapproved" give no status.
const STATUS_KEYWORDS: readonly [DecisionStatus, RegExp][] = [
  ['superseded', /supersed|remplac[ée]+ par/g],
  ['deprecated', /deprecat|obsol[eè]te/g],
  ['rejected', /reject|rejet/g],
  [
    'proposed',
    /propos|draft|brouillon|(?<![a-z])pending|en attente|to be decided|[àa] d[ée]cider/g,
  ],
  [
    'accepted',
    /accept|(?<![a-z])(?:decided|d[ée]cid[ée]e?s?|approved|approuv[ée]e?s?|merged)(?![a-z])/g,
  ],
]

// A keyword right after a negation does not give the status: "not accepted",
// "no longer accepted", "pas acceptée".
const NEGATION = /\b(?:not|never|no longer|non|pas|jamais)\s+$/
// The negation and its spaces sit in the few characters before the keyword:
// reading only those keeps the reading linear in the length of the text. A
// negation followed by more than about 30 spaces is no longer read.
const NEGATION_REACH = 40

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
      m =>
        !NEGATION.test(
          text.slice(Math.max(0, m.index - NEGATION_REACH), m.index)
        )
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
