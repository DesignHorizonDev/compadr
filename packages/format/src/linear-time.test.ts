// Records, compadr.yml and features.yml come from the analysed repository,
// whoever wrote them. Each reading stays linear in the size of the text: a
// hostile text of 200,000 characters is read in well under a second.
import { describe, expect, it } from 'vitest'
import { acceptRecordStatus } from './status-edit.ts'
import { normalizeQuote, quoteAppearsIn } from './assist.ts'
import { parseCompadrConfig } from './config.ts'
import { parseFeatureGlossary } from './features.ts'
import { parseAdr } from './parse-adr.ts'
import { locateQuote, readDecisionText } from './record-text.ts'
import { firstSentence } from './rule.ts'
import { normalizeStatus } from './status.ts'
import { parseYaml } from './yaml.ts'

const N = 200_000
const LIMIT_MS = 1_000

function timed(run: () => unknown): number {
  const start = performance.now()
  run()
  return performance.now() - start
}

const hostile: [string, () => unknown][] = [
  [
    'a Status line of spaces',
    () => parseAdr('0001-a.md', `# T\n\nStatus:${' '.repeat(N)}\n`),
  ],
  [
    'a Date line of spaces',
    () => parseAdr('0001-a.md', `# T\n\nDate:${' '.repeat(N)}\n`),
  ],
  [
    'a Deciders line of spaces',
    () => parseAdr('0001-a.md', `# T\n\nDeciders:${' '.repeat(N)}\n`),
  ],
  [
    'an amendment heading of spaces',
    () => parseAdr('0001-a.md', `# T\n\n## ${' '.repeat(N)}x\n`),
  ],
  [
    'a status of repeated negations',
    () => normalizeStatus('not accept '.repeat(N / 10)),
  ],
  [
    'a frontmatter of many keys',
    () =>
      parseAdr(
        '0001-a.md',
        `---\n${Array.from({ length: N / 10 }, (_, i) => `k${i}: 1`).join('\n')}\n---\n# T\n`
      ),
  ],
  [
    'a compadr.yml of many keys',
    () =>
      parseCompadrConfig(
        Array.from({ length: N / 10 }, (_, i) => `k${i}: 1`).join('\n')
      ),
  ],
  [
    'a features.yml of many keys',
    () =>
      parseFeatureGlossary(
        Array.from({ length: N / 10 }, (_, i) => `k${i}: 1`).join('\n')
      ),
  ],
  [
    'a status value closed by many stars',
    () =>
      acceptRecordStatus(
        `# T\n\nStatus: proposed${'*'.repeat(N)}x\n`,
        '2026-01-01'
      ),
  ],
  [
    'a status section after a line of spaces',
    () =>
      acceptRecordStatus(
        `# T\n\nStatus:${' '.repeat(N)}\n\n## Status\n\nproposed\n`,
        '2026-01-01'
      ),
  ],
  [
    'a run of opening guillemets',
    () =>
      readDecisionText(
        `# T\n\nremplace ADR-0001 ${'«'.repeat(N)}\n\n## Decision\nx\n`
      ),
  ],
  [
    'an opening guillemet and spaces',
    () =>
      readDecisionText(
        `# T\n\nremplace ADR-0001 «${' '.repeat(N)}\n\n## Decision\nx\n`
      ),
  ],
  [
    'many quotes on one line',
    () =>
      readDecisionText(
        `# T\n\nremplace ADR-0001 ${'"a b c d" '.repeat(N / 10)}\n\n## Decision\nx\n`
      ),
  ],
  [
    'a run of empty lines in a quote',
    () => normalizeQuote(`${'\n'.repeat(N)}x`),
  ],
  [
    'a quote looked for after empty lines',
    () => quoteAppearsIn('a quote long enough', `${'\n'.repeat(N)}x`),
  ],
  [
    'a run of opening brackets',
    () => firstSentence([{ heading: null, line: 1, markdown: '['.repeat(N) }]),
  ],
  [
    'a quote with an ellipsis and a missing end',
    () => locateQuote('a'.repeat(N), 'a … zzzz'),
  ],
  [
    'a quote with an ellipsis and a far end',
    () => locateQuote(`${'a'.repeat(N)}b`, 'a … b'),
  ],
]

describe('reading a hostile text', () => {
  for (const [name, run] of hostile) {
    it(`reads ${name} in linear time`, () => {
      expect(timed(run)).toBeLessThan(LIMIT_MS)
    })
  }
})

describe('reading a run of links without a closing parenthesis', () => {
  it('reads it in linear time', () => {
    expect(
      timed(() =>
        firstSentence([
          { heading: null, line: 1, markdown: '[a]('.repeat(N / 4) },
        ])
      )
    ).toBeLessThan(LIMIT_MS)
  })
})

describe('readings that changed', () => {
  it('reads the inner link of a text that opens a bracket before it', () => {
    expect(
      firstSentence([
        {
          heading: null,
          line: 1,
          markdown: 'Use [pas [x](y) here for all calls.',
        },
      ])
    ).toContain('[pas x here')
  })

  it('reads no quote that holds its own opening mark', () => {
    const text = readDecisionText(
      '# T\n\nThis replaces ADR-0001 « one « two three four five ».\n\n## Decision\n\nx\n'
    )
    expect(JSON.stringify(text)).not.toContain('one « two')
  })

  it('reads no negation beyond the spaces it can reach', () => {
    expect(normalizeStatus(`not${' '.repeat(5)}accepted`)).toBe('unknown')
    expect(normalizeStatus(`not${' '.repeat(50)}accepted`)).toBe('accepted')
  })
})

describe('keys of a YAML map, as in yaml 2.9', () => {
  it('refuses a merge key given twice, and accepts NaN twice', () => {
    expect(() => parseYaml('<<: 1\n<<: 2\n')).toThrow('Map keys must be unique')
    expect(parseYaml('.nan: 1\n.nan: 2\n')).toEqual({ NaN: 2 })
  })

  it('gives the first error of the text first', () => {
    expect(() => parseYaml('b: 1\nb: 2\nc: [1\n')).toThrow(
      'Map keys must be unique'
    )
  })
})

describe('readings kept as they were', () => {
  it('reads the status after stars and spaces', () => {
    expect(
      parseAdr('0001-a.md', '# T\n\n- **Status:** ** Accepted\n')?.status
    ).toBe('accepted')
    expect(
      parseAdr('0001-a.md', '# T\n\n- **Statut** : acceptée\n')?.status
    ).toBe('accepted')
  })

  it('reads a negation before the keyword', () => {
    expect(normalizeStatus('not accepted, proposed')).toBe('proposed')
    expect(normalizeStatus('no longer   accepted; deprecated')).toBe(
      'deprecated'
    )
  })

  it('keeps the marks that close a status value', () => {
    expect(
      acceptRecordStatus('# T\n\n- **Status:** Proposed**  \n', '2026-01-02')
    ).toBe('# T\n\n- **Status:** Accepted (2026-01-02)**  \n')
    expect(
      acceptRecordStatus('# T\n\n## Status\n\nProposed  \n', '2026-01-02')
    ).toBe('# T\n\n## Status\n\nAccepted (2026-01-02)  \n')
  })

  it('still refuses a key that a map holds twice', () => {
    expect(
      parseCompadrConfig(
        'assist:\n  semantic: true\nassist:\n  semantic: false\n'
      ).problems
    ).toEqual([expect.stringContaining('Map keys must be unique')])
    expect(
      parseFeatureGlossary('a:\n  label: A\na:\n  label: B\n').problems
    ).toEqual([expect.stringContaining('Map keys must be unique')])
  })
})
