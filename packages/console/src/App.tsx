import { useEffect, useId, useState } from 'react'
import logoUrl from '@compadr/tokens/logo-light.svg'
import type { DriftReport } from '@compadr/format'
import {
  DEFAULT_VIEW,
  NAVIGATION,
  viewLabel,
  type ViewId,
} from './navigation.ts'
import { LinksView } from './anchor/LinksView.tsx'
import { DriftView } from './drift/DriftView.tsx'
import { DecisionsView } from './decisions/DecisionsView.tsx'
import type { DraftDecisionSource, PlainSource } from './assist.ts'
import { FeaturesView } from './features/FeaturesView.tsx'
import { CoverageView } from './zones/CoverageView.tsx'
import { FilesView } from './files/FilesView.tsx'
import { ReviewsView } from './review/ReviewsView.tsx'
import { count, shortCommit } from './format.ts'
import type { ReportSource, ReportSummary } from './reports.ts'
import type { ReviewSource } from './reviews.ts'
import type { DraftSource, DraftState } from './drafts.ts'
import {
  DraftContext,
  type DraftContextValue,
} from './drafts/draft-context.tsx'
import { DraftView } from './drafts/DraftView.tsx'
import { OverviewView } from './overview/OverviewView.tsx'
import { PeopleView } from './people/PeopleView.tsx'
import { UsageView } from './usage/UsageView.tsx'
import { GitHubAppPanel } from './integrations/GitHubAppPanel.tsx'
import {
  SIGNED_OUT_PATH,
  type Me,
  type PortalOverview,
  type PortalSource,
} from './portal.ts'

export interface AppProps {
  source: ReportSource
  /** Where the Reviews view finds the branches that propose decisions. */
  reviews?: ReviewSource
  /** Where the actions of correction add their commit. */
  drafts?: DraftSource
  /** The overview of a portal, when the server is one. */
  portal?: PortalSource
  /** The versions in plain language, when the server asks the assist service. */
  plain?: PlainSource
  /** The drafting of records from the change of a branch. */
  drafting?: DraftDecisionSource
}

const ROLE_LABELS = {
  admin: 'administrator',
  editor: 'editor',
  reader: 'reader',
} as const

// Without a review source, the Reviews view explains where to find them.
const NO_REVIEWS: ReviewSource = { list: () => Promise.resolve(null) }

type Loadable<T> =
  | { state: 'loading' }
  | { state: 'ready'; value: T }
  | { state: 'error'; message: string }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Repository names, in the order of their first report. */
function repositoryNames(reports: ReportSummary[]): string[] {
  return [...new Set(reports.map(report => report.repository.name))]
}

/** The view that the address names in `?view=`, if it is one. */
function linkedView(): ViewId | undefined {
  if (typeof window === 'undefined') return undefined
  const name = new URLSearchParams(window.location.search).get('view')
  for (const { views } of NAVIGATION) {
    for (const view of views) if (view.id === name) return view.id
  }
  return undefined
}

export function App({
  source,
  reviews = NO_REVIEWS,
  drafts,
  portal,
  plain,
  drafting,
}: AppProps) {
  // The button "Read in plain language" shows once the server says it can
  // ask the assist service.
  const [plainReady, setPlainReady] = useState(false)
  useEffect(() => {
    let active = true
    plain?.available().then(
      ready => active && setPlainReady(ready),
      () => {}
    )
    return () => {
      active = false
    }
  }, [plain])
  // The branches without a record show their button once the server says it
  // drafts records.
  const [draftingReady, setDraftingReady] = useState(false)
  useEffect(() => {
    let active = true
    drafting?.available().then(
      ready => active && setDraftingReady(ready),
      () => {}
    )
    return () => {
      active = false
    }
  }, [drafting])
  const [list, setList] = useState<Loadable<ReportSummary[]>>({
    state: 'loading',
  })
  // The selection holds names only. A name missing from the list falls back
  // to the first repository and to its first report.
  const [repositoryName, setRepositoryName] = useState<string>()
  const [reportId, setReportId] = useState<string>()
  const [loaded, setLoaded] = useState<{
    id: string
    report: Loadable<DriftReport>
  }>()
  // Until a view is chosen, a portal opens on its overview.
  // A link may name the view to open, such as /?view=integrations.
  const [chosenView, setView] = useState<ViewId | undefined>(linkedView)
  const [overview, setOverview] = useState<PortalOverview | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [signOutFailure, setSignOutFailure] = useState<string>()
  const view: ViewId = chosenView ?? (overview ? 'overview' : DEFAULT_VIEW)
  // The decision open in the Decisions view, which the Files view can set.
  const [openDecision, setOpenDecision] = useState<number>()
  const [openFile, setOpenFile] = useState<string>()
  const repositoryLabel = useId()
  const refLabel = useId()
  // A change of the draft adds its report to the list, and changes that
  // report when it is on screen.
  const [listVersion, setListVersion] = useState(0)
  const [reportVersion, setReportVersion] = useState(0)
  // The draft that the actions fill, by name: the default of the server
  // until the person picks another one.
  const [draftName, setDraftName] = useState<string>()
  const [draftState, setDraftState] = useState<{
    id: string
    name: string | undefined
    value: DraftState | null
  }>()

  useEffect(() => {
    let active = true
    source.list().then(
      reports => active && setList({ state: 'ready', value: reports }),
      (error: unknown) =>
        active && setList({ state: 'error', message: errorMessage(error) })
    )
    return () => {
      active = false
    }
  }, [source, listVersion])

  useEffect(() => {
    if (portal === undefined) return
    let active = true
    // A server that is not a portal answers null, and a failure leaves the
    // console as it is.
    portal.overview().then(
      value => active && setOverview(value),
      () => {}
    )
    return () => {
      active = false
    }
  }, [portal, listVersion])

  useEffect(() => {
    if (portal === undefined) return
    let active = true
    portal.me().then(
      value => active && setMe(value),
      () => {}
    )
    return () => {
      active = false
    }
  }, [portal])

  function signOut() {
    if (portal === undefined) return
    setSignOutFailure(undefined)
    portal.signOut().then(
      () => window.location.assign(SIGNED_OUT_PATH),
      (error: unknown) => setSignOutFailure(errorMessage(error))
    )
  }

  const reports = list.state === 'ready' ? list.value : []
  const repositories = repositoryNames(reports)
  const repository = repositories.includes(repositoryName ?? '')
    ? repositoryName
    : repositories[0]
  const refs = reports.filter(report => report.repository.name === repository)
  const selectedId = (refs.find(report => report.id === reportId) ?? refs[0])
    ?.id

  useEffect(() => {
    if (selectedId === undefined) return
    const id = selectedId
    let active = true
    source.get(id).then(
      report =>
        active && setLoaded({ id, report: { state: 'ready', value: report } }),
      (error: unknown) =>
        active &&
        setLoaded({
          id,
          report: { state: 'error', message: errorMessage(error) },
        })
    )
    return () => {
      active = false
    }
  }, [source, selectedId, reportVersion])

  useEffect(() => {
    if (selectedId === undefined || drafts === undefined) return
    const id = selectedId
    let active = true
    const name = draftName
    // A server without drafts, or a failed read, shows the commands instead.
    drafts.get(id, name).then(
      value => active && setDraftState({ id, name, value }),
      () => active && setDraftState({ id, name, value: null })
    )
    return () => {
      active = false
    }
  }, [drafts, selectedId, draftName])

  // The React compiler memoizes the value.
  const changed = (id: string) => (state: DraftState) => {
    setDraftState({ id, name: draftName, value: state })
    setListVersion(version => version + 1)
    if (id === state.reportId) setReportVersion(version => version + 1)
    return state
  }
  const unavailable = () =>
    Promise.reject(new Error('The console keeps no draft'))
  const draftContext: DraftContextValue = {
    draft:
      drafts === undefined
        ? null
        : draftState !== undefined &&
            draftState.id === selectedId &&
            draftState.name === draftName
          ? draftState.value
          : undefined,
    check: request =>
      drafts === undefined || selectedId === undefined
        ? unavailable()
        : drafts
            .check(selectedId, { ...request, draft: draftName })
            .then(changed(selectedId)),
    anchor: request =>
      drafts === undefined || selectedId === undefined
        ? unavailable()
        : drafts
            .anchor(selectedId, { ...request, draft: draftName })
            .then(changed(selectedId)),
    accept: request =>
      drafts === undefined || selectedId === undefined
        ? unavailable()
        : drafts
            .accept(selectedId, { ...request, draft: draftName })
            .then(changed(selectedId)),
    validateRules: request =>
      drafts === undefined || selectedId === undefined
        ? unavailable()
        : drafts
            .validateRules(selectedId, { ...request, draft: draftName })
            .then(changed(selectedId)),
    showReport: id => {
      setReportId(id)
      setOpenDecision(undefined)
      setOpenFile(undefined)
    },
    selectDraft: setDraftName,
  }

  const report: Loadable<DriftReport> | undefined =
    selectedId === undefined
      ? undefined
      : loaded?.id === selectedId
        ? loaded.report
        : { state: 'loading' }

  // A decision stays open only while its view and its report stay on screen.
  function selectRepository(name: string) {
    setRepositoryName(name)
    setDraftName(undefined)
    setReportId(undefined)
    setOpenDecision(undefined)
    setOpenFile(undefined)
  }

  /** Shows the report of a repository, by its identifier. */
  function openReport(id: string) {
    const name = reports.find(r => r.id === id)?.repository.name
    if (name !== undefined) setRepositoryName(name)
    setReportId(id)
    setOpenFile(undefined)
  }

  function selectView(id: ViewId) {
    setView(id)
    setOpenDecision(undefined)
    setOpenFile(undefined)
  }

  return (
    <DraftContext.Provider value={draftContext}>
      <div className="shell">
        <aside className="sidebar">
          <img className="sidebar-logo" src={logoUrl} alt="Compadr" />
          <label className="visually-hidden" htmlFor={repositoryLabel}>
            Repository
          </label>
          <select
            id={repositoryLabel}
            className="select repository-select"
            value={repository ?? ''}
            disabled={repositories.length === 0}
            onChange={event => selectRepository(event.target.value)}
          >
            {repositories.map(name => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <nav aria-label="Main">
            {NAVIGATION.map(({ group, views }) => (
              <div key={group} className="nav-group">
                <h2 className="nav-group-title">{group}</h2>
                <ul>
                  {views.map(item => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className="nav-item"
                        aria-current={item.id === view ? 'page' : undefined}
                        onClick={() => selectView(item.id)}
                      >
                        {item.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
          {me?.signsIn && (
            <div className="sidebar-person">
              <p>
                {me.name}
                <span className="muted"> · {ROLE_LABELS[me.role]}</span>
              </p>
              <button type="button" className="link-button" onClick={signOut}>
                Sign out
              </button>
              {signOutFailure && (
                <p className="hint" role="alert">
                  {signOutFailure}
                </p>
              )}
            </div>
          )}
        </aside>
        <div className="main">
          <header className="topbar">
            <p className="breadcrumb">
              {repository && (
                <>
                  <span>{repository}</span>
                  <span aria-hidden="true">/</span>
                </>
              )}
              <span className="breadcrumb-current">{viewLabel(view)}</span>
            </p>
            <label className="visually-hidden" htmlFor={refLabel}>
              Git reference
            </label>
            <select
              id={refLabel}
              className="select ref-select"
              value={selectedId ?? ''}
              disabled={refs.length === 0}
              onChange={event => {
                setReportId(event.target.value)
                setOpenDecision(undefined)
                setOpenFile(undefined)
              }}
            >
              {refs.map(candidate => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.repository.ref} ·{' '}
                  {shortCommit(candidate.repository.commit)}
                </option>
              ))}
            </select>
          </header>
          <main className="content">
            <h1>{viewLabel(view)}</h1>
            {view === 'overview' && portal && overview ? (
              <OverviewView
                overview={overview}
                portal={portal}
                onOpenRepository={id => {
                  openReport(id)
                  setOpenDecision(undefined)
                  setView('drift')
                }}
                onOpenDecision={(id, number) => {
                  openReport(id)
                  setOpenDecision(number)
                  setView('decisions')
                }}
              />
            ) : view === 'usage' && portal && me?.role === 'admin' ? (
              <UsageView portal={portal} />
            ) : view === 'integrations' && portal && me?.role === 'admin' ? (
              <GitHubAppPanel portal={portal} />
            ) : view === 'people' && portal && me ? (
              <PeopleView portal={portal} me={me} />
            ) : view === 'drift' && report?.state === 'ready' ? (
              <DriftView
                key={selectedId}
                report={report.value}
                findingsOf={
                  source.findings === undefined || selectedId === undefined
                    ? undefined
                    : { source, id: selectedId }
                }
              />
            ) : view === 'links-to-repair' && report?.state === 'ready' ? (
              <LinksView key={selectedId} report={report.value} />
            ) : view === 'feature-map' && report?.state === 'ready' ? (
              <FeaturesView
                key={selectedId}
                report={report.value}
                consolidationOf={
                  source.consolidation === undefined || selectedId === undefined
                    ? undefined
                    : { source, id: selectedId }
                }
              />
            ) : view === 'decisions' && report?.state === 'ready' ? (
              <DecisionsView
                key={selectedId}
                report={report.value}
                selected={openDecision}
                onSelect={setOpenDecision}
                recommendationOf={
                  source.recommendation === undefined ||
                  selectedId === undefined
                    ? undefined
                    : { source, id: selectedId }
                }
                plainOf={
                  plain === undefined || !plainReady || selectedId === undefined
                    ? undefined
                    : { source: plain, id: selectedId }
                }
              />
            ) : view === 'reviews' && selectedId !== undefined ? (
              <ReviewsView
                key={selectedId}
                reviews={reviews}
                reports={source}
                baseReportId={selectedId}
                drafting={draftingReady ? drafting : undefined}
              />
            ) : view === 'draft' ? (
              <DraftView
                reportId={selectedId}
                portal={overview ? portal : undefined}
                me={me}
              />
            ) : view === 'files' && report?.state === 'ready' ? (
              <FilesView
                key={`${selectedId}:${openFile ?? ''}`}
                report={report.value}
                initialPath={openFile}
                onOpenDecision={number => {
                  setOpenDecision(number)
                  setView('decisions')
                }}
              />
            ) : view === 'coverage' && report?.state === 'ready' ? (
              <CoverageView
                key={selectedId}
                report={report.value}
                onOpenDecision={number => {
                  setOpenDecision(number)
                  setView('decisions')
                }}
                onOpenFile={path => {
                  setOpenFile(path)
                  setView('files')
                }}
              />
            ) : (
              <Status list={list} report={report} />
            )}
          </main>
        </div>
      </div>
    </DraftContext.Provider>
  )
}

function Status({
  list,
  report,
}: {
  list: Loadable<ReportSummary[]>
  report: Loadable<DriftReport> | undefined
}) {
  if (list.state === 'loading') {
    return <p className="content-note">Loading the reports…</p>
  }
  if (list.state === 'error') {
    return (
      <p className="content-note" role="alert">
        The list of reports cannot be loaded: {list.message}
      </p>
    )
  }
  if (!report) {
    return (
      <div className="content-note">
        <p>No drift report yet. Write one with the command line:</p>
        <pre className="code-block">
          compadr drift &lt;repository&gt; --out
          &lt;folder&gt;/&lt;name&gt;.json
        </pre>
        <p>
          Then start the console with <code>COMPADR_REPORTS_DIR</code> set to
          that folder.
        </p>
      </div>
    )
  }
  if (report.state === 'loading') {
    return <p className="content-note">Loading the report…</p>
  }
  if (report.state === 'error') {
    return (
      <p className="content-note" role="alert">
        The report cannot be loaded: {report.message}
      </p>
    )
  }
  const { decisions, signals, repository } = report.value
  return (
    <p className="content-note">
      {repository.name} at {repository.ref}, commit{' '}
      {shortCommit(repository.commit)}: {count(decisions.length, 'decision')},{' '}
      {count(signals.length, 'signal')}. This view will be available in a later
      version.
    </p>
  )
}
