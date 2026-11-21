import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { LicenseInfo } from '../portal.ts'
import { fakePortal } from '../testing/portal.ts'
import { LicenseNote, licenseLine } from './LicenseNote.tsx'

afterEach(cleanup)

const FREE: LicenseInfo = {
  mode: 'free',
  reason: 'the license of Acme ended on 2026-11-12',
  limits: { repositories: 1, editors: 1 },
  license: null,
  unlicensedRepositories: ['web'],
}

describe('licenseLine', () => {
  it('says that a license is a trial', () => {
    expect(
      licenseLine({
        mode: 'licensed',
        reason: null,
        limits: { repositories: 10, editors: 10 },
        license: {
          id: 't',
          licensee: 'acme',
          plan: 'team',
          expiresAt: '2026-12-19T00:00:00Z',
          trial: true,
        },
        unlicensedRepositories: [],
      })
    ).toBe(
      'Team trial license of acme, until Dec 19, 2026: 10 editors, 10 repositories.'
    )
  })

  it('names the plan and the limits of a license', () => {
    expect(
      licenseLine({
        mode: 'licensed',
        reason: null,
        limits: { repositories: null, editors: 12 },
        license: {
          id: 'l',
          licensee: 'Acme',
          plan: 'team',
          expiresAt: '2027-11-01T00:00:00Z',
        },
        unlicensedRepositories: [],
      })
    ).toBe(
      'Team license of Acme, until Nov 1, 2027: 12 editors, no limit of repositories.'
    )
  })

  it('says why the portal runs in the free mode', () => {
    expect(licenseLine(FREE)).toBe(
      'Free mode: 1 editor, 1 repository. The license is not in force: the license of Acme ended on 2026-11-12.'
    )
  })
})

describe('LicenseNote', () => {
  it('names the repositories that wait for a license', async () => {
    render(
      <LicenseNote portal={fakePortal({ license: () => Promise.resolve(FREE) })} />
    )
    expect(
      await screen.findByText(
        'The portal does not serve web: the free mode allows 1 repository.'
      )
    ).toBeTruthy()
  })

  it('shows nothing outside a portal', () => {
    const { container } = render(<LicenseNote portal={fakePortal()} />)
    expect(container.textContent).toBe('')
  })
})
