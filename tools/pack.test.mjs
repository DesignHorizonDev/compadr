import assert from 'node:assert/strict'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import {
  archiveManifest,
  REPOSITORY_URL,
  repositoryProblems,
  DISTRIBUTABLES,
  packageFolder,
  renderNotices,
} from './pack.mjs'

describe('packageFolder', () => {
  const root = join('/', 'repo')

  it('finds the package of a file in node_modules, scoped or not', () => {
    assert.equal(
      packageFolder(
        join(root, 'node_modules', 'yaml', 'dist', 'index.js'),
        root
      ),
      join(root, 'node_modules', 'yaml')
    )
    assert.equal(
      packageFolder(
        join(root, 'node_modules', '@scope', 'name', 'lib', 'a.js'),
        root
      ),
      join(root, 'node_modules', '@scope', 'name')
    )
  })

  it('takes the last node_modules of a nested dependency', () => {
    assert.equal(
      packageFolder(
        join(root, 'node_modules', 'a', 'node_modules', 'b', 'index.js'),
        root
      ),
      join(root, 'node_modules', 'a', 'node_modules', 'b')
    )
  })

  it('finds a package of the repository, and nothing elsewhere', () => {
    assert.equal(
      packageFolder(join(root, 'packages', 'format', 'src', 'a.ts'), root),
      join(root, 'packages', 'format')
    )
    assert.equal(packageFolder(join(root, 'tools', 'a.mjs'), root), null)
  })
})

describe('renderNotices', () => {
  it('gives each package its license and the text of its files', () => {
    const notices = renderNotices('@compadr/cli', [
      {
        name: 'yaml',
        version: '2.9.1',
        license: 'ISC',
        texts: [{ file: 'LICENSE', text: 'Copyright Eemeli Aro\n' }],
      },
      { name: 'bare', version: '1.0.0', license: 'MIT', texts: [] },
    ])
    assert.match(notices, /^# Third-party notices\n/)
    assert.match(
      notices,
      /## yaml 2\.9\.1\n\nLicense: ISC\n\n### LICENSE\n\n````text\nCopyright Eemeli Aro\n````/
    )
    assert.match(
      notices,
      /## bare 1\.0\.0\n\nLicense: MIT\n\nThe package ships no license file\./
    )
  })
})

describe('repositoryProblems', () => {
  const cli = DISTRIBUTABLES.find(d => d.dir === 'cli')
  const repository = (url, directory) => ({
    repository: { type: 'git', url, directory },
  })

  it('accepts the repository of this project and the folder of the package', () => {
    assert.deepEqual(
      repositoryProblems(repository(REPOSITORY_URL, 'packages/cli'), cli),
      []
    )
  })

  it('refuses a missing field, another repository or another folder', () => {
    assert.equal(repositoryProblems({}, cli).length, 1)
    assert.equal(
      repositoryProblems(
        repository('git+https://github.com/other/compadr.git', 'packages/cli'),
        cli
      ).length,
      1
    )
    assert.equal(
      repositoryProblems(repository(REPOSITORY_URL, 'packages/console'), cli)
        .length,
      1
    )
  })
})

describe('archiveManifest', () => {
  const engines = { node: '>=24' }
  const bundle = DISTRIBUTABLES.find(d => d.dir === 'cli')
  const library = DISTRIBUTABLES.find(d => d.dir === 'format')

  it('keeps the public fields of a bundle, without private or dependencies', () => {
    const manifest = archiveManifest(
      {
        name: '@compadr/cli',
        private: true,
        version: '1.0.0',
        description: 'A command line.',
        keywords: ['adr'],
        homepage: 'https://compadr.io',
        repository: {
          type: 'git',
          url: REPOSITORY_URL,
          directory: 'packages/cli',
        },
        bugs: { email: 'contact@compadr.io' },
        license: 'FSL-1.1-ALv2',
        exports: { './drafts': './src/drafts.ts' },
        dependencies: { '@compadr/engine': 'workspace:*' },
      },
      bundle,
      engines
    )
    assert.deepEqual(manifest, {
      name: '@compadr/cli',
      version: '1.0.0',
      description: 'A command line.',
      keywords: ['adr'],
      homepage: 'https://compadr.io',
      repository: {
        type: 'git',
        url: REPOSITORY_URL,
        directory: 'packages/cli',
      },
      bugs: { email: 'contact@compadr.io' },
      license: 'FSL-1.1-ALv2',
      engines,
    })
  })

  it('gives a library its built exports and keeps its dependencies', () => {
    const manifest = archiveManifest(
      {
        name: '@compadr/format',
        private: true,
        version: '1.0.0',
        license: 'Apache-2.0',
        exports: {
          '.': './src/index.ts',
          './a.schema.json': './schema/a.schema.json',
        },
        dependencies: { zod: '^4.0.0' },
      },
      library,
      engines
    )
    assert.equal(manifest.private, undefined)
    assert.equal(manifest.types, './dist/index.d.ts')
    assert.deepEqual(manifest.exports, {
      '.': { types: './dist/index.d.ts', default: './dist/index.js' },
      './a.schema.json': './schema/a.schema.json',
    })
    assert.deepEqual(manifest.dependencies, { zod: '^4.0.0' })
  })

  it('refuses a library that depends on a workspace package', () => {
    assert.throws(
      () =>
        archiveManifest(
          {
            name: '@compadr/format',
            dependencies: { '@compadr/engine': 'workspace:*' },
          },
          library,
          engines
        ),
      /depends on @compadr\/engine in the workspace/
    )
  })
})
