import { describe, expect, it, vi } from 'vitest'
import { httpReportSource, summarize } from './reports.ts'
import { makeReport } from './testing/report.ts'

function fakeFetch(routes: Record<string, { status?: number; body: unknown }>) {
  return vi.fn((url: string) => {
    const route = routes[url]
    return Promise.resolve(
      new Response(JSON.stringify(route?.body ?? { error: 'No such route' }), {
        status: route ? (route.status ?? 200) : 404,
      })
    )
  }) as unknown as typeof fetch
}

describe('httpReportSource', () => {
  it('lists the reports', async () => {
    const summary = summarize('api-main', makeReport())
    const source = httpReportSource(
      fakeFetch({ '/api/reports': { body: { reports: [summary] } } })
    )
    expect(await source.list()).toEqual([summary])
  })

  it('reads a report and checks it against the schema', async () => {
    const report = makeReport()
    const source = httpReportSource(
      fakeFetch({
        '/api/reports/api%20main': { body: report },
        '/api/reports/broken': { body: { ...report, schemaVersion: 1 } },
      })
    )
    expect(await source.get('api main')).toEqual(report)
    await expect(source.get('broken')).rejects.toThrow()
  })

  it('reports the status and the reason of a failed request', async () => {
    const source = httpReportSource(
      fakeFetch({
        '/api/reports': { status: 500, body: { error: 'folder missing' } },
      })
    )
    await expect(source.get('missing')).rejects.toThrow(
      '/api/reports/missing answered 404: No such route'
    )
    await expect(source.list()).rejects.toThrow(
      '/api/reports answered 500: folder missing'
    )
  })

  it('reports a failed request without a reason', async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(new Response('Bad gateway', { status: 502 }))
    ) as unknown as typeof globalThis.fetch
    await expect(httpReportSource(fetch).list()).rejects.toThrow(
      /^\/api\/reports answered 502$/
    )
  })
})
