import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PortalOverview, PortalSource, QueueRow } from '../portal.ts'
import { OverviewView } from './OverviewView.tsx'
import { fakePortal } from '../testing/portal.ts'

afterEach(cleanup)

const OVERVIEW: PortalOverview = {
  repositories: [
    {
      reportId: 'api',
      name: 'billing-api',
      ref: 'main',
      commit: '4f1c2a9e0000000000000000000000000000000',
      generatedAt: '2026-11-02T10:00:00Z',
      decisions: { total: 12, inForce: 10, proposed: 2 },
      signals: { broken: 3, review: 1, order: 5 },
      zones: { total: 8, covered: 5 },
      refreshedAt: '2026-11-02T10:05:00Z',
      refreshError: null,
    },
    {
      reportId: 'web',
      name: 'billing-web',
      ref: 'develop',
      commit: 'c0ffee1200000000000000000000000000000000',
      generatedAt: '2026-11-01T09:00:00Z',
      decisions: { total: 4, inForce: 4, proposed: 0 },
      signals: { broken: 0, review: 0, order: 1 },
      zones: null,
      refreshedAt: null,
      refreshError: 'git failed',
    },
  ],
  problems: [{ reportId: 'docs', message: 'no report' }],
  refreshIntervalSeconds: 300,
}

const row = (over: Partial<QueueRow>): QueueRow => ({
  reportId: 'api',
  repository: 'billing-api',
  signalId: 's',
  level: 'broken',
  title: 'Cited path no longer exists',
  target: 'src/gone.ts',
  note: null,
  decision: 7,
  decisionTitle: 'Pool',
  area: null,
  citedAt: null,
  ...over,
})

const QUEUE: QueueRow[] = [
  row({ signalId: 'a' }),
  row({
    signalId: 'b',
    reportId: 'web',
    repository: 'billing-web',
    level: 'order',
    title: 'Linked files changed since their citation',
    target: 'app/page.tsx',
    decision: 2,
    citedAt: '2026-01-05T00:00:00Z',
  }),
]

function renderView(
  portal: PortalSource = fakePortal({
    overview: () => Promise.resolve(OVERVIEW),
    queue: () => Promise.resolve({ rows: QUEUE }),
  }),
  overview: PortalOverview = OVERVIEW
) {
  const onOpenRepository = vi.fn()
  const onOpenDecision = vi.fn()
  render(
    <OverviewView
      overview={overview}
      portal={portal}
      onOpenRepository={onOpenRepository}
      onOpenDecision={onOpenDecision}
    />
  )
  return { user: userEvent.setup(), onOpenRepository, onOpenDecision }
}

describe('OverviewView', () => {
  it('lists each repository with its counts', () => {
    renderView()
    expect(
      screen.getByText('The portal computes the reports every 5 minutes.')
    ).toBeTruthy()
    const line = screen
      .getByRole('button', { name: 'billing-api' })
      .closest('tr')!
    expect(within(line).getByText('main · 4f1c2a9e')).toBeTruthy()
    expect(within(line).getByText('5 of 8')).toBeTruthy()
    expect(line.textContent).toContain('10 in force · 2 proposed')
    expect(screen.getByText('Last computation failed: git failed')).toBeTruthy()
    expect(
      screen.getByText('The report cannot be read: no report')
    ).toBeTruthy()
  })

  it('names no repository left aside when the portal sends none', () => {
    renderView()
    expect(screen.queryByText(/The service does not serve/)).toBeNull()
  })

  it('lists the repositories that a quota leaves aside, with their reasons', () => {
    renderView(undefined, {
      ...OVERVIEW,
      unserved: [
        { github: 'acme/eleventh', reason: 'repositories', quota: 10 },
        {
          github: 'acme/huge',
          reason: 'size',
          quota: 1_000_000,
          kilobytes: 2_345_678,
        },
        { github: 'acme/hidden', reason: 'unknown-size', quota: 1_000_000 },
      ],
    })
    const note = screen.getByRole('status')
    expect(note.textContent).toContain(
      'The service does not serve 3 repositories of the installation:'
    )
    const items = within(note).getAllByRole('listitem')
    expect(items.map(item => item.textContent)).toEqual([
      'acme/eleventh: The service serves at most 10 repositories per portal, and this portal has reached that number. Remove another repository from the installation of the GitHub App. The service then serves the waiting repositories in alphabetical order.',
      'acme/huge: The repository holds 2,345,678 kB, above the limit of 1,000,000 kB per repository. Remove the repository from the installation of the GitHub App, or ask the Compadr team to raise the limit.',
      'acme/hidden: GitHub did not give the size of the repository, which the service checks against the limit of 1,000,000 kB per repository. The service asks GitHub again at the next change of the installation, for example when you add or remove a repository.',
    ])
  })

  it('opens the Drift view of a repository', async () => {
    const { user, onOpenRepository } = renderView()
    await user.click(screen.getByRole('button', { name: 'billing-web' }))
    expect(onOpenRepository).toHaveBeenCalledWith('web')
  })

  it('filters the queue by level and by repository', async () => {
    const { user } = renderView()
    expect(await screen.findByText('src/gone.ts')).toBeTruthy()
    expect(screen.queryByText('app/page.tsx')).toBeNull()
    await user.click(screen.getByRole('tab', { name: /All/ }))
    expect(screen.getByText('app/page.tsx')).toBeTruthy()
    expect(screen.getByText('Jan 5, 2026')).toBeTruthy()
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Repository' }),
      'web'
    )
    expect(screen.queryByText('src/gone.ts')).toBeNull()
    expect(screen.getByRole('tab', { name: /Broken/ }).textContent).toContain(
      '0'
    )
  })

  it('opens the decision of a signal', async () => {
    const { user, onOpenDecision } = renderView()
    await user.click(await screen.findByRole('button', { name: 'ADR-0007' }))
    expect(onOpenDecision).toHaveBeenCalledWith('api', 7)
  })

  it('says when the queue cannot be loaded', async () => {
    renderView(
      fakePortal({
        overview: () => Promise.resolve(OVERVIEW),
        queue: () => Promise.reject(new Error('down')),
      })
    )
    expect(
      await screen.findByText('The queue cannot be loaded: down')
    ).toBeTruthy()
  })
})

describe('OverviewView reload', () => {
  it('loads the queue again with a new overview', async () => {
    const queue = vi.fn(() => Promise.resolve({ rows: QUEUE }))
    const portal: PortalSource = fakePortal({
      overview: () => Promise.resolve(OVERVIEW),
      queue,
    })
    const props = {
      portal,
      onOpenRepository: () => {},
      onOpenDecision: () => {},
    }
    const { rerender } = render(<OverviewView overview={OVERVIEW} {...props} />)
    await screen.findByText('src/gone.ts')
    rerender(<OverviewView overview={{ ...OVERVIEW }} {...props} />)
    await vi.waitFor(() => expect(queue).toHaveBeenCalledTimes(2))
  })
})
