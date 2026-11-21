import { useId, useMemo, useState } from 'react'
import type { DriftReport, Zone, ZoneCoverage } from '@compadr/format'
import { decisionLabel } from '../drift/signals.ts'
import { count, shortCommit } from '../format.ts'
import {
  COVERAGE_HINTS,
  COVERAGE_LABELS,
  zoneFiles,
  zoneKey,
  zoneName,
  zonesOf,
  type CoverageTab,
} from './zones.ts'

const TABS: { tab: CoverageTab; label: string }[] = [
  { tab: 'covered', label: 'Under decisions' },
  { tab: 'uncovered', label: 'Without decision' },
  { tab: 'all', label: 'All zones' },
]

/** Decisions named on the row of a zone; the others are counted. */
const SHOWN_DECISIONS = 4

export function CoverageBadge({ coverage }: { coverage: ZoneCoverage }) {
  return (
    <span className={`badge badge-coverage-${coverage}`}>
      {COVERAGE_LABELS[coverage]}
    </span>
  )
}

/** The zones of the code, and how much the decisions in force reach them. */
export function CoverageView({
  report,
  onOpenDecision,
  onOpenFile,
}: {
  report: DriftReport
  onOpenDecision: (number: number) => void
  onOpenFile: (path: string) => void
}) {
  const [tab, setTab] = useState<CoverageTab>('covered')
  const [selectedKey, setSelectedKey] = useState<string>()
  const panelId = useId()
  const zones = report.zones
  const visible = useMemo(() => zonesOf(report, tab), [report, tab])
  const selected = zones?.find(zone => zoneKey(zone) === selectedKey)

  if (zones === undefined) {
    return (
      <p className="notice">
        This report has no zones: it comes from an earlier version of Compadr.
        Compute it again to see the coverage of the code.
      </p>
    )
  }
  const tally = (tab: CoverageTab) => zonesOf(report, tab).length
  const linked = zones.reduce((sum, zone) => sum + zone.linkedFiles, 0)
  const files = zones.reduce((sum, zone) => sum + zone.files, 0)

  return (
    <div className="drift">
      <div className="drift-main">
        <p className="content-note">
          {report.repository.ref} at commit{' '}
          {shortCommit(report.repository.commit)} ·{' '}
          {count(zones.length, 'zone')} · {linked} of{' '}
          {count(files, 'code file')} linked to a decision in force
        </p>
        <p className="hint">
          A zone without decision is not a problem: it shows where the decisions
          say nothing yet.
        </p>
        <div className="tabs" role="tablist" aria-label="Zones">
          {TABS.map(({ tab: candidate, label }) => (
            <button
              key={candidate}
              type="button"
              role="tab"
              className="tab"
              aria-selected={candidate === tab}
              aria-controls={panelId}
              onClick={() => setTab(candidate)}
            >
              {label} <span className="tab-count">{tally(candidate)}</span>
            </button>
          ))}
        </div>
        <div id={panelId} role="tabpanel" className="table-wrap">
          {visible.length === 0 ? (
            <p className="empty">No zone in this list.</p>
          ) : (
            <table className="signals">
              <thead>
                <tr>
                  <th scope="col">Coverage</th>
                  <th scope="col">Zone</th>
                  <th scope="col">Linked files</th>
                  <th scope="col">Both ways</th>
                  <th scope="col">Decisions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(zone => (
                  <ZoneLine
                    key={zoneKey(zone)}
                    zone={zone}
                    selected={zoneKey(zone) === selectedKey}
                    onSelect={() => setSelectedKey(zoneKey(zone))}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {selected && (
        <ZoneDetail
          report={report}
          zone={selected}
          onClose={() => setSelectedKey(undefined)}
          onOpenDecision={onOpenDecision}
          onOpenFile={onOpenFile}
        />
      )}
    </div>
  )
}

function ZoneLine({
  zone,
  selected,
  onSelect,
}: {
  zone: Zone
  selected: boolean
  onSelect: () => void
}) {
  const shown = zone.decisions.slice(0, SHOWN_DECISIONS)
  const more = zone.decisions.length - shown.length
  return (
    <tr className={selected ? 'selected' : undefined}>
      <td>
        <CoverageBadge coverage={zone.coverage} />
      </td>
      <td>
        <button type="button" className="signal-title" onClick={onSelect}>
          <code>{zoneName(zone)}</code>
        </button>
      </td>
      <td className="numeric">
        {zone.linkedFiles} of {zone.files}
      </td>
      <td className="numeric">{zone.crossChecked}</td>
      <td>
        {shown.map(d => decisionLabel(d.number)).join(' ')}
        {more > 0 ? ` +${more}` : ''}
        {zone.decisions.length === 0 && zone.folderCited.length > 0
          ? `Folder cited by ${zone.folderCited.map(decisionLabel).join(' ')}`
          : ''}
      </td>
    </tr>
  )
}

function ZoneDetail({
  report,
  zone,
  onClose,
  onOpenDecision,
  onOpenFile,
}: {
  report: DriftReport
  zone: Zone
  onClose: () => void
  onOpenDecision: (number: number) => void
  onOpenFile: (path: string) => void
}) {
  const titles = new Map(report.decisions.map(d => [d.number, d.title]))
  const files = useMemo(() => zoneFiles(report, zone), [report, zone])
  return (
    <aside className="detail" aria-label="Zone">
      <div className="detail-head">
        <p className="detail-kicker">Zone</p>
        <button type="button" className="close" onClick={onClose}>
          Close
        </button>
      </div>
      <h2 className="detail-title">
        <code>{zoneName(zone)}</code>
      </h2>
      <p>
        <CoverageBadge coverage={zone.coverage} />
      </p>
      <p className="hint">{COVERAGE_HINTS[zone.coverage]}</p>
      <p>
        {zone.linkedFiles} of {count(zone.files, 'code file')} linked,{' '}
        {zone.crossChecked} both ways. Weight of the links: {zone.weight}.
      </p>
      {zone.decisions.length > 0 && (
        <section aria-label="Decisions of the zone">
          <h3>Decisions in force</h3>
          <ul className="file-decisions">
            {zone.decisions.map(d => (
              <li key={d.number}>
                <button
                  type="button"
                  className="signal-title"
                  onClick={() => onOpenDecision(d.number)}
                >
                  <code>{decisionLabel(d.number)}</code> {titles.get(d.number)}
                </button>
                <p className="hint">Weight {d.weight}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
      {zone.folderCited.length > 0 && (
        <p className="hint">
          The folder is cited by{' '}
          {zone.folderCited.map(decisionLabel).join(', ')}, which says little
          about each file.
        </p>
      )}
      {files.length > 0 && (
        <section aria-label="Linked files">
          <h3>Linked files</h3>
          <ul className="path-list">
            {files.map(file => (
              <li key={file.path}>
                <button
                  type="button"
                  className="signal-title"
                  onClick={() => onOpenFile(file.path)}
                >
                  <code>{file.path}</code>
                </button>{' '}
                <span className="muted">
                  {count(file.decisions, 'decision')}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  )
}
