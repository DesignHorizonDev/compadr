// Where the console finds the decisions to review. The console server
// answers `GET /api/reviews` with the branches that add or change a record
// with the status "proposed", compared with the reference it follows, and
// with the branches that change the code without proposing a record. The
// report of each branch is a report like the others, on the report routes.

export const REVIEWS_API = '/api/reviews'

/** A record that a branch adds or changes, with the status "proposed". */
export interface ProposedRecord {
  number: number
  title: string
  /** Path of the record in the repository. */
  file: string
  change: 'added' | 'changed'
}

/** The open pull request of a branch, when GitHub gives one. */
export interface PullRequestLink {
  number: number
  title: string
  url: string
  draft: boolean
}

export interface ReviewSummary {
  /** Identifier of the report of the branch, on the report routes. */
  reportId: string
  /** Identifier of the report of the reference the server follows. */
  baseReportId: string
  branch: string
  commit: string
  pullRequest: PullRequestLink | null
  proposed: ProposedRecord[]
}

/** A branch ahead of the reference that proposes no record. */
export interface BranchChange {
  /** Identifier of the report of the branch, on the report routes. */
  reportId: string
  /** Identifier of the report of the reference the server follows. */
  baseReportId: string
  branch: string
  commit: string
  pullRequest: PullRequestLink | null
}

export interface ReviewList {
  reviews: ReviewSummary[]
  /** Absent from a server older than the drafting of decisions. */
  changes?: BranchChange[]
}

export interface ReviewSource {
  /** The reviews, or null when the server does not serve them. */
  list(): Promise<Required<ReviewList> | null>
}

/** Reads the reviews over HTTP. The development server has none (404). */
export function httpReviewSource(
  fetch: typeof globalThis.fetch = globalThis.fetch.bind(globalThis)
): ReviewSource {
  return {
    async list() {
      const response = await fetch(REVIEWS_API, {
        headers: { accept: 'application/json' },
      })
      if (response.status === 404) return null
      if (!response.ok) {
        throw new Error(`${REVIEWS_API} answered ${response.status}`)
      }
      const list = (await response.json()) as ReviewList
      return { reviews: list.reviews, changes: list.changes ?? [] }
    },
  }
}
