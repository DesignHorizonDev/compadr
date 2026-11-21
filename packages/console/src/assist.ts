// The versions in plain language that the console server asks the assist
// service for, when it was started with COMPADR_ASSIST_URL and
// COMPADR_ASSIST_TOKEN:
//
// - `GET /api/assist` answers 200 when the server can ask the service;
// - `GET /api/assist/:id/plain/:n` gives the version already kept for
//   decision n of report `:id`, as the record is now, or 404, or 403 when
//   `assist.exclude` of compadr.yml keeps the record in the repository;
// - `POST /api/assist/:id/plain/:n` gives that version, and asks the service
//   for a new one when none is kept. Each new version costs;
// - `GET /api/assist/:id/draft` gives the outcome already kept for the change
//   of branch report `:id` at its commit, or 404, or 403 when
//   `assist.exclude` keeps every file of the change in the repository, or
//   409 when the draft of the branch holds a record for an earlier commit;
// - `POST /api/assist/:id/draft` gives that outcome, and otherwise sends the
//   change to the service, which drafts a record. The record goes into a new
//   local draft that starts at the tip of the branch. Each draft costs.
//
// `GET /api/assist` says which of the two the server offers. A server
// without the service answers 404 on every route, and the pages show no
// button.
import { AssistSuggestionSchema, type PlainSuggestion } from '@compadr/format'
import { csrfHeaders } from './csrf.ts'

export const ASSIST_API = '/api/assist'

/** What the server offers, as `GET /api/assist` says it. */
export interface AssistAvailability {
  plain: boolean
  /** Whether the server drafts a record from the change of a branch. */
  draft: boolean
}

/** The record that the service drafted from the change of a branch. */
export interface DraftDecisionOutcome {
  model: string
  promptVersion: string
  /** When the service answered. */
  createdAt: string
  /** The commit of the branch that the change ends at. */
  commit: string
  /** The files of the change that stayed in the repository. */
  excluded: string[]
  /** What the guard says of the answer of the service. */
  problems: {
    level: 'error' | 'notice'
    code: string
    item: string
    message: string
  }[]
  result:
    | {
        kind: 'drafted'
        /** Name of the local draft that holds the record. */
        draft: string
        /** Report of the draft, on the report routes. */
        reportId: string | null
        number: number
        path: string
        title: string
        /** What a person checks in the record before publishing it. */
        notes: string[]
      }
    | {
        kind: 'not-needed'
        /** Why the change needs no new record, as the service says. */
        reason: string
      }
}

export interface DraftDecisionSource {
  /** Whether the server drafts records from the change of a branch. */
  available(): Promise<boolean>
  /**
   * The outcome kept for a branch report, null without one, `excluded` when
   * every file of the change stays in the repository, or `waiting` with the
   * reason when the draft of the branch waits for review.
   */
  cached(
    reportId: string
  ): Promise<DraftDecisionOutcome | null | 'excluded' | { waiting: string }>
  /** The outcome kept, or a new draft. Each new draft costs. */
  draft(reportId: string): Promise<DraftDecisionOutcome>
}

export interface PlainSource {
  /** Whether the server can ask the service. */
  available(): Promise<boolean>
  /**
   * The version kept for a decision, null without one, or `excluded` for a
   * record that never leaves the repository.
   */
  cached(
    reportId: string,
    decision: number
  ): Promise<PlainSuggestion | null | 'excluded'>
  /** The version kept, or a new one. */
  read(reportId: string, decision: number): Promise<PlainSuggestion>
}

function plainOf(value: unknown, url: string): PlainSuggestion {
  const suggestion = AssistSuggestionSchema.parse(value)
  if (suggestion.kind !== 'plain') {
    throw new Error(`${url} holds no plain suggestion`)
  }
  return suggestion
}

async function failure(response: Response, url: string): Promise<Error> {
  const reason = await response
    .json()
    .then(body => (body as { error?: unknown }).error)
    .catch(() => undefined)
  return new Error(
    typeof reason === 'string' ? reason : `${url} answered ${response.status}`
  )
}

/** What the server offers, or nothing when it does not ask the service. */
export async function assistAvailability(
  fetch: typeof globalThis.fetch = globalThis.fetch.bind(globalThis)
): Promise<AssistAvailability> {
  const response = await fetch(ASSIST_API, {
    headers: { accept: 'application/json' },
  }).catch(() => null)
  if (response?.ok !== true) return { plain: false, draft: false }
  const body = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >
  // A server older than the drafting of decisions answers { plain: true }.
  return { plain: body.plain !== false, draft: body.draft === true }
}

export function httpDraftDecisionSource(
  fetch: typeof globalThis.fetch = globalThis.fetch.bind(globalThis)
): DraftDecisionSource {
  const route = (id: string) => `${ASSIST_API}/${encodeURIComponent(id)}/draft`
  return {
    async available() {
      return (await assistAvailability(fetch)).draft
    },
    async cached(id) {
      const url = route(id)
      const response = await fetch(url, {
        headers: { accept: 'application/json' },
      })
      if (response.status === 404) return null
      if (response.status === 403) return 'excluded'
      if (response.status === 409) {
        return { waiting: (await failure(response, url)).message }
      }
      if (!response.ok) throw await failure(response, url)
      return (await response.json()) as DraftDecisionOutcome
    },
    async draft(id) {
      const url = route(id)
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          ...csrfHeaders(),
        },
        body: '{}',
      })
      if (!response.ok) throw await failure(response, url)
      return (await response.json()) as DraftDecisionOutcome
    },
  }
}

export function httpPlainSource(
  fetch: typeof globalThis.fetch = globalThis.fetch.bind(globalThis)
): PlainSource {
  const route = (id: string, decision: number) =>
    `${ASSIST_API}/${encodeURIComponent(id)}/plain/${decision}`
  return {
    async available() {
      return (await assistAvailability(fetch)).plain
    },
    async cached(id, decision) {
      const url = route(id, decision)
      const response = await fetch(url, {
        headers: { accept: 'application/json' },
      })
      if (response.status === 404) return null
      if (response.status === 403) return 'excluded'
      if (!response.ok) throw await failure(response, url)
      return plainOf(await response.json(), url)
    },
    async read(id, decision) {
      const url = route(id, decision)
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          ...csrfHeaders(),
        },
        body: '{}',
      })
      if (!response.ok) throw await failure(response, url)
      return plainOf(await response.json(), url)
    },
  }
}
