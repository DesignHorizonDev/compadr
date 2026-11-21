import { describe, expect, it } from 'vitest'
import { httpPortalSource } from './portal.ts'

const answer = (status: number, type: string, body: string) =>
  (() =>
    Promise.resolve(
      new Response(body, { status, headers: { 'content-type': type } })
    )) as unknown as typeof fetch

describe('httpPortalSource', () => {
  it('reads the overview of a portal', async () => {
    const source = httpPortalSource(
      answer(200, 'application/json; charset=utf-8', '{"repositories":[]}')
    )
    expect(await source.overview()).toEqual({ repositories: [] })
  })

  it('answers null when the server is the console alone', async () => {
    expect(
      await httpPortalSource(
        answer(200, 'text/html', '<!doctype html>')
      ).overview()
    ).toBeNull()
    expect(
      await httpPortalSource(answer(404, 'application/json', '{}')).overview()
    ).toBeNull()
  })

  it('fails on an error of the portal', async () => {
    await expect(
      httpPortalSource(answer(500, 'application/json', '{}')).queue()
    ).rejects.toThrow('/api/portal/queue answered 500')
  })
})
