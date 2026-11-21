// Checks the license boundary between the packages of this repository. Run in
// CI.
//
// Each package belongs to a layer, given by the `license` field of its
// package.json:
//
//   0. Apache-2.0 (format)
//   1. FSL-1.1-ALv2 (engine, CLI, local MCP)
//   2. FCL-1.0-ALv2 (tokens, console)
//
// A package may depend only on packages of its own layer or of a lower one.
// Code under a more permissive license never imports code under a stricter
// one, so the Apache-2.0 packages can be used without the FSL, and the FSL
// packages without the FCL.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const LAYERS = new Map([
  [
    'Apache-2.0',
    { rank: 0, licenseFile: 'LICENSE', title: /^\s*Apache License\s*$/m },
  ],
  [
    'FSL-1.1-ALv2',
    {
      rank: 1,
      licenseFile: 'LICENSE.md',
      title:
        /^# Functional Source License, Version 1\.1, ALv2 Future License$/m,
    },
  ],
  [
    'LicenseRef-FCL-1.0-ALv2',
    {
      rank: 2,
      licenseFile: 'LICENSE.md',
      title: /^# Fair Core License, Version 1\.0, ALv2 Future License$/m,
    },
  ],
])

const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
]

const IMPORT = /(?:from\s+|import\s*\(\s*|import\s+)['"](@compadr\/[^/'"]+)/g

/**
 * @typedef {object} WorkspacePackage
 * @property {string} dir         Folder name under packages/
 * @property {any} manifest       Parsed package.json
 * @property {string | null} licenseText  Content of the license file, if any
 * @property {string[]} imports   Workspace packages imported by the sources
 */

/** Returns the list of problems found. An empty list means the boundary holds. */
export function checkBoundary(/** @type {WorkspacePackage[]} */ packages) {
  const problems = []
  const byName = new Map(packages.map(p => [p.manifest.name, p]))

  for (const pkg of packages) {
    const { name, license } = pkg.manifest
    const layer = LAYERS.get(license)
    if (!layer) {
      problems.push(`${name}: license "${license}" belongs to no layer`)
      continue
    }
    if (pkg.licenseText === null) {
      problems.push(`${name}: ${layer.licenseFile} is missing`)
    } else if (!layer.title.test(pkg.licenseText)) {
      problems.push(`${name}: ${layer.licenseFile} is not the ${license} text`)
    }

    const declared = new Set(
      DEPENDENCY_FIELDS.flatMap(field =>
        Object.keys(pkg.manifest[field] ?? {})
      ).filter(dep => byName.has(dep))
    )
    for (const imported of pkg.imports) {
      if (imported !== name && !declared.has(imported)) {
        problems.push(`${name}: imports ${imported} without declaring it`)
      }
    }

    for (const dep of declared) {
      const depLayer = LAYERS.get(byName.get(dep).manifest.license)
      if (depLayer && depLayer.rank > layer.rank) {
        problems.push(
          `${name} (${license}) depends on ${dep} (${byName.get(dep).manifest.license})`
        )
      }
    }
  }
  return problems
}

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter(entry => entry.isFile() && /\.(?:[cm]?[jt]sx?)$/.test(entry.name))
    .map(entry => join(entry.parentPath, entry.name))
}

function readPackages(root) {
  const packagesDir = join(root, 'packages')
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(({ name: dir }) => {
      const pkgDir = join(packagesDir, dir)
      const manifest = JSON.parse(
        readFileSync(join(pkgDir, 'package.json'), 'utf8')
      )
      const licenseFile = LAYERS.get(manifest.license)?.licenseFile
      const licensePath = licenseFile && join(pkgDir, licenseFile)
      const srcDir = join(pkgDir, 'src')
      const imports = existsSync(srcDir)
        ? sourceFiles(srcDir).flatMap(file =>
            [...readFileSync(file, 'utf8').matchAll(IMPORT)].map(m => m[1])
          )
        : []
      return {
        dir,
        manifest,
        licenseText:
          licensePath && existsSync(licensePath)
            ? readFileSync(licensePath, 'utf8')
            : null,
        imports: [...new Set(imports)],
      }
    })
}

function main() {
  const packages = readPackages(process.cwd())
  const problems = checkBoundary(packages)
  if (problems.length > 0) {
    console.error('✖ License boundary broken:')
    for (const problem of problems) console.error(`  ${problem}`)
    process.exit(1)
  }
  console.log(`✔ ${packages.length} packages, license boundary respected.`)
}

if (import.meta.main) main()
