import type { DriftReport } from '@compadr/format'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDriftReport } from './report.ts'
import { createFixtureRepo, type FixtureRepo } from './testing/fixture-repo.ts'
import { zoneRoot } from './zones.ts'

const record = (number: number, decision: string, status = 'accepted') =>
  [
    '---',
    `status: ${status}`,
    '---',
    `# ${number}. Decision ${number}`,
    '',
    '## Decision',
    '',
    decision,
    '',
  ].join('\n')

let fixture: FixtureRepo
let report: DriftReport

beforeAll(async () => {
  fixture = createFixtureRepo([
    {
      date: '2026-01-10T09:00:00Z',
      files: {
        'docs/adr/0001-billing.md': record(
          1,
          'Charges go through `server/billing/charge.ts:1` and `server/billing/refund.ts`.'
        ),
        'docs/adr/0002-server.md': record(2, 'The server starts here.'),
        'docs/adr/0003-mail.md': record(3, 'Mails leave from `server/mail`.'),
        'docs/adr/0004-draft.md': record(
          4,
          'A draft cites `server/jobs/queue.ts`.',
          'proposed'
        ),
        'server/billing/charge.ts': '// ADR-0001\nexport {}\n',
        'server/billing/refund.ts': 'export {}\n',
        'server/billing/tax.ts': 'export {}\n',
        'server/billing/README.md': '# Billing, see ADR-0001\n',
        'server/mail/send.ts': 'export {}\n',
        'server/jobs/queue.ts': 'export {}\n',
        'server/main.ts': '// ADR-0002\nexport {}\n',
        'web/app.ts': 'export {}\n',
      },
    },
  ])
  report = await createDriftReport(fixture.path, { generatorVersion: '0.0.0' })
})

afterAll(() => fixture.remove())

describe('zoneRoot', () => {
  it('stops at the second folder that is not generic', () => {
    expect(zoneRoot('packages/server/src/services/Ai/a.ts')).toBe(
      'packages/server/src/services'
    )
    expect(zoneRoot('server/billing/charge.ts')).toBe('server/billing')
    expect(zoneRoot('web/app.ts')).toBe('web')
    expect(zoneRoot('README.md')).toBe('.')
  })
})

describe('computeZones', () => {
  it('splits a folder whose subfolders hold linked files', () => {
    const zones = report.zones!.map(z => [z.path, z.own, z.coverage])
    expect(zones).toEqual([
      // main.ts cites ADR 0002, without being cited by it: partial.
      ['server', false, 'partial'],
      ['server/billing', false, 'strong'],
      ['server/jobs', false, 'none'],
      ['server/mail', false, 'folder-only'],
      ['web', false, 'none'],
    ])
  })

  it('counts the linked files, both ways and the weights', () => {
    const billing = report.zones!.find(z => z.path === 'server/billing')
    // charge.ts: its lines (2), it cites the record (2), both ways (2);
    // refund.ts: cited (1); tax.ts: nothing. README.md is not code.
    expect(billing).toEqual({
      path: 'server/billing',
      own: false,
      files: 3,
      linkedFiles: 2,
      crossChecked: 1,
      weight: 7,
      decisions: [{ number: 1, weight: 7 }],
      folderCited: [],
      coverage: 'strong',
    })
  })

  it('marks a zone by the folder that a decision in force cites in it', () => {
    const mail = report.zones!.find(z => z.path === 'server/mail')
    expect(mail).toMatchObject({ linkedFiles: 0, folderCited: [3] })
    // A proposed decision does not reach a zone.
    expect(report.zones!.find(z => z.path === 'server/jobs')).toMatchObject({
      linkedFiles: 0,
      folderCited: [],
      decisions: [],
    })
  })
})

describe('a cited folder above split zones', () => {
  let nested: FixtureRepo | undefined
  afterAll(() => nested?.remove())

  it('marks the zone of its own files, not the zones of its subfolders', async () => {
    nested = createFixtureRepo([
      {
        date: '2026-01-10T09:00:00Z',
        files: {
          'docs/adr/0001-billing.md': record(
            1,
            'Billing lives in `server/billing`, see `server/billing/charges/a.ts` and `server/billing/refunds/b.ts`.'
          ),
          'server/billing/index.ts': 'export {}\n',
          'server/billing/charges/a.ts': 'export {}\n',
          'server/billing/refunds/b.ts': 'export {}\n',
        },
      },
    ])
    const zones = (
      await createDriftReport(nested.path, { generatorVersion: '0.0.0' })
    ).zones!.map(z => [z.path, z.own, z.folderCited, z.coverage])
    expect(zones).toEqual([
      ['server/billing', true, [1], 'folder-only'],
      ['server/billing/charges', false, [], 'partial'],
      ['server/billing/refunds', false, [], 'partial'],
    ])
  })
})
