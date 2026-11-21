import type { DriftReport } from '@compadr/format'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  checkNotices,
  checkReport,
  generatedFileProblems,
  newProblems,
} from './check.ts'
import { renderAgentsExcerpt, renderIndex } from './generated.ts'
import { createDriftReport } from './report.ts'
import { createFixtureRepo, type FixtureRepo } from './testing/fixture-repo.ts'

const featured = (feature: string, title: string, status: string, body = '') =>
  [
    '---',
    'compadr:',
    `  feature: ${feature}`,
    '---',
    `# ${title}`,
    '',
    `- **Status:** ${status}`,
    '',
    '## Decision',
    '',
    body,
    '',
  ].join('\n')

let fixture: FixtureRepo
let base: DriftReport
let head: DriftReport

beforeAll(async () => {
  fixture = createFixtureRepo([
    {
      date: '2026-01-10T09:00:00Z',
      files: {
        'docs/adr/0001-pool.md': featured(
          'data',
          'ADR 0001 — Pool',
          'Accepted',
          'See `server/pool.ts` and `server/gone.ts`.'
        ),
        'docs/adr/0002-old.md': featured(
          'data',
          'ADR 0002 — Old',
          'Superseded by ADR-0001'
        ),
        'docs/adr/features.yml': 'data:\n  label: Data\n  main: 1\n',
        'server/pool.ts': '// ADR-0002\nexport {}\n',
      },
    },
    {
      date: '2026-02-10T09:00:00Z',
      files: {
        // A line above the references moves them: the check still knows them.
        'docs/adr/0001-pool.md': featured(
          'data',
          'ADR 0001 — Pool',
          'Accepted',
          'Intro.\n\nSee `server/pool.ts` and `server/gone.ts`.'
        ),
        'docs/adr/0003-mail.md':
          '# ADR 0003 — Mail\n\n- **Status:** Accepted\n\n## Decision\n\nUses `server/mail.ts`.\n',
        'docs/adr/0004-later.md':
          '# ADR 0004 — Later\n\n- **Status:** Superseded\n',
        'docs/adr/0005-odd.md': featured('data', 'ADR 0005 — Odd', 'Maybe'),
        'server/pool.ts': '// ADR-0002\n// ADR-0002 again\nexport {}\n',
      },
    },
  ])
  const options = { generatorVersion: '0.0.0' }
  base = await createDriftReport(fixture.path, { ...options, ref: 'HEAD~1' })
  head = await createDriftReport(fixture.path, options)
})

afterAll(() => fixture.remove())

describe('checkReport', () => {
  it('lists the broken signals and the rules of the check', () => {
    expect(
      checkReport(head).map(p => [p.rule, p.decision, p.file, p.line])
    ).toEqual([
      ['path-missing', 1, 'docs/adr/0001-pool.md', 13],
      ['path-missing', 3, 'docs/adr/0003-mail.md', 7],
      ['superseded-decision-cited', 2, 'server/pool.ts', 1],
      ['superseded-decision-cited', 2, 'server/pool.ts', 2],
      ['decision-without-feature', 3, 'docs/adr/0003-mail.md', null],
      ['superseded-without-successor', 4, 'docs/adr/0004-later.md', null],
      ['decision-without-feature', 4, 'docs/adr/0004-later.md', null],
      ['status-unknown', 5, 'docs/adr/0005-odd.md', null],
    ])
  })

  it('names a successor that the folder does not hold', () => {
    const report: DriftReport = {
      ...base,
      decisions: base.decisions.map(d =>
        d.number === 2 ? { ...d, supersededBy: [9] } : d
      ),
    }
    expect(checkReport(report).map(p => p.message)).toContain(
      'ADR 0002 is superseded by ADR 0009, which is not in docs/adr'
    )
  })

  it('asks for no feature when the repository declares none', () => {
    const report: DriftReport = {
      ...head,
      features: (head.features ?? []).map(f => ({
        ...f,
        source: 'proposed' as const,
      })),
    }
    expect(
      checkReport(report).filter(p => p.rule === 'decision-without-feature')
    ).toEqual([])
  })
})

describe('feature declarations', () => {
  let declarations: FixtureRepo | undefined
  afterAll(() => declarations?.remove())

  it('shows a problem of a record on the record, and keys YAML errors without their position', async () => {
    const odd = [
      '---',
      'compadr:',
      '  feature: Odd Name',
      '---',
      '# ADR 0001 — A',
      '',
      '- **Status:** Accepted',
      '',
    ].join('\n')
    declarations = createFixtureRepo([
      {
        date: '2026-01-10T09:00:00Z',
        files: {
          'docs/adr/0001-a.md': odd,
          'docs/adr/features.yml': 'a: [1\n',
        },
      },
      {
        date: '2026-02-10T09:00:00Z',
        files: { 'docs/adr/features.yml': '# Features\n\na: [1\n' },
      },
    ])
    const options = { generatorVersion: '0.0.0' }
    const before = checkReport(
      await createDriftReport(declarations.path, { ...options, ref: 'HEAD~1' })
    )
    const after = checkReport(
      await createDriftReport(declarations.path, options)
    )
    const record = after.find(p => p.message.startsWith('ADR 0001:'))
    expect(record).toMatchObject({
      decision: 1,
      file: 'docs/adr/0001-a.md',
    })
    const yaml = after.find(p => p.message.includes('not valid YAML'))
    expect(yaml?.file).toBe('docs/adr/features.yml')
    expect(newProblems(after, before)).toEqual([])
  })
})

describe('rules of the decisions', () => {
  let rules: FixtureRepo | undefined
  afterAll(() => rules?.remove())

  const record = (title: string, frontmatter: string, decision: string) =>
    [
      '---',
      'status: accepted',
      ...(frontmatter === '' ? [] : ['compadr:', frontmatter]),
      '---',
      `# ${title}`,
      '',
      '## Decision',
      '',
      decision,
      '',
    ].join('\n')

  const reportWith = async (config: string | null) => {
    rules?.remove()
    rules = createFixtureRepo([
      {
        date: '2026-01-10T09:00:00Z',
        files: {
          'docs/adr/0001-declared.md': record(
            '1. Declared',
            '  rule: Only the admins of an activity list its directory.',
            'Trois rôles.'
          ),
          'docs/adr/0002-derived.md': record(
            '2. Derived',
            '',
            'Every job keeps one provider from its start to its end.'
          ),
          'docs/adr/0003-none.md': record(
            '3. None',
            '',
            'Le lot les applique.'
          ),
          'docs/adr/0004-weak.md': record(
            '4. Weak',
            '  rule: Use Lingui.',
            'Lingui, one config per app, no shared package.'
          ),
          ...(config === null ? {} : { 'docs/adr/compadr.yml': config }),
        },
      },
    ])
    return createDriftReport(rules.path, { generatorVersion: '0.0.0' })
  }
  const listed = (problems: ReturnType<typeof checkReport>) =>
    problems
      .filter(p => p.rule.startsWith('rule-') || p.rule === 'config-invalid')
      .map(p => [p.rule, p.decision])

  it('puts the rule of each decision in the report', async () => {
    const report = await reportWith(null)
    expect(report.rulePolicy).toBe('preferred')
    expect(report.decisions.map(d => d.rule)).toEqual([
      {
        text: 'Only the admins of an activity list its directory.',
        source: 'declared',
      },
      {
        text: 'Every job keeps one provider from its start to its end.',
        source: 'first-sentence',
      },
      null,
      { text: 'Use Lingui.', source: 'declared' },
    ])
  })

  it('gives notices under the default policy, without failing', async () => {
    const report = await reportWith(null)
    expect(listed(checkReport(report))).toEqual([])
    expect(listed(checkNotices(report))).toEqual([
      ['rule-missing', 3],
      ['rule-weak', 4],
    ])
  })

  it('fails on a decision without compadr.rule under the policy required', async () => {
    const report = await reportWith('rules:\n  policy: required\n')
    expect(listed(checkReport(report))).toEqual([
      ['rule-missing', 2],
      ['rule-missing', 3],
    ])
    expect(listed(checkNotices(report))).toEqual([['rule-weak', 4]])
  })

  it('says nothing under the policy derived', async () => {
    const report = await reportWith('rules:\n  policy: derived\n')
    expect(listed(checkReport(report))).toEqual([])
    expect(checkNotices(report)).toEqual([])
  })

  it('fails on a setting that it cannot read, and keeps its default', async () => {
    const report = await reportWith('rules:\n  policy: always\n')
    expect(report.rulePolicy).toBe('preferred')
    expect(
      checkReport(report).find(p => p.rule === 'config-invalid')
    ).toMatchObject({
      file: 'docs/adr/compadr.yml',
      decision: null,
    })
  })
})

describe('length of the records', () => {
  let long: FixtureRepo | undefined
  afterAll(() => long?.remove())

  it('gives a notice on a long record and a long decision, whatever the rule policy', async () => {
    const record = (title: string, decision: string, extra = '') =>
      [
        '---',
        'status: accepted',
        'compadr:',
        '  rule: A rule that stands alone, so that no other notice shows.',
        '---',
        `# ${title}`,
        '',
        '## Decision',
        '',
        decision,
        '',
        extra,
      ].join('\n')
    long = createFixtureRepo([
      {
        date: '2026-01-10T09:00:00Z',
        files: {
          'docs/adr/0001-long.md': record(
            '1. Long',
            'Short decision.',
            '## Inventory\n\n' + 'A line of inventory.\n'.repeat(400)
          ),
          'docs/adr/0002-wide.md': record('2. Wide', 'word '.repeat(2500)),
          'docs/adr/0003-fine.md': record('3. Fine', 'A short decision.'),
          'docs/adr/compadr.yml': 'rules:\n  policy: derived\n',
        },
      },
    ])
    const report = await createDriftReport(long.path, {
      generatorVersion: '0.0.0',
    })
    expect(checkNotices(report).map(n => [n.rule, n.decision])).toEqual([
      ['record-too-long', 1],
      ['decision-text-too-long', 2],
    ])
    // A notice never fails the check.
    expect(
      checkReport(report).filter(p => p.rule.endsWith('-too-long'))
    ).toEqual([])
  })
})

describe('proposed decisions that the code cites', () => {
  let repo: FixtureRepo | undefined
  afterAll(() => repo?.remove())

  it('gives a notice on a proposed decision that a file of the code cites', async () => {
    const record = (title: string, status: string) =>
      [
        '---',
        `status: ${status}`,
        'compadr:',
        '  rule: A rule that stands alone, so that no other notice shows.',
        '---',
        `# ${title}`,
        '',
        '## Decision',
        '',
        'A short decision.',
        '',
      ].join('\n')
    repo = createFixtureRepo([
      {
        date: '2026-01-10T09:00:00Z',
        files: {
          'docs/adr/0001-kept.md': record('1. Kept', 'accepted'),
          'docs/adr/0002-applied.md': record('2. Applied', 'proposed'),
          'docs/adr/0003-waiting.md': record('3. Waiting', 'proposed'),
          'docs/adr/0004-guide.md': record('4. Guide', 'proposed'),
          'server/a.ts': '// ADR-0001 ADR-0002\nexport {}\n',
          'server/b.ts': '// ADR-0002\nexport {}\n',
          'docs/guide.md': 'See ADR-0004.\n',
        },
      },
    ])
    const report = await createDriftReport(repo.path, {
      generatorVersion: '0.0.0',
    })
    expect(checkNotices(report)).toEqual([
      {
        rule: 'proposed-applied',
        decision: 2,
        file: 'docs/adr/0002-applied.md',
        line: null,
        message:
          'ADR 0002 is proposed, and 2 files of the code cite it: if the code applies the decision, accept it, or say in the record why it waits',
        key: 'proposed-applied:0002',
      },
    ])
    expect(checkReport(report).filter(p => p.decision === 2)).toEqual([])
  })
})

describe('newProblems', () => {
  it('keeps only what the base does not have, line moves aside', () => {
    expect(
      newProblems(checkReport(head), checkReport(base)).map(p => [
        p.rule,
        p.decision,
      ])
    ).toEqual([
      ['path-missing', 3],
      // The base cites 0002 once in this file; the second citation is new.
      ['superseded-decision-cited', 2],
      ['decision-without-feature', 3],
      ['superseded-without-successor', 4],
      ['decision-without-feature', 4],
      ['status-unknown', 5],
    ])
  })
})

describe('generatedFileProblems', () => {
  it('reads a generated file with CRLF line endings', () => {
    const files = new Map([
      ['docs/adr/INDEX.md', renderIndex(head).replace(/\n/g, '\r\n')],
      ['AGENTS.md', renderAgentsExcerpt(head).replace(/\n/g, '\r\n')],
    ])
    expect(generatedFileProblems(head, files)).toEqual([])
  })

  it('names the command that rewrites each stale excerpt', () => {
    const old = '<!-- compadr:start -->\nOld.\n<!-- compadr:end -->\n'
    const files = new Map([
      ['AGENTS.md', `# Agents\n\n${old}`],
      ['CLAUDE.md', `# Claude\n\n${old}`],
    ])
    expect(
      generatedFileProblems(head, files).map(p => [p.file, p.message])
    ).toEqual([
      [
        'AGENTS.md',
        'AGENTS.md no longer matches the decision records: run compadr agents',
      ],
      [
        'CLAUDE.md',
        'CLAUDE.md no longer matches the decision records: run compadr agents --file CLAUDE.md',
      ],
    ])
  })
})
