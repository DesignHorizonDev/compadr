// @vitest-environment node
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeReport } from '../src/testing/report.ts'
import { handleReportRequest, reportFolder } from './reports-api.ts'

let directory: string
const main = makeReport({ ref: 'main' })
const findings = {
  schemaVersion: 1,
  repository: {
    name: main.repository.name,
    commit: main.repository.commit,
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
const develop = makeReport({
  ref: 'develop',
  commit: '9a8b7c6d'.padEnd(40, '0'),
})

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'compadr-reports-'))
  writeFileSync(join(directory, 'api-main.json'), JSON.stringify(main))
  writeFileSync(join(directory, 'api-develop.json'), JSON.stringify(develop))
  writeFileSync(join(directory, 'notes.json'), '{"title": "not a report"}')
  writeFileSync(join(directory, 'cut.json'), '{"schemaVersion":')
  writeFileSync(join(directory, 'readme.md'), '# Reports')
  writeFileSync(
    join(directory, 'api-main.findings.json'),
    JSON.stringify(findings)
  )
  writeFileSync(
    join(directory, 'api-develop.findings.json'),
    '{"findings": []}'
  )
})

const recommendation = {
  kind: 'accept',
  schemaVersion: 1,
  status: 'suggested',
  provenance: {
    model: 'compadr-assist-1',
    promptVersion: 'accept-1',
    inputHash: 'b'.repeat(64),
    createdAt: '2026-11-17T10:00:00Z',
  },
  recommendation: 'accept',
  explanation: 'The code applies it.',
  points: [],
  amendments: [],
}

beforeAll(() => {
  // The output of compadr assist accept --out, and a file that holds another kind.
  writeFileSync(
    join(directory, 'api-main.accept-7.json'),
    JSON.stringify({ suggestion: recommendation, problems: [], rejected: 0 })
  )
  writeFileSync(
    join(directory, 'api-main.accept-8.json'),
    JSON.stringify({ ...recommendation, kind: 'plain', summary: 'x' })
  )
})

const consolidation = {
  kind: 'consolidate',
  schemaVersion: 1,
  status: 'suggested',
  provenance: { ...recommendation.provenance, promptVersion: 'consolidate-4' },
  rules: [{ rule: 'Send once.', sources: [3], quote: 'once' }],
  replaced: [],
  conflicts: [],
}

beforeAll(() => {
  // The output of compadr assist consolidate --out, and the suggestion alone
  // of another kind.
  writeFileSync(
    join(directory, 'api-main.consolidate-3.json'),
    JSON.stringify({ suggestion: consolidation, problems: [], rejected: 0 })
  )
  writeFileSync(
    join(directory, 'api-main.consolidate-4.json'),
    JSON.stringify(recommendation)
  )
})

afterAll(() => rmSync(directory, { recursive: true, force: true }))

async function request(method: string, url: string, folder = directory) {
  const headers: Record<string, string> = {}
  const result = { status: 0, headers, body: undefined as unknown }
  const response = {
    set statusCode(status: number) {
      result.status = status
    },
    setHeader(name: string, value: string) {
      headers[name] = value
    },
    end(body: string) {
      result.body = JSON.parse(body)
    },
  } as unknown as ServerResponse
  const warnings: string[] = []
  await handleReportRequest(
    reportFolder(folder),
    { method, url } as IncomingMessage,
    response,
    message => warnings.push(message)
  )
  return { ...result, warnings }
}

describe('reportFolder', () => {
  it('lists the drift reports and names the other JSON files', () => {
    const { reports, problems } = reportFolder(directory).list()
    expect(reports.map(report => [report.id, report.repository.ref])).toEqual([
      ['api-develop', 'develop'],
      ['api-main', 'main'],
    ])
    expect(problems).toEqual([
      expect.stringMatching(/^cut\.json cannot be read/),
      'notes.json is not a drift report',
    ])
  })

  it('reads one report and nothing outside the listed ones', () => {
    const folder = reportFolder(directory)
    expect(folder.get('api-main')).toEqual(main)
    expect(folder.get('notes')).toBeUndefined()
    expect(folder.get('../api-main')).toBeUndefined()
    expect(folder.get('missing')).toBeUndefined()
  })

  it('lists nothing without a folder', () => {
    expect(reportFolder(undefined).list()).toEqual({
      reports: [],
      problems: [],
    })
  })

  it('never writes to the folder', () => {
    const before = readdirSync(directory).sort()
    const folder = reportFolder(directory)
    folder.list()
    folder.get('api-main')
    expect(readdirSync(directory).sort()).toEqual(before)
  })
})

describe('handleReportRequest', () => {
  it('answers the list and logs the files it skips', async () => {
    const { status, body, warnings } = await request('GET', '/')
    expect(status).toBe(200)
    expect((body as { reports: unknown[] }).reports).toHaveLength(2)
    expect(warnings).toHaveLength(2)
  })

  it('answers one report', async () => {
    expect(await request('GET', '/api-main')).toMatchObject({
      status: 200,
      body: main,
    })
  })

  it('answers 404 for an unknown report', async () => {
    expect((await request('GET', '/missing')).status).toBe(404)
    expect((await request('GET', '/..%2Fapi-main')).status).toBe(404)
  })

  it('answers 404 for a malformed identifier', async () => {
    expect((await request('GET', '/%E0%A4%A')).status).toBe(404)
  })

  it('answers 500 with the reason when the folder cannot be read', async () => {
    const missing = join(directory, 'missing')
    for (const url of ['/', '/api-main']) {
      const { status, body, warnings } = await request('GET', url, missing)
      expect(status).toBe(500)
      expect((body as { error: string }).error).toMatch(
        /^The reports folder .*missing cannot be read: ENOENT/
      )
      expect(warnings).toEqual([(body as { error: string }).error])
    }
  })

  it('refuses other methods', async () => {
    const { status, headers } = await request('POST', '/')
    expect(status).toBe(405)
    expect(headers.allow).toBe('GET, HEAD')
  })
})

describe('the recommendations route', () => {
  it('answers the recommendation on a decision, which is not a report', async () => {
    expect(await request('GET', '/api-main/recommendations/7')).toMatchObject({
      status: 200,
      body: recommendation,
    })
    expect(
      reportFolder(directory)
        .list()
        .reports.map(r => r.id)
    ).toEqual(['api-develop', 'api-main'])
    expect((await request('GET', '/api-main/recommendations/9')).status).toBe(
      404
    )
    expect((await request('GET', '/notes/recommendations/7')).status).toBe(404)
    const wrong = await request('GET', '/api-main/recommendations/8')
    expect(wrong).toMatchObject({
      status: 500,
      body: { error: 'api-main.accept-8.json holds no accept suggestion' },
    })
  })
})

describe('the consolidations route', () => {
  it('answers the consolidation along a decision, which is not a report', async () => {
    expect(await request('GET', '/api-main/consolidations/3')).toMatchObject({
      status: 200,
      body: consolidation,
    })
    expect(
      reportFolder(directory)
        .list()
        .reports.map(r => r.id)
    ).toEqual(['api-develop', 'api-main'])
    expect((await request('GET', '/api-main/consolidations/7')).status).toBe(
      404
    )
    expect((await request('GET', '/notes/consolidations/3')).status).toBe(404)
    expect(await request('GET', '/api-main/consolidations/4')).toMatchObject({
      status: 500,
      body: {
        error: 'api-main.consolidate-4.json holds no consolidate suggestion',
      },
    })
  })
})

describe('the findings route', () => {
  it('answers the findings of a report, which are not a report', async () => {
    const answer = await request('GET', '/api-main/findings')
    expect(answer).toMatchObject({ status: 200, body: findings })
    expect(
      reportFolder(directory)
        .list()
        .reports.map(report => report.id)
    ).not.toContain('api-main.findings')
  })

  it('answers 404 without findings or for an unknown report', async () => {
    for (const url of [
      '/notes/findings',
      '/absent/findings',
      '/a%2F..%2Fb/findings',
    ]) {
      expect((await request('GET', url)).status).toBe(404)
    }
  })

  it('answers 500 for a file that does not follow the schema', async () => {
    const answer = await request('GET', '/api-develop/findings')
    expect(answer.status).toBe(500)
    expect(answer.warnings).toEqual([
      'api-develop.findings.json does not follow the findings schema',
    ])
  })
})
