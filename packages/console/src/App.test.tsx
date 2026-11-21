import type { DriftReport } from '@compadr/format'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from './App.tsx'
import type { PlainSource } from './assist.ts'
import { NAVIGATION } from './navigation.ts'
import { summarize, type ReportSource } from './reports.ts'
import {
  makeCitedReport,
  makeReport,
  makeFeatureReport,
} from './testing/report.ts'
import type { PortalOverview, PortalSource } from './portal.ts'
import { fakePortal } from './testing/portal.ts'

afterEach(cleanup)

const REPORTS: Record<string, DriftReport> = {
  'api-main': makeReport({ ref: 'main' }),
  'api-develop': makeReport({
    ref: 'develop',
    commit: '9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b',
  }),
  'web-main': makeReport({
    name: 'billing-web',
    commit: 'c0ffee1234567890abcdef1234567890abcdef12',
  }),
}

function memorySource(reports: Record<string, DriftReport>): ReportSource {
  return {
    list: () =>
      Promise.resolve(
        Object.entries(reports).map(([id, report]) => summarize(id, report))
      ),
    get: id =>
      reports[id]
        ? Promise.resolve(reports[id])
        : Promise.reject(new Error(`no report ${id}`)),
  }
}

function renderApp(source: ReportSource = memorySource(REPORTS)) {
  return { user: userEvent.setup(), ...render(<App source={source} />) }
}

const select = (name: string) =>
  screen.getByRole<HTMLSelectElement>('combobox', { name })
const options = (name: string) =>
  within(select(name))
    .getAllByRole('option')
    .map(option => option.textContent)
const note = (container: HTMLElement) =>
  container.querySelector('.content-note')?.textContent

describe('console shell', () => {
  it('shows the logo in the sidebar', () => {
    renderApp()
    const logo = screen.getByRole('img', { name: 'Compadr' })
    expect(logo.getAttribute('src')).toMatch(/logo-light.*\.svg$|^data:/)
  })

  it('lists every view in the main navigation', () => {
    renderApp()
    const nav = screen.getByRole('navigation', { name: 'Main' })
    const labels = within(nav)
      .getAllByRole('button')
      .map(button => button.textContent)
    expect(labels).toEqual(
      NAVIGATION.flatMap(({ views }) => views.map(view => view.label))
    )
  })

  it('opens on the drift view and switches views', async () => {
    const { user, container } = renderApp()
    await screen.findByText(/main at commit 4f1c2a9e/)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Drift')
    await user.click(screen.getByRole('button', { name: 'Reviews' }))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Reviews'
    )
    expect(
      screen
        .getByRole('button', { name: 'Reviews' })
        .getAttribute('aria-current')
    ).toBe('page')
    expect(container.querySelector('.breadcrumb')?.textContent).toBe(
      'billing-api/Reviews'
    )
  })
})

describe('reports', () => {
  it('fills the selectors from the list of reports', async () => {
    const { container } = renderApp()
    await screen.findByText(/main at commit 4f1c2a9e/)
    expect(options('Repository')).toEqual(['billing-api', 'billing-web'])
    expect(options('Git reference')).toEqual([
      'main · 4f1c2a9e',
      'develop · 9a8b7c6d',
    ])
    expect(note(container)).toMatch(/^main at commit 4f1c2a9e · scanned /)
  })

  it('states the report on the views that are not ready yet', async () => {
    const { user, container } = renderApp()
    await screen.findByText(/main at commit 4f1c2a9e/)
    await user.click(screen.getByRole('button', { name: 'Overview' }))
    expect(note(container)).toMatch(
      /^billing-api at main, commit 4f1c2a9e: 0 decisions, 0 signals\./
    )
  })

  it('counts one decision and one signal in the singular', async () => {
    const report = makeReport(
      {},
      {
        decisions: [
          {
            number: 1,
            file: 'docs/adr/0001-base.md',
            title: 'Base',
            status: 'accepted',
            rawStatus: 'Accepted',
            date: null,
            revisedAt: null,
            lineCount: 3,
            feature: null,
            parent: null,
            amends: [],
            amendedBy: [],
            supersededBy: [],
            codeArea: null,
          },
        ],
        signals: [
          {
            type: 'decision-without-code',
            level: 'info',
            id: 'decision-without-code:0001',
            decision: 1,
          },
        ],
      }
    )
    const { user, container } = renderApp(memorySource({ one: report }))
    await screen.findByText(/main at commit 4f1c2a9e/)
    await user.click(screen.getByRole('button', { name: 'Overview' }))
    expect(note(container)).toMatch(/: 1 decision, 1 signal\./)
  })

  it('loads the report of the selected reference', async () => {
    const { user } = renderApp()
    await screen.findByText(/main at commit 4f1c2a9e/)
    await user.selectOptions(select('Git reference'), 'api-develop')
    expect(await screen.findByText(/develop at commit 9a8b7c6d/)).toBeTruthy()
  })

  it('resets the reference when the repository changes', async () => {
    const { user } = renderApp()
    await screen.findByText(/main at commit 4f1c2a9e/)
    await user.selectOptions(select('Git reference'), 'api-develop')
    await user.selectOptions(select('Repository'), 'billing-web')
    expect(select('Git reference').value).toBe('web-main')
    expect(await screen.findByText(/main at commit c0ffee12/)).toBeTruthy()
  })

  it('falls back to the first repository when the list changes', async () => {
    const { user, rerender } = renderApp()
    await screen.findByText(/main at commit 4f1c2a9e/)
    await user.selectOptions(select('Repository'), 'billing-web')
    await screen.findByText(/main at commit c0ffee12/)
    const apiOnly = Object.fromEntries(
      Object.entries(REPORTS).filter(([id]) => id !== 'web-main')
    )
    rerender(<App source={memorySource(apiOnly)} />)
    expect(await screen.findByText(/main at commit 4f1c2a9e/)).toBeTruthy()
    expect(select('Repository').value).toBe('billing-api')
  })

  it('explains how to write a report when there is none', async () => {
    const { container } = renderApp(memorySource({}))
    expect(await screen.findByText(/No drift report yet/)).toBeTruthy()
    expect(container.querySelector('.code-block')?.textContent).toBe(
      'compadr drift <repository> --out <folder>/<name>.json'
    )
    expect(select('Repository').disabled).toBe(true)
    expect(container.querySelector('.breadcrumb')?.textContent).toBe('Drift')
  })

  it('reports a list that cannot be loaded', async () => {
    renderApp({
      list: () => Promise.reject(new Error('/api/reports answered 500')),
      get: () => Promise.reject(new Error('unused')),
    })
    expect((await screen.findByRole('alert')).textContent).toBe(
      'The list of reports cannot be loaded: /api/reports answered 500'
    )
  })

  it('reports a report that cannot be loaded', async () => {
    const source = memorySource(REPORTS)
    renderApp({ ...source, get: () => Promise.reject(new Error('bad schema')) })
    expect((await screen.findByRole('alert')).textContent).toBe(
      'The report cannot be loaded: bad schema'
    )
  })
})

describe('decisions of a file', () => {
  it('opens the page of a decision from the Files view', async () => {
    const { user } = renderApp(memorySource({ cited: makeCitedReport() }))
    await screen.findByText(/main at commit 4f1c2a9e/)
    await user.click(screen.getByRole('button', { name: 'Files' }))
    await user.click(screen.getByRole('button', { name: 'src/a.ts' }))
    await user.click(screen.getByRole('button', { name: /ADR-0027 Storage/ }))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Decisions'
    )
    expect(screen.getByRole('article', { name: 'ADR-0027' })).toBeTruthy()
    // Another view closes the decision: Decisions opens on its list.
    await user.click(screen.getByRole('button', { name: 'Drift' }))
    await user.click(screen.getByRole('button', { name: 'Decisions' }))
    expect(screen.queryByRole('article')).toBeNull()
  })
  it('asks the source for the recommendation on a proposed decision', async () => {
    const cited = makeCitedReport()
    const report: DriftReport = {
      ...cited,
      decisions: cited.decisions.map(d =>
        d.number === 27 ? { ...d, status: 'proposed' } : d
      ),
    }
    const asked: [string, number][] = []
    const source: ReportSource = {
      ...memorySource({ cited: report }),
      recommendation: (id, decision) => {
        asked.push([id, decision])
        return Promise.resolve(null)
      },
    }
    const { user } = renderApp(source)
    await screen.findByText(/main at commit 4f1c2a9e/)
    await user.click(screen.getByRole('button', { name: 'Files' }))
    await user.click(screen.getByRole('button', { name: 'src/a.ts' }))
    await user.click(screen.getByRole('button', { name: /ADR-0027 Storage/ }))
    expect(
      await screen.findByRole('region', { name: 'Recommended by a model' })
    ).toBeTruthy()
    expect(asked).toEqual([['cited', 27]])
  })
  it('shows the plain language on a decision once the server can ask for it', async () => {
    const plain: PlainSource = {
      available: () => Promise.resolve(true),
      cached: () => Promise.resolve(null),
      read: () => Promise.reject(new Error('not in this test')),
    }
    const user = userEvent.setup()
    render(
      <App source={memorySource({ cited: makeCitedReport() })} plain={plain} />
    )
    await screen.findByText(/main at commit 4f1c2a9e/)
    await user.click(screen.getByRole('button', { name: 'Files' }))
    await user.click(screen.getByRole('button', { name: 'src/a.ts' }))
    await user.click(screen.getByRole('button', { name: /ADR-0027 Storage/ }))
    expect(
      await screen.findByRole('button', { name: 'Read in plain language' })
    ).toBeTruthy()
    cleanup()
    render(
      <App
        source={memorySource({ cited: makeCitedReport() })}
        plain={{ ...plain, available: () => Promise.resolve(false) }}
      />
    )
    await screen.findByText(/main at commit 4f1c2a9e/)
    await user.click(screen.getByRole('button', { name: 'Files' }))
    await user.click(screen.getByRole('button', { name: 'src/a.ts' }))
    await user.click(screen.getByRole('button', { name: /ADR-0027 Storage/ }))
    await screen.findByRole('article', { name: 'ADR-0027' })
    expect(
      screen.queryByRole('region', { name: 'In plain language' })
    ).toBeNull()
  })

  it('asks the source for the consolidation of a declared feature', async () => {
    const asked: [string, number][] = []
    const source: ReportSource = {
      ...memorySource({ billing: makeFeatureReport() }),
      consolidation: (id, decision) => {
        asked.push([id, decision])
        return Promise.resolve(null)
      },
    }
    const { user } = renderApp(source)
    await screen.findByText(/main at commit 4f1c2a9e/)
    await user.click(screen.getByRole('button', { name: 'Feature map' }))
    await user.click(screen.getByRole('button', { name: 'Billing' }))
    expect(await screen.findByText(/No consolidation yet/)).toBeTruthy()
    expect(asked).toEqual([['billing', 3]])
  })
})

describe('console of a portal', () => {
  const overview: PortalOverview = {
    repositories: [
      {
        reportId: 'web-main',
        name: 'billing-web',
        ref: 'main',
        commit: 'c0ffee1234567890abcdef1234567890abcdef12',
        generatedAt: '2026-11-02T10:00:00Z',
        decisions: { total: 1, inForce: 1, proposed: 0 },
        signals: { broken: 0, review: 0, order: 0 },
        zones: null,
        refreshedAt: null,
        refreshError: null,
      },
    ],
    problems: [],
    refreshIntervalSeconds: 0,
  }

  it('opens on the overview, and a repository opens its Drift view', async () => {
    const user = userEvent.setup()
    const portal: PortalSource = fakePortal({
      overview: () => Promise.resolve(overview),
      queue: () => Promise.resolve({ rows: [] }),
    })
    render(<App source={memorySource(REPORTS)} portal={portal} />)
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Overview' })
    ).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'billing-web' }))
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Drift' })
    ).toBeTruthy()
    expect(select('Repository').value).toBe('billing-web')
  })

  it('stays on the Drift view when the server is not a portal', async () => {
    const portal: PortalSource = fakePortal({
      overview: () => Promise.resolve(null),
      queue: () => Promise.resolve({ rows: [] }),
    })
    render(<App source={memorySource(REPORTS)} portal={portal} />)
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Drift' })
    ).toBeTruthy()
  })
})

describe('person signed in to a portal', () => {
  it('names the person and signs out', async () => {
    const user = userEvent.setup()
    const signOut = vi.fn(() => Promise.reject(new Error('down')))
    render(
      <App
        source={memorySource(REPORTS)}
        portal={fakePortal({
          me: () =>
            Promise.resolve({
              login: 'ann',
              name: 'Ann',
              role: 'editor',
              signsIn: true,
            }),
          signOut,
        })}
      />
    )
    expect(await screen.findByText('Ann')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(signOut).toHaveBeenCalled()
    expect(await screen.findByText('down')).toBeTruthy()
  })

  it('shows nothing for the operator', async () => {
    render(
      <App
        source={memorySource(REPORTS)}
        portal={fakePortal({
          me: () =>
            Promise.resolve({
              login: 'operator',
              name: 'Operator',
              role: 'admin',
              signsIn: false,
            }),
        })}
      />
    )
    await screen.findByRole('heading', { level: 1, name: 'Drift' })
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()
  })
})

describe('a link to a view', () => {
  it('opens the view that ?view= names', async () => {
    window.history.pushState({}, '', '/?view=integrations')
    try {
      render(<App source={memorySource(REPORTS)} />)
      expect(
        await screen.findByRole('heading', { level: 1, name: 'Integrations' })
      ).toBeTruthy()
    } finally {
      window.history.pushState({}, '', '/')
    }
  })
})
