import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Me, People } from '../portal.ts'
import { fakePortal } from '../testing/portal.ts'
import { PeopleView } from './PeopleView.tsx'

afterEach(cleanup)

const PEOPLE: People = {
  people: [
    {
      login: 'boss',
      name: 'Boss',
      lastSeenAt: '2026-11-02T10:00:00Z',
      seat: false,
      active: false,
      admin: true,
    },
    {
      login: 'ann',
      name: 'Ann',
      lastSeenAt: '2026-11-03T10:00:00Z',
      seat: false,
      active: false,
      admin: false,
    },
  ],
  editors: 1,
  limit: 5,
}

const ADMIN: Me = { login: 'boss', name: 'Boss', role: 'admin', signsIn: true }
const READER: Me = { login: 'ann', name: 'Ann', role: 'reader', signsIn: true }

describe('PeopleView', () => {
  it('counts the editors and gives a seat', async () => {
    const user = userEvent.setup()
    const setSeat = vi.fn(() =>
      Promise.resolve({
        people: [
          PEOPLE.people[0]!,
          { ...PEOPLE.people[1]!, seat: true, active: true },
        ],
        editors: 2,
        limit: 5,
      })
    )
    render(
      <PeopleView
        portal={fakePortal({ people: () => Promise.resolve(PEOPLE), setSeat })}
        me={ADMIN}
      />
    )
    expect(
      await screen.findByText(
        /^1 of 5 editors that the license allows · 2 people/
      )
    ).toBeTruthy()
    expect(screen.getByText('Always')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Give a seat' }))
    expect(setSeat).toHaveBeenCalledWith('ann', true)
    expect(await screen.findByText(/^2 of 5 editors/)).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Take back the seat' })
    ).toBeTruthy()
  })

  it('shows a refusal of the portal', async () => {
    const user = userEvent.setup()
    render(
      <PeopleView
        portal={fakePortal({
          people: () => Promise.resolve(PEOPLE),
          setSeat: () =>
            Promise.reject(new Error('Only an administrator gives seats')),
        })}
        me={ADMIN}
      />
    )
    await user.click(await screen.findByRole('button', { name: 'Give a seat' }))
    expect(
      await screen.findByText('Only an administrator gives seats')
    ).toBeTruthy()
  })

  it('gives a reader no seat button', async () => {
    render(
      <PeopleView
        portal={fakePortal({ people: () => Promise.resolve(PEOPLE) })}
        me={READER}
      />
    )
    expect(await screen.findByText('Ann')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
