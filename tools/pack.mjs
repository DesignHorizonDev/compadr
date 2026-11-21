// Packs the distributable packages into the archives that a release
// publishes on npm (`npm publish <archive>`). Run after `yarn build`, in CI
// and for a release:
//
//   node tools/pack.mjs <folder>
//
// The command line and the console are bundles. Each archive holds the
// bundle, the license of the package and THIRD_PARTY_NOTICES.md, which gives
// the license of every package that the bundle includes. The bundles carry
// their dependencies, so the manifest of the archive declares none.
//
// The format is a library. Its archive holds the built module, its types and
// the JSON schemas, and its manifest declares its dependencies (zod, yaml),
// which npm installs beside it.
//
// The manifest of an archive keeps the public fields of the package and
// never `private`: the packages stay private in the workspace, so that only
// a checked archive reaches npm. The script then reads each archive back and
// fails when a file, a notice or a license text is missing.
import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * @typedef {object} Distributable
 * @property {string} dir        Folder under packages/
 * @property {string[]} files    Files and folders of the archive, from the package
 * @property {string[]} modules  Lists of bundled files: esbuild metafiles or JSON arrays
 * @property {string[]} copied   Packages whose files the build copies without bundling
 * @property {string[]} licenses License files of the package that the archive holds
 * @property {object} [library]  Set for a library: the built entry points,
 *   which replace those of the workspace manifest in `exports`, and `types`.
 *   The other exports (the JSON schemas) stay. The archive then keeps the
 *   dependencies and holds no notices.
 */

/** @type {Distributable[]} */
export const DISTRIBUTABLES = [
  {
    dir: 'cli',
    files: ['dist/cli.js', 'dist/wasm'],
    modules: ['dist/metafile-esm.json'],
    copied: ['web-tree-sitter', '@vscode/tree-sitter-wasm'],
    licenses: ['LICENSE.md'],
  },
  {
    dir: 'console',
    files: ['dist/pages', 'dist/server/console.js', 'dist/server/wasm'],
    modules: ['dist/server/metafile-esm.json', 'dist/client-modules.json'],
    copied: ['web-tree-sitter', '@vscode/tree-sitter-wasm'],
    licenses: ['LICENSE.md'],
  },
  {
    dir: 'format',
    files: ['dist/index.js', 'dist/index.d.ts', 'schema'],
    modules: [],
    copied: [],
    licenses: ['LICENSE', 'NOTICE'],
    library: {
      exports: {
        '.': {
          types: './dist/index.d.ts',
          default: './dist/index.js',
        },
      },
      types: './dist/index.d.ts',
    },
  },
]

// The repository that npm names as the source of each archive. For the
// provenance of a package, npm requires repository.url to match the
// repository that publishes it.
export const REPOSITORY_URL =
  'git+https://github.com/DesignHorizonDev/compadr.git'

// Fields of the package manifest that the archive keeps.
const MANIFEST_FIELDS = [
  'name',
  'version',
  'description',
  'keywords',
  'homepage',
  'repository',
  'bugs',
  'author',
  'license',
  'type',
  'bin',
  'engines',
]

/**
 * The manifest of the archive of `distributable`, from the manifest of its
 * workspace package and the engines of the repository. A library keeps its
 * dependencies, which must not point into the workspace.
 */
export function archiveManifest(manifest, distributable, engines) {
  const kept = Object.fromEntries(
    MANIFEST_FIELDS.filter(field => manifest[field] !== undefined).map(
      field => [field, manifest[field]]
    )
  )
  kept.engines ??= engines
  if (distributable.library) {
    kept.exports = { ...manifest.exports, ...distributable.library.exports }
    kept.types = distributable.library.types
    const dependencies = manifest.dependencies ?? {}
    for (const [name, range] of Object.entries(dependencies)) {
      if (range.startsWith('workspace:')) {
        throw new Error(
          `${manifest.name} depends on ${name} in the workspace: a published library cannot`
        )
      }
    }
    if (Object.keys(dependencies).length > 0) kept.dependencies = dependencies
  }
  return kept
}

const LICENSE_FILE = /^(?:licen[cs]e|notice|copying)(?:[.-].*)?$/i

/**
 * The folder of the package that holds a bundled file: the last
 * `node_modules` segment of its absolute path, or a package of this
 * repository. Returns null for a file outside every package.
 */
export function packageFolder(file, root = ROOT) {
  const parts = file.split(sep)
  const last = parts.lastIndexOf('node_modules')
  if (last !== -1) {
    const scoped = parts[last + 1]?.startsWith('@')
    return parts.slice(0, last + (scoped ? 3 : 2)).join(sep)
  }
  const packages = join(root, 'packages')
  if (file.startsWith(`${packages}${sep}`)) {
    return join(packages, relative(packages, file).split(sep)[0])
  }
  return null
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/** Files that the bundle of `distributable` includes, from its build lists. */
function bundledFiles(packageDir, distributable) {
  return distributable.modules.flatMap(list => {
    const json = readJson(join(packageDir, list))
    return Array.isArray(json) ? json : Object.keys(json.inputs)
  })
}

/**
 * The third-party packages of a bundle, with their license texts, sorted by
 * name. The package itself is left out.
 */
export function bundledPackages(packageDir, distributable) {
  const folders = new Set()
  for (const file of bundledFiles(packageDir, distributable)) {
    const folder = packageFolder(resolve(packageDir, file))
    if (folder !== null) folders.add(folder)
  }
  for (const name of distributable.copied) {
    folders.add(join(ROOT, 'node_modules', ...name.split('/')))
  }
  folders.delete(resolve(packageDir))
  const byName = new Map()
  for (const folder of folders) {
    const manifest = readJson(join(folder, 'package.json'))
    const texts = readdirSync(folder)
      .filter(file => LICENSE_FILE.test(file))
      .sort()
      .map(file => ({ file, text: readFileSync(join(folder, file), 'utf8') }))
    byName.set(`${manifest.name}@${manifest.version}`, {
      name: manifest.name,
      version: manifest.version,
      license: manifest.license ?? 'UNKNOWN',
      texts,
    })
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Content of THIRD_PARTY_NOTICES.md. */
export function renderNotices(name, packages) {
  const lines = [
    '# Third-party notices',
    '',
    `${name} includes the following packages. Each section gives the license of a package, as the package states it.`,
  ]
  for (const pkg of packages) {
    lines.push(
      '',
      `## ${pkg.name} ${pkg.version}`,
      '',
      `License: ${pkg.license}`
    )
    if (pkg.texts.length === 0) {
      lines.push('', 'The package ships no license file.')
    }
    for (const { file, text } of pkg.texts) {
      lines.push('', `### ${file}`, '', '````text', text.trimEnd(), '````')
    }
  }
  return `${lines.join('\n')}\n`
}

/** Builds the archive of one package in `out` and returns its path. */
export function pack(distributable, out) {
  const packageDir = join(ROOT, 'packages', distributable.dir)
  const manifest = readJson(join(packageDir, 'package.json'))
  const stage = mkdtempSync(join(tmpdir(), 'compadr-pack-'))
  try {
    const kept = archiveManifest(
      manifest,
      distributable,
      readJson(join(ROOT, 'package.json')).engines
    )
    writeFileSync(
      join(stage, 'package.json'),
      `${JSON.stringify(kept, null, 2)}\n`
    )
    for (const file of [
      ...distributable.files,
      'README.md',
      ...distributable.licenses,
    ]) {
      const source = join(packageDir, file)
      if (!existsSync(source)) {
        throw new Error(`${relative(ROOT, source)} is missing: run yarn build`)
      }
      cpSync(source, join(stage, file), { recursive: true })
    }
    const packages = distributable.library
      ? []
      : bundledPackages(packageDir, distributable)
    if (!distributable.library) {
      writeFileSync(
        join(stage, 'THIRD_PARTY_NOTICES.md'),
        renderNotices(manifest.name, packages)
      )
    }
    mkdirSync(out, { recursive: true })
    const [result] = JSON.parse(
      execFileSync(
        'npm',
        ['pack', '--json', '--ignore-scripts', '--pack-destination', out],
        { cwd: stage, encoding: 'utf8' }
      )
    )
    return { archive: join(out, result.filename), packages }
  } finally {
    rmSync(stage, { recursive: true, force: true })
  }
}

/** The problems of the repository field of an archive manifest. */
export function repositoryProblems(manifest, distributable) {
  const expected = `packages/${distributable.dir}`
  const repository = manifest.repository
  if (repository?.url !== REPOSITORY_URL) {
    return [
      `package.json names the repository ${JSON.stringify(repository?.url)}, not ${REPOSITORY_URL}`,
    ]
  }
  if (repository.directory !== expected) {
    return [
      `package.json names the directory ${JSON.stringify(repository.directory)}, not ${expected}`,
    ]
  }
  return []
}

/**
 * Reads an archive back and returns its problems: a missing file, a
 * dependency in the manifest, or a bundled package without its notice or
 * without the text of its license.
 */
export function checkArchive(distributable, archive, packages) {
  const listing = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .map(path => path.replace(/^package\//, ''))
  const problems = []
  for (const file of [
    ...distributable.files,
    'package.json',
    'README.md',
    ...distributable.licenses,
    ...(distributable.library ? [] : ['THIRD_PARTY_NOTICES.md']),
  ]) {
    if (!listing.some(path => path === file || path.startsWith(`${file}/`))) {
      problems.push(`${file} is missing`)
    }
  }
  const read = file =>
    execFileSync('tar', ['-xzOf', archive, `package/${file}`], {
      encoding: 'utf8',
    })
  const manifest = JSON.parse(read('package.json'))
  if (manifest.private !== undefined) {
    problems.push('package.json declares private: npm would refuse it')
  }
  problems.push(...repositoryProblems(manifest, distributable))
  if (!distributable.library) {
    for (const field of ['dependencies', 'peerDependencies']) {
      if (manifest[field] && Object.keys(manifest[field]).length > 0) {
        problems.push(`package.json declares ${field}: the bundle carries them`)
      }
    }
  }
  const notices = listing.includes('THIRD_PARTY_NOTICES.md')
    ? read('THIRD_PARTY_NOTICES.md')
    : ''
  for (const pkg of packages) {
    if (!notices.includes(`## ${pkg.name} ${pkg.version}\n`)) {
      problems.push(`THIRD_PARTY_NOTICES.md has no notice for ${pkg.name}`)
    } else if (pkg.texts.length === 0 && pkg.name.startsWith('@compadr/')) {
      problems.push(`${pkg.name} ships no license file`)
    }
  }
  return problems
}

function main() {
  const out = resolve(process.argv[2] ?? 'packs')
  let failed = false
  for (const distributable of DISTRIBUTABLES) {
    const { archive, packages } = pack(distributable, out)
    const problems = checkArchive(distributable, archive, packages)
    const shown = relative(process.cwd(), archive) || archive
    if (problems.length > 0) {
      failed = true
      for (const problem of problems) {
        console.error(`::error::${shown.split(sep).join('/')}: ${problem}`)
      }
    } else {
      console.log(
        distributable.library
          ? `✔ ${shown}: library, with its licenses and dependencies.`
          : `✔ ${shown}: ${packages.length} bundled packages, each with its notice.`
      )
    }
  }
  if (failed) process.exitCode = 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
