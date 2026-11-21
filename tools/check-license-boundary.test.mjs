import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { checkBoundary } from './check-license-boundary.mjs'

const TEXTS = {
  'Apache-2.0': '\n                                 Apache License\n',
  'FSL-1.1-ALv2':
    '# Functional Source License, Version 1.1, ALv2 Future License\n',
  'LicenseRef-FCL-1.0-ALv2':
    '# Fair Core License, Version 1.0, ALv2 Future License\n',
}

function pkg(name, license, { deps = {}, imports = [], licenseText } = {}) {
  return {
    dir: name.replace('@compadr/', ''),
    manifest: { name, license, dependencies: deps },
    licenseText: licenseText === undefined ? TEXTS[license] : licenseText,
    imports,
  }
}

const format = pkg('@compadr/format', 'Apache-2.0')
const engine = pkg('@compadr/engine', 'FSL-1.1-ALv2')
const tokens = pkg('@compadr/tokens', 'LicenseRef-FCL-1.0-ALv2')

describe('checkBoundary', () => {
  it('accepts dependencies towards the same or a lower layer', () => {
    const cli = pkg('@compadr/cli', 'FSL-1.1-ALv2', {
      deps: {
        '@compadr/format': 'workspace:*',
        '@compadr/engine': 'workspace:*',
      },
      imports: ['@compadr/format', '@compadr/engine'],
    })
    const console = pkg('@compadr/console', 'LicenseRef-FCL-1.0-ALv2', {
      deps: { '@compadr/cli': 'workspace:*', '@compadr/tokens': 'workspace:*' },
    })
    assert.deepEqual(checkBoundary([format, engine, tokens, cli, console]), [])
  })

  it('refuses a dependency of the format on the engine', () => {
    const bad = pkg('@compadr/format', 'Apache-2.0', {
      deps: { '@compadr/engine': 'workspace:*' },
    })
    assert.deepEqual(checkBoundary([bad, engine]), [
      '@compadr/format (Apache-2.0) depends on @compadr/engine (FSL-1.1-ALv2)',
    ])
  })

  it('refuses a dependency of the engine on the tokens', () => {
    const bad = pkg('@compadr/engine', 'FSL-1.1-ALv2', {
      deps: { '@compadr/tokens': 'workspace:*' },
    })
    assert.deepEqual(checkBoundary([bad, tokens]), [
      '@compadr/engine (FSL-1.1-ALv2) depends on @compadr/tokens (LicenseRef-FCL-1.0-ALv2)',
    ])
  })

  it('refuses an import that package.json does not declare', () => {
    const bad = pkg('@compadr/engine', 'FSL-1.1-ALv2', {
      imports: ['@compadr/format'],
    })
    assert.deepEqual(checkBoundary([format, bad]), [
      '@compadr/engine: imports @compadr/format without declaring it',
    ])
  })

  it('refuses a license outside the layers', () => {
    const bad = pkg('@compadr/tokens', 'MIT')
    assert.deepEqual(checkBoundary([bad]), [
      '@compadr/tokens: license "MIT" belongs to no layer',
    ])
  })

  it('refuses a missing or mismatched license file', () => {
    const missing = pkg('@compadr/engine', 'FSL-1.1-ALv2', {
      licenseText: null,
    })
    const wrong = pkg('@compadr/format', 'Apache-2.0', {
      licenseText: TEXTS['FSL-1.1-ALv2'],
    })
    assert.deepEqual(checkBoundary([missing, wrong]), [
      '@compadr/engine: LICENSE.md is missing',
      '@compadr/format: LICENSE is not the Apache-2.0 text',
    ])
  })
})
