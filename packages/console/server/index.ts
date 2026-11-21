// What the portal reuses from the server of the console: the request
// handler, the reports of the repositories and the lookups of GitHub.
export {
  allowedHost,
  consoleHandler,
  sameOrigin,
  SECURITY_HEADERS,
  securityHeaders,
  type ConsoleReports,
} from './http.ts'
export {
  repositoryIds,
  repositoryReports,
  type RepositoryReports,
} from './repository-reports.ts'
export { commitLookup } from './attribution.ts'
export {
  DraftRequestError,
  type ConsoleDrafts,
  type DraftActor,
} from './drafts.ts'
export type { DraftState } from '../src/drafts.ts'
export { openPullRequests } from './pull-requests.ts'
export { consolePlain } from './plain.ts'
export { consoleDraftDecision } from './draft-decision.ts'
export {
  DRIFT_LEVELS,
  driftRows,
  indexReport,
  type DriftLevel,
  type SignalRow,
} from '../src/drift/signals.ts'
export { PORTAL_API } from '../src/portal.ts'
export type {
  DriftQueue,
  PortalOverview,
  QueueRow,
  RepositoryOverview,
  UnservedRepository,
} from '../src/portal.ts'
