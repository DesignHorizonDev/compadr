// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AssistServiceError,
  fakeAssistClient,
  type AssistClient,
  type AssistOutcomeClient,
  type FakeAnswer,
  type SuggestionOutcome,
} from '@compadr/assist'
import { DraftStore } from '@compadr/cli/drafts'
import { createFixtureRepo, type FixtureRepo } from '@compadr/engine/testing'
import type { AssistRequest } from '@compadr/format'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DraftDecisionOutcome } from '../src/assist.ts'
import type { DraftState } from '../src/drafts.ts'
import type { ReviewList } from '../src/reviews.ts'
import { consoleDraftDecision, draftNameOf } from './draft-decision.ts'
import { runConsole } from './main.ts'
import { repositoryIds, repositoryReports } from './repository-reports.ts'

let fixture: FixtureRepo
let pages: string
let id: string
let receipts: string
let before: { head: string; branches: string }
const folders: string[] = []

const ASSIST = {
  COMPADR_ASSIST_URL: 'https://assist.test',
  COMPADR_ASSIST_TOKEN: 't',
}

function commitOn(branch: string, files: Record<string, string>) {
  fixture.git('checkout', '-q', '-b', branch, 'main')
  for (const [file, content] of Object.entries(files)) {
    writeFileSync(join(fixture.path, file), content)
    fixture.git('add', '--', file)
  }
  fixture.git('commit', '-q', '-m', branch)
  const commit = fixture.git('rev-parse', 'HEAD').trim()
  fixture.git('checkout', '-q', 'main')
  return commit
}

beforeAll(() => {
  fixture = createFixtureRepo([
    {
      date: '2026-01-10T09:00:00Z',
      files: {
        'docs/adr/0001-billing.md':
          '# 1. Billing\n\nStatus: Accepted\n\n## Decision\n\nCharges go through `server/billing/charge.ts`.\n',
        'docs/adr/compadr.yml': 'assist:\n  exclude:\n    - config/secrets\n',
        'server/billing/charge.ts': 'export const charge = 1\n',
        'config/secrets/keys.ts': 'export const key = "k"\n',
      },
    },
  ])
  // The runner of the CI has no identity: the draft takes the one of the
  // analysed repository.
  fixture.git('config', 'user.name', 'Draft Author')
  fixture.git('config', 'user.email', 'draft@example.com')
  receipts = commitOn('feat/receipts', {
    'server/billing/receipt.ts': 'export const receipt = 1\n',
    'config/secrets/keys.ts': 'export const key = "l"\n',
  })
  commitOn('fix/secret', {
    'config/secrets/keys.ts': 'export const key = "m"\n',
  })
  before = {
    head: fixture.git('rev-parse', 'HEAD').trim(),
    branches: fixture.git('branch', '--list'),
  }
  pages = mkdtempSync(join(tmpdir(), 'compadr-pages-'))
  id = repositoryIds([fixture.path])[0]!
})

afterAll(() => {
  fixture.remove()
  rmSync(pages, { recursive: true, force: true })
  for (const folder of folders) rmSync(folder, { recursive: true, force: true })
})

/** A draft of the service for the receipt of a charge. */
const receipt: FakeAnswer = () => ({
  notNeeded: null,
  title: 'Receipts of a charge',
  rule: 'Each charge gives one receipt, named after the charge.',
  amends: [1],
  supersedes: [],
  context: 'Customers ask for a proof of each charge.',
  decision: [
    {
      heading: 'One receipt per charge',
      text: '`server/billing/receipt.ts` names the receipt after the charge.',
    },
  ],
  consequences: 'Support finds a receipt from the charge alone.',
  codeRefs: ['server/billing/receipt.ts'],
})

/** A console on the fixture, with a client that counts what it is sent. */
async function start(
  options: {
    env?: Record<string, string>
    cacheDir?: string
    answer?: FakeAnswer
    fail?: boolean
    args?: string[]
  } = {}
) {
  const outcomes: SuggestionOutcome[] = []
  const cacheDir =
    options.cacheDir ?? mkdtempSync(join(tmpdir(), 'compadr-cache-'))
  folders.push(cacheDir)
  const sent: AssistRequest[] = []
  const result = await runConsole(
    [
      fixture.path,
      '--port',
      '0',
      '--cache-dir',
      cacheDir,
      '--no-github',
      '--ref',
      'main',
      ...(options.args ?? []),
    ],
    { out: () => {}, err: () => {} },
    {
      pages,
      env: options.env ?? ASSIST,
      now: () => new Date(2026, 10, 19, 10),
      assistOutcomes: (): AssistOutcomeClient => ({
        report(outcome) {
          outcomes.push(outcome)
          return Promise.resolve()
        },
      }),
      assistClient: (): AssistClient => {
        const fake = fakeAssistClient({
          answer: options.answer ?? receipt,
          now: () => new Date('2026-11-19T10:00:00Z'),
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
  const changes = async () =>
    ((await ask('/api/reviews')).body as unknown as Required<ReviewList>)
      .changes
  const route = async (branch: string) =>
    `/api/assist/${encodeURIComponent(
      (await changes()).find(c => c.branch === branch)!.reportId
    )}/draft`
  return {
    sent,
    outcomes,
    cacheDir,
    ask,
    post,
    changes,
    route,
    close: () => new Promise(done => result.close(done)),
  }
}

function expectRepositoryUnchanged() {
  expect(fixture.git('rev-parse', 'HEAD').trim()).toBe(before.head)
  expect(fixture.git('status', '--porcelain')).toBe('')
  expect(fixture.git('branch', '--list')).toBe(before.branches)
}

async function discard(cacheDir: string, name: string) {
  const store = await DraftStore.open(fixture.path, cacheDir)
  const draft = await store.get(name)
  if (draft !== null) await store.discard(draft)
}

describe('the drafting of a decision from the change of a branch', () => {
  it('names the draft after the branch', () => {
    expect(draftNameOf('feat/receipts')).toBe('propose-feat-receipts')
    expect(draftNameOf('a..b.lock')).toBe('propose-a.b')
  })

  it('answers 404 without the service, and without drafts', async () => {
    const without = await start({ env: {} })
    try {
      expect((await without.ask('/api/assist')).status).toBe(404)
      expect(
        (await without.post(await without.route('feat/receipts'))).status
      ).toBe(404)
    } finally {
      await without.close()
    }
    const noDraft = await start({ args: ['--no-draft'] })
    try {
      expect((await noDraft.ask('/api/assist')).body).toEqual({
        plain: true,
        draft: false,
      })
      expect(
        (await noDraft.post(await noDraft.route('feat/receipts'))).status
      ).toBe(404)
      expect(noDraft.sent).toEqual([])
    } finally {
      await noDraft.close()
    }
  })

  it('drafts once for a change, into a draft that starts at the branch', async () => {
    const console = await start()
    try {
      expect((await console.ask('/api/assist')).body).toEqual({
        plain: true,
        draft: true,
      })
      // The branches that change the code without proposing a record.
      expect((await console.changes()).map(c => c.branch)).toEqual([
        'feat/receipts',
        'fix/secret',
      ])
      const route = await console.route('feat/receipts')
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
      expect(one.status, JSON.stringify(one.body)).toBe(200)
      expect(two.body).toEqual(one.body)
      expect(console.sent).toHaveLength(1)
      const outcome = one.body as unknown as DraftDecisionOutcome
      expect(outcome).toMatchObject({
        model: 'fake',
        commit: receipts,
        excluded: ['config/secrets/keys.ts'],
        result: {
          kind: 'drafted',
          draft: 'propose-feat-receipts',
          number: 2,
          path: 'docs/adr/0002-receipts-of-a-charge.md',
          title: 'Receipts of a charge',
        },
      })
      // The change of the branch, without the files that stay.
      const diff = (console.sent[0] as { diff: string }).diff
      expect(diff).toContain('server/billing/receipt.ts')
      expect(diff).not.toContain('config/secrets')

      // The draft starts at the tip of the branch, and goes into it.
      const state = (
        await console.ask(`/api/drafts/${id}?draft=propose-feat-receipts`)
      ).body as unknown as DraftState
      expect(state.base).toBe(receipts)
      expect(state.baseBranch).toBe('feat/receipts')
      expect(state.commits.map(c => c.subject)).toEqual([
        'docs(adr): propose ADR 0002',
      ])

      // The outcome is kept: the page shows it, and a click does not pay.
      expect(await console.ask(route)).toEqual({ status: 200, body: one.body })
      expect(await console.post(route)).toEqual({ status: 200, body: one.body })
      expect(console.sent).toHaveLength(1)
      expectRepositoryUnchanged()
    } finally {
      await console.close()
    }
  })

  it('asks again once the draft is discarded, and refuses a draft that exists', async () => {
    const first = await start()
    const route = await first.route('feat/receipts')
    try {
      expect((await first.post(route)).status).toBe(200)
      await discard(first.cacheDir, 'propose-feat-receipts')
      // The draft is gone: the button shows again.
      expect((await first.ask(route)).status).toBe(404)
      expect((await first.post(route)).status).toBe(200)
      expect(first.sent).toHaveLength(2)
    } finally {
      await first.close()
    }
    // A console without the outcome on disk finds the draft in the way.
    const again = await start({ cacheDir: first.cacheDir, args: [] })
    try {
      // The outcome on disk is read back.
      expect((await again.ask(await again.route('feat/receipts'))).status).toBe(
        200
      )
    } finally {
      await again.close()
    }
    rmSync(join(first.cacheDir, 'draft-decision'), { recursive: true })
    const lost = await start({ cacheDir: first.cacheDir })
    try {
      // The draft is in the way: the page says so, and nothing is sent.
      const route = await lost.route('feat/receipts')
      const waiting = await lost.ask(route)
      expect(waiting.status).toBe(409)
      expect(waiting.body.error).toContain(
        'the draft propose-feat-receipts holds a record for this branch already'
      )
      expect((await lost.post(route)).status).toBe(409)
      expect(lost.sent).toEqual([])
    } finally {
      await lost.close()
      await discard(first.cacheDir, 'propose-feat-receipts')
    }
  })

  it('tells the service that a draft was shown, and never that the console set it aside', async () => {
    const console = await start()
    const route = await console.route('feat/receipts')
    try {
      expect((await console.post(route)).status).toBe(200)
      await new Promise(done => setTimeout(done, 0))
      expect(console.sent[0]!.kind).toBe('draft')
      expect(console.outcomes).toHaveLength(1)
      expect(console.outcomes[0]).toMatchObject({
        kind: 'draft',
        outcome: 'shown',
      })
      expect(console.outcomes[0]!.inputHash).toMatch(/^[0-9a-f]{64}$/)
      // The command line publishes the drafts of a console: a draft gone
      // may have been published first, so no outcome goes.
      await discard(console.cacheDir, 'propose-feat-receipts')
      expect((await console.ask(route)).status).toBe(404)
      expect(console.outcomes).toHaveLength(1)
    } finally {
      await console.close()
    }
  })

  it('tells a server that publishes its drafts what became of each one', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'compadr-cache-'))
    folders.push(cacheDir)
    const reports = repositoryReports(
      [
        {
          repository: fixture.path,
          ref: 'main',
          generatorVersion: '0.0.0',
          cacheDir,
        },
      ],
      { drafts: { name: 'review', cacheDir } }
    )
    const told: SuggestionOutcome['outcome'][] = []
    const drafting = consoleDraftDecision({
      url: 'https://assist.test',
      token: 't',
      drafts: reports.drafts!,
      cacheDir,
      client: () =>
        fakeAssistClient({
          answer: receipt,
          now: () => new Date('2026-11-19T10:00:00Z'),
        }),
      now: () => new Date(2026, 10, 19, 10),
      outcomes: {
        client: {
          report(outcome) {
            told.push(outcome.outcome)
            return Promise.resolve()
          },
        },
        publications: true,
      },
    })
    const sourceOf = async () => {
      const { changes } = await reports.reviews()
      const change = changes.find(c => c.branch === 'feat/receipts')!
      return (await reports.branchSource(change.reportId))!
    }
    // A draft published, then discarded: followed once, never dismissed.
    const first = await drafting.draft(await sourceOf())
    await new Promise(done => setTimeout(done, 0))
    expect(first.result.kind).toBe('drafted')
    const reportId = (first.result as { reportId: string }).reportId
    await drafting.published(reportId)
    await drafting.published(reportId)
    expect(told).toEqual(['shown', 'followed'])
    await discard(cacheDir, 'propose-feat-receipts')
    expect(await drafting.cached(await sourceOf())).toBeUndefined()
    expect(told).toEqual(['shown', 'followed'])
    // A draft discarded without a publication: dismissed.
    await drafting.draft(await sourceOf())
    await new Promise(done => setTimeout(done, 0))
    await discard(cacheDir, 'propose-feat-receipts')
    expect(await drafting.cached(await sourceOf())).toBeUndefined()
    expect(told).toEqual(['shown', 'followed', 'shown', 'dismissed'])
    expectRepositoryUnchanged()
  })

  it('never sends a change whose files stay in the repository', async () => {
    const console = await start()
    try {
      const route = await console.route('fix/secret')
      const kept = await console.ask(route)
      expect(kept.status).toBe(403)
      expect(kept.body.excluded).toBe(true)
      expect((await console.post(route)).status).toBe(403)
      expect(console.sent).toEqual([])
    } finally {
      await console.close()
    }
  })

  it('writes nothing when the change only applies a decision', async () => {
    const console = await start({
      answer: request => ({
        ...(receipt(request) as object),
        notNeeded: 'The change only applies ADR 0001.',
      }),
    })
    try {
      const answered = await console.post(await console.route('feat/receipts'))
      expect(answered.status).toBe(200)
      expect(answered.body.result).toEqual({
        kind: 'not-needed',
        reason: 'The change only applies ADR 0001.',
      })
      const state = (
        await console.ask(`/api/drafts/${id}?draft=propose-feat-receipts`)
      ).body as unknown as DraftState
      expect(state.reportId).toBeNull()
      expectRepositoryUnchanged()
    } finally {
      await console.close()
    }
  })

  it('says when the service fails, and keeps nothing', async () => {
    const console = await start({ fail: true })
    try {
      const route = await console.route('feat/receipts')
      expect(await console.post(route)).toEqual({
        status: 502,
        body: { error: 'the service answered 503' },
      })
      expect((await console.ask(route)).status).toBe(404)
      const state = (
        await console.ask(`/api/drafts/${id}?draft=propose-feat-receipts`)
      ).body as unknown as DraftState
      expect(state.reportId).toBeNull()
    } finally {
      await console.close()
    }
  })

  // Last: it moves feat/receipts.
  it('follows a new commit of the branch, and never pays for a draft in the way', async () => {
    const console = await start()
    try {
      const route = await console.route('feat/receipts')
      expect((await console.post(route)).status).toBe(200)
      expect(console.sent).toHaveLength(1)
      // A commit on the branch, after the list of reviews.
      fixture.git('checkout', '-q', 'feat/receipts')
      writeFileSync(
        join(fixture.path, 'server/billing/receipt.ts'),
        'export const receipt = 2\n'
      )
      fixture.git('commit', '-q', '-am', 'later')
      const later = fixture.git('rev-parse', 'HEAD').trim()
      fixture.git('checkout', '-q', 'main')
      // The same route reads the branch at its new commit: the draft of the
      // earlier commit waits for review, so nothing is sent.
      const waiting = await console.ask(route)
      expect(waiting.status).toBe(409)
      expect((await console.post(route)).status).toBe(409)
      expect((await console.post(route)).status).toBe(409)
      expect(console.sent).toHaveLength(1)
      expect(
        (await console.changes()).find(c => c.branch === 'feat/receipts')
          ?.commit
      ).toBe(later)
      // Once the draft is discarded, the new commit is drafted.
      await discard(console.cacheDir, 'propose-feat-receipts')
      const drafted = await console.post(route)
      expect(drafted.status).toBe(200)
      expect(drafted.body.commit).toBe(later)
      expect(console.sent).toHaveLength(2)
    } finally {
      await console.close()
    }
  })
})
