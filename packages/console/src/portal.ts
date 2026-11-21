// What the portal adds to the routes of the console: the overview of the
// repositories and the drift queue of all of them. The console alone does
// not serve these routes, and the source then answers null.
import { csrfHeaders } from './csrf.ts'
import type { DriftLevel } from './drift/signals.ts'
import type { DraftState } from './drafts.ts'

export const PORTAL_API = '/api/portal'

/** One repository of the portal, at its followed reference. */
export interface RepositoryOverview {
  /** Identifier of the report of the followed reference. */
  reportId: string
  name: string
  ref: string
  commit: string
  generatedAt: string
  decisions: { total: number; inForce: number; proposed: number }
  signals: Record<DriftLevel, number>
  /** Zones of code with a strong or partial coverage, or null without zones. */
  zones: { total: number; covered: number } | null
  /** Last scheduled computation, or null before the first one. */
  refreshedAt: string | null
  /** Why the last scheduled computation failed, or null. */
  refreshError: string | null
}

export interface PortalOverview {
  repositories: RepositoryOverview[]
  /** Repositories whose report could not be read. */
  problems: { reportId: string; message: string }[]
  /** Seconds between two scheduled computations, or 0 when none runs. */
  refreshIntervalSeconds: number
  /**
   * Repositories that the hosted service does not serve because of a quota.
   * The portal lists them for its administrators only.
   */
  unserved?: UnservedRepository[]
}

/** Why the hosted service does not serve a repository. */
export type UnservedReason = 'repositories' | 'size' | 'unknown-size'

/** A repository that the hosted service does not serve, for an administrator. */
export interface UnservedRepository {
  /** `owner/name` of the repository on GitHub. */
  github: string
  reason: UnservedReason
  /**
   * The quota: a number of repositories for `repositories`, kilobytes per
   * repository for `size` and `unknown-size`.
   */
  quota: number
  /** Size of the repository in kilobytes, when GitHub gave it. */
  kilobytes?: number
}

/** One signal of the drift queue. */
export interface QueueRow {
  reportId: string
  repository: string
  signalId: string
  level: DriftLevel
  title: string
  target: string
  note: string | null
  decision: number
  decisionTitle: string | null
  area: string | null
  /** Date the drift relates to, or null. */
  citedAt: string | null
}

export interface DriftQueue {
  rows: QueueRow[]
}

export type Role = 'reader' | 'editor' | 'admin'

/** The person who uses the page. */
export interface Me {
  login: string
  name: string
  role: Role
  /** Whether the portal signs people in, and can sign them out. */
  signsIn: boolean
}

export interface Person {
  login: string
  name: string
  lastSeenAt: string
  seat: boolean
  /** Whether the seat gives the right to edit within the license. */
  active: boolean
  admin: boolean
}

export interface People {
  people: Person[]
  /** People who may edit: the seats and the administrators. */
  editors: number
  /** Editors that the license allows, administrators included. */
  limit: number
}

export type Verdict = 'approve' | 'request-changes' | 'comment'

/** The review of a draft, as the portal serves it. */
export interface DraftReview {
  draft: DraftState
  /** Commit at the tip of the draft, which a review names. */
  tip: string
  /** The commit whose patch this is, or null for the whole draft. */
  commit: string | null
  files: string[]
  patch: string
  truncated: boolean
  reviews: {
    login: string
    verdict: Verdict
    body: string
    tip: string
    at: string
  }[]
  comments: {
    login: string
    path: string
    line: number | null
    body: string
    tip: string
    at: string
  }[]
  publications: {
    login: string
    tip: string
    pullRequest: string | null
    pushedTo: string
    at: string
  }[]
  rule: {
    required: number
    approvedBy: string[]
    changesRequestedBy: string[]
    publishable: boolean
    reason: string | null
  }
}

/** The GitHub App of a portal, for an administrator. */
export interface GitHubAppState {
  organization: string
  registered: boolean
  slug: string | null
  htmlUrl: string | null
  installUrl: string | null
  installation: { id: number; account: string } | null
  /** Why the installation could not be read, or null. */
  problem: string | null
  repositories: {
    id: string
    github: string
    served: boolean
    error: string | null
  }[]
}

/** The license of a portal, as the people of the team see it. */
export interface LicenseInfo {
  mode: 'licensed' | 'free'
  reason: string | null
  limits: { repositories: number | null; editors: number }
  license: {
    id: string
    licensee: string
    plan: string
    expiresAt: string
    /** Whether the hosted service signed it as a trial. */
    trial?: boolean
  } | null
  /** Repositories that wait for a license. */
  unlicensedRepositories: string[]
}

/** The AI credits of the month, as the assist service counts them, in UTC. */
export interface UsageInfo {
  /** YYYY-MM. */
  month: string
  /** Credits included each month, from the license. */
  included: number
  /** The cap in force. */
  cap: number
  /** Whether an administrator set the cap; otherwise it is the included volume. */
  capSet: boolean
  used: number
  byKind: Record<string, number>
  byRepository: Record<string, number>
}

/** The invitations of a customer of the hosted service, for its administrators. */
export interface InvitationsInfo {
  /** Invitations that the customer can send in all. */
  allowance: number
  /** Invitations that the customer can still send. */
  remaining: number
  /** ISO date from which the customer can invite. */
  invitesFrom: string
  /** The page where an invited account signs up. */
  signUpUrl: string
  /** The invitations sent, the most recent first. */
  invitations: {
    account: string
    email: string | null
    invitedBy: string | null
    invitedAt: string
    expiresAt: string
    usedAt: string | null
    status: 'open' | 'used' | 'expired' | 'revoked'
  }[]
}

export const SIGN_OUT_PATH = '/auth/logout'
/** The page after a sign-out, which does not sign in again. */
export const SIGNED_OUT_PATH = '/auth/signed-out'

export interface PortalSource {
  /** The overview, or null when the server is not a portal. */
  overview(): Promise<PortalOverview | null>
  queue(): Promise<DriftQueue>
  me(): Promise<Me | null>
  people(): Promise<People>
  /** Gives (true) or takes back (false) the editor seat of a person. */
  setSeat(login: string, seat: boolean): Promise<People>
  signOut(): Promise<void>
  /** The review of a draft, or of one of its commits. */
  draftReview(
    repository: string,
    draft: string,
    commit?: string
  ): Promise<DraftReview>
  reviewDraft(
    repository: string,
    draft: string,
    review: { tip: string; verdict: Verdict; body: string }
  ): Promise<DraftReview>
  commentDraft(
    repository: string,
    draft: string,
    comment: { tip: string; path: string; line: number | null; body: string }
  ): Promise<DraftReview>
  publishDraft(
    repository: string,
    draft: string,
    tip: string
  ): Promise<DraftReview>
  /** The license of the portal, or null when the server is not a portal. */
  license(): Promise<LicenseInfo | null>
  /** The GitHub App, or null when the portal reads no repository through one. */
  githubApp(): Promise<GitHubAppState | null>
  /** Starts the registration: where to post the manifest, and the manifest. */
  startGithubApp(): Promise<{ action: string; manifest: string }>
  /** The AI credits of the month, or null when the portal asks no service. */
  usage(): Promise<UsageInfo | null>
  /** Sets the cap of the AI credits; null goes back to the included volume. */
  setUsageCap(cap: number | null): Promise<UsageInfo>
  /**
   * The invitations of the customer, or null when no hosted service runs
   * the portal.
   */
  invitations(): Promise<InvitationsInfo | null>
  /** Invites a GitHub account, with an optional address to write to. */
  invite(account: string, email: string | null): Promise<InvitationsInfo>
}

export function httpPortalSource(
  fetch: typeof globalThis.fetch = globalThis.fetch.bind(globalThis)
): PortalSource {
  async function getJson(url: string): Promise<unknown> {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
    })
    // The console alone answers its page on every path: a page is not JSON.
    const type = response.headers.get('content-type') ?? ''
    if (response.status === 404 || !type.startsWith('application/json')) {
      return null
    }
    if (!response.ok) throw new Error(`${url} answered ${response.status}`)
    return response.json()
  }
  const draftPath = (repository: string, draft: string) =>
    `${PORTAL_API}/drafts/${encodeURIComponent(repository)}/${encodeURIComponent(draft)}`
  /** A request whose error answer explains itself in an `error` field. */
  async function send<T>(method: string, url: string, body?: unknown) {
    const response = await fetch(url, {
      method,
      headers: {
        accept: 'application/json',
        ...(body === undefined
          ? {}
          : { 'content-type': 'application/json', ...csrfHeaders() }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    if (!response.ok) {
      const reason = await response
        .json()
        .then(answer => (answer as { error?: unknown }).error)
        .catch(() => undefined)
      throw new Error(
        typeof reason === 'string'
          ? reason
          : `${url} answered ${response.status}`
      )
    }
    return (await response.json()) as T
  }
  /**
   * A route that only some portals have: null when the portal answers 404
   * or a page, the `error` of the answer when it fails.
   */
  async function getOptional<T>(url: string): Promise<T | null> {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
    })
    const type = response.headers.get('content-type') ?? ''
    if (response.status === 404 || !type.startsWith('application/json')) {
      return null
    }
    if (!response.ok) {
      const reason = await response
        .json()
        .then(body => (body as { error?: unknown }).error)
        .catch(() => undefined)
      throw new Error(
        typeof reason === 'string'
          ? reason
          : `${url} answered ${response.status}`
      )
    }
    return (await response.json()) as T
  }
  return {
    async overview() {
      return (await getJson(`${PORTAL_API}/overview`)) as PortalOverview | null
    },
    async queue() {
      const body = (await getJson(`${PORTAL_API}/queue`)) as DriftQueue | null
      return body ?? { rows: [] }
    },
    async me() {
      return (await getJson(`${PORTAL_API}/me`)) as Me | null
    },
    async people() {
      const body = (await getJson(`${PORTAL_API}/people`)) as People | null
      return body ?? { people: [], editors: 0, limit: 0 }
    },
    async setSeat(login, seat) {
      const url = `${PORTAL_API}/seats/${encodeURIComponent(login)}`
      const response = await fetch(url, {
        method: seat ? 'PUT' : 'DELETE',
        headers: { accept: 'application/json', ...csrfHeaders() },
      })
      if (!response.ok) {
        const reason = await response
          .json()
          .then(body => (body as { error?: unknown }).error)
          .catch(() => undefined)
        throw new Error(
          typeof reason === 'string'
            ? reason
            : `${url} answered ${response.status}`
        )
      }
      return (await response.json()) as People
    },
    async draftReview(repository, draft, commit) {
      const query =
        commit === undefined ? '' : `?commit=${encodeURIComponent(commit)}`
      return send<DraftReview>('GET', `${draftPath(repository, draft)}${query}`)
    },
    reviewDraft: (repository, draft, review) =>
      send<DraftReview>(
        'POST',
        `${draftPath(repository, draft)}/reviews`,
        review
      ),
    commentDraft: (repository, draft, comment) =>
      send<DraftReview>(
        'POST',
        `${draftPath(repository, draft)}/comments`,
        comment
      ),
    publishDraft: (repository, draft, tip) =>
      send<DraftReview>('POST', `${draftPath(repository, draft)}/publish`, {
        tip,
      }),
    async license() {
      return (await getJson(`${PORTAL_API}/license`)) as LicenseInfo | null
    },
    async githubApp() {
      return (await getJson(
        `${PORTAL_API}/github-app`
      )) as GitHubAppState | null
    },
    startGithubApp: () =>
      send<{ action: string; manifest: string }>(
        'POST',
        `${PORTAL_API}/github-app/manifest`,
        {}
      ),
    usage: () => getOptional<UsageInfo>(`${PORTAL_API}/usage`),
    setUsageCap: cap =>
      send<UsageInfo>('PUT', `${PORTAL_API}/usage/cap`, { cap }),
    invitations: () =>
      getOptional<InvitationsInfo>(`${PORTAL_API}/invitations`),
    invite: (account, email) =>
      send<InvitationsInfo>('POST', `${PORTAL_API}/invitations`, {
        account,
        email,
      }),
    async signOut() {
      const response = await fetch(SIGN_OUT_PATH, {
        method: 'POST',
        headers: csrfHeaders(),
      })
      if (!response.ok) {
        throw new Error(`${SIGN_OUT_PATH} answered ${response.status}`)
      }
    },
  }
}
