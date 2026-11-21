import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  SemanticFindingsSchema,
  semanticFindingsJsonSchema,
} from './semantic-findings.ts'

const commit = 'a'.repeat(40)

const findings = {
  schemaVersion: 1,
  repository: { name: 'shop', commit, adrDir: 'docs/adr' },
  base: 'b'.repeat(40),
  generatedAt: '2026-11-16T10:00:00.000Z',
  model: 'compadr-assist-1',
  promptVersion: 'check-3',
  findings: [
    {
      decision: 11,
      verdict: 'violated',
      quote: 'parameters pinned explicitly',
      evidence: { path: 'src/password.ts', text: '+  timeCost: 1,' },
      explanation: 'The change lowers the cost.',
      title: 'Authentication',
      line: 51,
      notices: [],
    },
  ],
  rejected: 0,
  excluded: [],
}

describe('SemanticFindingsSchema', () => {
  it('reads a findings file', () => {
    expect(SemanticFindingsSchema.parse(findings)).toEqual(findings)
    expect(
      SemanticFindingsSchema.parse({ ...findings, base: null }).base
    ).toBeNull()
  })

  it('refuses another version or a finding without its place', () => {
    expect(
      SemanticFindingsSchema.safeParse({ ...findings, schemaVersion: 2 })
        .success
    ).toBe(false)
    const [finding] = findings.findings
    expect(
      SemanticFindingsSchema.safeParse({
        ...findings,
        findings: [{ ...finding, line: undefined }],
      }).success
    ).toBe(false)
  })

  it('matches the JSON Schema published in schema/', () => {
    expect(semanticFindingsJsonSchema()).toEqual(
      JSON.parse(
        readFileSync(
          new URL('../schema/semantic-findings.schema.json', import.meta.url),
          'utf8'
        )
      )
    )
  })
})
