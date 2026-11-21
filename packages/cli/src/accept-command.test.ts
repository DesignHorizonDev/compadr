import { createDriftReport } from '@compadr/engine'
import { createFixtureRepo, type FixtureRepo } from '@compadr/engine/testing'
import type { DriftReport } from '@compadr/format'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildAcceptCorrection } from './accept-command.ts'

let fixture: FixtureRepo
let report: DriftReport

beforeAll(async () => {
  fixture = createFixtureRepo([
    {
      date: '2026-01-10T09:00:00Z',
      files: {
        'docs/adr/0001-pool.md':
          '# ADR 0001 — Le pool de la base\n\n- **Statut** : acceptée\n\n## Décision\n\nUn pool.\n',
        'docs/adr/0002-relances.md':
          '# ADR 0002 — Les relances des tâches\n\n- **Statut** : proposée\n\n## Décision\n\nTrois relances.\n',
        'src/relances.ts': '// ADR-0002\nexport const relances = 3\n',
      },
    },
  ])
  report = await createDriftReport(fixture.path, { generatorVersion: '0.0.0' })
})
afterAll(() => fixture.remove())

const read = (file: string) =>
  Promise.resolve(fixture.git('show', `HEAD:${file}`))

describe('buildAcceptCorrection', () => {
  it('accepts a proposed decision in the language of the records', async () => {
    const correction = await buildAcceptCorrection(
      fixture.path,
      report,
      {
        decision: 2,
        date: '2026-11-17',
        recommendation: {
          recommendation: 'accept',
          model: 'compadr-assist-1',
          promptVersion: 'accept-1',
        },
      },
      read
    )
    expect(correction.title).toBe("docs(adr): accepter l'ADR 0002")
    expect(correction.branch).toMatch(/^compadr\/accept-0002-[0-9a-f]{8}$/)
    expect(correction.body).toBe(
      `Une personne accepte l'ADR 0002, proposé jusqu'au commit ${report.repository.commit.slice(0, 8)}. 1 fichier du code le citait déjà. Le service d'assistance l'a recommandé (compadr-assist-1, accept-1).`
    )
    expect([...correction.files.keys()]).toEqual(['docs/adr/0002-relances.md'])
    expect(correction.files.get('docs/adr/0002-relances.md')).toContain(
      '- **Statut** : acceptée (2026-11-17)'
    )
  })

  it('refuses a decision that is not proposed, or another recommendation', async () => {
    await expect(
      buildAcceptCorrection(
        fixture.path,
        report,
        { decision: 1, date: '2026-11-17' },
        read
      )
    ).rejects.toThrow('ADR 0001 is accepted, not proposed')
    await expect(
      buildAcceptCorrection(
        fixture.path,
        report,
        { decision: 9, date: '2026-11-17' },
        read
      )
    ).rejects.toThrow('no decision 9')
    await expect(
      buildAcceptCorrection(
        fixture.path,
        report,
        {
          decision: 2,
          date: '2026-11-17',
          recommendation: {
            recommendation: 'keep-proposed',
            model: 'm',
            promptVersion: 'p',
          },
        },
        read
      )
    ).rejects.toThrow('the recommendation is keep-proposed, not accept')
  })
})
