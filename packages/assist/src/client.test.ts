import { ASSIST_SCHEMA_VERSION, type PlainRequest } from '@compadr/format'
import { describe, expect, it } from 'vitest'
import { keepAccepted } from './assist.ts'
import {
  AssistCapReachedError,
  AssistServiceError,
  httpAssistClient,
  httpAssistUsage,
  MAX_ANSWER_BYTES,
  oneLine,
} from './client.ts'
import { fakeAssistClient } from './fake.ts'

const request: PlainRequest = {
  kind: 'plain',
  schemaVersion: ASSIST_SCHEMA_VERSION,
  repository: { name: 'app', commit: 'a'.repeat(40), adrDir: 'docs/adr' },
  record: {
    number: 1,
    file: 'docs/adr/0001-billing.md',
    text: '# 1. Billing\n\nCharges go through one service.\n',
  },
}

function fetchAnswering(status: number, body: string, seen: Request[] = []) {
  return ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    seen.push(new Request(input, init))
    return Promise.resolve(new Response(body, { status }))
  }) as typeof globalThis.fetch
}

describe('httpAssistClient', () => {
  it('posts the request with the token and reads the suggestion', async () => {
    const suggestion = await fakeAssistClient().suggest(request)
    const seen: Request[] = []
    const client = httpAssistClient({
      url: 'https://assist.test/',
      token: 'secret',
      fetch: fetchAnswering(200, JSON.stringify(suggestion), seen),
    })
    expect(await client.suggest(request)).toEqual(suggestion)
    expect(seen[0]!.url).toBe('https://assist.test/v1/assist/plain')
    expect(seen[0]!.method).toBe('POST')
    expect(seen[0]!.headers.get('authorization')).toBe('Bearer secret')
    expect(await seen[0]!.json()).toEqual(request)
  })

  it('reports a refusal, a body that is not JSON, and an answer outside the contract', async () => {
    const answer = async (status: number, body: string) =>
      httpAssistClient({
        url: 'https://assist.test',
        token: 't',
        fetch: fetchAnswering(status, body),
      })
        .suggest(request)
        .catch((error: unknown) => error)
    const refused = await answer(402, 'no credit left')
    expect(refused).toBeInstanceOf(AssistServiceError)
    // A 402 that does not name the cap is not read as the cap.
    expect(refused).not.toBeInstanceOf(AssistCapReachedError)
    expect(
      await answer(402, JSON.stringify({ error: 'pay the gateway' }))
    ).not.toBeInstanceOf(AssistCapReachedError)
    expect(refused).toMatchObject({ status: 402 })
    expect((refused as Error).message).toContain('no credit left')
    // The 402 of the service at the cap names the month and the cap.
    const capped = await answer(
      402,
      JSON.stringify({
        // A final period of the service is not doubled.
        error: 'the AI credits of 2026-11 are used: 4 of a cap of 4.',
        used: 4,
        cap: 4,
      })
    )
    expect(capped).toBeInstanceOf(AssistCapReachedError)
    expect((capped as Error).message).toBe(
      'the AI credits of 2026-11 are used: 4 of a cap of 4. Nothing was sent to the model: an administrator may raise the cap'
    )
    expect(((await answer(200, '<html>')) as Error).message).toContain(
      'other than JSON'
    )
    expect(
      ((await answer(200, '{"kind":"plain"}')) as Error).message
    ).toContain('does not follow the contract')
    const check = {
      ...(await fakeAssistClient().suggest(request)),
      kind: 'check',
      findings: [],
    }
    expect(
      ((await answer(200, JSON.stringify(check))) as Error).message
    ).toContain('a check suggestion to a plain request')
  })

  it('reports a service that does not answer, and refuses an address without a scheme', async () => {
    const client = httpAssistClient({
      url: 'https://assist.test',
      token: 't',
      fetch: () => Promise.reject(new Error('connection refused')),
    })
    await expect(client.suggest(request)).rejects.toThrow('did not answer')
    for (const url of [
      'assist.test',
      'http://assist.test',
      'http://127.0.0.1.example.com',
    ]) {
      expect(() => httpAssistClient({ url, token: 't' }), url).toThrow(
        AssistServiceError
      )
    }
    for (const url of [
      'https://assist.test',
      'http://localhost:5199',
      'http://127.0.0.1',
      'http://[::1]:80/',
    ]) {
      expect(() => httpAssistClient({ url, token: 't' }), url).not.toThrow()
    }
  })

  it('reports a body that stops before its end', async () => {
    const broken = new ReadableStream({
      start(controller) {
        controller.error(new Error('connection reset'))
      },
    })
    const client = httpAssistClient({
      url: 'https://assist.test',
      token: 't',
      fetch: () => Promise.resolve(new Response(broken, { status: 200 })),
    })
    const error = await client.suggest(request).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AssistServiceError)
    expect((error as Error).message).toContain('could not be read')
  })
})

describe('httpAssistClient, on a hostile answer', () => {
  const client = (fetch: typeof globalThis.fetch) =>
    httpAssistClient({ url: 'https://assist.test', token: 't', fetch })

  it('refuses an answer larger than the limit, announced or not', async () => {
    const big = 'x'.repeat(MAX_ANSWER_BYTES + 1)
    const announced = (() =>
      Promise.resolve(
        new Response('{}', {
          status: 200,
          headers: { 'content-length': String(MAX_ANSWER_BYTES + 1) },
        })
      )) as typeof globalThis.fetch
    for (const fetch of [fetchAnswering(200, big), announced]) {
      await expect(client(fetch).suggest(request)).rejects.toThrow(
        `the answer is larger than ${MAX_ANSWER_BYTES} bytes`
      )
    }
  })

  it('keeps the control characters of an answer out of its texts', async () => {
    const suggestion = await fakeAssistClient().suggest(request)
    const hostile = JSON.parse(JSON.stringify(suggestion)) as {
      provenance: { model: string }
    }
    hostile.provenance.model = 'model\u001b]0;title\u0007\u001b[2J\u009b31m'
    const read = await client(
      fetchAnswering(200, JSON.stringify(hostile))
    ).suggest(request)
    expect(read.provenance.model).toBe(
      'model\ufffd]0;title\ufffd\ufffd[2J\ufffd31m'
    )
  })

  it('refuses a deeply nested answer as an answer outside the contract', async () => {
    for (const body of [
      '['.repeat(1_000_000) + ']'.repeat(1_000_000),
      '{"a":'.repeat(300_000) + '1' + '}'.repeat(300_000),
    ]) {
      await expect(
        client(fetchAnswering(200, body)).suggest(request)
      ).rejects.toBeInstanceOf(AssistServiceError)
    }
  })

  it('quotes an error body on one line', async () => {
    await expect(
      client(fetchAnswering(500, 'boom\n::error::forged\u001b[31m')).suggest(
        request
      )
    ).rejects.toThrow(
      'the assist service answered 500: boom ::error::forged [31m'
    )
  })

  it('writes a text on one line', () => {
    expect(oneLine('a\r\n::add-mask::b\tc')).toBe('a ::add-mask::b c')
  })
})

describe('keepAccepted', () => {
  it('keeps nothing when the guard rejects the whole suggestion', async () => {
    const suggestion = await fakeAssistClient().suggest(request)
    expect(
      keepAccepted(suggestion, {
        ok: false,
        problems: [
          {
            level: 'error',
            code: 'input-hash-mismatch',
            item: '',
            message: '',
          },
        ],
      })
    ).toEqual({ suggestion: null, rejected: 0 })
  })
})

describe('httpAssistUsage', () => {
  const usage = {
    month: '2026-11',
    included: 100,
    cap: 120,
    capSet: true,
    used: 12,
    byKind: { check: 12 },
    byRepository: { app: 12 },
  }

  it('reads the use of the month and sets the cap with the token', async () => {
    const seen: Request[] = []
    const client = httpAssistUsage({
      url: 'https://assist.test/',
      token: 'secret',
      fetch: fetchAnswering(200, JSON.stringify(usage), seen),
    })
    expect(await client.usage()).toEqual(usage)
    expect(await client.setCap(null)).toEqual(usage)
    expect(seen.map(r => [r.method, r.url])).toEqual([
      ['GET', 'https://assist.test/v1/usage'],
      ['PUT', 'https://assist.test/v1/usage/cap'],
    ])
    expect(seen[1]!.headers.get('authorization')).toBe('Bearer secret')
    expect(await seen[1]!.json()).toEqual({ cap: null })
  })

  it('reports an error of the service and an answer outside the contract', async () => {
    const failing = (status: number, body: string) =>
      httpAssistUsage({
        url: 'https://assist.test',
        token: 't',
        fetch: fetchAnswering(status, body),
      })
        .usage()
        .then(
          () => new AssistServiceError('no error'),
          (error: unknown) => error as AssistServiceError
        )
    const refused = await failing(
      400,
      JSON.stringify({ error: 'the cap must be a whole number' })
    )
    expect(refused).toBeInstanceOf(AssistServiceError)
    expect(refused.message).toBe(
      'the assist service answered 400: the cap must be a whole number'
    )
    expect(
      (await failing(200, JSON.stringify({ ...usage, used: -1 }))).message
    ).toContain('does not follow the contract')
    expect(() =>
      httpAssistUsage({ url: 'http://assist.example.com', token: 't' })
    ).toThrow('must start with https://')
  })
})
