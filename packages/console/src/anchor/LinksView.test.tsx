import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DriftView } from '../drift/DriftView.tsx'
import { makeProposalReport, makeReport } from '../testing/report.ts'
import { LinksView } from './LinksView.tsx'

afterEach(cleanup)

function renderLinks(report = makeProposalReport()) {
  return { user: userEvent.setup(), ...render(<LinksView report={report} />) }
}

const panel = () =>
  within(screen.getByRole('region', { name: 'Anchor proposal' }))

describe('LinksView', () => {
  it('counts the links that cite a line and those with a proposal', () => {
    renderLinks()
    expect(
      screen.getByText(
        'main at commit 4f1c2a9e · 3 links cite a line number · 2 can be anchored on a symbol'
      )
    ).toBeTruthy()
    expect(screen.getAllByRole('row')).toHaveLength(1 + 3)
    expect(screen.getByText('No proposal')).toBeTruthy()
  })

  it('says when no link relies on a line number', () => {
    renderLinks(makeReport())
    expect(screen.getByText('No link relies on a line number.')).toBeTruthy()
  })

  it('shows the proposal and offers the cited lines of a large symbol', async () => {
    const { user } = renderLinks()
    await user.click(
      screen.getByRole('button', { name: 'services/billing.ts:116' })
    )
    expect(
      panel().getByText('services/billing.ts#BillingService.charge')
    ).toBeTruthy()
    const command = () =>
      panel().getAllByText(/^compadr anchor/)[0]!.textContent
    expect(command()).not.toContain('--with-lines')
    await user.click(
      panel().getByRole('checkbox', {
        name: 'Also track the cited lines (1 line, now at line 130)',
      })
    )
    expect(command()).toContain('--with-lines')
    expect(panel().getByText(/lines: \{ count: 1/)).toBeTruthy()
  })

  it('copies the command', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    const { user } = renderLinks()
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    await user.click(
      screen.getByRole('button', { name: 'services/search.ts:20' })
    )
    expect(panel().queryByRole('checkbox')).toBeNull()
    await user.click(panel().getByRole('button', { name: 'Copy the command' }))
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining(
        '--reference 0037:services/search.ts:20:1 --open-pr'
      )
    )
    expect(panel().getByRole('button', { name: 'Copied' })).toBeTruthy()
  })

  it('counts one link in the singular', () => {
    const report = makeProposalReport()
    report.references = report.references.filter(
      r =>
        r.kind !== 'path' ||
        r.lines === null ||
        r.id === '0037:services/billing.ts:116:1'
    )
    renderLinks(report)
    expect(
      screen.getByText(
        'main at commit 4f1c2a9e · 1 link cites a line number · 1 can be anchored on a symbol'
      )
    ).toBeTruthy()
  })

  it('copies again after the option changes, and reports a refused copy', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    const { user } = renderLinks()
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    await user.click(
      screen.getByRole('button', { name: 'services/billing.ts:116' })
    )
    await user.click(panel().getByRole('button', { name: 'Copy the command' }))
    expect(panel().getByRole('button', { name: 'Copied' })).toBeTruthy()
    await user.click(panel().getByRole('checkbox'))
    expect(
      panel().getByRole('button', { name: 'Copy the command' })
    ).toBeTruthy()

    writeText.mockImplementation(() => Promise.reject(new Error('denied')))
    await user.click(panel().getByRole('button', { name: 'Copy the command' }))
    expect(panel().getByRole('alert').textContent).toMatch(
      /^The browser refused the copy/
    )
  })

  it('explains a large symbol whose cited lines were not proposed', async () => {
    const report = makeProposalReport()
    const reference = report.references.find(
      r => r.id === '0037:services/billing.ts:116:1'
    )!
    if (reference.kind === 'path' && reference.proposal) {
      reference.proposal.lines = null
    }
    const { user } = renderLinks(report)
    await user.click(
      screen.getByRole('button', { name: 'services/billing.ts:116' })
    )
    expect(panel().queryByRole('checkbox')).toBeNull()
    expect(
      panel().getByText(/The cited lines were not found once in the symbol/)
    ).toBeTruthy()
  })

  it('explains a link without proposal', async () => {
    const { user } = renderLinks()
    await user.click(
      screen.getByRole('button', { name: 'services/short.ts:400' })
    )
    expect(panel().getByText(/No anchor can be proposed/)).toBeTruthy()
  })
})

describe('signal detail', () => {
  it('shows the anchor proposal of a reference signal', async () => {
    const user = userEvent.setup()
    render(<DriftView report={makeProposalReport()} />)
    await user.click(screen.getByRole('tab', { name: /^Review order/ }))
    await user.click(
      screen.getByRole('button', {
        name: 'Cited file changed since the citation',
      })
    )
    expect(
      panel().getByText('services/billing.ts#BillingService.charge')
    ).toBeTruthy()
  })
})
