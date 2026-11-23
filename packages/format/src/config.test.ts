import { describe, expect, it } from 'vitest'
import { excludedFromAssist, parseCompadrConfig } from './config.ts'

describe('parseCompadrConfig', () => {
  it('reads the rule policy', () => {
    expect(parseCompadrConfig('rules:\n  policy: required\n')).toEqual({
      rulePolicy: 'required',
      assist: { semantic: false, exclude: [] },
      problems: [],
    })
  })

  it('keeps the default without a file or a setting', () => {
    for (const text of ['', '# nothing yet\n', 'rules:\n', 'other: 1\n']) {
      expect(parseCompadrConfig(text)).toEqual({
        rulePolicy: 'preferred',
        assist: { semantic: false, exclude: [] },
        problems: [],
      })
    }
  })

  it('names a setting that it cannot read', () => {
    expect(parseCompadrConfig('rules:\n  policy: always\n')).toEqual({
      rulePolicy: 'preferred',
      assist: { semantic: false, exclude: [] },
      problems: [
        'compadr.yml: rules.policy is "always", not one of derived, preferred, required',
      ],
    })
    expect(parseCompadrConfig('rules: required\n').problems).toEqual([
      'compadr.yml: rules is not a map',
    ])
    expect(parseCompadrConfig('- a\n').problems).toEqual([
      'compadr.yml is not a map',
    ])
    expect(parseCompadrConfig('rules: [\n').problems[0]).toMatch(
      /^compadr\.yml is not valid YAML/
    )
  })

  it('turns the semantic check on, with the paths it never sends', () => {
    const config = parseCompadrConfig(
      'rules:\n  policy: required\nassist:\n  semantic: true\n  exclude:\n    - ./config/secrets/\n    - src/keys.ts\n'
    )
    expect(config).toEqual({
      rulePolicy: 'required',
      assist: { semantic: true, exclude: ['config/secrets', 'src/keys.ts'] },
      problems: [],
    })
    expect(excludedFromAssist(config.assist, 'config/secrets/prod.yml')).toBe(
      true
    )
    expect(excludedFromAssist(config.assist, 'src/keys.ts')).toBe(true)
    expect(excludedFromAssist(config.assist, 'config/secrets-old.yml')).toBe(
      false
    )
    expect(excludedFromAssist(config.assist, 'src/keys.test.ts')).toBe(false)
  })

  it('keeps the semantic check off when assist.exclude holds a pattern', () => {
    for (const pattern of [
      'src/*.ts',
      '**/*.key',
      'src/[ab].ts',
      'src/?.ts',
      'src/{a,b}',
    ]) {
      const config = parseCompadrConfig(
        `assist:\n  semantic: true\n  exclude:\n    - private/\n    - "${pattern}"\n`
      )
      expect(config.assist).toEqual({ semantic: false, exclude: [] })
      expect(config.problems).toEqual([
        `compadr.yml: assist.exclude holds the pattern ${JSON.stringify(pattern)}, but it lists paths and folders, not patterns, so the semantic check stays off`,
      ])
    }
  })

  it('keeps the semantic check off when a setting of assist cannot be read', () => {
    for (const text of [
      'assist:\n  semantic: yes please\n',
      'assist:\n  semantic: true\n  exclude: config/secrets\n',
      'assist:\n  semantic: true\n  exclude: [1]\n',
      'assist: true\n',
    ]) {
      const config = parseCompadrConfig(text)
      expect(config.assist.semantic).toBe(false)
      expect(config.problems).toHaveLength(1)
    }
  })
})
