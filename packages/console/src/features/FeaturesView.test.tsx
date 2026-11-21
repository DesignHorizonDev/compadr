import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ConsolidateSuggestion, Feature } from '@compadr/format'
import { afterEach, describe, expect, it } from 'vitest'
import type { DraftState, ValidateRulesRequest } from '../drafts.ts'
import { DraftContext } from '../drafts/draft-context.tsx'
import type { ReportSource } from '../reports.ts'
import {
  makeDecision,
  makeFeatureReport,
  makeReport,
} from '../testing/report.ts'
import { featureMap, featureReading } from './features.ts'
import { FeaturesView } from './FeaturesView.tsx'

afterEach(cleanup)

describe('featureMap', () => {
  it('counts the details, the states and the replaced rules', () => {
    const map = featureMap(makeFeatureReport())
    expect(map.cards).toHaveLength(1)
    expect(map.cards[0]).toMatchObject({
      main: { number: 3 },
      states: ['in-sync', 'in-sync', 'broken'],
      replaced: 2,
    })
    expect(map.cards[0]!.details.map(d => d.number)).toEqual([7, 9])
    expect(map.unassigned.map(d => d.number)).toEqual([12])
    expect(map.proposed).toBe(false)
  })
})

describe('featureReading', () => {
  it('puts the main decision first and marks the replaced rule', () => {
    const report = makeFeatureReport()
    const reading = featureReading(report, report.features![0]!)
    expect(reading.map(e => [e.decision.number, e.role])).toEqual([
      [3, 'main'],
      [7, 'detail'],
      [9, 'detail'],
    ])
    expect(reading[0]!.sections[0]!.marks).toEqual([
      expect.objectContaining({ note: 'ADR-0007' }),
    ])
    expect(reading[1]!.replaces).toHaveLength(2)
    expect(reading.map(e => e.changedElsewhere)).toEqual([[12], [], []])
  })
})

describe('FeaturesView', () => {
  it('opens a feature and reads its rules in force', async () => {
    const user = userEvent.setup()
    render(<FeaturesView report={makeFeatureReport()} />)
    expect(
      screen.getByText(
        'main at commit 4f1c2a9e · 1 feature · 1 decision in no feature'
      )
    ).toBeTruthy()
    expect(screen.getByText('In no feature: ADR-0012')).toBeTruthy()
    expect(
      screen.getByText('Bad Id: not a feature identifier (lowercase-words)')
    ).toBeTruthy()
    expect(screen.getByText('1 broken · 2 in sync')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Billing' }))
    const rules = within(screen.getByRole('region', { name: 'Rules in force' }))
    const main = within(rules.getByRole('region', { name: 'ADR-0003' }))
    expect(main.getByText('Main decision')).toBeTruthy()
    expect(main.getByText('Sending')).toBeTruthy()
    expect(
      main.getByText('Also changed by decisions of other features: ADR-0012.')
    ).toBeTruthy()
    const struck = main.getAllByTitle('Replaced by ADR-0007')
    expect(struck.length).toBeGreaterThan(0)

    const detail = within(rules.getByRole('region', { name: 'ADR-0007' }))
    expect(
      detail.getByText('Struck through in ADR-0003, section “Sending”.')
    ).toBeTruthy()
    expect(
      detail.getByText('Not found in the decisions it names.')
    ).toBeTruthy()
    const empty = within(rules.getByRole('region', { name: 'ADR-0009' }))
    expect(empty.getByText('This record has no Decision section.')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: '← Feature map' }))
    expect(screen.getByRole('button', { name: 'Billing' })).toBeTruthy()
  })

  it('offers to write a proposed grouping and says when there is none', () => {
    const report = makeFeatureReport()
    render(
      <FeaturesView
        report={{
          ...report,
          features: report.features!.map(f => ({ ...f, source: 'proposed' })),
        }}
      />
    )
    expect(
      screen.getByText(/compadr features <path-to-billing-api> --ref main/)
    ).toBeTruthy()
    cleanup()
    render(
      <FeaturesView report={makeReport({}, { decisions: [makeDecision(1)] })} />
    )
    expect(
      screen.getByText(
        'No feature is declared, and no two decisions are linked by a relation or by the code files they cite.'
      )
    ).toBeTruthy()
  })
})

const consolidation: ConsolidateSuggestion = {
  kind: 'consolidate',
  schemaVersion: 1,
  status: 'suggested',
  provenance: {
    model: 'compadr-assist-1',
    promptVersion: 'consolidate-4',
    inputHash: 'c'.repeat(64),
    createdAt: '2026-11-17T10:00:00Z',
  },
  rules: [
    {
      rule: 'An invoice goes out on the day of the order.',
      sources: [7],
      quote: 'on the day of the order',
    },
  ],
  replaced: [
    { rule: 'An invoice goes out monthly.', record: 3, replacedBy: 7 },
  ],
  conflicts: [{ point: 'Who sends a late invoice.', records: [3, 9] }],
}

const validated = {
  decision: 3,
  validated: '2026-11-16',
  model: 'compadr-assist-1',
  promptVersion: 'consolidate-4',
  chain: [
    { decision: 3, hash: 'sha256:0123456789abcdef' },
    { decision: 7, hash: 'sha256:0123456789abcdef' },
  ],
  rules: [
    {
      rule: 'An invoice goes out monthly.',
      sources: [3],
      quote: 'once a month',
    },
  ],
  replaced: [],
  conflicts: [],
}

function withFeature(change: Partial<Feature>) {
  const report = makeFeatureReport()
  return {
    ...report,
    features: report.features!.map(f => ({ ...f, ...change })),
  }
}

function sourceOf(value: ConsolidateSuggestion | null) {
  const asked: number[] = []
  const source: ReportSource = {
    list: () => Promise.resolve([]),
    get: () => Promise.reject(new Error('not in this test')),
    consolidation: (_id, decision) => {
      asked.push(decision)
      return Promise.resolve(value)
    },
  }
  return { source, asked }
}

const draft: DraftState = {
  name: 'console',
  repository: '/repos/billing-api',
  baseReportId: 'api',
  reportId: null,
  base: null,
  baseBranch: null,
  commits: [],
  drafts: [],
}

describe('the consolidated rules of a feature', () => {
  it('shows the rules that a person validated, without asking for a suggestion', async () => {
    const user = userEvent.setup()
    const { source, asked } = sourceOf(consolidation)
    render(
      <FeaturesView
        report={withFeature({ rules: validated, staleRecords: [] })}
        consolidationOf={{ source, id: 'api' }}
      />
    )
    await user.click(screen.getByRole('button', { name: 'Billing' }))
    const block = within(
      screen.getByRole('region', { name: 'Consolidated rules' })
    )
    expect(
      block.getByText(
        /A person validated these rules on 2026-11-16\. compadr-assist-1 \(consolidate-4\) consolidated them along ADR-0003, ADR-0007/
      )
    ).toBeTruthy()
    expect(block.getByText('An invoice goes out monthly.')).toBeTruthy()
    expect(block.getByText('once a month')).toBeTruthy()
    expect(block.queryByText('Suggested by a model')).toBeNull()
    expect(asked).toEqual([])
  })

  it('says when the validated rules are stale, and offers to validate the new ones', async () => {
    const user = userEvent.setup()
    const { source, asked } = sourceOf(consolidation)
    const sent: ValidateRulesRequest[] = []
    const reject = () => Promise.reject(new Error('not in this test'))
    render(
      <DraftContext.Provider
        value={{
          draft,
          check: reject,
          anchor: reject,
          accept: reject,
          validateRules: request => {
            sent.push(request)
            return Promise.resolve({
              ...draft,
              commits: [
                { commit: 'a'.repeat(40), subject: 'rules', author: 'Ana' },
              ],
            })
          },
          showReport: () => {},
          selectDraft: () => {},
        }}
      >
        <FeaturesView
          report={withFeature({ rules: validated, staleRecords: [7] })}
          consolidationOf={{ source, id: 'api' }}
        />
      </DraftContext.Provider>
    )
    await user.click(screen.getByRole('button', { name: 'Billing' }))
    const block = within(
      screen.getByRole('region', { name: 'Consolidated rules' })
    )
    expect(
      block.getByText(/ADR-0007 changed since the validation/)
    ).toBeTruthy()
    expect(await block.findByText('Suggested by a model')).toBeTruthy()
    expect(asked).toEqual([3])
    expect(
      block.getByText('An invoice goes out on the day of the order.')
    ).toBeTruthy()
    const replaced = within(
      block.getAllByRole('list', { name: 'Replaced along the chain' })[0]!
    )
    expect(replaced.getByText('(ADR-0003, replaced by ADR-0007)')).toBeTruthy()
    expect(block.getByText('Who sends a late invoice.')).toBeTruthy()
    expect(
      block.getByText(/in place of the rules validated before/)
    ).toBeTruthy()
    await user.click(
      block.getByRole('button', { name: 'Validate these rules' })
    )
    expect(sent).toEqual([{ feature: 'billing' }])
  })

  it('reads the consolidation once, whatever the renders of the page', async () => {
    const user = userEvent.setup()
    const { source, asked } = sourceOf(null)
    const page = () => (
      <FeaturesView
        report={makeFeatureReport()}
        // A new object at each render, as App makes it.
        consolidationOf={{ source, id: 'api' }}
      />
    )
    const { rerender } = render(page())
    await user.click(screen.getByRole('button', { name: 'Billing' }))
    await screen.findByText(/No consolidation yet/)
    rerender(page())
    rerender(page())
    expect(asked).toEqual([3])
  })

  it('does not offer again the rules that a person validated', async () => {
    const user = userEvent.setup()
    // The guard kept one rule of two when the rules were validated.
    const same: ConsolidateSuggestion = {
      ...consolidation,
      provenance: {
        ...consolidation.provenance,
        createdAt: '2026-11-16T09:00:00Z',
      },
      rules: [...validated.rules, consolidation.rules[0]!],
      replaced: [],
      conflicts: [],
    }
    render(
      <FeaturesView
        report={withFeature({ rules: validated, staleRecords: [7] })}
        consolidationOf={{ source: sourceOf(same).source, id: 'api' }}
      />
    )
    await user.click(screen.getByRole('button', { name: 'Billing' }))
    expect(
      await screen.findByText(
        /The consolidation of the folder holds the rules validated on 2026-11-16\./
      )
    ).toBeTruthy()
    expect(
      screen.getByText(
        'compadr assist consolidate . --decision 3 --out <findings-dir>/api.consolidate-3.json'
      )
    ).toBeTruthy()
    expect(screen.queryByText('Suggested by a model')).toBeNull()
  })

  it('gives the commands without a consolidation, or without a draft', async () => {
    const user = userEvent.setup()
    render(
      <FeaturesView
        report={makeFeatureReport()}
        consolidationOf={{ source: sourceOf(null).source, id: 'api' }}
      />
    )
    await user.click(screen.getByRole('button', { name: 'Billing' }))
    expect(
      await screen.findByText(
        'compadr assist consolidate . --decision 3 --out <findings-dir>/api.consolidate-3.json'
      )
    ).toBeTruthy()
    cleanup()

    render(
      <FeaturesView
        report={makeFeatureReport()}
        consolidationOf={{ source: sourceOf(consolidation).source, id: 'api' }}
      />
    )
    await user.click(screen.getByRole('button', { name: 'Billing' }))
    expect(
      await screen.findByText(
        'compadr rules . --feature billing --suggestion <findings-dir>/api.consolidate-3.json --open-pr'
      )
    ).toBeTruthy()
    expect(
      screen.queryByRole('button', { name: 'Validate these rules' })
    ).toBeNull()
  })

  it('shows nothing for a proposed feature or without a source', async () => {
    const user = userEvent.setup()
    render(
      <FeaturesView
        report={withFeature({ source: 'proposed' })}
        consolidationOf={{ source: sourceOf(consolidation).source, id: 'api' }}
      />
    )
    await user.click(screen.getByRole('button', { name: 'Billing' }))
    expect(
      screen.queryByRole('region', { name: 'Consolidated rules' })
    ).toBeNull()
    cleanup()
    render(<FeaturesView report={makeFeatureReport()} />)
    await user.click(screen.getByRole('button', { name: 'Billing' }))
    expect(
      screen.queryByRole('region', { name: 'Consolidated rules' })
    ).toBeNull()
  })
})
