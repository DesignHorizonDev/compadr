import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeCitedReport } from '../testing/report.ts'
import { FilesView } from './FilesView.tsx'

afterEach(cleanup)

describe('FilesView', () => {
  it('lists the linked paths and the decisions of the one selected', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    render(<FilesView report={makeCitedReport()} onOpenDecision={onOpen} />)
    expect(
      screen.getByText('main at commit 4f1c2a9e · 6 paths linked to a decision')
    ).toBeTruthy()
    await user.type(
      screen.getByRole('searchbox', { name: 'Search the files' }),
      'billing'
    )
    await user.click(
      screen.getByRole('button', { name: 'src/services/billing.ts' })
    )
    const panel = within(
      screen.getByRole('complementary', { name: 'Decisions of the file' })
    )
    const inForce = within(panel.getByRole('region', { name: 'In force' }))
    expect(
      inForce.getByText(
        'The record cites this file (line 116), cited Oct 4, 2026.'
      )
    ).toBeTruthy()
    expect(inForce.getByText('The file cites it on lines 10, 44.')).toBeTruthy()
    await user.click(inForce.getByRole('button', { name: /ADR-0037/ }))
    expect(onOpen).toHaveBeenCalledWith(37)
  })

  it('names the replaced decision that the file cites', async () => {
    const user = userEvent.setup()
    render(<FilesView report={makeCitedReport()} onOpenDecision={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'src/a.ts' }))
    const panel = within(
      screen.getByRole('complementary', { name: 'Decisions of the file' })
    )
    expect(panel.getByText('The file cites ADR-0003 on line 50.')).toBeTruthy()
    expect(panel.getByText('Replaces ADR-0003.')).toBeTruthy()
  })
})
