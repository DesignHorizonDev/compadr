import { createContext, useContext, useState } from 'react'
import { count } from '../format.ts'
import type {
  AcceptDecisionRequest,
  AnchorRequest,
  CheckRequest,
  DraftState,
  ValidateRulesRequest,
} from '../drafts.ts'

/** The draft of the report on screen, and the actions that fill it. */
export interface DraftContextValue {
  /** The draft, null when the server keeps none, undefined while loading. */
  draft: DraftState | null | undefined
  check: (request: CheckRequest) => Promise<DraftState>
  anchor: (request: AnchorRequest) => Promise<DraftState>
  accept: (request: AcceptDecisionRequest) => Promise<DraftState>
  validateRules: (request: ValidateRulesRequest) => Promise<DraftState>
  /** Shows a report, such as the report of the draft. */
  showReport: (id: string) => void
  /** Makes the actions fill another draft of the repository, by name. */
  selectDraft: (name: string) => void
}

const NO_DRAFT: DraftContextValue = {
  draft: null,
  check: () => Promise.reject(new Error('The console keeps no draft')),
  anchor: () => Promise.reject(new Error('The console keeps no draft')),
  accept: () => Promise.reject(new Error('The console keeps no draft')),
  validateRules: () => Promise.reject(new Error('The console keeps no draft')),
  showReport: () => {},
  selectDraft: () => {},
}

export const DraftContext = createContext<DraftContextValue>(NO_DRAFT)

export function useDraft(): DraftContextValue {
  return useContext(DraftContext)
}

/**
 * A button that adds a correction to the draft, then says how many commits
 * the draft holds, or why the server refused it.
 */
export function AddToDraftButton({
  label,
  add,
  onAdded,
}: {
  label: string
  add: () => Promise<DraftState>
  onAdded?: (draft: DraftState) => void
}) {
  const [status, setStatus] = useState<
    | { state: 'idle' }
    | { state: 'adding' }
    | { state: 'added'; draft: DraftState }
    | { state: 'failed'; message: string }
  >({ state: 'idle' })
  return (
    <>
      <button
        type="button"
        className="close"
        disabled={status.state === 'adding'}
        onClick={() => {
          setStatus({ state: 'adding' })
          add().then(
            draft => {
              setStatus({ state: 'added', draft })
              onAdded?.(draft)
            },
            (error: unknown) =>
              setStatus({
                state: 'failed',
                message: error instanceof Error ? error.message : String(error),
              })
          )
        }}
      >
        {status.state === 'adding' ? 'Adding…' : label}
      </button>
      {status.state === 'added' && (
        <p className="hint" role="status">
          Added to the draft {status.draft.name}, which now holds{' '}
          {count(status.draft.commits.length, 'commit')}.
        </p>
      )}
      {status.state === 'failed' && (
        <p className="hint" role="alert">
          The draft refused the change: {status.message}
        </p>
      )}
    </>
  )
}
