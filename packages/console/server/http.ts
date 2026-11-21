// The HTTP server of the console: the built pages, and the report routes.
import { readFile } from 'node:fs/promises'
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { isIP } from 'node:net'
import { extname, join, normalize, sep } from 'node:path'
import { handleReportRequest, type ReportFolder } from '../dev/reports-api.ts'
import { REPORTS_API } from '../src/reports.ts'
import { REVIEWS_API, type ReviewList } from '../src/reviews.ts'
import { ASSIST_API, type DraftDecisionOutcome } from '../src/assist.ts'
import type { PlainSuggestion } from '@compadr/format'
import { PlainExcludedError, PlainRequestError } from './plain.ts'
import {
  DraftDecisionExcludedError,
  DraftDecisionExistsError,
  DraftDecisionRequestError,
} from './draft-decision.ts'
import { ProposeCommandError } from '@compadr/cli/drafts'
import { DRAFTS_API, type AcceptDecisionRequest } from '../src/drafts.ts'
import {
  AcceptCommandError,
  AnchorCommandError,
  CheckedCommandError,
  DraftError,
  RulesCommandError,
} from '@compadr/cli/drafts'
import { AnchorEditError, FrontmatterEditError } from '@compadr/format'
import {
  DraftRequestError,
  type ConsoleDrafts,
  type DraftActor,
} from './drafts.ts'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
}

/**
 * The headers of every answer. The console reads its reports from the same
 * origin only, and the fonts and the logo are files of the build. The
 * styles come from the stylesheet of the build: React sets the `style`
 * properties of its elements through the CSSOM, which the policy allows.
 * `formTargets` names the other addresses where a form of the pages posts,
 * such as GitHub for the manifest of an app.
 */
export function securityHeaders(
  formTargets: readonly string[] = []
): Record<string, string> {
  const forms = ["'self'", ...formTargets.map(url => new URL(url).origin)]
  return {
    'content-security-policy': `default-src 'self'; img-src 'self' data:; style-src 'self'; object-src 'none'; base-uri 'none'; form-action ${forms.join(' ')}; frame-ancestors 'none'`,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'permissions-policy':
      'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-embedder-policy': 'require-corp',
    'cross-origin-resource-policy': 'same-origin',
  }
}

export const SECURITY_HEADERS = securityHeaders()

/**
 * The file of `pages` that a path names, or null when the path leaves the
 * folder. Every path without an extension is a page of the application.
 */
export function pageFile(pages: string, path: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(path)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null
  if (extname(decoded) === '') return join(pages, 'index.html')
  const file = normalize(join(pages, decoded))
  return file.startsWith(pages.endsWith(sep) ? pages : `${pages}${sep}`)
    ? file
    : null
}

/**
 * Whether the server answers a request with this `Host` header. The server
 * refuses every domain name other than localhost and the address it listens
 * on: a page of another site could otherwise point such a name at the server
 * (DNS rebinding) and read the decisions of the repositories.
 */
export function allowedHost(host: string | undefined, listen: string): boolean {
  if (host === undefined) return false
  let name: string
  try {
    name = new URL(`http://${host}`).hostname
  } catch {
    return false
  }
  const bare = name.replace(/^\[(.*)\]$/, '$1').toLowerCase()
  return (
    isIP(bare) !== 0 ||
    bare === 'localhost' ||
    bare.endsWith('.localhost') ||
    bare === listen.replace(/^\[(.*)\]$/, '$1').toLowerCase()
  )
}

async function servePage(
  pages: string,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.statusCode = 405
    response.setHeader('allow', 'GET, HEAD')
    response.end()
    return
  }
  const path = new URL(request.url ?? '/', 'http://localhost').pathname
  const file = pageFile(pages, path)
  let body: Buffer
  try {
    if (file === null) throw new Error('outside the pages')
    body = await readFile(file)
  } catch {
    response.statusCode = 404
    response.setHeader('content-type', 'text/plain; charset=utf-8')
    response.end('Not found')
    return
  }
  response.statusCode = 200
  response.setHeader(
    'content-type',
    TYPES[extname(file)] ?? 'application/octet-stream'
  )
  // Vite names each asset after its content: it never changes.
  if (path.startsWith('/assets/')) {
    response.setHeader('cache-control', 'public, max-age=31536000, immutable')
  }
  response.end(request.method === 'HEAD' ? undefined : body)
}

/** Answers REVIEWS_API with the branches that propose decisions. */
async function serveReviews(
  reports: ReportFolder & {
    reviews(): Promise<ReviewList & { problems: string[] }>
  },
  request: IncomingMessage,
  response: ServerResponse,
  warn: (message: string) => void
): Promise<void> {
  response.setHeader('content-type', 'application/json')
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.statusCode = 405
    response.setHeader('allow', 'GET, HEAD')
    response.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }
  try {
    const { reviews, changes, problems } = await reports.reviews()
    for (const problem of problems) warn(problem)
    response.statusCode = 200
    response.end(JSON.stringify({ reviews, changes } satisfies ReviewList))
  } catch (error) {
    warn((error as Error).message)
    response.statusCode = 500
    response.end(JSON.stringify({ error: FAULT }))
  }
}

/**
 * The answer to a fault of the server. Its message, which may name a path
 * of the machine or quote git, goes to the output of the console only.
 */
const FAULT = 'The console could not answer: its output tells why'

/** Largest body of a request to the drafts. */
const MAX_BODY = 64 * 1024

/**
 * Whether a request that writes comes from a page of the console. A page of
 * another site can send a POST to a local server: it cannot set the JSON
 * type without a preflight that the server never answers, and the browser
 * names its origin.
 */
export function sameOrigin(request: IncomingMessage): boolean {
  const type = request.headers['content-type'] ?? ''
  if (!/^application\/json\s*(?:;|$)/i.test(type)) return false
  const site = request.headers['sec-fetch-site']
  if (site !== undefined && site !== 'same-origin') return false
  const origin = request.headers.origin
  if (origin === undefined) return false
  try {
    return new URL(origin).host === request.headers.host
  } catch {
    return false
  }
}

/** A body larger than MAX_BODY: the answer is 413. */
class TooLargeError extends DraftRequestError {}

function readBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((done, fail) => {
    const chunks: Buffer[] = []
    let size = 0
    let tooLarge = false
    request.on('data', (chunk: Buffer) => {
      if (tooLarge) return
      size += chunk.length
      if (size > MAX_BODY) {
        // The rest of the body is read and dropped, so that the answer
        // reaches the client before the connection closes.
        tooLarge = true
        chunks.length = 0
        fail(new TooLargeError('the request is too large'))
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (tooLarge) return
      try {
        done(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        fail(new DraftRequestError('the request is not JSON'))
      }
    })
    request.on('error', fail)
  })
}

/** Errors of a request that the draft cannot take, as opposed to a fault. */
function refused(error: unknown): boolean {
  return (
    error instanceof DraftRequestError ||
    error instanceof DraftError ||
    error instanceof CheckedCommandError ||
    error instanceof AnchorCommandError ||
    error instanceof AcceptCommandError ||
    error instanceof RulesCommandError ||
    error instanceof AnchorEditError ||
    error instanceof FrontmatterEditError
  )
}

/** Answers the routes of src/drafts.ts. */
async function serveDrafts(
  drafts: ConsoleDrafts | null,
  path: string,
  search: URLSearchParams,
  request: IncomingMessage,
  response: ServerResponse,
  warn: (message: string) => void,
  actor: DraftActor | undefined
): Promise<void> {
  response.setHeader('content-type', 'application/json')
  const send = (status: number, body: unknown) => {
    response.statusCode = status
    response.end(JSON.stringify(body))
  }
  const match = /^\/([^/]+)(?:\/(checks|anchors|accepts|rules))?$/.exec(
    path.slice(DRAFTS_API.length)
  )
  if (drafts === null || match === null) {
    send(404, { error: 'Not found' })
    return
  }
  let id: string
  try {
    id = decodeURIComponent(match[1]!)
  } catch {
    send(404, { error: 'Not found' })
    return
  }
  const action = match[2]
  const method = action === undefined ? 'GET' : 'POST'
  if (
    request.method !== method &&
    !(method === 'GET' && request.method === 'HEAD')
  ) {
    response.setHeader('allow', method === 'GET' ? 'GET, HEAD' : 'POST')
    send(405, { error: 'Method not allowed' })
    return
  }
  try {
    if (action === undefined) {
      const state = await drafts.state(id, search.get('draft') ?? undefined)
      if (state === undefined) send(404, { error: `No repository for ${id}` })
      else send(200, state)
      return
    }
    if (!sameOrigin(request)) {
      send(403, { error: 'The request does not come from the console' })
      return
    }
    const body = (await readBody(request)) as Record<string, unknown>
    if (typeof body !== 'object' || body === null) {
      throw new DraftRequestError('the request is not an object')
    }
    const state =
      action === 'checks'
        ? await drafts.check(
            id,
            {
              references: body.references as string[],
              by: typeof body.by === 'string' ? body.by : undefined,
              draft: body.draft as string | undefined,
            },
            actor
          )
        : action === 'anchors'
          ? await drafts.anchor(
              id,
              {
                references: body.references as string[],
                withLines: body.withLines === true,
                draft: body.draft as string | undefined,
              },
              actor
            )
          : action === 'accepts'
            ? await drafts.accept(
                id,
                {
                  decision: body.decision as number,
                  draft: body.draft as string | undefined,
                  recommendation:
                    body.recommendation as AcceptDecisionRequest['recommendation'],
                },
                actor
              )
            : await drafts.validateRules(
                id,
                {
                  feature: body.feature as string,
                  draft: body.draft as string | undefined,
                },
                actor
              )
    send(200, state)
  } catch (error) {
    const message = (error as Error).message
    if (error instanceof TooLargeError) {
      response.setHeader('connection', 'close')
      send(413, { error: message })
    } else if (refused(error)) {
      send(400, { error: message })
    } else {
      warn(message)
      send(500, { error: FAULT })
    }
  }
}

/** The reports that the console serves, with the branches under review. */
export type ConsoleReports = ReportFolder & {
  reviews(): Promise<ReviewList & { problems: string[] }>
  /**
   * The versions in plain language of the decisions of a report, when the
   * server can ask the assist service. Undefined for an unknown report.
   */
  plain?: {
    cached(id: string, decision: number): Promise<PlainSuggestion | undefined>
    read(id: string, decision: number): Promise<PlainSuggestion | undefined>
  }
  /**
   * The record that the service drafts from the change of a branch report,
   * when the server can ask the service and keeps drafts. Undefined for a
   * report that is not a branch ahead of the reference.
   */
  draftDecision?: {
    cached(id: string): Promise<DraftDecisionOutcome | undefined>
    draft(
      id: string,
      actor?: DraftActor
    ): Promise<DraftDecisionOutcome | undefined>
  }
}

/** Answers the routes of src/assist.ts. */
async function serveAssist(
  reports: ConsoleReports,
  path: string,
  request: IncomingMessage,
  response: ServerResponse,
  warn: (message: string) => void,
  actor: DraftActor | undefined
): Promise<void> {
  const send = (status: number, body: unknown) => {
    response.statusCode = status
    response.setHeader('content-type', 'application/json')
    response.setHeader('cache-control', 'no-store')
    response.end(JSON.stringify(body))
  }
  const { plain, draftDecision } = reports
  if (plain === undefined && draftDecision === undefined) {
    send(404, { error: 'The console does not ask the assist service' })
    return
  }
  if (path === ASSIST_API) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('allow', 'GET, HEAD')
      send(405, { error: 'Method not allowed' })
    } else {
      send(200, {
        plain: plain !== undefined,
        draft: draftDecision !== undefined,
      })
    }
    return
  }
  const drafting = /^\/([^/]+)\/draft$/.exec(path.slice(ASSIST_API.length))
  if (drafting !== null) {
    await serveDraftDecision(
      draftDecision,
      drafting[1]!,
      request,
      response,
      send,
      warn,
      actor
    )
    return
  }
  const match = /^\/([^/]+)\/plain\/(\d{1,4})$/.exec(
    path.slice(ASSIST_API.length)
  )
  if (match === null || plain === undefined) {
    send(404, { error: 'Not found' })
    return
  }
  let id: string
  try {
    id = decodeURIComponent(match[1]!)
  } catch {
    send(404, { error: 'Not found' })
    return
  }
  const decision = Number(match[2])
  const asks = request.method === 'POST'
  if (!asks && request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('allow', 'GET, HEAD, POST')
    send(405, { error: 'Method not allowed' })
    return
  }
  // A new version costs: only a page of the console asks for one.
  if (asks && !sameOrigin(request)) {
    send(403, { error: 'The request does not come from the console' })
    return
  }
  try {
    const version = asks
      ? await plain.read(id, decision)
      : await plain.cached(id, decision)
    if (version === undefined) {
      send(404, {
        error: asks
          ? `No report ${id} of a repository`
          : 'No version kept for this decision',
      })
    } else send(200, version)
  } catch (error) {
    const message = (error as Error).message
    if (error instanceof PlainExcludedError) {
      // The page shows no button for a record that never leaves.
      send(403, { error: message, excluded: true })
    } else if (error instanceof PlainRequestError) {
      send(400, { error: message })
    } else {
      warn(message)
      send(502, { error: message })
    }
  }
}

/** Answers the draft of a decision from the change of a branch. */
async function serveDraftDecision(
  drafting: ConsoleReports['draftDecision'],
  encodedId: string,
  request: IncomingMessage,
  response: ServerResponse,
  send: (status: number, body: unknown) => void,
  warn: (message: string) => void,
  actor: DraftActor | undefined
): Promise<void> {
  let id: string
  try {
    id = decodeURIComponent(encodedId)
  } catch {
    send(404, { error: 'Not found' })
    return
  }
  if (drafting === undefined) {
    send(404, { error: 'The console does not draft decisions' })
    return
  }
  const asks = request.method === 'POST'
  if (!asks && request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('allow', 'GET, HEAD, POST')
    send(405, { error: 'Method not allowed' })
    return
  }
  // A new draft costs: only a page of the console asks for one.
  if (asks && !sameOrigin(request)) {
    send(403, { error: 'The request does not come from the console' })
    return
  }
  try {
    const outcome = asks
      ? await drafting.draft(id, actor)
      : await drafting.cached(id)
    if (outcome === undefined) {
      send(404, {
        error: asks
          ? `No branch ahead of the reference for the report ${id}`
          : 'No draft kept for this change',
      })
    } else send(200, outcome)
  } catch (error) {
    const message = (error as Error).message
    if (error instanceof DraftDecisionExcludedError) {
      // The page shows no button for a change that never leaves.
      send(403, { error: message, excluded: true })
    } else if (error instanceof DraftDecisionExistsError) {
      // Nor for a branch whose draft waits for review.
      send(409, { error: message })
    } else if (
      error instanceof DraftDecisionRequestError ||
      error instanceof ProposeCommandError ||
      refused(error)
    ) {
      send(400, { error: message })
    } else {
      warn(message)
      send(502, { error: message })
    }
  }
}

/**
 * Whether a request of the API may come from a page of the console. A page
 * of another site can still make the browser send a GET, such as the source
 * of an image, and each one makes the console read git: the browser names
 * the site of such a request, and the server refuses it. A request without
 * these headers comes from a program, which the Host check already limits.
 */
export function fromThisSite(request: IncomingMessage): boolean {
  const site = request.headers['sec-fetch-site']
  if (site === 'cross-site' || site === 'same-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === request.headers.host
  } catch {
    return false
  }
}

/** Name of the cookie that carries the token of a console open to the network. */
export const TOKEN_COOKIE = 'compadr-console-token'

function sameSecret(given: string, token: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Requires the token of the console on every request. The address that the
 * console prints holds it once (`?token=`): the server then keeps it in a
 * cookie that only this site sends, and leads to the same page without it.
 */
export function withToken(
  token: string,
  handle: (request: IncomingMessage, response: ServerResponse) => void
): (request: IncomingMessage, response: ServerResponse) => void {
  return (request, response) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      response.setHeader(name, value)
    }
    const url = new URL(request.url ?? '/', 'http://localhost')
    const given = url.searchParams.get('token')
    if (given !== null && sameSecret(given, token)) {
      url.searchParams.delete('token')
      response.statusCode = 303
      response.setHeader(
        'set-cookie',
        `${TOKEN_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`
      )
      response.setHeader('location', `${url.pathname}${url.search}`)
      response.end()
      return
    }
    const cookie = (request.headers.cookie ?? '')
      .split(';')
      .map(part => part.trim())
      .find(part => part.startsWith(`${TOKEN_COOKIE}=`))
    if (
      cookie === undefined ||
      !sameSecret(cookie.slice(TOKEN_COOKIE.length + 1), token)
    ) {
      response.statusCode = 401
      response.setHeader('content-type', 'text/plain; charset=utf-8')
      response.end(
        'Open the address that compadr-console printed: it holds the token of the console'
      )
      return
    }
    handle(request, response)
  }
}

/**
 * Answers every request of the console: the report, draft and review
 * routes, then the pages. `knownHost` tells whether the server answers a
 * `Host` header.
 */
export function consoleHandler(
  pages: string,
  reports: ConsoleReports,
  warn: (message: string) => void,
  knownHost: (host: string | undefined) => boolean,
  drafts: ConsoleDrafts | null = null,
  /** The person who makes a request, when a portal knows it. */
  actorOf: (request: IncomingMessage) => DraftActor | undefined = () =>
    undefined
): (request: IncomingMessage, response: ServerResponse) => void {
  return (request, response) => {
    // A portal in front of the console may have set its own headers.
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      if (!response.hasHeader(name)) response.setHeader(name, value)
    }
    if (!knownHost(request.headers.host)) {
      response.statusCode = 403
      response.setHeader('content-type', 'text/plain; charset=utf-8')
      response.end('Unknown host')
      return
    }
    const { pathname: path, search } = new URL(
      request.url ?? '/',
      'http://localhost'
    )
    if (path === '/api' || path.startsWith('/api/')) {
      // An answer of the API describes the repositories at one moment.
      if (!response.hasHeader('cache-control')) {
        response.setHeader('cache-control', 'no-store')
      }
      if (!fromThisSite(request)) {
        response.statusCode = 403
        response.setHeader('content-type', 'application/json')
        response.end(
          JSON.stringify({
            error: 'The request does not come from the console',
          })
        )
        return
      }
    }
    if (path === REPORTS_API || path.startsWith(`${REPORTS_API}/`)) {
      // The report routes read the path after REPORTS_API.
      request.url = `${path.slice(REPORTS_API.length) || '/'}${search}`
      void handleReportRequest(reports, request, response, warn)
    } else if (path === DRAFTS_API || path.startsWith(`${DRAFTS_API}/`)) {
      void serveDrafts(
        drafts,
        path,
        new URLSearchParams(search),
        request,
        response,
        warn,
        actorOf(request)
      )
    } else if (path === ASSIST_API || path.startsWith(`${ASSIST_API}/`)) {
      void serveAssist(reports, path, request, response, warn, actorOf(request))
    } else if (path === REVIEWS_API) {
      void serveReviews(reports, request, response, warn)
    } else {
      void servePage(pages, request, response)
    }
  }
}

export function consoleServer(
  pages: string,
  reports: ConsoleReports,
  warn: (message: string) => void,
  listen: string,
  drafts: ConsoleDrafts | null = null,
  /** Required on each request when set: the console is open to the network. */
  token?: string
): Server {
  const handle = consoleHandler(
    pages,
    reports,
    warn,
    host => allowedHost(host, listen),
    drafts
  )
  return createServer(token === undefined ? handle : withToken(token, handle))
}
