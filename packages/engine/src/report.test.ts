import { DriftReportSchema } from '@compadr/format'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDriftReport } from './report.ts'
import { createFixtureRepo, type FixtureRepo } from './testing/fixture-repo.ts'

let fixture: FixtureRepo

beforeAll(() => {
  fixture = createFixtureRepo([
    {
      date: '2026-01-10T09:00:00Z',
      files: {
        'decisions/0001-base.md':
          '# 1. Base\n\nStatus: accepted\n\nUses `src/main.ts`.\n',
        'decisions/0002-detail.md':
          '# 2. Detail\n\nStatus: accepted\nAmends ADR-0001\n',
        'src/main.ts': 'export {}\n',
      },
    },
  ])
})

afterAll(() => fixture.remove())

describe('createDriftReport', () => {
  it('loads no grammar when no reference names a symbol or cites lines', async () => {
    const report = await createDriftReport(fixture.path, {
      adrDir: 'decisions',
      generatorVersion: '1.2.3',
      locateWasm: () => {
        throw new Error('the grammars should not load')
      },
    })
    expect(report.decisions).toHaveLength(2)
  })

  it('returns a report that follows the published schema', async () => {
    const report = await createDriftReport(`${fixture.path}/`, {
      adrDir: 'decisions',
      generatorVersion: '1.2.3',
      now: new Date('2026-10-31T10:20:30.456Z'),
    })
    expect(DriftReportSchema.safeParse(report).success).toBe(true)
    // Each path reference says whether an anchor can be proposed.
    for (const reference of report.references) {
      if (reference.kind === 'path') expect(reference.proposal).toBeNull()
    }
    expect(report).toMatchObject({
      schemaVersion: 2,
      generator: { name: 'compadr', version: '1.2.3' },
      repository: {
        name: fixture.path.slice(fixture.path.lastIndexOf('/') + 1),
        ref: 'HEAD',
        commit: fixture.git('rev-parse', 'HEAD').trim(),
        adrDir: 'decisions',
      },
      generatedAt: '2026-10-31T10:20:30Z',
      families: [{ principal: 1, details: [2], principalIsDetail: false }],
    })
    expect(report.decisions.map(d => d.number)).toEqual([1, 2])
    expect(report.signals.map(s => s.type)).toEqual(['decision-without-code'])
  })

  it('uses the name given by the caller', async () => {
    const report = await createDriftReport(fixture.path, {
      adrDir: 'decisions',
      name: 'example',
      generatorVersion: '0.0.0',
    })
    expect(report.repository.name).toBe('example')
  })
})
