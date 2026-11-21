import { renderAgentsExcerpt, renderIndex } from '@compadr/engine'
import { createFixtureRepo, type FixtureRepo } from '@compadr/engine/testing'
import type { DriftReport } from '@compadr/format'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { main } from './main.ts'

const record = (number: number, title: string, feature: string) =>
  [
    '---',
    'compadr:',
    `  feature: ${feature}`,
    `  rule: ${title} suit la règle commune des mails de l'équipe.`,
    '---',
    `# ADR ${String(number).padStart(4, '0')} — ${title}`,
    '',
    '- **Statut :** Acceptée',
    '',
  ].join('\n')

let fixture: FixtureRepo

function commit(files: Record<string, string>) {
  for (const [file, content] of Object.entries(files)) {
    writeFileSync(join(fixture.path, file), content)
    fixture.git('add', '--', file)
  }
  fixture.git('commit', '-q', '-m', 'change')
}

async function run(argv: string[]) {
  const out: string[] = []
  const err: string[] = []
  const code = await main(argv, {
    out: line => out.push(line),
    err: line => err.push(line),
  })
  return { code, out: out.join('\n'), err: err.join('\n') }
}

async function report(ref = 'HEAD'): Promise<DriftReport> {
  const { out } = await run(['drift', fixture.path, '--ref', ref])
  return JSON.parse(out) as DriftReport
}

beforeAll(async () => {
  fixture = createFixtureRepo([
    {
      date: '2026-01-10T09:00:00Z',
      files: {
        'docs/adr/0001-adresse.md': record(1, 'Adresse de réponse', 'mails'),
        'docs/adr/0002-rappel.md': record(2, 'Rappel des adresses', 'mails'),
        'docs/adr/features.yml': 'mails:\n  label: Mails\n  main: 1\n',
        'AGENTS.md': '# Agents\n',
      },
    },
  ])
  // The branches of the corrections take the identity of the repository.
  fixture.git('config', 'user.name', 'Compadr')
  fixture.git('config', 'user.email', 'fixture@example.com')
  // A second commit holds the generated files, up to date.
  const current = await report()
  commit({
    'docs/adr/INDEX.md': renderIndex(current),
    'AGENTS.md': `# Agents\n\n${renderAgentsExcerpt(current)}`,
  })
})

afterAll(() => fixture.remove())

describe('compadr index', () => {
  it('shows the index in the language of the records', async () => {
    const { code, out, err } = await run([
      'index',
      fixture.path,
      '--ref',
      'HEAD~1',
    ])
    expect(code).toBe(0)
    expect(out).toContain('docs(adr): lister les décisions en vigueur')
    expect(out).toContain('+# Décisions en vigueur')
    expect(out).toContain(
      '+- [0001](0001-adresse.md) Adresse de réponse (décision principale)'
    )
    expect(err).toContain('Nothing was pushed')
  })

  it('says when the index is up to date', async () => {
    const { code, err } = await run(['index', fixture.path])
    expect(code).toBe(0)
    expect(err).toMatch(/^✔ docs\/adr\/INDEX\.md is up to date at [0-9a-f]{8}$/)
  })
})

describe('compadr map', () => {
  it('shows the memory card in the language of the records', async () => {
    const { code, out, err } = await run(['map', fixture.path])
    expect(code).toBe(0)
    expect(out).toContain(
      'docs(adr): cartographier les décisions pour les agents'
    )
    expect(out).toContain('+# Mémoire des décisions')
    expect(out).toContain('+- Mails : 0001 Adresse de réponse.')
    expect(err).toContain('Nothing was pushed')
  })
})

describe('compadr agents', () => {
  it('appends the excerpt to AGENTS.md', async () => {
    const { code, out } = await run(['agents', fixture.path, '--ref', 'HEAD~1'])
    expect(code).toBe(0)
    expect(out).toContain('+<!-- compadr:start -->')
    expect(out).toContain('+- Mails: 0001 Adresse de réponse')
  })

  it('writes in the file named by --file', async () => {
    const { out } = await run([
      'agents',
      fixture.path,
      '--ref',
      'HEAD~1',
      '--file',
      'CLAUDE.md',
    ])
    expect(out).toContain('CLAUDE.md')
  })
})

describe('compadr check and the generated files', () => {
  it('passes while the generated files match the records', async () => {
    const { code, out } = await run(['check', fixture.path])
    expect(out).toBe('✔ No problem')
    expect(code).toBe(0)
  })

  it('fails when a record is missing from the index', async () => {
    commit({
      'docs/adr/0003-classement.md': record(3, 'Module classement', 'mails'),
    })
    const { code, out } = await run(['check', fixture.path, '--base', 'HEAD~1'])
    expect(code).toBe(1)
    expect(out.split('\n')).toEqual([
      'docs/adr/INDEX.md  generated-file-stale  docs/adr/INDEX.md no longer matches the decision records: run compadr index',
      '✖ 1 problem since HEAD~1',
    ])
  })
})
