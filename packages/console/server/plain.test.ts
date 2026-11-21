// @vitest-environment node
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AssistServiceError,
  fakeAssistClient,
  type AssistClient,
} from '@compadr/assist'
import { createFixtureRepo, type FixtureRepo } from '@compadr/engine/testing'
import type { AssistRequest } from '@compadr/format'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runConsole } from './main.ts'
import { repositoryIds } from './repository-reports.ts'

let fixture: FixtureRepo
let pages: string
let id: string
const folders: string[] = []

const ASSIST = {
  COMPADR_ASSIST_URL: 'https://assist.test',
  COMPADR_ASSIST_TOKEN: 't',
}

beforeAll(() => {
  fixture = createFixtureRepo([
    {
      date: '2026-01-10T09:00:00Z',
      files: {
        'docs/adr/0001-pool.md':
          '# ADR 0001 — Pool\n\n- **Status:** Accepted\n\n## Decision\n\nThe pool keeps four workers at most.\n',
        'docs/adr/0002-secret.md':
          '# ADR 0002 — Secret\n\n- **Status:** Accepted\n\n## Decision\n\nThe keys stay in the vault of the team.\n',
        'docs/adr/compadr.yml':
          'assist:\n  exclude:\n    - docs/adr/0002-secret.md\n',
      },
    },
    {
      date: '2026-01-11T09:00:00Z',
      // Another commit that leaves ADR 0001 as it is.
      files: { 'src/pool.ts': 'export const workers = 4\n' },
    },
  ])
  pages = mkdtempSync(join(tmpdir(), 'compadr-pages-'))
  id = repositoryIds([fixture.path])[0]!
})

afterAll(() => {
  fixture.remove()
  rmSync(pages, { recursive: true, force: true })
  for (const folder of folders) rmSync(folder, { recursive: true, force: true })
})

/** A console on the fixture, with a client that counts what it is sent. */
async function start(
  options: {
    env?: Record<string, string>
    ref?: string
    cacheDir?: string
    fail?: boolean
    /** Arguments in place of the cache folder, such as --no-cache. */
    args?: string[]
  } = {}
) {
  const cacheDir =
    options.cacheDir ?? mkdtempSync(join(tmpdir(), 'compadr-cache-'))
  folders.push(cacheDir)
  const sent: AssistRequest[] = []
  const err: string[] = []
  const result = await runConsole(
    [
      fixture.path,
      '--port',
      '0',
      ...(options.args ?? ['--cache-dir', cacheDir]),
      '--no-github',
      '--ref',
      options.ref ?? 'HEAD',
    ],
    { out: () => {}, err: line => err.push(line) },
    {
      pages,
      env: options.env ?? ASSIST,
      assistClient: (): AssistClient => {
        const fake = fakeAssistClient({
          now: () => new Date('2026-11-17T10:00:00Z'),
        })
        return {
          async suggest(request) {
            sent.push(request)
            // The answer takes a moment: a second click arrives meanwhile.
            await new Promise(done => setTimeout(done, 50))
            if (options.fail) {
              throw new AssistServiceError('the service answered 503', 503)
            }
            return fake.suggest(request)
          },
        }
      },
    }
  )
  if (typeof result === 'number') throw new Error(`exit ${result}`)
  const address = result.address()
  if (typeof address !== 'object' || address === null) throw new Error()
  const at = `http://127.0.0.1:${address.port}`
  const ask = (path: string, init: RequestInit = {}) =>
    fetch(`${at}${path}`, init).then(async response => ({
      status: response.status,
      body: (await response.json()) as Record<string, unknown>,
    }))
  const post = (path: string, origin = at) =>
    ask(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: '{}',
    })
  return {
    sent,
    err,
    cacheDir,
    ask,
    post,
    close: () => new Promise(done => result.close(done)),
  }
}

describe('the plain language of the console server', () => {
  it('answers 404 on every route without the service', async () => {
    const console = await start({ env: {} })
    try {
      expect((await console.ask('/api/assist')).status).toBe(404)
      expect((await console.post(`/api/assist/${id}/plain/1`)).status).toBe(404)
      expect(console.sent).toEqual([])
    } finally {
      await console.close()
    }
    const noToken = await start({
      env: { COMPADR_ASSIST_URL: 'https://assist.test' },
    })
    try {
      expect((await noToken.ask('/api/assist')).status).toBe(404)
      expect(noToken.err.join('\n')).toContain(
        'COMPADR_ASSIST_TOKEN is missing'
      )
    } finally {
      await noToken.close()
    }
  })

  it('asks once for a record, keeps the version, and only for a page of the console', async () => {
    const console = await start()
    try {
      expect(await console.ask('/api/assist')).toEqual({
        status: 200,
        body: { plain: true, draft: true },
      })
      expect(console.err.join('\n')).toContain('each new version costs')
      const route = `/api/assist/${id}/plain/1`
      expect((await console.ask(route)).status).toBe(404)
      expect((await console.post(route, 'https://elsewhere.test')).status).toBe(
        403
      )
      expect(console.sent).toEqual([])

      // Two clicks at once pay once.
      const [one, two] = await Promise.all([
        console.post(route),
        console.post(route),
      ])
      expect(one.status).toBe(200)
      expect(one.body).toMatchObject({
        kind: 'plain',
        summary: 'Decision 1: **Status:** Accepted.',
      })
      expect(two.body).toEqual(one.body)
      expect(await console.ask(route)).toEqual({ status: 200, body: one.body })
      expect(await console.post(route)).toEqual({ status: 200, body: one.body })
      expect(console.sent).toHaveLength(1)
      expect(console.sent[0]).toMatchObject({
        kind: 'plain',
        record: { number: 1 },
      })
      expect(readdirSync(join(console.cacheDir, 'plain'))).toHaveLength(1)

      expect((await console.post(`/api/assist/${id}/plain/9`)).status).toBe(400)
      expect((await console.post('/api/assist/unknown/plain/1')).status).toBe(
        404
      )
    } finally {
      await console.close()
    }
  })

  it('never sends a record that compadr.yml excludes', async () => {
    const console = await start()
    try {
      const route = `/api/assist/${id}/plain/2`
      // The page reads the answer of the GET, and shows no button.
      expect(await console.ask(route)).toEqual({
        status: 403,
        body: {
          error:
            'docs/adr/0002-secret.md stays in the repository: assist.exclude of compadr.yml names it',
          excluded: true,
        },
      })
      expect((await console.post(route)).status).toBe(403)
      expect(console.sent).toEqual([])
    } finally {
      await console.close()
    }
  })

  it('keeps the version on disk for another commit and another run', async () => {
    const first = await start({ ref: 'HEAD~1' })
    const route = `/api/assist/${id}/plain/1`
    try {
      expect((await first.post(route)).status).toBe(200)
    } finally {
      await first.close()
    }
    const again = await start({ cacheDir: first.cacheDir })
    try {
      expect((await again.ask(route)).status).toBe(200)
      expect((await again.post(route)).status).toBe(200)
      expect(again.sent).toEqual([])
    } finally {
      await again.close()
    }
  })

  it('says when the service fails, and keeps nothing', async () => {
    const console = await start({ fail: true })
    try {
      const failed = await console.post(`/api/assist/${id}/plain/1`)
      expect(failed).toEqual({
        status: 502,
        body: { error: 'the service answered 503' },
      })
      expect(existsSync(join(console.cacheDir, 'plain'))).toBe(false)
    } finally {
      await console.close()
    }
  })
})

describe('the settings of the plain language', () => {
  it('refuses an address of the service that is neither https nor local', async () => {
    const err: string[] = []
    const code = await runConsole(
      [fixture.path, '--port', '0', '--no-cache', '--no-github'],
      { out: () => {}, err: line => err.push(line) },
      {
        pages,
        env: {
          COMPADR_ASSIST_URL: 'http://assist.example.com',
          COMPADR_ASSIST_TOKEN: 't',
        },
      }
    )
    expect(code).toBe(2)
    expect(err.join('\n')).toContain('must start with https://')
  })

  it('keeps the versions in memory with --no-cache', async () => {
    const console = await start({ args: ['--no-cache'] })
    const route = `/api/assist/${id}/plain/1`
    try {
      expect((await console.post(route)).status).toBe(200)
      expect((await console.post(route)).status).toBe(200)
      expect(console.sent).toHaveLength(1)
      expect(existsSync(join(console.cacheDir, 'plain'))).toBe(false)
    } finally {
      await console.close()
    }
  })

  it('asks again when the version on disk cannot be read', async () => {
    const first = await start()
    const route = `/api/assist/${id}/plain/1`
    try {
      expect((await first.post(route)).status).toBe(200)
    } finally {
      await first.close()
    }
    const folder = join(first.cacheDir, 'plain')
    for (const file of readdirSync(folder)) {
      writeFileSync(join(folder, file), '{')
    }
    const again = await start({ cacheDir: first.cacheDir })
    try {
      expect((await again.ask(route)).status).toBe(404)
      expect((await again.post(route)).status).toBe(200)
      expect(again.sent).toHaveLength(1)
    } finally {
      await again.close()
    }
  })

  it('warns when another machine can reach the console', async () => {
    const console = await start({ args: ['--no-cache', '--host', '0.0.0.0'] })
    try {
      expect(console.err.join('\n')).toContain(
        'the console listens on 0.0.0.0, so another machine that reaches the port can ask the assist service, at your cost'
      )
    } finally {
      await console.close()
    }
  })
})
