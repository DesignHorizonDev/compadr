import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ASSIST_SCHEMA_VERSION,
  AssistSuggestionSchema,
  assistRequestJsonSchema,
  assistSuggestionJsonSchema,
  normalizeQuote,
  quoteAppearsIn,
} from './assist.ts'

describe('quoteAppearsIn', () => {
  const text = [
    '1. **The pool keeps at most ten connections.** A request waits for a',
    '   free one; it never opens an eleventh.',
    '',
    "> L'auteur décide, et l’agent propose.",
  ].join('\n')

  it('finds a quote across emphasis, line breaks and typographic apostrophes', () => {
    expect(
      quoteAppearsIn('The pool keeps at most ten connections.', text)
    ).toBe(true)
    expect(quoteAppearsIn('A request waits for a free one', text)).toBe(true)
    expect(quoteAppearsIn("L'auteur décide, et l'agent propose.", text)).toBe(
      true
    )
    expect(
      quoteAppearsIn('« The pool keeps at most ten connections. »', text)
    ).toBe(true)
  })

  it('finds the parts of a quote cut by an ellipsis, in their order', () => {
    expect(quoteAppearsIn('The pool keeps … an eleventh.', text)).toBe(true)
    expect(quoteAppearsIn('an eleventh. [...] The pool keeps', text)).toBe(
      false
    )
  })

  it('rejects a changed letter, a changed sign and an empty quote', () => {
    expect(
      quoteAppearsIn('The pool keeps at most tan connections.', text)
    ).toBe(false)
    expect(
      quoteAppearsIn('The pool keeps at most ten connections!', text)
    ).toBe(false)
    expect(quoteAppearsIn('', text)).toBe(false)
    expect(quoteAppearsIn(' … ', text)).toBe(false)
  })

  it('rejects a quote made of short fragments, or cut too many times', () => {
    expect(quoteAppearsIn('The pool … ten', text)).toBe(false)
    expect(quoteAppearsIn('The … at … ten … free … never', text)).toBe(false)
    expect(quoteAppearsIn('ten', text)).toBe(false)
  })

  it('normalizes white space and code marks only', () => {
    expect(normalizeQuote('  `a`\u00a0 *b*\n c. ')).toBe('a b c.')
  })
})

describe('AssistSuggestionSchema', () => {
  const plain = {
    kind: 'plain',
    schemaVersion: ASSIST_SCHEMA_VERSION,
    status: 'suggested',
    provenance: {
      model: 'model',
      promptVersion: 'plain-1',
      inputHash: 'a'.repeat(64),
      createdAt: '2026-11-11T10:00:00Z',
    },
    summary: 'The team decided.',
  }

  it('reads a suggestion, whose status is always suggested', () => {
    expect(AssistSuggestionSchema.parse(plain)).toEqual(plain)
    expect(() =>
      AssistSuggestionSchema.parse({ ...plain, status: 'accepted' })
    ).toThrow()
    expect(() =>
      AssistSuggestionSchema.parse({
        ...plain,
        kind: 'check',
        findings: [
          {
            decision: 1,
            verdict: 'violated',
            quote: '',
            evidence: { path: 'a', text: '' },
            explanation: '',
          },
        ],
      })
    ).toThrow()
  })

  it('matches the JSON Schemas published in schema/', () => {
    const committed = (name: string): unknown =>
      JSON.parse(
        readFileSync(new URL(`../schema/${name}`, import.meta.url), 'utf8')
      )
    expect(assistRequestJsonSchema()).toEqual(
      committed('assist-request.schema.json')
    )
    expect(assistSuggestionJsonSchema()).toEqual(
      committed('assist-suggestion.schema.json')
    )
  })
})
