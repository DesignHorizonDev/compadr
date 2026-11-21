// Serves the drift reports of one folder on the routes of src/reports.ts,
// for the development and preview servers. The folder is read at each
// request and never written. Each `.json` file that follows the drift report
// schema is a report; its identifier is the file name without `.json`. A
// file `<id>.findings.json` holds the findings of a semantic check on it,
// a file `<id>.accept-<n>.json` the recommendation of the assist service on
// its proposed decision n, as `compadr assist accept --out` writes it, and a
// file `<id>.consolidate-<n>.json` the rules in force that the service
// consolidated along the chain of decision n (`compadr assist consolidate`).
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import {
  AssistSuggestionSchema,
  DriftReportSchema,
  SEMANTIC_FINDINGS_SUFFIX,
  SemanticFindingsSchema,
  type AcceptSuggestion,
  type AssistSuggestion,
  type ConsolidateSuggestion,
  type DriftReport,
  type SemanticFindings,
} from '@compadr/format'
import type { Plugin, PreviewServer, ViteDevServer } from 'vite'
import { REPORTS_API, summarize, type ReportList } from '../src/reports.ts'

const REPORT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const SUGGESTION_FILE = /\.(?:accept|consolidate)-\d{1,4}\.json$/

/** The reports of a folder, read at each call. */
export interface FolderReports {
  list(): ReportList & { problems: string[] }
  get(id: string): DriftReport | undefined
  findings(id: string): SemanticFindings | undefined
  recommendation(id: string, decision: number): AcceptSuggestion | undefined
  consolidation(id: string, decision: number): ConsolidateSuggestion | undefined
}

/** Where the routes read the reports: a folder, or live repositories. */
export interface ReportFolder {
  list():
    | (ReportList & { problems: string[] })
    | Promise<ReportList & { problems: string[] }>
  get(id: string): DriftReport | undefined | Promise<DriftReport | undefined>
  /** The findings of a semantic check on a report, when a file holds them. */
  findings?(
    id: string
  ): SemanticFindings | undefined | Promise<SemanticFindings | undefined>
  /** The recommendation on a proposed decision of a report, when a file holds it. */
  recommendation?(
    id: string,
    decision: number
  ): AcceptSuggestion | undefined | Promise<AcceptSuggestion | undefined>
  /** The rules that the service consolidated along the chain of a decision, when a file holds them. */
  consolidation?(
    id: string,
    decision: number
  ):
    | ConsolidateSuggestion
    | undefined
    | Promise<ConsolidateSuggestion | undefined>
}

/**
 * The findings file of a report in a folder: undefined without one. A file
 * that does not follow the schema is an error, which the route reports.
 */
export function findingsInFolder(
  directory: string | undefined,
  id: string
): SemanticFindings | undefined {
  if (directory === undefined || !REPORT_ID.test(id)) return undefined
  const file = join(directory, `${id}${SEMANTIC_FINDINGS_SUFFIX}`)
  if (!existsSync(file)) return undefined
  let content: unknown
  try {
    content = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(
      `${id}${SEMANTIC_FINDINGS_SUFFIX} cannot be read: ${(error as Error).message}`
    )
  }
  const result = SemanticFindingsSchema.safeParse(content)
  if (!result.success) {
    throw new Error(
      `${id}${SEMANTIC_FINDINGS_SUFFIX} does not follow the findings schema`
    )
  }
  return result.data
}

/**
 * The suggestion of a kind on decision n of a report in a folder: undefined
 * without one. The file holds the output of `compadr assist <kind> --out` or
 * the suggestion alone; another content is an error, which the route
 * reports.
 */
function suggestionInFolder<K extends 'accept' | 'consolidate'>(
  directory: string | undefined,
  id: string,
  kind: K,
  decision: number
): Extract<AssistSuggestion, { kind: K }> | undefined {
  if (directory === undefined || !REPORT_ID.test(id)) return undefined
  const name = `${id}.${kind}-${decision}.json`
  const file = join(directory, name)
  if (!existsSync(file)) return undefined
  let content: unknown
  try {
    content = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`${name} cannot be read: ${(error as Error).message}`)
  }
  const value =
    typeof content === 'object' && content !== null && 'suggestion' in content
      ? content.suggestion
      : content
  const result = AssistSuggestionSchema.safeParse(value)
  if (!result.success || result.data.kind !== kind) {
    throw new Error(`${name} holds no ${kind} suggestion`)
  }
  return result.data as Extract<AssistSuggestion, { kind: K }>
}

/** The recommendation of the assist service on a proposed decision. */
export function recommendationInFolder(
  directory: string | undefined,
  id: string,
  decision: number
): AcceptSuggestion | undefined {
  return suggestionInFolder(directory, id, 'accept', decision)
}

/** The rules that the assist service consolidated along the chain of a decision. */
export function consolidationInFolder(
  directory: string | undefined,
  id: string,
  decision: number
): ConsolidateSuggestion | undefined {
  return suggestionInFolder(directory, id, 'consolidate', decision)
}

export function reportFolder(directory: string | undefined): FolderReports {
  function read(id: string): DriftReport | string {
    try {
      const content = readFileSync(join(directory!, `${id}.json`), 'utf8')
      const result = DriftReportSchema.safeParse(JSON.parse(content))
      return result.success ? result.data : `${id}.json is not a drift report`
    } catch (error) {
      return `${id}.json cannot be read: ${(error as Error).message}`
    }
  }

  function ids(): string[] {
    if (directory === undefined) return []
    let files: string[]
    try {
      files = readdirSync(directory)
    } catch (error) {
      throw new Error(
        `The reports folder ${directory} cannot be read: ${(error as Error).message}`
      )
    }
    return files
      .filter(
        file =>
          file.endsWith('.json') &&
          !file.endsWith(SEMANTIC_FINDINGS_SUFFIX) &&
          !SUGGESTION_FILE.test(file)
      )
      .map(file => file.slice(0, -'.json'.length))
      .filter(id => REPORT_ID.test(id))
      .sort()
  }

  return {
    list() {
      const reports: ReportList['reports'] = []
      const problems: string[] = []
      for (const id of ids()) {
        const report = read(id)
        if (typeof report === 'string') problems.push(report)
        else reports.push(summarize(id, report))
      }
      return { reports, problems }
    },
    get(id) {
      if (!ids().includes(id)) return undefined
      const report = read(id)
      return typeof report === 'string' ? undefined : report
    },
    findings(id) {
      return ids().includes(id) ? findingsInFolder(directory, id) : undefined
    },
    recommendation(id, decision) {
      return ids().includes(id)
        ? recommendationInFolder(directory, id, decision)
        : undefined
    },
    consolidation(id, decision) {
      return ids().includes(id)
        ? consolidationInFolder(directory, id, decision)
        : undefined
    },
  }
}

function send(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify(body))
}

/**
 * Answers the report routes; `url` is relative to REPORTS_API. A folder that
 * cannot be read answers 500 with its reason.
 */
export async function handleReportRequest(
  folder: ReportFolder,
  request: IncomingMessage,
  response: ServerResponse,
  warn: (message: string) => void = () => {}
): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('allow', 'GET, HEAD')
    send(response, 405, { error: 'Method not allowed' })
    return
  }
  const path = new URL(request.url ?? '/', 'http://localhost').pathname
  try {
    if (path === '/' || path === '') {
      const { reports, problems } = await folder.list()
      for (const problem of problems) warn(problem)
      send(response, 200, { reports } satisfies ReportList)
      return
    }
    const findingsOf = /^\/(.+)\/findings$/.exec(path)
    if (findingsOf !== null) {
      const id = decodeId(findingsOf[1]!)
      const findings =
        id === undefined || folder.findings === undefined
          ? undefined
          : await folder.findings(id)
      if (findings === undefined) {
        send(response, 404, { error: 'No findings for this report' })
      } else send(response, 200, findings)
      return
    }
    const recommendationOf = /^\/(.+)\/recommendations\/(\d{1,4})$/.exec(path)
    if (recommendationOf !== null) {
      const id = decodeId(recommendationOf[1]!)
      const recommendation =
        id === undefined || folder.recommendation === undefined
          ? undefined
          : await folder.recommendation(id, Number(recommendationOf[2]))
      if (recommendation === undefined) {
        send(response, 404, { error: 'No recommendation for this decision' })
      } else send(response, 200, recommendation)
      return
    }
    const consolidationOf = /^\/(.+)\/consolidations\/(\d{1,4})$/.exec(path)
    if (consolidationOf !== null) {
      const id = decodeId(consolidationOf[1]!)
      const consolidation =
        id === undefined || folder.consolidation === undefined
          ? undefined
          : await folder.consolidation(id, Number(consolidationOf[2]))
      if (consolidation === undefined) {
        send(response, 404, { error: 'No consolidation for this decision' })
      } else send(response, 200, consolidation)
      return
    }
    const id = decodeId(path.slice(1))
    const report = id === undefined ? undefined : await folder.get(id)
    if (report === undefined) send(response, 404, { error: 'No such report' })
    else send(response, 200, report)
  } catch (error) {
    const message = (error as Error).message
    warn(message)
    send(response, 500, { error: message })
  }
}

/** The identifier of a report path, or undefined when it is malformed. */
function decodeId(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment)
  } catch {
    return undefined
  }
}

/** Vite plugin that serves the reports of `directory` on REPORTS_API. */
export function reportsApi(directory: string | undefined): Plugin {
  const folder = reportFolder(directory)
  // Returns nothing: Vite would run a returned function after its own
  // middlewares.
  const serve = (server: ViteDevServer | PreviewServer): void => {
    server.middlewares.use(REPORTS_API, (request, response) => {
      void handleReportRequest(folder, request, response, message =>
        server.config.logger.warn(`compadr: ${message}`)
      )
    })
  }
  return {
    name: 'compadr-reports-api',
    configureServer: serve,
    configurePreviewServer: serve,
  }
}
