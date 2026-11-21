import { describe, expect, it } from 'vitest'
import type { DecisionSection } from './record-text.ts'
import {
  decisionRule,
  firstSentence,
  isWeakRule,
  MAX_RULE_LENGTH,
  sectionHeadings,
} from './rule.ts'

const section = (
  markdown: string,
  heading: string | null = null
): DecisionSection => ({ heading, line: 10, markdown })

describe('firstSentence', () => {
  it('takes the first sentence of the first paragraph', () => {
    expect(
      firstSentence([
        section(
          '\nThe generated Prisma client is build output, not source. It lives in `generated/`.\n'
        ),
      ])
    ).toBe('The generated Prisma client is build output, not source.')
  })

  it('does not end a sentence inside a file name or a version', () => {
    expect(
      firstSentence([
        section(
          'The schema stays in `schema.prisma` and follows v1.0.0 of the format. Then more.'
        ),
      ])
    ).toBe(
      'The schema stays in `schema.prisma` and follows v1.0.0 of the format.'
    )
  })

  it('does not end a sentence on an abbreviation before a name', () => {
    expect(
      firstSentence([
        section(
          'The API returns 404 for an unknown user, e.g. Alice or Bob, cf. ADR 3. Then more.'
        ),
      ])
    ).toBe(
      'The API returns 404 for an unknown user, e.g. Alice or Bob, cf. ADR 3.'
    )
  })

  it('keeps the opening of a list without the list', () => {
    expect(
      firstSentence([
        section(
          'One canonical package format, Markdown Package v1: a plain directory, flat YAML.'
        ),
      ])
    ).toBe('One canonical package format, Markdown Package v1')
  })

  it('does not cut on a colon inside code', () => {
    expect(
      firstSentence([
        section(
          'Better Auth with the plugin `emailOTP` (`storeOTP: "hashed"`) and the Prisma adapter for every account.'
        ),
      ])
    ).toBe(
      'Better Auth with the plugin `emailOTP` (`storeOTP: "hashed"`) and the Prisma adapter for every account.'
    )
  })

  it('keeps a short label before a colon', () => {
    expect(
      firstSentence([
        section('Durable target: Cloudflare R2, through an S3 driver.'),
      ])
    ).toBe('Durable target: Cloudflare R2, through an S3 driver.')
  })

  it('reads the first item of a list, without emphasis nor link', () => {
    expect(
      firstSentence([
        section(
          '- **Hashing** with [argon2id](https://example.com), rehashed at sign-in.\n- Sessions are opaque.'
        ),
      ])
    ).toBe('Hashing with argon2id, rehashed at sign-in.')
  })

  it('reads a list item over its indented lines', () => {
    expect(
      firstSentence([
        section(
          '1. **Lingui, one config per app, with no shared lang\n   package.** Each app extracts its own sources.\n2. Other.'
        ),
      ])
    ).toBe('Lingui, one config per app, with no shared lang package.')
  })

  it('drops the number of a bold lead', () => {
    expect(
      firstSentence([
        section(
          '**1. Trois régions, trois rôles, prédictibles.** Le centre est le travail.'
        ),
      ])
    ).toBe('Trois régions, trois rôles, prédictibles.')
  })

  it('keeps a rule about the author, not about how the author decided', () => {
    expect(
      firstSentence([
        section('The author is the sole canon authority. The AI proposes.'),
      ])
    ).toBe('The author is the sole canon authority.')
    expect(
      firstSentence([
        section("L'auteur a pris quatre décisions le 2026-10-25. Le lot suit."),
      ])
    ).toBe(null)
  })

  it('skips code blocks, tables and quotes', () => {
    expect(
      firstSentence([
        section(
          '```ts\nconst a = 1.\n```\n\n| a | b |\n|---|---|\n\n> Note.\n\nEvery job keeps one provider from start to end.'
        ),
      ])
    ).toBe('Every job keeps one provider from start to end.')
  })

  it('has no rule when the first sentence cannot stand alone', () => {
    expect(firstSentence([section('Trois rôles, une seule liste.')])).toBe(null)
    expect(
      firstSentence([section('Cet ADR remplace les décisions 1 et 2.')])
    ).toBe(null)
    expect(firstSentence([section('Four pieces, deliberately small:')])).toBe(
      null
    )
  })

  it('moves to the next subsection when one has no text', () => {
    expect(
      firstSentence([
        section('', '1. Scope'),
        section('Each job keeps one provider from its start to its end.'),
      ])
    ).toBe('Each job keeps one provider from its start to its end.')
  })

  it('shortens a long sentence on a word', () => {
    const long = `${'word '.repeat(80)}end.`
    const rule = firstSentence([section(long)])!
    expect(rule.length).toBeLessThanOrEqual(MAX_RULE_LENGTH)
    expect(rule.endsWith('word…')).toBe(true)
  })
})

describe('decisionRule', () => {
  it('prefers the declared rule', () => {
    expect(
      decisionRule('Only admins list the directory.', [
        section('Something else entirely, said at length here.'),
      ])
    ).toEqual({ text: 'Only admins list the directory.', source: 'declared' })
  })

  it('falls back to the first sentence, then to nothing', () => {
    expect(
      decisionRule(null, [
        section('The editor runtime is isolated behind a boundary.'),
      ])
    ).toEqual({
      text: 'The editor runtime is isolated behind a boundary.',
      source: 'first-sentence',
    })
    expect(decisionRule(null, [section('Le lot J3-2 les applique.')])).toBe(
      null
    )
    expect(decisionRule('  ', [])).toBe(null)
  })
})

describe('isWeakRule', () => {
  it('names the rules too short or about the record', () => {
    expect(isWeakRule('Use Lingui.')).toBe(true)
    expect(isWeakRule('This ADR replaces the first two decisions.')).toBe(true)
    expect(isWeakRule('The AI proposes; the author decides.')).toBe(false)
  })
})

describe('sectionHeadings', () => {
  it('lists the headings without their numbering', () => {
    expect(
      sectionHeadings([
        section('Intro.'),
        section('a', '1. Portée'),
        section('b', '2) Deux ports étroits dans `provider/`'),
        section('c', '**Un sélecteur**'),
      ])
    ).toEqual(['Portée', 'Deux ports étroits dans `provider/`', 'Un sélecteur'])
  })
})
