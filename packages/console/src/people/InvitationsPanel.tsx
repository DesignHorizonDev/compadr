import { useEffect, useId, useState } from 'react'
import { formatDate } from '../drift/signals.ts'
import type { InvitationsInfo, PortalSource } from '../portal.ts'

type Loadable<T> =
  | { state: 'loading' }
  | { state: 'ready'; value: T }
  | { state: 'error'; message: string }

const numbers = new Intl.NumberFormat('en-US')

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const STATUSES = {
  open: 'Waiting for the sign-up',
  used: 'Signed up',
  expired: 'Expired',
  revoked: 'Withdrawn',
} as const

/**
 * The invitations of a customer of the hosted service, for its
 * administrators: the invitations left, the date from which the customer
 * can invite, and the invitations sent. A portal that no hosted service
 * runs shows nothing.
 */
export function InvitationsPanel({
  portal,
  now = () => new Date(),
}: {
  portal: PortalSource
  /** The clock; the tests give their own. */
  now?: () => Date
}) {
  const [invitations, setInvitations] = useState<
    Loadable<InvitationsInfo | null>
  >({ state: 'loading' })
  const [account, setAccount] = useState('')
  const [email, setEmail] = useState('')
  const [failure, setFailure] = useState<string>()
  const [sent, setSent] = useState<string>()
  const [busy, setBusy] = useState(false)
  const accountId = useId()
  const emailId = useId()

  useEffect(() => {
    let active = true
    portal.invitations().then(
      value => active && setInvitations({ state: 'ready', value }),
      (error: unknown) =>
        active &&
        setInvitations({ state: 'error', message: errorMessage(error) })
    )
    return () => {
      active = false
    }
  }, [portal])

  if (invitations.state === 'loading') return null
  if (invitations.state === 'error') {
    return (
      <section className="invitations" aria-label="Invitations">
        <h2 className="section-title">Invitations</h2>
        <p className="content-note" role="alert">
          The invitations cannot be loaded: {invitations.message}
        </p>
      </section>
    )
  }
  if (invitations.value === null) return null
  const value = invitations.value
  const opensLater = new Date(value.invitesFrom).getTime() > now().getTime()
  const canInvite = !opensLater && value.remaining > 0

  function invite() {
    const login = account.trim()
    const address = email.trim()
    setBusy(true)
    setFailure(undefined)
    setSent(undefined)
    portal
      .invite(login, address === '' ? null : address)
      .then(
        updated => {
          setInvitations({ state: 'ready', value: updated })
          setAccount('')
          setEmail('')
          setSent(
            address === ''
              ? `${login} is invited. Tell them to sign up at ${value.signUpUrl}.`
              : `${login} is invited. Compadr sends the invitation to ${address}.`
          )
        },
        (error: unknown) => setFailure(errorMessage(error))
      )
      .finally(() => setBusy(false))
  }

  return (
    <section className="invitations" aria-label="Invitations">
      <h2 className="section-title">Invitations</h2>
      <p className="content-note">
        {numbers.format(value.remaining)} of {numbers.format(value.allowance)}{' '}
        {value.allowance === 1 ? 'invitation' : 'invitations'} left.{' '}
        {opensLater
          ? `Your organization can invite from ${formatDate(value.invitesFrom)}.`
          : 'An invitation lets a GitHub account sign up to Compadr without waiting for a place.'}{' '}
        An invitation that nobody uses expires after 30 days, and you get it
        back.
      </p>
      {canInvite && (
        <form
          className="queue-filters"
          onSubmit={event => {
            event.preventDefault()
            if (!busy && account.trim() !== '') invite()
          }}
        >
          <label htmlFor={accountId}>GitHub account</label>
          <input
            id={accountId}
            className="select"
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="organization or user"
            maxLength={39}
            value={account}
            onChange={event => setAccount(event.target.value)}
          />
          <label htmlFor={emailId}>Email (optional)</label>
          <input
            id={emailId}
            className="select"
            type="email"
            autoComplete="off"
            maxLength={254}
            value={email}
            onChange={event => setEmail(event.target.value)}
          />
          <button
            type="submit"
            className="close"
            disabled={busy || account.trim() === ''}
          >
            Invite
          </button>
        </form>
      )}
      {canInvite && (
        <p className="hint">
          With an email, Compadr writes the invitation to that address. Without
          one, tell the account to sign up at {value.signUpUrl}.
        </p>
      )}
      {sent && (
        <p className="content-note" role="status">
          {sent}
        </p>
      )}
      {failure && (
        <p className="notice" role="alert">
          {failure}
        </p>
      )}
      {value.invitations.length === 0 ? (
        <p className="muted">Your organization has sent no invitation yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="signals">
            <thead>
              <tr>
                <th scope="col">Account</th>
                <th scope="col">State</th>
                <th scope="col">Invited</th>
                <th scope="col">Expires</th>
              </tr>
            </thead>
            <tbody>
              {value.invitations.map(invitation => (
                <tr key={`${invitation.account}-${invitation.invitedAt}`}>
                  <td>
                    <code>{invitation.account}</code>
                    {invitation.email !== null && (
                      <p className="muted">{invitation.email}</p>
                    )}
                  </td>
                  <td>
                    {STATUSES[invitation.status]}
                    {invitation.status === 'used' &&
                      invitation.usedAt !== null && (
                        <p className="muted">{formatDate(invitation.usedAt)}</p>
                      )}
                  </td>
                  <td className="muted">
                    {formatDate(invitation.invitedAt)}
                    {invitation.invitedBy !== null && (
                      <p className="muted">by {invitation.invitedBy}</p>
                    )}
                  </td>
                  <td className="muted">
                    {invitation.status === 'open'
                      ? formatDate(invitation.expiresAt)
                      : '–'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
