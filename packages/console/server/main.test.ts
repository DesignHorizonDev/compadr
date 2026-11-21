// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { request, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFixtureRepo, type FixtureRepo } from '@compadr/engine/testing'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { DriftReport } from '@compadr/format'
import type { ReportList } from '../src/reports.ts'
import { allowedHost, pageFile } from './http.ts'
import { runConsole } from './main.ts'
import { repositoryIds } from './repository-reports.ts'

let fixture: FixtureRepo
let pages: string
let cacheDir: string
const servers: Server[] = []

beforeAll(() => {
  fixture = createFixtureRepo([
    {
      date: '2026-01-10T09:00:00Z',
      files: {
        'docs/adr/0001-pool.md':
          '# ADR 0001 — Pool\n\n- **Status:** Accepted\n\nSee `src/pool.ts`.\n',
        'src/pool.ts': 'export {}\n',
      },
    },
  ])
  pages = mkdtempSync(join(tmpdir(), 'compadr-pages-'))
  mkdirSync(join(pages, 'assets'))
  writeFileSync(join(pages, 'index.html'), '<!doctype html><title>t</title>')
  writeFileSync(join(pages, 'assets', 'app-1.js'), 'console.log(1)')
  cacheDir = mkdtempSync(join(tmpdir(), 'compadr-cache-'))
})

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(s => new Promise(done => s.close(done)))
  )
})

afterAll(() => {
  fixture.remove()
  rmSync(pages, { recursive: true, force: true })
  rmSync(cacheDir, { recursive: true, force: true })
})

async function start(argv: string[]) {
  const out: string[] = []
  const err: string[] = []
  const result = await runConsole(
    [...argv, '--port', '0'],
    { out: line => out.push(line), err: line => err.push(line) },
    { pages }
  )
  if (typeof result !== 'number') servers.push(result)
  return { result, out: out.join('\n'), err: err.join('\n') }
}

/** Status of a GET with the given `Host` header, which fetch cannot set. */
function statusWithHost(url: string, host: string): Promise<number> {
  return new Promise((done, fail) => {
    request(url, { headers: { host } }, response => {
      response.resume()
      done(response.statusCode ?? 0)
    })
      .on('error', fail)
      .end()
  })
}

function base(server: Server): string {
  const address = server.address()
  if (typeof address !== 'object' || address === null) throw new Error()
  return `http://127.0.0.1:${address.port}`
}

describe('compadr-console', () => {
  // The first report of a repository: a loaded machine needs more than 5 s.
  it('serves the pages and the report of a repository', async () => {
    const { result, out } = await start([fixture.path, '--cache-dir', cacheDir])
    if (typeof result === 'number') throw new Error(`exit ${result}`)
    expect(out).toMatch(
      /^compadr-console: http:\/\/127\.0\.0\.1:\d+ serves 1 repository at HEAD$/
    )
    const url = base(result)
    const [id] = repositoryIds([fixture.path])

    const answer = await fetch(`${url}/api/reports`)
    expect(answer.headers.get('x-content-type-options')).toBe('nosniff')
    const list = (await answer.json()) as ReportList
    expect(list.reports.map(r => [r.id, r.repository.ref])).toEqual([
      [id, 'HEAD'],
    ])
    const report = (await fetch(`${url}/api/reports/${id}`).then(r =>
      r.json()
    )) as DriftReport
    expect(report.decisions).toHaveLength(1)

    const page = await fetch(`${url}/drift`)
    expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8')
    const policy = page.headers.get('content-security-policy') ?? ''
    expect(policy).not.toContain('unsafe-inline')
    expect(policy).toContain("form-action 'self';")
    expect(page.headers.get('permissions-policy')).toContain('camera=()')
    expect(page.headers.get('cross-origin-opener-policy')).toBe('same-origin')
    expect(page.headers.get('cross-origin-embedder-policy')).toBe(
      'require-corp'
    )
    expect(page.headers.get('cross-origin-resource-policy')).toBe('same-origin')
    expect(page.headers.get('content-security-policy')).toContain(
      "default-src 'self'"
    )
    const asset = await fetch(`${url}/assets/app-1.js`)
    expect(asset.headers.get('cache-control')).toContain('immutable')
    expect((await fetch(`${url}/assets/missing.js`)).status).toBe(404)
    expect((await fetch(`${url}/api/reports/missing`)).status).toBe(404)
  }, 20_000)

  it('serves the findings of --findings-dir, and 404 without it', async () => {
    const [id] = repositoryIds([fixture.path])
    const findingsDir = mkdtempSync(join(tmpdir(), 'compadr-findings-'))
    const findings = {
      schemaVersion: 1,
      repository: {
        name: 'pool',
        commit: fixture.git('rev-parse', 'HEAD').trim(),
        adrDir: 'docs/adr',
      },
      base: null,
      generatedAt: '2026-11-16T10:00:00.000Z',
      model: 'compadr-assist-1',
      promptVersion: 'check-3',
      findings: [],
      rejected: 0,
      excluded: [],
    }
    writeFileSync(
      join(findingsDir, `${id}.findings.json`),
      JSON.stringify(findings)
    )
    try {
      const served = await start([
        fixture.path,
        '--cache-dir',
        cacheDir,
        '--no-github',
        '--findings-dir',
        findingsDir,
      ])
      if (typeof served.result === 'number') throw new Error('exit')
      const answer = await fetch(
        `${base(served.result)}/api/reports/${id}/findings`
      )
      expect(answer.status).toBe(200)
      expect(await answer.json()).toEqual(findings)
      expect(
        (await fetch(`${base(served.result)}/api/reports/other/findings`))
          .status
      ).toBe(404)

      const without = await start([
        fixture.path,
        '--cache-dir',
        cacheDir,
        '--no-github',
      ])
      if (typeof without.result === 'number') throw new Error('exit')
      expect(
        (await fetch(`${base(without.result)}/api/reports/${id}/findings`))
          .status
      ).toBe(404)
    } finally {
      rmSync(findingsDir, { recursive: true, force: true })
    }
  }, 20_000)

  it('lists no review when no branch proposes a decision', async () => {
    const { result } = await start([
      fixture.path,
      '--cache-dir',
      cacheDir,
      '--no-github',
    ])
    if (typeof result === 'number') throw new Error(`exit ${result}`)
    const answer = await fetch(`${base(result)}/api/reviews`)
    expect(answer.status).toBe(200)
    expect(await answer.json()).toEqual({ reviews: [], changes: [] })
  })

  it('refuses a request for another domain name', async () => {
    const { result } = await start([fixture.path, '--cache-dir', cacheDir])
    if (typeof result === 'number') throw new Error(`exit ${result}`)
    const url = `${base(result)}/api/reports`
    expect(await statusWithHost(url, 'evil.example')).toBe(403)
    expect(await statusWithHost(url, 'localhost:4180')).toBe(200)
  })

  it('refuses a cache folder inside the repository', async () => {
    const { result, err } = await start([
      fixture.path,
      '--cache-dir',
      join(fixture.path, '.cache'),
    ])
    expect(result).toBe(2)
    expect(err).toContain('is inside the repository')
  })

  it('stops on a reference that is not a commit', async () => {
    const { result, err } = await start([fixture.path, '--ref', 'nowhere'])
    expect(result).toBe(1)
    expect(err).toContain('nowhere is not a commit of')
  })

  it('refuses a port that is not a number', async () => {
    const out: string[] = []
    const err: string[] = []
    const result = await runConsole(
      [fixture.path, '--port', 'http'],
      { out: line => out.push(line), err: line => err.push(line) },
      { pages }
    )
    expect(result).toBe(2)
    expect(err[0]).toBe('compadr-console: --port http is not a port number')
  })
})

describe('allowedHost', () => {
  it('accepts localhost and IP addresses, and refuses other names', () => {
    expect(allowedHost('127.0.0.1:4180', '127.0.0.1')).toBe(true)
    expect(allowedHost('[::1]:4180', '127.0.0.1')).toBe(true)
    expect(allowedHost('LOCALHOST:4180', '127.0.0.1')).toBe(true)
    expect(allowedHost('compadr.localhost', '127.0.0.1')).toBe(true)
    expect(allowedHost('box.lan:4180', 'box.lan')).toBe(true)
    expect(allowedHost('evil.example', '127.0.0.1')).toBe(false)
    expect(allowedHost('box.lan', '0.0.0.0')).toBe(false)
    expect(allowedHost(undefined, '127.0.0.1')).toBe(false)
  })
})

describe('pageFile', () => {
  it('serves index.html for the routes of the application', () => {
    expect(pageFile('/p', '/')).toBe('/p/index.html')
    expect(pageFile('/p', '/features/billing')).toBe('/p/index.html')
  })

  it('keeps a file inside the pages', () => {
    expect(pageFile('/p', '/assets/a.js')).toBe('/p/assets/a.js')
    expect(pageFile('/p', '/../secret.txt')).toBeNull()
    expect(pageFile('/p', '/%2e%2e/secret.txt')).toBeNull()
    expect(pageFile('/p', '/%E0%A4%A.js')).toBeNull()
  })
})

describe('repositoryIds', () => {
  it('names each repository after its folder, without collision', () => {
    expect(
      repositoryIds([
        '/a/api',
        '/b/api',
        '/c/api-2',
        '/d/.hidden',
        '/e/my repo',
      ])
    ).toEqual(['api', 'api-2', 'api-2-2', 'r.hidden', 'my-repo'])
  })
})
