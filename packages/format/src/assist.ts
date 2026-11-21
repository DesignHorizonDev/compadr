// The contract between Compadr and an assist service: what Compadr sends
// (a request, built from the drift report without any model) and what the
// service returns (a suggestion that a person reviews). A suggestion is never
// a decision: its status is always `suggested`.
import { z } from 'zod'
import { DECISION_STATUSES } from './status.ts'

/**
 * Version of the assist contract. A change that removes or renames a field,
 * or changes its meaning, increments it.
 */
export const ASSIST_SCHEMA_VERSION = 1

/** What the service is asked to do. */
export const ASSIST_KINDS = [
  'check',
  'consolidate',
  'plain',
  'draft',
  'accept',
] as const

/** How a finding of a check reads the decision. */
export const CHECK_VERDICTS = ['violated', 'at-risk'] as const

/**
 * What the service recommends for a proposed decision that the code cites.
 * A person decides: the service never accepts a decision.
 */
export const ACCEPT_RECOMMENDATIONS = [
  'accept',
  'amend-then-accept',
  'keep-proposed',
  'withdraw',
] as const

const decisionNumber = z.int().min(0).max(9999)
const path = z.string().min(1)

export const AssistRepositorySchema = z.object({
  name: z.string(),
  commit: z.string().regex(/^[0-9a-f]{40}$/),
  adrDir: z.string(),
})

/** A decision of a check request, with the text the service may quote. */
export const AssistDecisionSchema = z.object({
  number: decisionNumber,
  title: z.string(),
  status: z.enum(DECISION_STATUSES),
  rule: z.string().optional(),
  files: z.array(path).describe('Changed files that the decision applies to'),
  weight: z
    .number()
    .min(0)
    .describe('Sum of the weights of its links to the changed files'),
  text: z
    .string()
    .describe(
      'Decision section of the record, as Markdown; empty when the report has none'
    ),
  truncated: z
    .boolean()
    .describe('True when the text was cut to the budget of the request'),
})

export const AssistSignalSchema = z.object({
  type: z.string(),
  level: z.enum(['broken', 'review']),
  decision: decisionNumber,
  path,
})

/** A whole record, for the requests that read records rather than a change. */
export const AssistRecordSchema = z.object({
  number: decisionNumber,
  file: path,
  text: z.string(),
})

/** Lines of a file of the code, from `startLine`, as the analysed commit holds them. */
export const AssistCodeExcerptSchema = z.object({
  path,
  startLine: z.int().min(1),
  text: z.string(),
})

const requestBase = {
  schemaVersion: z.literal(ASSIST_SCHEMA_VERSION),
  repository: AssistRepositorySchema,
}

const diffPart = {
  diff: z
    .string()
    .describe(
      'Unified diff, without documentation, lock files, generated code or the content of deleted files'
    ),
  omittedFiles: z
    .array(path)
    .describe('Changed files left out of the diff to keep within its budget'),
}

export const CheckRequestSchema = z.object({
  kind: z.literal('check'),
  ...requestBase,
  memoryCard: z.string(),
  decisions: z.array(AssistDecisionSchema),
  signals: z.array(AssistSignalSchema),
  ...diffPart,
})

export const ConsolidateRequestSchema = z.object({
  kind: z.literal('consolidate'),
  ...requestBase,
  decision: decisionNumber.describe('Decision whose chain is consolidated'),
  records: z
    .array(AssistRecordSchema)
    .min(1)
    .describe('The chain of amendments, by number'),
  omittedRecords: z
    .array(decisionNumber)
    .describe('Records of the chain left out to keep within the budget'),
})

export const PlainRequestSchema = z.object({
  kind: z.literal('plain'),
  ...requestBase,
  record: AssistRecordSchema,
})

export const DraftRequestSchema = z.object({
  kind: z.literal('draft'),
  ...requestBase,
  memoryCard: z.string(),
  nextNumber: decisionNumber,
  ...diffPart,
})

export const AcceptRequestSchema = z.object({
  kind: z.literal('accept'),
  ...requestBase,
  record: AssistRecordSchema.describe('The proposed decision'),
  code: z
    .array(AssistCodeExcerptSchema)
    .describe('Excerpts of the files of the code that cite the decision'),
  omittedFiles: z
    .array(path)
    .describe(
      'Files that cite the decision, left out to keep within the budget'
    ),
})

export const AssistRequestSchema = z.discriminatedUnion('kind', [
  CheckRequestSchema,
  ConsolidateRequestSchema,
  PlainRequestSchema,
  DraftRequestSchema,
  AcceptRequestSchema,
])

/** Where a suggestion comes from, so that a reviewer can weigh and replay it. */
export const AssistProvenanceSchema = z.object({
  model: z.string(),
  promptVersion: z.string(),
  inputHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .describe('SHA-256 of the request, as Compadr serialized it'),
  createdAt: z.iso.datetime(),
})

const quote = z
  .string()
  .min(1)
  .describe('Passage of the record, copied word for word')

export const CheckFindingSchema = z.object({
  decision: decisionNumber,
  verdict: z.enum(CHECK_VERDICTS),
  quote: quote.describe(
    'Passage of the decision text that states the rule, copied word for word'
  ),
  evidence: z.object({
    path,
    text: z.string().describe('Line or lines of the diff'),
  }),
  explanation: z.string(),
})

export const ConsolidatedRuleSchema = z.object({
  rule: z.string(),
  sources: z.array(decisionNumber).min(1),
  quote,
})

export const ReplacedPointSchema = z.object({
  rule: z.string(),
  record: decisionNumber,
  replacedBy: decisionNumber,
})

export const ConflictSchema = z.object({
  point: z.string(),
  records: z.array(decisionNumber).min(2),
})

export const DraftSectionSchema = z.object({
  heading: z.string().describe('States the rule of the subsection'),
  text: z.string(),
})

/** A point of the record, and what the code shows about it. */
export const AcceptPointSchema = z.object({
  quote: quote.describe('Passage of the record, copied word for word'),
  evidence: z
    .object({
      path,
      text: z.string().describe('Line or lines of an excerpt that was sent'),
    })
    .nullable()
    .describe('What the code shows; null when no excerpt shows it'),
  finding: z.string(),
})

const suggestionBase = {
  schemaVersion: z.literal(ASSIST_SCHEMA_VERSION),
  status: z.literal('suggested'),
  provenance: AssistProvenanceSchema,
}

export const CheckSuggestionSchema = z.object({
  kind: z.literal('check'),
  ...suggestionBase,
  findings: z.array(CheckFindingSchema),
})

export const ConsolidateSuggestionSchema = z.object({
  kind: z.literal('consolidate'),
  ...suggestionBase,
  rules: z.array(ConsolidatedRuleSchema),
  replaced: z.array(ReplacedPointSchema),
  conflicts: z.array(ConflictSchema),
})

export const PlainSuggestionSchema = z.object({
  kind: z.literal('plain'),
  ...suggestionBase,
  summary: z.string().min(1),
})

export const DraftSuggestionSchema = z.object({
  kind: z.literal('draft'),
  ...suggestionBase,
  notNeeded: z
    .string()
    .nullable()
    .describe('Why the change needs no new record, when it only applies one'),
  title: z.string(),
  rule: z.string(),
  amends: z.array(decisionNumber),
  supersedes: z.array(decisionNumber),
  context: z.string(),
  decision: z.array(DraftSectionSchema),
  consequences: z.string(),
  codeRefs: z.array(z.string()),
})

export const AcceptSuggestionSchema = z.object({
  kind: z.literal('accept'),
  ...suggestionBase,
  recommendation: z.enum(ACCEPT_RECOMMENDATIONS),
  explanation: z.string().min(1),
  points: z.array(AcceptPointSchema),
  amendments: z
    .array(z.string())
    .describe('What to change in the record before a person accepts it'),
})

export const AssistSuggestionSchema = z.discriminatedUnion('kind', [
  CheckSuggestionSchema,
  ConsolidateSuggestionSchema,
  PlainSuggestionSchema,
  DraftSuggestionSchema,
  AcceptSuggestionSchema,
])

export type AssistKind = (typeof ASSIST_KINDS)[number]
export type AssistDecision = z.infer<typeof AssistDecisionSchema>
export type AssistRecord = z.infer<typeof AssistRecordSchema>
export type AssistRequest = z.infer<typeof AssistRequestSchema>
export type CheckRequest = z.infer<typeof CheckRequestSchema>
export type ConsolidateRequest = z.infer<typeof ConsolidateRequestSchema>
export type PlainRequest = z.infer<typeof PlainRequestSchema>
export type DraftRequest = z.infer<typeof DraftRequestSchema>
export type AcceptRequest = z.infer<typeof AcceptRequestSchema>
export type AssistCodeExcerpt = z.infer<typeof AssistCodeExcerptSchema>
export type AssistSuggestion = z.infer<typeof AssistSuggestionSchema>
export type CheckSuggestion = z.infer<typeof CheckSuggestionSchema>
export type CheckFinding = z.infer<typeof CheckFindingSchema>
export type ConsolidateSuggestion = z.infer<typeof ConsolidateSuggestionSchema>
export type PlainSuggestion = z.infer<typeof PlainSuggestionSchema>
export type DraftSuggestion = z.infer<typeof DraftSuggestionSchema>
export type AcceptSuggestion = z.infer<typeof AcceptSuggestionSchema>
export type AcceptRecommendation = (typeof ACCEPT_RECOMMENDATIONS)[number]

/** JSON Schema of an assist request, as published in `schema/`. */
export function assistRequestJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(AssistRequestSchema, { target: 'draft-2020-12' })
}

/** JSON Schema of an assist suggestion, as published in `schema/`. */
export function assistSuggestionJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(AssistSuggestionSchema, { target: 'draft-2020-12' })
}

/**
 * The form of a quote that the guard compares: Markdown emphasis and code
 * marks removed, typographic apostrophes and spaces unified, white space
 * collapsed. Letters, digits and punctuation stay, so that a changed word
 * no longer matches.
 */
export function normalizeQuote(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u00a0\u202f]/g, ' ')
    .replace(/^\s*>\s?/gm, '')
    .replace(/[*`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Characters of each part of a quote, at least, once normalized. */
export const QUOTE_MIN_PART_CHARS = 12
/** Ellipses in a quote, at most. */
export const QUOTE_MAX_ELLIPSES = 3

/**
 * Whether a quote appears in a text, word for word once normalized. A quote
 * may skip a passage with an ellipsis, at most three times: each part must
 * then appear, in order. A part shorter than 12 characters, or an empty
 * quote, is never found: a few letters would match almost any text.
 */
export function quoteAppearsIn(quoteText: string, text: string): boolean {
  const parts = normalizeQuote(quoteText)
    .replace(/^["«“]\s*|\s*["»”]$/g, '')
    .split(/\s*(?:…|\[\.\.\.\]|\[…\]|\.\.\.)\s*/)
    .map(part => part.trim())
    .filter(part => part !== '')
  if (
    parts.length === 0 ||
    parts.length > QUOTE_MAX_ELLIPSES + 1 ||
    parts.some(part => part.length < QUOTE_MIN_PART_CHARS)
  ) {
    return false
  }
  const haystack = normalizeQuote(text)
  let from = 0
  for (const part of parts) {
    const at = haystack.indexOf(part, from)
    if (at < 0) return false
    from = at + part.length
  }
  return true
}
