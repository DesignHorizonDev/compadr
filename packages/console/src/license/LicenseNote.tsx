import { useEffect, useState } from 'react'
import { formatDate } from '../drift/signals.ts'
import type { LicenseInfo, PortalSource } from '../portal.ts'

const PLANS: Record<string, string> = {
  team: 'Team',
  business: 'Business',
  enterprise: 'Enterprise',
}

const count = (n: number, one: string, other: string) =>
  `${n} ${n === 1 ? one : other}`

/** One line on the license of the portal: its plan and its limits. */
export function licenseLine(info: LicenseInfo): string {
  const editors = count(info.limits.editors, 'editor', 'editors')
  const repositories =
    info.limits.repositories === null
      ? 'no limit of repositories'
      : count(info.limits.repositories, 'repository', 'repositories')
  if (info.mode === 'licensed' && info.license !== null) {
    const kind = info.license.trial === true ? 'trial license' : 'license'
    return `${PLANS[info.license.plan] ?? info.license.plan} ${kind} of ${info.license.licensee}, until ${formatDate(info.license.expiresAt)}: ${editors}, ${repositories}.`
  }
  const why = info.reason ? ` The license is not in force: ${info.reason}.` : ''
  return `Free mode: ${editors}, ${repositories}.${why}`
}

/**
 * The state of the license, above a view. It also names the repositories
 * that wait for a license, so that nobody looks for them in vain.
 */
export function LicenseNote({ portal }: { portal: PortalSource }) {
  const [info, setInfo] = useState<LicenseInfo | null>(null)
  useEffect(() => {
    let active = true
    portal.license().then(
      value => active && setInfo(value),
      () => {}
    )
    return () => {
      active = false
    }
  }, [portal])
  if (info === null) return null
  const waiting = info.unlicensedRepositories
  return (
    <div className={waiting.length > 0 ? 'notice' : 'hint'}>
      <p>{licenseLine(info)}</p>
      {waiting.length > 0 && info.limits.repositories !== null && (
        <p>
          The portal does not serve {waiting.join(', ')}: the{' '}
          {info.mode === 'free' ? 'free mode' : 'license'} allows{' '}
          {count(info.limits.repositories, 'repository', 'repositories')}.
        </p>
      )}
    </div>
  )
}
