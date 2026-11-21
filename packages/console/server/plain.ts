// The version in plain language of a decision record, as the console asks
// the assist service for it. A person asks for it with a button: each call
// costs, so the server keeps each version by the text of the record, on disk
// when the console has a cache folder. A record that does not change is
// never sent twice. A record that `assist.exclude` of compadr.yml names
// never leaves the machine.
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AssistServiceError,
  httpAssistClient,
  runAssist,
  type AssistClient,
} from '@compadr/assist'
import { buildPlainRequest, type ReadRecord } from '@compadr/engine'
import {
  ASSIST_SCHEMA_VERSION,
  AssistSuggestionSchema,
  excludedFromAssist,
  type DriftReport,
  type PlainRequest,
  type PlainSuggestion,
} from '@compadr/format'

/** A request that cannot be answered, such as an unknown decision. */
export class PlainRequestError extends Error {}

/** A record that `assist.exclude` keeps in the repository. */
export class PlainExcludedError extends PlainRequestError {}

/** The service failed, or the guard rejected its answer. */
export class PlainServiceError extends Error {}

export interface PlainOptions {
  /** Address of the service, from COMPADR_ASSIST_URL. */
  url: string
  /** Token of the service, from COMPADR_ASSIST_TOKEN. */
  token: string
  /** Folder of the versions already written; memory only without it. */
  cacheDir?: string
  /** Builds the client; the tests give a fake one. */
  client?: (url: string, token: string) => AssistClient
}

/** Where a report reads its records. */
export interface RecordSource {
  report: DriftReport
  read: ReadRecord
}

export interface ConsolePlain {
  /** The version kept for the record as it is now, or undefined. */
  cached(
    source: RecordSource,
    decision: number
  ): Promise<PlainSuggestion | undefined>
  /** The version kept, or a new one from the service. */
  read(source: RecordSource, decision: number): Promise<PlainSuggestion>
}

/**
 * The key of a version: the service, the record and where it lives, without
 * the commit. Another commit that leaves the record as it is keeps its
 * version; another service writes its own.
 */
function keyOf(service: string, request: PlainRequest): string {
  const { name, adrDir } = request.repository
  return createHash('sha256')
    .update(
      JSON.stringify({
        schemaVersion: ASSIST_SCHEMA_VERSION,
        service,
        repository: { name, adrDir },
        record: request.record,
      })
    )
    .digest('hex')
}

export function consolePlain(options: PlainOptions): ConsolePlain {
  const client = (
    options.client ?? ((url, token) => httpAssistClient({ url, token }))
  )(options.url, options.token)
  const folder =
    options.cacheDir === undefined ? undefined : join(options.cacheDir, 'plain')
  const kept = new Map<string, PlainSuggestion>()
  // A second click while the first waits does not pay twice.
  const pending = new Map<string, Promise<PlainSuggestion>>()

  function fromDisk(key: string): PlainSuggestion | undefined {
    if (folder === undefined) return undefined
    try {
      const parsed = AssistSuggestionSchema.safeParse(
        JSON.parse(readFileSync(join(folder, `${key}.json`), 'utf8'))
      )
      return parsed.success && parsed.data.kind === 'plain'
        ? parsed.data
        : undefined
    } catch {
      return undefined
    }
  }

  function keep(key: string, suggestion: PlainSuggestion) {
    kept.set(key, suggestion)
    if (folder === undefined) return
    try {
      mkdirSync(folder, { recursive: true })
      const file = join(folder, `${key}.json`)
      writeFileSync(`${file}.tmp`, JSON.stringify(suggestion))
      renameSync(`${file}.tmp`, file)
    } catch {
      // The version stays in memory.
    }
  }

  async function requestOf(
    { report, read }: RecordSource,
    decision: number
  ): Promise<{ request: PlainRequest; key: string }> {
    const found = report.decisions.find(d => d.number === decision)
    if (found === undefined) {
      throw new PlainRequestError(`no decision ${decision} in the report`)
    }
    // Without the settings, nothing says what may leave: nothing leaves.
    if (report.assist === undefined) {
      throw new PlainRequestError(
        'the report does not give the assist settings of compadr.yml: compute it again'
      )
    }
    if (excludedFromAssist(report.assist, found.file)) {
      throw new PlainExcludedError(
        `${found.file} stays in the repository: assist.exclude of compadr.yml names it`
      )
    }
    const request = await buildPlainRequest(report, decision, read)
    return { request, key: keyOf(options.url.replace(/\/+$/, ''), request) }
  }

  function known(key: string): PlainSuggestion | undefined {
    const found = kept.get(key) ?? fromDisk(key)
    if (found !== undefined) kept.set(key, found)
    return found
  }

  return {
    async cached(source, decision) {
      return known((await requestOf(source, decision)).key)
    },

    async read(source, decision) {
      const { request, key } = await requestOf(source, decision)
      const found = known(key)
      if (found !== undefined) return found
      let waiting = pending.get(key)
      if (waiting === undefined) {
        waiting = (async () => {
          let outcome
          try {
            outcome = await runAssist(client, request, source.report)
          } catch (error) {
            throw new PlainServiceError(
              error instanceof AssistServiceError
                ? error.message
                : `the assist service failed: ${(error as Error).message}`
            )
          }
          const suggestion = outcome.suggestion
          if (suggestion === null || suggestion.kind !== 'plain') {
            throw new PlainServiceError(
              `the guard rejected the answer of the service: ${outcome.problems[0]?.message ?? 'no version'}`
            )
          }
          keep(key, suggestion)
          return suggestion
        })()
        pending.set(key, waiting)
        waiting.then(
          () => pending.delete(key),
          () => pending.delete(key)
        )
      }
      return waiting
    },
  }
}
