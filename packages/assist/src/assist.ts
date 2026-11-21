// One round with an assist service: send the request, read the suggestion,
// run the guard, and keep only what the guard accepts.
import {
  verifySuggestion,
  type AssistProblem,
  type AssistVerdict,
} from '@compadr/engine'
import {
  AssistSuggestionSchema,
  type AssistRequest,
  type AssistSuggestion,
  type DriftReport,
} from '@compadr/format'
import type { AssistClient } from './client.ts'

export interface AssistOutcome {
  /** The suggestion without the items that the guard rejected; null when it rejected the whole. */
  suggestion: AssistSuggestion | null
  /** Every problem that the guard found, including those of the removed items. */
  problems: AssistProblem[]
  /** Number of items that the guard removed. */
  rejected: number
}

const ITEM = /^(\w+)\[(\d+)\]$/

/**
 * Removes from a suggestion the items that an error of the guard names. A
 * notice keeps its item. When the guard rejects the whole suggestion, there
 * is nothing left.
 */
export function keepAccepted(
  suggestion: AssistSuggestion,
  verdict: AssistVerdict
): { suggestion: AssistSuggestion | null; rejected: number } {
  if (!verdict.ok) return { suggestion: null, rejected: 0 }
  const removed = new Map<string, Set<number>>()
  for (const problem of verdict.problems) {
    if (problem.level !== 'error') continue
    const match = ITEM.exec(problem.item)
    if (match === null) continue
    const indexes = removed.get(match[1]!) ?? new Set<number>()
    indexes.add(Number(match[2]))
    removed.set(match[1]!, indexes)
  }
  const copy: Record<string, unknown> = { ...suggestion }
  let rejected = 0
  for (const [field, indexes] of removed) {
    const items = copy[field]
    if (!Array.isArray(items)) continue
    copy[field] = items.filter((_, index) => !indexes.has(index))
    rejected += indexes.size
  }
  return { suggestion: AssistSuggestionSchema.parse(copy), rejected }
}

/** Sends a request, then checks the suggestion against the request and the report. */
export async function runAssist(
  client: AssistClient,
  request: AssistRequest,
  report: DriftReport
): Promise<AssistOutcome> {
  const suggestion = await client.suggest(request)
  const verdict = verifySuggestion(request, suggestion, report)
  return { ...keepAccepted(suggestion, verdict), problems: verdict.problems }
}
