// The record that the assist service drafts from a change, for the `assist`
// option of the MCP tool `propose_decision`. An agent sends changes on its
// own: the consent is the one of the semantic check. Nothing leaves the
// repository unless its compadr.yml sets assist.semantic, and the paths that
// it excludes never leave. The guard checks the answer before the agent
// reads it, and the record keeps the status proposed: a person accepts it.
import {
  buildDraftRequest,
  parseUnifiedDiff,
  type AssistProblem,
} from '@compadr/engine'
import type { DraftSuggestion, DriftReport } from '@compadr/format'
import { runAssist } from './assist.ts'
import { AssistCapReachedError, httpAssistClient } from './client.ts'
import { notSent, withoutExcluded, type SemanticOptions } from './semantic.ts'

export type ChangeDraft =
  /** Nothing was sent, and why; `capped` at the cap of the AI credits. */
  | { status: 'skipped'; reason: string; capped?: true }
  /** The request was sent and did not get a usable answer. */
  | { status: 'failed'; reason: string }
  | {
      status: 'done'
      suggestion: DraftSuggestion
      /** What the guard says of the answer. */
      problems: AssistProblem[]
      /** Changed files that compadr.yml kept from the service. */
      excluded: string[]
    }

/** Asks the assist service to draft the record of a change. */
export async function draftFromChange(
  report: DriftReport,
  diff: string,
  options: SemanticOptions
): Promise<ChangeDraft> {
  const reason = notSent(report, options, 'the assist service')
  if (reason !== null) return { status: 'skipped', reason }
  const kept = withoutExcluded(diff, report)
  if (parseUnifiedDiff(kept.diff).length === 0) {
    return {
      status: 'skipped',
      reason:
        kept.excluded.length > 0
          ? 'every file of the change stays in the repository: assist.exclude of compadr.yml names it'
          : 'the change holds no file of a unified diff',
    }
  }
  const request = buildDraftRequest(report, kept.diff)
  let outcome
  try {
    const client = (
      options.client ?? ((url, token) => httpAssistClient({ url, token }))
    )(options.url!, options.token!)
    outcome = await runAssist(client, request, report)
  } catch (error) {
    if (error instanceof AssistCapReachedError) {
      return { status: 'skipped', reason: error.message, capped: true }
    }
    return { status: 'failed', reason: (error as Error).message }
  }
  const suggestion = outcome.suggestion
  if (suggestion === null || suggestion.kind !== 'draft') {
    return {
      status: 'failed',
      reason: `the guard rejected the answer of the service: ${outcome.problems[0]?.message ?? ''}`,
    }
  }
  return {
    status: 'done',
    suggestion,
    problems: outcome.problems,
    excluded: kept.excluded,
  }
}
