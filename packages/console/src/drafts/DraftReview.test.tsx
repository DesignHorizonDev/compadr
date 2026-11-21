import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DraftReview as Review, Me } from '../portal.ts'
import { fakePortal } from '../testing/portal.ts'
import { DraftReview, splitPatch } from './DraftReview.tsx'

afterEach(cleanup)

const TIP = 'a'.repeat(40)
const PATCH = [
  'diff --git a/docs/adr/0001-pool.md b/docs/adr/0001-pool.md',
  'index 1..2 100644',
  '--- a/docs/adr/0001-pool.md',
  '+++ b/docs/adr/0001-pool.md',
  '@@ -1,3 +1,4 @@',
  ' # ADR 0001',
  '+compadr:',
  '-old',
  '',
].join('\n')

function makeReview(over: Partial<Review> = {}): Review {
  return {
    draft: {
      name: 'portal',
      repository: '/srv/app',
      baseReportId: 'app',
      reportId: 'app--draft.portal',
      base: 'b'.repeat(40),
      baseBranch: 'main',
      commits: [{ commit: TIP, subject: 'docs(adr): check', author: 'Ann' }],
      drafts: [],
    },
    tip: TIP,
    commit: null,
    files: ['docs/adr/0001-pool.md'],
    patch: PATCH,
    truncated: false,
    reviews: [],
    comments: [],
    publications: [],
    rule: {
      required: 1,
      approvedBy: [],
      changesRequestedBy: [],
      publishable: false,
      reason: '1 approval of another editor needed, 0 given',
    },
    ...over,
  }
}

const ANN: Me = { login: 'ann', name: 'Ann', role: 'editor', signsIn: true }

describe('splitPatch', () => {
  it('splits a patch by file', () => {
    expect(splitPatch(PATCH)).toEqual([
      {
        path: 'docs/adr/0001-pool.md',
        lines: PATCH.split('\n').slice(1, -1),
      },
    ])
  })
})

describe('DraftReview', () => {
  it('shows the patch and why the draft cannot be published yet', async () => {
    render(
      <DraftReview
        portal={fakePortal({
          draftReview: () => Promise.resolve(makeReview()),
        })}
        me={ANN}
        repository="app"
        draft="portal"
      />
    )
    expect(
      await screen.findByText(
        'You cannot publish the draft yet: 1 approval of another editor needed, 0 given. Your own approval does not count for you.'
      )
    ).toBeTruthy()
    expect(screen.getByText('+compadr:').className).toBe('patch-add')
    expect(screen.getByText('-old').className).toBe('patch-del')
    expect(
      screen.getByRole<HTMLButtonElement>('button', {
        name: 'Publish as one pull request',
      }).disabled
    ).toBe(true)
  })

  it('approves the tip that the person read, then publishes', async () => {
    const user = userEvent.setup()
    const approved = makeReview({
      reviews: [
        {
          login: 'boss',
          verdict: 'approve',
          body: '',
          tip: TIP,
          at: '2026-11-11T10:00:00Z',
        },
      ],
      rule: {
        required: 1,
        approvedBy: ['boss'],
        changesRequestedBy: [],
        publishable: true,
        reason: null,
      },
    })
    const reviewDraft = vi.fn(() => Promise.resolve(approved))
    const publishDraft = vi.fn(() =>
      Promise.resolve({
        ...approved,
        publications: [
          {
            login: 'ann',
            tip: TIP,
            pullRequest: 'https://github.com/acme/app/pull/7',
            pushedTo: 'https://github.com/acme/app.git',
            at: '2026-11-11T11:00:00Z',
          },
        ],
      })
    )
    render(
      <DraftReview
        portal={fakePortal({
          draftReview: () => Promise.resolve(makeReview()),
          reviewDraft,
          publishDraft,
        })}
        me={ANN}
        repository="app"
        draft="portal"
      />
    )
    await user.click(await screen.findByRole('button', { name: 'Approve' }))
    expect(reviewDraft).toHaveBeenCalledWith('app', 'portal', {
      tip: TIP,
      verdict: 'approve',
      body: '',
    })
    expect(
      await screen.findByText('You can publish the draft: boss approved it.')
    ).toBeTruthy()
    const reviews = within(
      screen.getByRole('list', { name: 'Reviews of the draft' })
    )
    expect(reviews.getByRole('listitem').textContent).toBe('boss approved')
    await user.click(
      screen.getByRole('button', { name: 'Publish as one pull request' })
    )
    expect(publishDraft).toHaveBeenCalledWith('app', 'portal', TIP)
    expect(
      (
        await screen.findByRole('link', {
          name: 'https://github.com/acme/app/pull/7',
        })
      ).getAttribute('href')
    ).toBe('https://github.com/acme/app/pull/7')
  })

  it('asks for changes only with a message, and shows a refusal', async () => {
    const user = userEvent.setup()
    const draftReview = vi.fn(() => Promise.resolve(makeReview()))
    render(
      <DraftReview
        portal={fakePortal({
          draftReview,
          reviewDraft: () =>
            Promise.reject(
              new Error('The draft changed since you read it: read it again')
            ),
        })}
        me={ANN}
        repository="app"
        draft="portal"
      />
    )
    const ask = await screen.findByRole('button', { name: 'Ask for changes' })
    expect((ask as HTMLButtonElement).disabled).toBe(true)
    await user.type(screen.getByLabelText('Message of the review'), 'Wait.')
    await user.click(ask)
    expect(
      await screen.findByText(
        'The draft changed since you read it: read it again'
      )
    ).toBeTruthy()
    // The page reads the draft again, to name its new tip next time.
    await vi.waitFor(() => expect(draftReview).toHaveBeenCalledTimes(2))
  })

  it('comments a line of a file', async () => {
    const user = userEvent.setup()
    const commentDraft = vi.fn(() =>
      Promise.resolve(
        makeReview({
          comments: [
            {
              login: 'ann',
              path: 'docs/adr/0001-pool.md',
              line: 3,
              body: 'Fine.',
              tip: TIP,
              at: '2026-11-11T10:00:00Z',
            },
          ],
        })
      )
    )
    render(
      <DraftReview
        portal={fakePortal({
          draftReview: () => Promise.resolve(makeReview()),
          commentDraft,
        })}
        me={ANN}
        repository="app"
        draft="portal"
      />
    )
    await user.type(await screen.findByLabelText('Line'), '3')
    await user.type(screen.getByLabelText('Comment'), 'Fine.')
    await user.click(screen.getByRole('button', { name: 'Add the comment' }))
    expect(commentDraft).toHaveBeenCalledWith('app', 'portal', {
      tip: TIP,
      path: 'docs/adr/0001-pool.md',
      line: 3,
      body: 'Fine.',
    })
    const comments = within(
      await screen.findByRole('list', {
        name: 'Comments on docs/adr/0001-pool.md',
      })
    )
    expect(comments.getByRole('listitem').textContent).toBe(
      'ann on line 3: Fine.'
    )
  })

  it('gives a reader no form', async () => {
    render(
      <DraftReview
        portal={fakePortal({
          draftReview: () => Promise.resolve(makeReview()),
        })}
        me={{ ...ANN, role: 'reader' }}
        repository="app"
        draft="portal"
      />
    )
    await screen.findByText(/You cannot publish the draft yet/)
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
    expect(screen.queryByLabelText('Comment')).toBeNull()
  })
})
