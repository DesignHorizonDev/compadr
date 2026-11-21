// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assistInputHash,
  buildConsolidateRequest,
  createDriftReport,
  runGit,
} from '@compadr/engine'
import { createFixtureRepo, type FixtureRepo } from '@compadr/engine/testing'
import type { DriftReport } from '@compadr/format'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DraftState } from '../src/drafts.ts'
import type { ReportList } from '../src/reports.ts'
import { sameOrigin } from './http.ts'
import { runConsole } from './main.ts'
import { repositoryIds } from './repository-reports.ts'

let fixture: FixtureRepo
let pages: string
let cacheDir: string
let server: Server
let url: string
let id: string
let state: { status: string; refs: string }

beforeAll(async () => {
  fixture = createFixtureRepo([
    {
      date: '2026-01-10T09:00:00Z',
      files: {
        'docs/adr/0001-pool.md':
          '# ADR 0001 — Pool\n\n- **Status:** Accepted\n\nSee `src/pool.ts:2` and `src/queue.ts:1`.\n',
        'src/pool.ts': 'one\ntwo\n',
        'src/queue.ts': 'one\n',
      },
    },
    {
      date: '2026-02-10T09:00:00Z',
      files: { 'src/pool.ts': 'one\nTWO\n', 'src/queue.ts': 'ONE\n' },
    },
  ])
  fixture.git('config', 'user.name', 'Console Author')
  fixture.git('config', 'user.email', 'console@example.com')
  state = {
    status: fixture.git('status', '--porcelain', '--ignored'),
    refs: fixture.git('for-each-ref'),
  }
  pages = mkdtempSync(join(tmpdir(), 'compadr-pages-'))
  cacheDir = mkdtempSync(join(tmpdir(), 'compadr-cache-'))
  const result = await runConsole(
    [fixture.path, '--port', '0', '--cache-dir', cacheDir, '--no-github'],
    { out: () => {}, err: () => {} },
    { pages }
  )
  if (typeof result === 'number') throw new Error(`exit ${result}`)
  server = result
  const address = server.address()
  if (typeof address !== 'object' || address === null) throw new Error()
  url = `http://127.0.0.1:${address.port}`
  id = repositoryIds([fixture.path])[0]!
})

afterAll(async () => {
  await new Promise(done => server.close(done))
  fixture.remove()
  rmSync(pages, { recursive: true, force: true })
  rmSync(cacheDir, { recursive: true, force: true })
})

const post = (path: string, body: unknown, headers: object = {}) =>
  fetch(`${url}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: url,
      ...headers,
    },
    body: JSON.stringify(body),
  })

async function reference(text: string): Promise<string> {
  const report = (await fetch(`${url}/api/reports/${id}`).then(r =>
    r.json()
  )) as DriftReport
  return report.references.find(r => r.text === text)!.id
}

describe('the drafts of the console server', () => {
  it('gives an empty draft before the first correction', async () => {
    const answer = await fetch(`${url}/api/drafts/${id}`)
    expect(answer.status).toBe(200)
    expect(await answer.json()).toEqual({
      name: 'console',
      repository: fixture.path,
      baseReportId: id,
      reportId: null,
      base: null,
      baseBranch: null,
      commits: [],
      drafts: [],
    })
  })

  // Two drafts and three reports: a loaded machine needs more than 5 s.
  it('adds two checks as two commits, then serves the draft report', async () => {
    const pool = await reference('src/pool.ts:2')
    const queue = await reference('src/queue.ts:1')
    const first = await post(`/api/drafts/${id}/checks`, { references: [pool] })
    expect(first.status).toBe(200)
    const second = await post(`/api/drafts/${id}/checks`, {
      references: [queue],
      by: 'Ana Martin',
    })
    const draft = (await second.json()) as DraftState
    expect(draft.commits.map(c => c.subject)).toEqual([
      'docs(adr): mark a reference as checked',
      'docs(adr): mark a reference as checked',
    ])
    expect(draft.base).toBe(fixture.git('rev-parse', 'HEAD').trim())
    expect(draft.baseBranch).toBe('main')
    expect(draft.reportId).toBe(`${id}--draft.console`)

    const list = (await fetch(`${url}/api/reports`).then(r =>
      r.json()
    )) as ReportList
    expect(list.reports.map(r => [r.id, r.repository.name])).toEqual([
      [id, id],
      [`${id}--draft.console`, id],
    ])
    const tip = (await fetch(`${url}/api/reports/${draft.reportId}`).then(r =>
      r.json()
    )) as DriftReport
    expect(tip.repository.ref).toBe('drafts/console')
    const checked = tip.references.filter(r => r.checkedAt)
    expect(checked.map(r => [r.text, r.checkedAt, r.checkedBy?.names])).toEqual(
      [
        ['src/pool.ts:2', '2026-02-10T09:00:00Z', ['Console Author']],
        ['src/queue.ts:1', '2026-02-10T09:00:00Z', ['Ana Martin']],
      ]
    )
    expect(draft.commits.map(c => c.author)).toEqual([
      'Console Author',
      'Console Author',
    ])
    // The actions on the draft report go to the same draft.
    const again = await fetch(`${url}/api/drafts/${draft.reportId}`)
    expect(((await again.json()) as DraftState).commits).toHaveLength(2)

    // Another draft of the same repository, named by the request.
    const named = await post(`/api/drafts/${id}/checks`, {
      references: [pool],
      draft: 'release',
    })
    expect(named.status).toBe(200)
    const release = (await named.json()) as DraftState
    expect(release.name).toBe('release')
    expect(release.reportId).toBe(`${id}--draft.release`)
    expect(release.drafts.map(d => [d.name, d.commits, d.authors])).toEqual([
      ['console', 2, ['Console Author']],
      ['release', 1, ['Console Author']],
    ])
    const read = (await fetch(`${url}/api/drafts/${id}?draft=release`).then(r =>
      r.json()
    )) as DraftState
    expect(read.commits).toHaveLength(1)
    // The default draft stays the default one.
    const byDefault = (await fetch(`${url}/api/drafts/${id}`).then(r =>
      r.json()
    )) as DraftState
    expect(byDefault.name).toBe('console')
    const reports = (await fetch(`${url}/api/reports`).then(r =>
      r.json()
    )) as ReportList
    expect(reports.reports.map(r => r.id)).toContain(`${id}--draft.release`)
    expect((await fetch(`${url}/api/drafts/${id}?draft=..bad`)).status).toBe(
      400
    )
    expect(fixture.git('status', '--porcelain', '--ignored')).toBe(state.status)
    expect(fixture.git('for-each-ref')).toBe(state.refs)
  }, 20_000)

  it('leaves no empty draft after a refused first correction', async () => {
    const other = createFixtureRepo([
      {
        date: '2026-01-10T09:00:00Z',
        files: {
          'docs/adr/0001-pool.md':
            '# ADR 0001 — Pool\n\n- **Status:** Accepted\n\nSee `src/pool.ts`.\n',
          'src/pool.ts': 'one\n',
        },
      },
    ])
    const result = await runConsole(
      [other.path, '--port', '0', '--cache-dir', cacheDir, '--no-github'],
      { out: () => {}, err: () => {} },
      { pages }
    )
    if (typeof result === 'number') throw new Error(`exit ${result}`)
    try {
      const address = result.address()
      if (typeof address !== 'object' || address === null) throw new Error()
      const at = `http://127.0.0.1:${address.port}`
      const [otherId] = repositoryIds([other.path])
      const refused = await fetch(`${at}/api/drafts/${otherId}/checks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: at },
        body: JSON.stringify({ references: ['9999:none:1'] }),
      })
      expect(refused.status).toBe(400)
      const draft = (await fetch(`${at}/api/drafts/${otherId}`).then(r =>
        r.json()
      )) as DraftState
      expect(draft.reportId).toBeNull()
      const list = (await fetch(`${at}/api/reports`).then(r =>
        r.json()
      )) as ReportList
      expect(list.reports.map(r => r.id)).toEqual([otherId])
    } finally {
      await new Promise(done => result.close(done))
      other.remove()
    }
  })

  it('accepts a proposed decision as recommended, and serves the recommendation', async () => {
    const other = createFixtureRepo([
      {
        date: '2026-01-10T09:00:00Z',
        files: {
          'docs/adr/0001-pool.md':
            '# ADR 0001 — Pool\n\n- **Status:** Accepted\n\nSee `src/pool.ts`.\n',
          'docs/adr/0002-retries.md':
            '# ADR 0002 — Retries\n\n- **Status:** Proposed (2026-01-09)\n\n## Decision\n\nA failed job is retried three times.\n',
          'src/pool.ts': '// ADR-0002\nexport const retries = 3\n',
        },
      },
    ])
    other.git('config', 'user.name', 'Console Author')
    other.git('config', 'user.email', 'console@example.com')
    const before = other.git('for-each-ref')
    const findingsDir = mkdtempSync(join(tmpdir(), 'compadr-findings-'))
    const [otherId] = repositoryIds([other.path])
    const recommendation = {
      kind: 'accept',
      schemaVersion: 1,
      status: 'suggested',
      provenance: {
        model: 'compadr-assist-1',
        promptVersion: 'accept-1',
        inputHash: 'a'.repeat(64),
        createdAt: '2026-11-17T10:00:00Z',
      },
      recommendation: 'accept',
      explanation: 'The code retries three times.',
      points: [],
      amendments: [],
    }
    writeFileSync(
      join(findingsDir, `${otherId}.accept-2.json`),
      JSON.stringify({ suggestion: recommendation, problems: [], rejected: 0 })
    )
    const result = await runConsole(
      [
        other.path,
        '--port',
        '0',
        '--cache-dir',
        cacheDir,
        '--no-github',
        '--findings-dir',
        findingsDir,
      ],
      { out: () => {}, err: () => {} },
      { pages }
    )
    if (typeof result === 'number') throw new Error(`exit ${result}`)
    try {
      const address = result.address()
      if (typeof address !== 'object' || address === null) throw new Error()
      const at = `http://127.0.0.1:${address.port}`
      const accepts = (body: unknown) =>
        fetch(`${at}/api/drafts/${otherId}/accepts`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: at },
          body: JSON.stringify(body),
        })

      const served = await fetch(
        `${at}/api/reports/${otherId}/recommendations/2`
      )
      expect(await served.json()).toEqual(recommendation)
      expect(
        (await fetch(`${at}/api/reports/${otherId}/recommendations/1`)).status
      ).toBe(404)

      expect((await accepts({ decision: 1 })).status).toBe(400)
      expect(
        (
          await accepts({
            decision: 2,
            recommendation: {
              recommendation: 'withdraw',
              model: 'm',
              promptVersion: 'p',
            },
          })
        ).status
      ).toBe(400)
      // A model is a name: a line break would forge the message.
      expect(
        (
          await accepts({
            decision: 2,
            recommendation: {
              recommendation: 'accept',
              model: 'claude\nSigned-off-by: someone',
              promptVersion: 'accept-1',
            },
          })
        ).status
      ).toBe(400)
      const accepted = await accepts({
        decision: 2,
        recommendation: {
          recommendation: 'accept',
          model: 'compadr-assist-1',
          promptVersion: 'accept-1',
        },
      })
      expect(accepted.status).toBe(200)
      const draft = (await accepted.json()) as DraftState
      expect(draft.commits.map(c => c.subject)).toEqual([
        'docs(adr): accept ADR 0002',
      ])
      const tip = (await fetch(`${at}/api/reports/${draft.reportId}`).then(r =>
        r.json()
      )) as DriftReport
      const two = tip.decisions.find(d => d.number === 2)!
      expect(two.status).toBe('accepted')
      expect(two.rawStatus).toMatch(/^Accepted \(\d{4}-\d{2}-\d{2}\)$/)
      expect(other.git('for-each-ref')).toBe(before)
    } finally {
      await new Promise(done => result.close(done))
      other.remove()
      rmSync(findingsDir, { recursive: true, force: true })
    }
  }, 20_000)

  it('validates the rules that the service consolidated, read by the server', async () => {
    const record = (head: string[], text: string) =>
      [...head, '', '## Decision', '', text, ''].join('\n')
    const other = createFixtureRepo([
      {
        date: '2026-01-10T09:00:00Z',
        files: {
          'docs/adr/0001-billing.md': record(
            [
              '---',
              'compadr:',
              '  feature: billing',
              '---',
              '# ADR 0001 — Billing',
              '',
              '- **Status:** Accepted',
            ],
            'An invoice is sent on the first day of the month.'
          ),
          'docs/adr/0002-daily.md': record(
            [
              '---',
              'compadr:',
              '  feature: billing',
              '  parent: 1',
              '---',
              '# ADR 0002 — Daily invoices',
              '',
              '- **Status:** Accepted',
              '- Amends ADR 0001.',
            ],
            'An invoice is sent on the day of the order.'
          ),
          'docs/adr/features.yml':
            '# Features\nbilling:\n  label: Billing\n  main: 1\n',
        },
      },
    ])
    other.git('config', 'user.name', 'Console Author')
    other.git('config', 'user.email', 'console@example.com')
    const before = other.git('for-each-ref')
    const findingsDir = mkdtempSync(join(tmpdir(), 'compadr-findings-'))
    const [otherId] = repositoryIds([other.path])
    const report = await createDriftReport(other.path, {
      ref: 'HEAD',
      generatorVersion: '0.0.0',
    })
    const commit = report.repository.commit
    const request = await buildConsolidateRequest(report, 1, file =>
      runGit(other.path, 'show', [`${commit}:${file}`])
    )
    const suggestion = (inputHash: string) => ({
      kind: 'consolidate',
      schemaVersion: 1,
      status: 'suggested',
      provenance: {
        model: 'compadr-assist-1',
        promptVersion: 'consolidate-4',
        inputHash,
        createdAt: '2026-11-17T10:00:00Z',
      },
      rules: [
        {
          rule: 'An invoice goes out on the day of the order.',
          sources: [2],
          quote: 'An invoice is sent on the day of the order.',
        },
      ],
      replaced: [
        {
          rule: 'An invoice is sent on the first day of the month.',
          record: 1,
          replacedBy: 2,
        },
      ],
      conflicts: [],
    })
    const file = join(findingsDir, `${otherId}.consolidate-1.json`)
    const result = await runConsole(
      [
        other.path,
        '--port',
        '0',
        '--cache-dir',
        cacheDir,
        '--no-github',
        '--findings-dir',
        findingsDir,
      ],
      { out: () => {}, err: () => {} },
      { pages }
    )
    if (typeof result === 'number') throw new Error(`exit ${result}`)
    try {
      const address = result.address()
      if (typeof address !== 'object' || address === null) throw new Error()
      const at = `http://127.0.0.1:${address.port}`
      const validate = async (body: unknown) => {
        const response = await fetch(`${at}/api/drafts/${otherId}/rules`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: at },
          body: JSON.stringify(body),
        })
        return {
          status: response.status,
          body: (await response.json()) as DraftState & { error?: string },
        }
      }

      // Without a file, the server says which command writes it.
      const missing = await validate({ feature: 'billing' })
      expect(missing.status).toBe(400)
      expect(missing.body.error).toContain(
        `compadr assist consolidate --decision 1 --out <findings-dir>/${otherId}.consolidate-1.json`
      )
      expect((await validate({ feature: 'shipping' })).status).toBe(400)
      expect((await validate({})).status).toBe(400)

      // A file of another kind is the fault of the folder, not of the server.
      writeFileSync(file, JSON.stringify({ kind: 'plain', summary: 'x' }))
      const wrong = await validate({ feature: 'billing' })
      expect(wrong.status).toBe(400)
      expect(wrong.body.error).toBe(
        `${otherId}.consolidate-1.json holds no consolidate suggestion`
      )
      writeFileSync(file, '{')
      expect((await validate({ feature: 'billing' })).status).toBe(400)

      // A consolidation made on another state of the chain is refused.
      writeFileSync(file, JSON.stringify(suggestion('b'.repeat(64))))
      const old = await validate({ feature: 'billing' })
      expect(old.status).toBe(400)
      expect(old.body.error).toContain(
        'the suggestion does not answer the chain of ADR 0001'
      )

      writeFileSync(
        file,
        JSON.stringify({
          suggestion: suggestion(assistInputHash(request)),
          problems: [],
          rejected: 0,
        })
      )
      const served = await fetch(
        `${at}/api/reports/${otherId}/consolidations/1`
      )
      expect(((await served.json()) as { kind: string }).kind).toBe(
        'consolidate'
      )
      expect(
        (await fetch(`${at}/api/reports/${otherId}/consolidations/2`)).status
      ).toBe(404)

      // The server reads the file: a rule in the request changes nothing.
      const validated = await validate({
        feature: 'billing',
        rules: [{ rule: 'forged', sources: [1], quote: 'forged' }],
      })
      expect(validated.status, validated.body.error).toBe(200)
      expect(validated.body.commits.map(c => c.subject)).toEqual([
        'docs(adr): validate the rules in force of Billing',
      ])
      const tip = (await fetch(
        `${at}/api/reports/${validated.body.reportId}`
      ).then(r => r.json())) as DriftReport
      const billing = tip.features!.find(f => f.id === 'billing')!
      expect(billing.rules?.rules.map(r => r.rule)).toEqual([
        'An invoice goes out on the day of the order.',
      ])
      expect(billing.rules?.validated).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(billing.staleRecords).toEqual([])
      expect(other.git('for-each-ref')).toBe(before)
    } finally {
      await new Promise(done => result.close(done))
      other.remove()
      rmSync(findingsDir, { recursive: true, force: true })
    }
  }, 20_000)

  it('refuses an unknown reference, a bad body and a foreign page', async () => {
    const unknown = await post(`/api/drafts/${id}/checks`, {
      references: ['9999:none:1'],
    })
    expect(unknown.status).toBe(400)
    expect(await unknown.json()).toEqual({
      error: 'no reference 9999:none:1 in the report',
    })
    expect(
      (await post(`/api/drafts/${id}/checks`, { references: 'x' })).status
    ).toBe(400)
    expect(
      (
        await post(
          `/api/drafts/${id}/checks`,
          { references: ['x'] },
          { origin: 'http://evil.example' }
        )
      ).status
    ).toBe(403)
    expect(
      (
        await post(
          `/api/drafts/${id}/checks`,
          { references: ['x'] },
          { 'content-type': 'text/plain' }
        )
      ).status
    ).toBe(403)
    expect((await fetch(`${url}/api/drafts/${id}/checks`)).status).toBe(405)
    expect((await fetch(`${url}/api/drafts/unknown`)).status).toBe(404)
  })
})

describe('compadr-console --no-draft', () => {
  it('serves no draft route', async () => {
    const result = await runConsole(
      [fixture.path, '--port', '0', '--no-cache', '--no-draft', '--no-github'],
      { out: () => {}, err: () => {} },
      { pages }
    )
    if (typeof result === 'number') throw new Error(`exit ${result}`)
    try {
      const address = result.address()
      if (typeof address !== 'object' || address === null) throw new Error()
      const answer = await fetch(
        `http://127.0.0.1:${address.port}/api/drafts/${id}`
      )
      expect(answer.status).toBe(404)
    } finally {
      await new Promise(done => result.close(done))
    }
  })

  it('names the folder of the drafts when it is inside the repository', async () => {
    // With --no-cache, the drafts still go to the default cache folder.
    const xdg = process.env.XDG_CACHE_HOME
    process.env.XDG_CACHE_HOME = join(fixture.path, '.cache')
    const err: string[] = []
    try {
      const refused = await runConsole(
        [fixture.path, '--port', '0', '--no-cache'],
        { out: () => {}, err: line => err.push(line) },
        { pages }
      )
      expect(refused).toBe(2)
    } finally {
      if (xdg === undefined) delete process.env.XDG_CACHE_HOME
      else process.env.XDG_CACHE_HOME = xdg
    }
    expect(err.join('\n')).toContain(
      `--cache-dir ${join(fixture.path, '.cache', 'compadr')} is inside`
    )
  })

  it('refuses a draft name that git cannot keep', async () => {
    const err: string[] = []
    const result = await runConsole(
      [fixture.path, '--port', '0', '--draft', '../x'],
      { out: () => {}, err: line => err.push(line) },
      { pages }
    )
    expect(result).toBe(2)
    expect(err.join('\n')).toContain('is not a draft name')
  })
})

describe('sameOrigin', () => {
  const request = (headers: Record<string, string>) =>
    ({ headers: { host: '127.0.0.1:4180', ...headers } }) as never
  it('accepts a JSON request from the page of the console', () => {
    expect(
      sameOrigin(
        request({
          'content-type': 'application/json; charset=utf-8',
          origin: 'http://127.0.0.1:4180',
          'sec-fetch-site': 'same-origin',
        })
      )
    ).toBe(true)
  })
  it('refuses another site, another type or no origin', () => {
    const json = { 'content-type': 'application/json' }
    expect(sameOrigin(request({ ...json }))).toBe(false)
    expect(
      sameOrigin(request({ ...json, origin: 'http://localhost:4180' }))
    ).toBe(false)
    expect(
      sameOrigin(
        request({
          ...json,
          origin: 'http://127.0.0.1:4180',
          'sec-fetch-site': 'cross-site',
        })
      )
    ).toBe(false)
    expect(
      sameOrigin(
        request({
          'content-type': 'text/plain',
          origin: 'http://127.0.0.1:4180',
        })
      )
    ).toBe(false)
  })
})
