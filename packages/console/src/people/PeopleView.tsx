import { useEffect, useState } from 'react'
import { formatDate } from '../drift/signals.ts'
import { LicenseNote } from '../license/LicenseNote.tsx'
import { InvitationsPanel } from './InvitationsPanel.tsx'
import type { Me, People, PortalSource } from '../portal.ts'

type Loadable<T> =
  | { state: 'loading' }
  | { state: 'ready'; value: T }
  | { state: 'error'; message: string }

const numbers = new Intl.NumberFormat('en-US')

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const ROLES = {
  admin: 'Administrator',
  editor: 'Editor',
  // A seat given beyond the editors that the license allows.
  waiting: 'Reader: seat beyond the license',
  reader: 'Reader',
} as const

/**
 * The people who signed in to the portal and their role. An administrator
 * gives and takes back the editor seats, which the license counts.
 */
export function PeopleView({ portal, me }: { portal: PortalSource; me: Me }) {
  const [people, setPeople] = useState<Loadable<People>>({ state: 'loading' })
  const [failure, setFailure] = useState<string>()
  const [busy, setBusy] = useState<string>()

  useEffect(() => {
    let active = true
    portal.people().then(
      value => active && setPeople({ state: 'ready', value }),
      (error: unknown) =>
        active && setPeople({ state: 'error', message: errorMessage(error) })
    )
    return () => {
      active = false
    }
  }, [portal])

  if (people.state === 'loading') {
    return <p className="content-note">Loading the people…</p>
  }
  if (people.state === 'error') {
    return (
      <p className="content-note" role="alert">
        The people cannot be loaded: {people.message}
      </p>
    )
  }
  const admin = me.role === 'admin'

  function setSeat(login: string, seat: boolean) {
    setBusy(login)
    setFailure(undefined)
    portal
      .setSeat(login, seat)
      .then(
        value => setPeople({ state: 'ready', value }),
        (error: unknown) => setFailure(errorMessage(error))
      )
      .finally(() => setBusy(undefined))
  }

  return (
    <div className="people">
      <LicenseNote portal={portal} />
      <p className="content-note">
        {numbers.format(people.value.editors)} of{' '}
        {numbers.format(people.value.limit)}{' '}
        {people.value.limit === 1 ? 'editor' : 'editors'} that the license
        allows · {numbers.format(people.value.people.length)}{' '}
        {people.value.people.length === 1 ? 'person' : 'people'} signed in at
        least once. Editors add to the drafts. Readers see every page.
      </p>
      {failure && (
        <p className="notice" role="alert">
          {failure}
        </p>
      )}
      <div className="table-wrap">
        <table className="signals">
          <thead>
            <tr>
              <th scope="col">Person</th>
              <th scope="col">Role</th>
              <th scope="col">Last sign-in</th>
              {admin && <th scope="col">Editor seat</th>}
            </tr>
          </thead>
          <tbody>
            {people.value.people.map(person => (
              <tr key={person.login}>
                <td>
                  {person.name}
                  <p className="muted">
                    <code>{person.login}</code>
                  </p>
                </td>
                <td>
                  {
                    ROLES[
                      person.admin
                        ? 'admin'
                        : person.seat
                          ? person.active
                            ? 'editor'
                            : 'waiting'
                          : 'reader'
                    ]
                  }
                </td>
                <td className="muted">{formatDate(person.lastSeenAt)}</td>
                {admin && (
                  <td>
                    {person.admin ? (
                      <span className="muted">Always</span>
                    ) : (
                      <button
                        type="button"
                        className="close"
                        disabled={busy !== undefined}
                        onClick={() => setSeat(person.login, !person.seat)}
                      >
                        {person.seat ? 'Take back the seat' : 'Give a seat'}
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {admin && <InvitationsPanel portal={portal} />}
    </div>
  )
}
