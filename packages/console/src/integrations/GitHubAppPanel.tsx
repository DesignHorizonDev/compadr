import { useEffect, useRef, useState } from 'react'
import type { GitHubAppState, PortalSource } from '../portal.ts'
import { safeHref } from '../links.ts'

type Loadable<T> =
  | { state: 'loading' }
  | { state: 'ready'; value: T }
  | { state: 'error'; message: string }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The GitHub App of the portal, for an administrator: its registration
 * with the manifest flow of GitHub, its installation, and the repositories
 * it reads.
 */
export function GitHubAppPanel({ portal }: { portal: PortalSource }) {
  const [app, setApp] = useState<Loadable<GitHubAppState | null>>({
    state: 'loading',
  })
  const [failure, setFailure] = useState<string>()
  const [manifest, setManifest] = useState<{
    action: string
    manifest: string
  }>()
  const form = useRef<HTMLFormElement>(null)

  useEffect(() => {
    let active = true
    portal.githubApp().then(
      value => active && setApp({ state: 'ready', value }),
      (error: unknown) =>
        active && setApp({ state: 'error', message: errorMessage(error) })
    )
    return () => {
      active = false
    }
  }, [portal])

  // The manifest goes to GitHub in a form that the browser posts: GitHub
  // shows the app to the person, who creates it.
  useEffect(() => {
    if (manifest !== undefined) form.current?.submit()
  }, [manifest])

  if (app.state === 'loading') {
    return <p className="content-note">Loading the GitHub App…</p>
  }
  if (app.state === 'error') {
    return (
      <p className="content-note" role="alert">
        The GitHub App cannot be read: {app.message}
      </p>
    )
  }
  const state = app.value
  if (state === null) {
    return (
      <p className="content-note">
        This portal reads its repositories from local clones. Add a{' '}
        <code>githubApp</code> section to <code>portal.yml</code> to read them
        through a GitHub App.
      </p>
    )
  }
  const waiting = state.repositories.filter(r => !r.served)
  return (
    <section className="github-app" aria-label="GitHub App">
      <h2 className="section-title">GitHub App</h2>
      {!state.registered ? (
        <>
          <p>
            The portal reads the repositories of {state.organization} through a
            GitHub App of its own. GitHub creates the app from a manifest that
            the portal prepares. The app has read access to the code and the
            metadata, and write access to branches and pull requests. GitHub
            then sends the credentials of the app to the portal, which seals
            them in its database. The administrator types no key.
          </p>
          <p>
            <button
              type="button"
              className="close"
              onClick={() => {
                setFailure(undefined)
                portal
                  .startGithubApp()
                  .then(setManifest, (error: unknown) =>
                    setFailure(errorMessage(error))
                  )
              }}
            >
              Create the GitHub App on GitHub
            </button>
          </p>
          {manifest && (
            <form ref={form} method="post" action={manifest.action}>
              <input type="hidden" name="manifest" value={manifest.manifest} />
            </form>
          )}
        </>
      ) : (
        <>
          <p>
            The app{' '}
            {state.htmlUrl ? (
              <a href={safeHref(state.htmlUrl)} rel="noreferrer noopener">
                {state.slug}
              </a>
            ) : (
              state.slug
            )}{' '}
            is registered.{' '}
            {state.installation
              ? `It is installed on ${state.installation.account}.`
              : `It is not installed on ${state.organization} yet.`}
          </p>
          {!state.installation && state.installUrl && (
            <p>
              <a href={safeHref(state.installUrl)} rel="noreferrer noopener">
                Install the app on {state.organization}
              </a>
              , on the repositories of <code>portal.yml</code> only.
            </p>
          )}
          {state.problem && (
            <p className="notice" role="alert">
              {state.problem}
            </p>
          )}
        </>
      )}
      {failure && (
        <p className="notice" role="alert">
          {failure}
        </p>
      )}
      <h3 className="rules-title">Repositories</h3>
      <ul
        className="patch-comments"
        aria-label="Repositories of the GitHub App"
      >
        {state.repositories.map(r => (
          <li key={r.github}>
            <code>{r.github}</code>{' '}
            {r.served ? (
              <span className="muted">· read by the portal</span>
            ) : (
              <span className="muted">· not served yet: {r.error}</span>
            )}
          </li>
        ))}
      </ul>
      {waiting.length > 0 && state.registered && (
        <p className="hint">
          Restart the portal once the app is installed: the portal then clones
          the repositories that it does not serve yet.
        </p>
      )}
    </section>
  )
}
