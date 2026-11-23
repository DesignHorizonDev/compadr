// Sends an assist request to a service and reads its suggestion. The service
// itself is not part of this repository: this client only knows the contract
// of @compadr/format.
import {
  AssistSuggestionSchema,
  type AssistRequest,
  type AssistSuggestion,
} from '@compadr/format'

/** Anything that answers an assist request with a suggestion. */
export interface AssistClient {
  suggest(request: AssistRequest): Promise<AssistSuggestion>
}

/** The service refused the request, failed, or answered outside the contract. */
export class AssistServiceError extends Error {
  /** HTTP status of the answer, when there was one. */
  readonly status: number | null

  constructor(message: string, status: number | null = null) {
    super(message)
    this.name = 'AssistServiceError'
    this.status = status
  }
}

/**
 * The customer has used the AI credits of its month, up to its cap: the
 * service answered 402 and called no model. The commands then answer
 * without the assist service, and say so.
 */
export class AssistCapReachedError extends AssistServiceError {}

export interface HttpAssistClientOptions {
  /** Address of the service, such as `https://assist.example.com`. */
  url: string
  /** Bearer token of the service. It is read from the environment, never from a file. */
  token: string
  /** Time allowed for one answer, in milliseconds (default: two minutes). */
  timeoutMs?: number
  /** Replaces the global `fetch` in the tests. */
  fetch?: typeof globalThis.fetch
}

/** An address on this machine, the only one reached over plain HTTP. */
const LOCAL_HTTP =
  /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/

/** Length of an error body quoted in a message, at most. */
const QUOTED_BODY = 300

/**
 * Size of an answer of the service, at most. A suggestion takes a few
 * kilobytes: a larger answer is refused before it fills the memory.
 */
export const MAX_ANSWER_BYTES = 4 * 1024 * 1024

// Control characters: C0, DEL and C1. A terminal reads ESC and the C1 codes
// as commands, and a line break would let a text start a line of its own,
// such as a GitHub workflow command (`::error::`).
// eslint-disable-next-line no-control-regex -- these characters are the point
const CONTROLS = /[\u0000-\u001f\u007f-\u009f]+/g
// eslint-disable-next-line no-control-regex -- these characters are the point
const CONTROLS_BUT_BREAKS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g

/** A text of the service on one line: each run of control characters becomes a space. */
export function oneLine(text: string): string {
  return text.replace(CONTROLS, ' ')
}

/** Each string of a value without control characters, line breaks and tabs kept. */
function withoutControls(value: unknown): unknown {
  if (typeof value === 'string')
    return value.replace(CONTROLS_BUT_BREAKS, '\ufffd')
  if (Array.isArray(value)) return value.map(withoutControls)
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, withoutControls(item)])
    )
  }
  return value
}

/** The body of an answer, refused beyond MAX_ANSWER_BYTES. */
async function readBody(response: Response): Promise<string> {
  const tooLarge = () =>
    new Error(`the answer is larger than ${MAX_ANSWER_BYTES} bytes`)
  const announced = Number(response.headers.get('content-length'))
  if (Number.isFinite(announced) && announced > MAX_ANSWER_BYTES) {
    await response.body?.cancel()
    throw tooLarge()
  }
  if (response.body === null) return ''
  const reader = (response.body as ReadableStream<Uint8Array>).getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_ANSWER_BYTES) {
      await reader.cancel()
      throw tooLarge()
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** The reason of the 402 that the service gives at the cap, or null. */
function capOf(body: string): string | null {
  try {
    const answer = JSON.parse(body) as Record<string, unknown>
    return typeof answer.error === 'string' &&
      typeof answer.used === 'number' &&
      typeof answer.cap === 'number'
      ? oneLine(answer.error.slice(0, QUOTED_BODY))
      : null
  } catch {
    return null
  }
}

/**
 * The address of the service without its final slashes. The token and the
 * texts of the decisions travel with each request: only a service on this
 * machine may be reached without TLS.
 */
function serviceUrl(address: string): string {
  const url = address.replace(/\/+$/, '')
  if (!/^https:\/\//.test(url) && !LOCAL_HTTP.test(url)) {
    throw new AssistServiceError(
      `the address of the assist service must start with https://, or http:// on localhost (${address})`
    )
  }
  return url
}

/**
 * The token of the service, checked before it goes into a header. fetch
 * refuses a header value with a line break, and quotes the whole value in
 * its error: a token pasted on two lines would then reach the output and a
 * comment of a pull request. The error here never quotes the token.
 */
function serviceToken(token: string): string {
  const value = token.trim()
  if (!/^[\x21-\x7e]+$/.test(value)) {
    throw new AssistServiceError(
      'the token of the assist service holds a space, a line break or a character outside ASCII: set COMPADR_ASSIST_TOKEN again, on one line'
    )
  }
  return value
}

/**
 * A client that posts each request to `<url>/v1/assist/<kind>` as JSON and
 * reads the suggestion against its schema. A suggestion of another kind than
 * the request is an error.
 */
export function httpAssistClient(
  options: HttpAssistClientOptions
): AssistClient {
  const url = serviceUrl(options.url)
  const send = options.fetch ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? 120_000
  return {
    async suggest(request) {
      const token = serviceToken(options.token)
      let response: Response
      try {
        response = await send(`${url}/v1/assist/${request.kind}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(request),
          // A redirect would carry the change and the decisions to another
          // address: the service answers at its own address or not at all.
          redirect: 'error',
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch (error) {
        throw new AssistServiceError(
          `the assist service did not answer: ${oneLine((error as Error).message)}`
        )
      }
      let body: string
      try {
        // The time limit also covers the body: a service may send its
        // headers and then stop.
        body = await readBody(response)
      } catch (error) {
        throw new AssistServiceError(
          `the answer of the assist service could not be read: ${oneLine((error as Error).message)}`,
          response.status
        )
      }
      // Only the 402 of the cap names the credits used and the cap: a 402 of
      // a proxy or a gateway stays an error of the service.
      const cap = response.status === 402 ? capOf(body) : null
      if (cap !== null) {
        throw new AssistCapReachedError(
          `${cap.replace(/\.+$/, '')}. Nothing was sent to the model: an administrator may raise the cap`,
          402
        )
      }
      if (!response.ok) {
        throw new AssistServiceError(
          `the assist service answered ${response.status}: ${oneLine(body.slice(0, QUOTED_BODY))}`,
          response.status
        )
      }
      let json: unknown
      try {
        json = JSON.parse(body)
      } catch {
        throw new AssistServiceError(
          'the assist service answered with something other than JSON',
          response.status
        )
      }
      const parsed = AssistSuggestionSchema.safeParse(json)
      if (!parsed.success) {
        throw new AssistServiceError(
          `the suggestion of the assist service does not follow the contract: ${oneLine(parsed.error.issues[0]?.message ?? '')}`,
          response.status
        )
      }
      if (parsed.data.kind !== request.kind) {
        throw new AssistServiceError(
          `the assist service answered a ${parsed.data.kind} suggestion to a ${request.kind} request`,
          response.status
        )
      }
      // The texts of a suggestion reach a terminal, a file and a comment:
      // no control character comes with them. The walk follows the depth of
      // the schema, not the depth of the answer.
      return withoutControls(parsed.data) as AssistSuggestion
    },
  }
}

/** What the customer used of its AI credits during a month, in UTC. */
export interface AssistUsage {
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

/** The use of the month and the cap of a customer, on the assist service. */
export interface AssistUsageClient {
  usage(): Promise<AssistUsage>
  /** Sets the cap; null goes back to the included volume. */
  setCap(cap: number | null): Promise<AssistUsage>
}

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0

const isCounts = (value: unknown): value is Record<string, number> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every(isCount)

function usageOf(value: unknown): AssistUsage | null {
  const u = value as Partial<AssistUsage> | null
  return typeof u === 'object' &&
    u !== null &&
    typeof u.month === 'string' &&
    /^\d{4}-\d{2}$/.test(u.month) &&
    isCount(u.included) &&
    isCount(u.cap) &&
    typeof u.capSet === 'boolean' &&
    isCount(u.used) &&
    isCounts(u.byKind) &&
    isCounts(u.byRepository)
    ? {
        month: u.month,
        included: u.included,
        cap: u.cap,
        capSet: u.capSet,
        used: u.used,
        byKind: u.byKind,
        byRepository: u.byRepository,
      }
    : null
}

/**
 * A client of `GET /v1/usage` and `PUT /v1/usage/cap`, with the token of the
 * customer. The same rules as the assist client hold for the address.
 */
export function httpAssistUsage(
  options: HttpAssistClientOptions
): AssistUsageClient {
  const url = serviceUrl(options.url)
  const send = options.fetch ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? 30_000
  async function call(path: string, init: RequestInit): Promise<AssistUsage> {
    const token = serviceToken(options.token)
    let response: Response
    let body: string
    try {
      response = await send(`${url}${path}`, {
        ...init,
        redirect: 'error',
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${token}`,
          ...(init.body === undefined
            ? {}
            : { 'content-type': 'application/json' }),
        },
        signal: AbortSignal.timeout(timeoutMs),
      })
      body = await readBody(response)
    } catch (error) {
      throw new AssistServiceError(
        `the assist service did not answer: ${oneLine((error as Error).message)}`
      )
    }
    let json: unknown = null
    try {
      json = JSON.parse(body)
    } catch {
      // Read below as an answer outside the contract.
    }
    if (!response.ok) {
      const reason = (json as { error?: unknown } | null)?.error
      throw new AssistServiceError(
        `the assist service answered ${response.status}: ${oneLine(typeof reason === 'string' ? reason.slice(0, QUOTED_BODY) : body.slice(0, QUOTED_BODY))}`,
        response.status
      )
    }
    const usage = usageOf(json)
    if (usage === null) {
      throw new AssistServiceError(
        'the use of the month that the assist service gives does not follow the contract',
        response.status
      )
    }
    return usage
  }
  return {
    usage: () => call('/v1/usage', { method: 'GET' }),
    setCap: cap =>
      call('/v1/usage/cap', { method: 'PUT', body: JSON.stringify({ cap }) }),
  }
}
