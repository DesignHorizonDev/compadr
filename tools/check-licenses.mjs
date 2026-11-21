// Checks that every installed dependency uses a permissive license. Run in CI.
// A license outside the allowlist fails the step: accepting a new license is
// decided here, in code, never along the way.
//
// Strong copyleft licenses (GPL, LGPL, AGPL) are refused: they would bind the
// Apache-2.0, FSL and FCL packages of this repository.
import { execFileSync } from 'node:child_process'

const ALLOWED = new Set([
  'MIT',
  'MIT-0',
  'ISC',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'BlueOak-1.0.0',
  'CC0-1.0',
  // Data files: the SPDX license and exception lists (spdx-exceptions,
  // spdx-ranges).
  'CC-BY-3.0',
  'CC-BY-4.0',
  // File-level copyleft: it binds only changes to the MPL files themselves,
  // never the code that uses them (lightningcss, by Vite).
  'MPL-2.0',
  'Python-2.0',
  'Unlicense',
  // Fonts (Geist, Geist Mono).
  'OFL-1.1',
])

// Packages that declare an imprecise license, read in their LICENSE file. The
// key carries the version: a new version is read again.
const REVIEWED = new Map([])

// A compound expression is accepted when one of its alternatives is (OR) or
// when all of them are (AND). A trailing asterisk marks a license guessed by
// the tool.
export function isAllowed(expression) {
  const cleaned = expression.replace(/[()*]/g, '').trim()
  if (cleaned.includes(' OR '))
    return cleaned.split(' OR ').some(l => ALLOWED.has(l.trim()))
  if (cleaned.includes(' AND '))
    return cleaned.split(' AND ').every(l => ALLOWED.has(l.trim()))
  return ALLOWED.has(cleaned)
}

function main() {
  const json = execFileSync(
    'yarn',
    ['license-checker-rseidelsohn', '--json', '--excludePrivatePackages'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  )
  const packages = JSON.parse(json)
  const refused = Object.entries(packages)
    .map(([name, info]) => [
      name,
      REVIEWED.get(name) ??
        (Array.isArray(info.licenses)
          ? info.licenses.join(' OR ')
          : String(info.licenses)),
    ])
    .filter(([, license]) => !isAllowed(license))

  if (refused.length > 0) {
    console.error('✖ Dependencies under a license outside the allowlist:')
    for (const [name, license] of refused)
      console.error(`  ${name}: ${license}`)
    process.exit(1)
  }
  console.log(
    `✔ ${Object.keys(packages).length} dependencies, all under an allowed license.`
  )
}

if (import.meta.main) main()
