// Where the console gets its drift reports. The contract is two read-only
// routes: `GET /api/reports` lists the reports, and `GET /api/reports/:id`
// returns one of them. A third route is optional: `GET
// /api/reports/:id/findings` returns the findings of the last semantic check
// kept for the report, or 404. Their commit may differ from that of the
// report: the console says so. `GET /api/reports/:id/recommendations/:n`, as
// optional, returns the recommendation of the assist service on the proposed
// decision n, or 404. `GET /api/reports/:id/consolidations/:n`, as optional,
// returns the rules in force that the service consolidated along the chain of
// decision n, or 404. The development server implements them from a folder
// (dev/reports-api.ts); the portal will implement the same routes.
import {
  AssistSuggestionSchema,
  DriftReportSchema,
  SemanticFindingsSchema,
  type AcceptSuggestion,
  type ConsolidateSuggestion,
  type DriftReport,
  type SemanticFindings,
} from '@compadr/format'

export const REPORTS_API = '/api/reports'

/** What the list route returns for each report. */
export interface ReportSummary {
  id: string
  repository: { name: string; ref: string; commit: string }
  generatedAt: string
}

export interface ReportList {
  reports: ReportSummary[]
}

export interface ReportSource {
  list(): Promise<ReportSummary[]>
  get(id: string): Promise<DriftReport>
  /** The findings of a semantic check on the report, or null when there are none. */
  findings?(id: string): Promise<SemanticFindings | null>
  /** The recommendation on a proposed decision, or null when there is none. */
  recommendation?(
    id: string,
    decision: number
  ): Promise<AcceptSuggestion | null>
  /** The rules consolidated along the chain of a decision, or null when there are none. */
  consolidation?(
    id: string,
    decision: number
  ): Promise<ConsolidateSuggestion | null>
}

export function summarize(id: string, report: DriftReport): ReportSummary {
  const { name, ref, commit } = report.repository
  return {
    id,
    repository: { name, ref, commit },
    generatedAt: report.generatedAt,
  }
}

/** Reads the reports over HTTP. The report itself is checked against the schema. */
export function httpReportSource(
  fetch: typeof globalThis.fetch = globalThis.fetch.bind(globalThis)
): ReportSource {
  async function getJson(url: string): Promise<unknown> {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
    })
    if (!response.ok) {
      // The routes explain an error in an `error` field, when they can.
      const reason = await response
        .json()
        .then(body => (body as { error?: unknown }).error)
        .catch(() => undefined)
      throw new Error(
        typeof reason === 'string'
          ? `${url} answered ${response.status}: ${reason}`
          : `${url} answered ${response.status}`
      )
    }
    return response.json()
  }

  return {
    async list() {
      const body = (await getJson(REPORTS_API)) as ReportList
      return body.reports
    },
    async get(id) {
      return DriftReportSchema.parse(
        await getJson(`${REPORTS_API}/${encodeURIComponent(id)}`)
      )
    },
    async findings(id) {
      const url = `${REPORTS_API}/${encodeURIComponent(id)}/findings`
      const response = await fetch(url, {
        headers: { accept: 'application/json' },
      })
      // A server without the route, or a report without findings.
      if (response.status === 404) return null
      if (!response.ok) throw new Error(`${url} answered ${response.status}`)
      return SemanticFindingsSchema.parse(await response.json())
    },
    async recommendation(id, decision) {
      const url = `${REPORTS_API}/${encodeURIComponent(id)}/recommendations/${decision}`
      const response = await fetch(url, {
        headers: { accept: 'application/json' },
      })
      // A server without the route, or a decision without a recommendation.
      if (response.status === 404) return null
      if (!response.ok) throw new Error(`${url} answered ${response.status}`)
      const suggestion = AssistSuggestionSchema.parse(await response.json())
      if (suggestion.kind !== 'accept') {
        throw new Error(`${url} holds no accept suggestion`)
      }
      return suggestion
    },
    async consolidation(id, decision) {
      const url = `${REPORTS_API}/${encodeURIComponent(id)}/consolidations/${decision}`
      const response = await fetch(url, {
        headers: { accept: 'application/json' },
      })
      // A server without the route, or a decision without a consolidation.
      if (response.status === 404) return null
      if (!response.ok) throw new Error(`${url} answered ${response.status}`)
      const suggestion = AssistSuggestionSchema.parse(await response.json())
      if (suggestion.kind !== 'consolidate') {
        throw new Error(`${url} holds no consolidate suggestion`)
      }
      return suggestion
    },
  }
}
