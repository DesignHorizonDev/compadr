import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import type { UsageInfo } from '../portal.ts'
import { fakePortal } from '../testing/portal.ts'
import { UsageView } from './UsageView.tsx'

afterEach(cleanup)

const USAGE: UsageInfo = {
  month: '2026-11',
  included: 100,
  cap: 100,
  capSet: false,
  used: 12,
  byKind: { plain: 2, check: 10 },
  byRepository: { app: 12 },
}

describe('UsageView', () => {
  it('shows the credits of the month, and sets the cap', async () => {
    const caps: (number | null)[] = []
    let current = USAGE
    const portal = fakePortal({
      usage: () => Promise.resolve(current),
      setUsageCap: cap => {
        caps.push(cap)
        current = {
          ...current,
          cap: cap ?? current.included,
          capSet: cap !== null,
        }
        return Promise.resolve(current)
      },
    })
    const user = userEvent.setup()
    render(<UsageView portal={portal} />)
    expect(
      await screen.findByText(/November 2026: 12 of 100 credits used/)
    ).toBeTruthy()
    expect(screen.getByText('Semantic check')).toBeTruthy()
    expect(
      screen.getByText(/nothing is billed beyond the license/)
    ).toBeTruthy()
    const field = screen.getByLabelText('Cap of the month')
    await user.clear(field)
    await user.type(field, '150')
    await user.click(screen.getByRole('button', { name: 'Set the cap' }))
    expect(await screen.findByText(/12 of 150 credits used/)).toBeTruthy()
    await user.click(
      screen.getByRole('button', { name: 'Back to the included volume' })
    )
    expect(await screen.findByText(/12 of 100 credits used/)).toBeTruthy()
    expect(caps).toEqual([150, null])
  })

  it('announces an overage only for a cap above the included volume', async () => {
    render(
      <UsageView
        portal={fakePortal({
          usage: () => Promise.resolve({ ...USAGE, cap: 50, capSet: true }),
        })}
      />
    )
    expect(await screen.findByText(/within the included volume/)).toBeTruthy()
    expect(screen.queryByText(/overage/)).toBeNull()
  })

  it('says when the portal asks no service, and when the service fails', async () => {
    render(<UsageView portal={fakePortal()} />)
    expect(
      await screen.findByText(/This portal does not ask the assist service/)
    ).toBeTruthy()
    cleanup()
    render(
      <UsageView
        portal={fakePortal({
          usage: () => Promise.reject(new Error('the service answered 503')),
        })}
      />
    )
    expect(
      await screen.findByText(
        /The AI credits cannot be loaded: the service answered 503/
      )
    ).toBeTruthy()
  })
})
