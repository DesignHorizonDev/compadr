// The local draft of a repository, as the console server serves it. The
// actions of correction of the console add their commit to the draft:
//
// - `GET /api/drafts/:id` gives the draft of the repository of report `:id`;
// - `POST /api/drafts/:id/checks` records checked references;
// - `POST /api/drafts/:id/anchors` anchors references on their symbol;
// - `POST /api/drafts/:id/accepts` accepts a proposed decision;
// - `POST /api/drafts/:id/rules` validates the rules in force of a feature.
//
// The publication stays an explicit command of the command line. The
// development server has no drafts: the routes answer 404, and the console
// then gives the commands to run.

import { shellArgument } from './review/commands.ts'
import { csrfHeaders } from './csrf.ts'

export const DRAFTS_API = '/api/drafts'

export interface DraftCommitSummary {
  commit: string
  subject: string
  /** Name of the author of the commit. */
  author: string
}

/** One draft of the repository, for the list of the drafts. */
export interface DraftSummary {
  name: string
  reportId: string
  commits: number
  /** Authors of the commits, in the order of their first commit. */
  authors: string[]
}

export interface DraftState {
  /** Name of the draft that the actions fill. */
  name: string
  /** Path of the repository, for the commands of the command line. */
  repository: string
  /** Identifier of the report of the repository, on the report routes. */
  baseReportId: string
  /** Identifier of the report of the tip of the draft, once it exists. */
  reportId: string | null
  /** Commit the draft starts from, once it exists. */
  base: string | null
  baseBranch: string | null
  commits: DraftCommitSummary[]
  /** Every draft of the repository, by name. */
  drafts: DraftSummary[]
}

export interface CheckRequest {
  references: string[]
  /** Name of the draft to fill; the draft of the page by default. */
  draft?: string
  /** The person who checked; the git user of the repository by default. */
  by?: string
}

export interface AnchorRequest {
  references: string[]
  draft?: string
  withLines: boolean
}

export interface AcceptDecisionRequest {
  decision: number
  draft?: string
  /** The recommendation that the person followed, for the message. */
  recommendation?: {
    recommendation: 'accept'
    model: string
    promptVersion: string
  }
}

export interface ValidateRulesRequest {
  /** Identifier of the feature. The server reads the consolidation itself. */
  feature: string
  draft?: string
}

export interface DraftSource {
  /**
   * A draft of the repository of a report, or null without drafts: the
   * draft that `draft` names, else the draft of the report or the default.
   */
  get(reportId: string, draft?: string): Promise<DraftState | null>
  check(reportId: string, request: CheckRequest): Promise<DraftState>
  anchor(reportId: string, request: AnchorRequest): Promise<DraftState>
  accept(reportId: string, request: AcceptDecisionRequest): Promise<DraftState>
  validateRules(
    reportId: string,
    request: ValidateRulesRequest
  ): Promise<DraftState>
}

async function answer<T>(response: Response, route: string): Promise<T> {
  if (!response.ok) {
    let message = `${route} answered ${response.status}`
    try {
      const body = (await response.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      // The status says enough.
    }
    throw new Error(message)
  }
  return (await response.json()) as T
}

/** Reads and fills the drafts over HTTP. */
export function httpDraftSource(
  fetch: typeof globalThis.fetch = globalThis.fetch.bind(globalThis)
): DraftSource {
  const route = (id: string, action = '') =>
    `${DRAFTS_API}/${encodeURIComponent(id)}${action}`
  const post = <T>(path: string, body: unknown) =>
    fetch(path, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...csrfHeaders(),
      },
      body: JSON.stringify(body),
    }).then(response => answer<T>(response, path))
  return {
    async get(reportId, draft) {
      const path =
        draft === undefined
          ? route(reportId)
          : `${route(reportId)}?draft=${encodeURIComponent(draft)}`
      const response = await fetch(path, {
        headers: { accept: 'application/json' },
      })
      if (response.status === 404) return null
      return answer<DraftState>(response, path)
    },
    check: (reportId, request) =>
      post<DraftState>(route(reportId, '/checks'), request),
    anchor: (reportId, request) =>
      post<DraftState>(route(reportId, '/anchors'), request),
    accept: (reportId, request) =>
      post<DraftState>(route(reportId, '/accepts'), request),
    validateRules: (reportId, request) =>
      post<DraftState>(route(reportId, '/rules'), request),
  }
}

/** The command that publishes the draft as one pull request. */
export function publishDraftCommand(draft: DraftState): string {
  return `compadr draft publish ${shellArgument(draft.repository)} ${draft.name} --open-pr`
}

/** The command that deletes the draft. */
export function discardDraftCommand(draft: DraftState): string {
  return `compadr draft discard ${shellArgument(draft.repository)} ${draft.name}`
}
