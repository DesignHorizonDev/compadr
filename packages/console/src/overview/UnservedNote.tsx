import type { UnservedRepository } from '../portal.ts'

const numbers = new Intl.NumberFormat('en-US')

/** Why the hosted service does not serve a repository, in one sentence. */
export function unservedReason(r: UnservedRepository): string {
  const quota = numbers.format(r.quota)
  switch (r.reason) {
    case 'repositories':
      return `The service serves at most ${r.quota === 1 ? '1 repository' : `${quota} repositories`} per portal, and this portal has reached that number.`
    case 'size':
      return r.kilobytes === undefined
        ? `The repository is larger than the limit of ${quota} kB per repository.`
        : `The repository holds ${numbers.format(r.kilobytes)} kB, above the limit of ${quota} kB per repository.`
    case 'unknown-size':
      return `GitHub did not give the size of the repository, which the service checks against the limit of ${quota} kB per repository.`
  }
}

/** What an administrator can do about it. */
export function unservedStep(r: UnservedRepository): string {
  switch (r.reason) {
    case 'repositories':
      return 'Remove another repository from the installation of the GitHub App. The service then serves the waiting repositories in alphabetical order.'
    case 'size':
      return 'Remove the repository from the installation of the GitHub App, or ask the Compadr team to raise the limit.'
    case 'unknown-size':
      return 'The service asks GitHub again at the next change of the installation, for example when you add or remove a repository.'
  }
}

/**
 * The repositories that the hosted service leaves aside because of a
 * quota. The portal sends them to its administrators only.
 */
export function UnservedNote({
  repositories,
}: {
  repositories: readonly UnservedRepository[]
}) {
  if (repositories.length === 0) return null
  return (
    <div className="notice" role="status">
      <p>
        {repositories.length === 1
          ? 'The service does not serve 1 repository of the installation:'
          : `The service does not serve ${repositories.length} repositories of the installation:`}
      </p>
      <ul>
        {repositories.map(r => (
          <li key={r.github}>
            <code>{r.github}</code>: {unservedReason(r)} {unservedStep(r)}
          </li>
        ))}
      </ul>
    </div>
  )
}
