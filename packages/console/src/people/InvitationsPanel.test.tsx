import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import type { InvitationsInfo } from '../portal.ts'
import { fakePortal } from '../testing/portal.ts'
import { InvitationsPanel } from './InvitationsPanel.tsx'

afterEach(cleanup)

const NOW = new Date('2026-11-20T12:00:00Z')

const INVITATIONS: InvitationsInfo = {
  allowance: 5,
  remaining: 4,
  invitesFrom: '2026-11-01T00:00:00Z',
  signUpUrl: 'https://app.compadr.test',
  invitations: [
    {
      account: 'used-org',
      email: null,
      invitedBy: 'alice',
      invitedAt: '2026-11-02T09:00:00Z',
      expiresAt: '2026-12-02T09:00:00Z',
      usedAt: '2026-11-05T09:00:00Z',
      status: 'used',
    },
  ],
}

describe('InvitationsPanel', () => {
  it('shows nothing when no hosted service runs the portal', async () => {
    const { container } = render(
      <InvitationsPanel portal={fakePortal()} now={() => NOW} />
    )
    await new Promise(done => setTimeout(done, 0))
    expect(container.textContent).toBe('')
  })

  it('lists the invitations and invites an account, with or without an email', async () => {
    let current = INVITATIONS
    const sent: [string, string | null][] = []
    const portal = fakePortal({
      invitations: () => Promise.resolve(current),
      invite: (account, email) => {
        sent.push([account, email])
        current = {
          ...current,
          remaining: current.remaining - 1,
          invitations: [
            {
              account,
              email,
              invitedBy: 'alice',
              invitedAt: '2026-11-20T12:00:00Z',
              expiresAt: '2026-12-20T12:00:00Z',
              usedAt: null,
              status: 'open',
            },
            ...current.invitations,
          ],
        }
        return Promise.resolve(current)
      },
    })
    const user = userEvent.setup()
    render(<InvitationsPanel portal={portal} now={() => NOW} />)
    expect(await screen.findByText(/4 of 5 invitations left/)).toBeTruthy()
    expect(screen.getByText('Signed up')).toBeTruthy()
    expect(screen.getByText('used-org')).toBeTruthy()

    await user.type(screen.getByLabelText('GitHub account'), 'octo-org')
    await user.type(screen.getByLabelText('Email (optional)'), 'lead@octo.test')
    await user.click(screen.getByRole('button', { name: 'Invite' }))
    expect(
      await screen.findByText(
        'octo-org is invited. Compadr sends the invitation to lead@octo.test.'
      )
    ).toBeTruthy()
    expect(screen.getByText(/3 of 5 invitations left/)).toBeTruthy()
    expect(screen.getByText('Waiting for the sign-up')).toBeTruthy()
    expect(screen.getByText('Dec 20, 2026')).toBeTruthy()

    await user.type(screen.getByLabelText('GitHub account'), 'solo')
    await user.click(screen.getByRole('button', { name: 'Invite' }))
    expect(
      await screen.findByText(
        'solo is invited. Tell them to sign up at https://app.compadr.test.'
      )
    ).toBeTruthy()
    expect(sent).toEqual([
      ['octo-org', 'lead@octo.test'],
      ['solo', null],
    ])
  })

  it('says from when the customer can invite, and offers no form before', async () => {
    render(
      <InvitationsPanel
        portal={fakePortal({
          invitations: () =>
            Promise.resolve({
              ...INVITATIONS,
              remaining: 5,
              invitesFrom: '2026-12-15T00:00:00Z',
              invitations: [],
            }),
        })}
        now={() => NOW}
      />
    )
    expect(await screen.findByText(/can invite from Dec 15, 2026/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Invite' })).toBeNull()
    expect(screen.getByText(/has sent no invitation yet/)).toBeTruthy()
  })

  it('offers no form once every invitation is sent', async () => {
    render(
      <InvitationsPanel
        portal={fakePortal({
          invitations: () => Promise.resolve({ ...INVITATIONS, remaining: 0 }),
        })}
        now={() => NOW}
      />
    )
    expect(await screen.findByText(/0 of 5 invitations left/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Invite' })).toBeNull()
  })

  it('shows the refusal of the service and the failure of the list', async () => {
    const user = userEvent.setup()
    render(
      <InvitationsPanel
        portal={fakePortal({
          invitations: () => Promise.resolve(INVITATIONS),
          invite: () =>
            Promise.reject(new Error('acme is already a customer of Compadr')),
        })}
        now={() => NOW}
      />
    )
    await user.type(await screen.findByLabelText('GitHub account'), 'acme')
    await user.click(screen.getByRole('button', { name: 'Invite' }))
    expect((await screen.findByRole('alert')).textContent).toBe(
      'acme is already a customer of Compadr'
    )
    cleanup()
    render(
      <InvitationsPanel
        portal={fakePortal({
          invitations: () =>
            Promise.reject(new Error('the service answered 502')),
        })}
        now={() => NOW}
      />
    )
    expect(
      await screen.findByText(
        /The invitations cannot be loaded: the service answered 502/
      )
    ).toBeTruthy()
  })
})
