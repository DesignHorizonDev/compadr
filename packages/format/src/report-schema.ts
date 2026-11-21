import { z } from 'zod'
import { FINGERPRINT } from './anchor.ts'
import { RULE_POLICIES } from './config.ts'
import { FEATURE_ID, ValidatedRulesSchema } from './features.ts'
import { RULE_SOURCES } from './rule.ts'
import { DECISION_STATUSES } from './status.ts'

/**
 * Version of the drift report contract. A change that removes or renames a
 * field, or changes its meaning, increments it. Adding an optional field or a
 * new signal type does not.
 */
export const REPORT_SCHEMA_VERSION = 2

const decisionNumber = z.int().min(0).max(9999)
const timestamp = z.iso.datetime().describe('UTC date and time')
const lineNumber = z.int().min(1)

/** What a feature page reads of a record: its relations and its decision. */
export const DecisionTextSchema = z.object({
  relations: z
    .array(z.string())
    .describe('Header items that link the decision to older ones, as Markdown'),
  sections: z
    .array(
      z.object({
        heading: z
          .string()
          .nullable()
          .describe('Null for the text before the first subsection'),
        line: lineNumber.describe('Line of the record where it starts'),
        markdown: z.string(),
      })
    )
    .describe('Subsections of the Decision section, in order'),
})

/**
 * Where a name comes from, in the order of preference: written in the record
 * (`declared`), the people who approved or else merged the pull request of
 * the commit that wrote the line (`pull-request`), or the author of that
 * commit (`commit`).
 */
export const ATTRIBUTION_SOURCES = [
  'declared',
  'pull-request',
  'commit',
] as const

/** What the named people did on the pull request. */
export const PULL_REQUEST_ROLES = ['approved', 'merged'] as const

export const AttributionSchema = z.object({
  names: z.array(z.string()).min(1),
  source: z.enum(ATTRIBUTION_SOURCES),
  commit: z
    .string()
    .regex(/^[0-9a-f]{40}$/)
    .optional()
    .describe('Commit that wrote the line, for the sources read in git'),
  pullRequest: z
    .object({
      number: z.number().int().positive(),
      title: z.string(),
      url: z.string(),
      role: z.enum(PULL_REQUEST_ROLES),
    })
    .optional()
    .describe('Pull request of the commit, for the source pull-request'),
})

export const DecisionSchema = z.object({
  number: decisionNumber,
  file: z.string().describe('Path of the record in the repository'),
  title: z.string(),
  status: z.enum(DECISION_STATUSES),
  rawStatus: z.string().describe('Status as written in the record'),
  date: z.iso.date().nullable().describe('Date declared in the record'),
  revisedAt: timestamp
    .nullable()
    .describe('Date of the last commit that changed the record'),
  lineCount: lineNumber,
  feature: z.string().nullable().describe('compadr.feature'),
  parent: decisionNumber.nullable().describe('compadr.parent'),
  amends: z.array(decisionNumber),
  amendedBy: z.array(decisionNumber),
  supersededBy: z.array(decisionNumber),
  codeArea: z
    .string()
    .nullable()
    .describe('Folder of the code most linked to the decision'),
  text: DecisionTextSchema.optional(),
  history: z
    .array(
      z.object({
        commit: z.string().regex(/^[0-9a-f]{40}$/),
        date: timestamp,
        subject: z.string(),
        author: z.string().optional().describe('Name of the commit author'),
      })
    )
    .optional()
    .describe('Last commits that changed the record, the most recent first'),
  attribution: AttributionSchema.optional().describe(
    'Who made the decision: the deciders that the record names, or else the author of the commit that added it'
  ),
  rule: z
    .object({
      text: z.string(),
      source: z
        .enum(RULE_SOURCES)
        .describe(
          'declared: compadr.rule; first-sentence: the first sentence of the Decision section'
        ),
    })
    .nullable()
    .optional()
    .describe(
      'What the decision requires, in one sentence. Null when the record declares no rule and its first sentence cannot stand alone'
    ),
})

const referenceBase = {
  id: z
    .string()
    .describe(
      'Stable identifier: decision number, cited text and rank of the citation of that text in the record (0012:src/mail.ts:40:1). An edit of the record elsewhere leaves it unchanged'
    ),
  decision: decisionNumber,
  adrLine: lineNumber.describe('Line of the record that carries the reference'),
  column: lineNumber.describe('Column of the opening backtick in that line'),
  text: z.string().describe('Text cited between backticks'),
  citedAt: timestamp
    .nullable()
    .describe('Date the line of the record was written (git blame)'),
  checkedAt: timestamp
    .nullable()
    .optional()
    .describe(
      'Date of the commit at which a person checked the reference against the code (compadr.checked)'
    ),
  checkedBy: AttributionSchema.optional().describe(
    'Who checked the reference: the name of the entry, or else the author of the commit that wrote it'
  ),
}

const fingerprint = z
  .string()
  .regex(FINGERPRINT)
  .describe('sha256: and 16 hex digits of the normalized text')
const lineSpan = z.object({ start: lineNumber, end: lineNumber })

/** The anchor that a reference declares: `path#Symbol` in the record. */
export const AnchorSchema = z.object({
  symbol: z.string().describe('Qualified name of the symbol'),
  fingerprint: fingerprint
    .nullable()
    .describe('Fingerprint recorded in compadr.anchors, if any'),
  lines: z
    .object({ count: z.int().min(1), fingerprint })
    .nullable()
    .describe('Cited lines tracked inside the symbol, if any'),
})

/**
 * How a reference that cites a line could be anchored on the symbol that
 * contains it. The symbol is found at the date of the citation, then at the
 * analysed commit, where the fingerprints are computed.
 */
export const AnchorProposalSchema = z.object({
  symbol: z.string(),
  text: z.string().describe('New text of the reference: path#Symbol'),
  fingerprint,
  symbolLines: lineSpan.describe('Lines of the symbol at the analysed commit'),
  lines: z
    .object({ count: z.int().min(1), fingerprint, start: lineNumber })
    .nullable()
    .describe(
      'The cited lines, found unchanged inside the symbol at the analysed commit'
    ),
})

export const CodeReferenceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('path'),
    ...referenceBase,
    path: z.string(),
    lines: z
      .object({ start: lineNumber, end: lineNumber })
      .nullable()
      .describe('Lines cited after the path (file.ts:120-140)'),
    resolvedPaths: z
      .array(z.string())
      .describe('Tracked files or folders that match the path'),
    anchor: AnchorSchema.nullable().describe(
      'Set when the reference names a symbol: path#Symbol'
    ),
    proposal: AnchorProposalSchema.nullable()
      .optional()
      .describe('Anchor proposed for a reference that cites lines'),
  }),
  z.object({
    kind: z.literal('symbol'),
    ...referenceBase,
    symbol: z.string(),
    foundInCode: z.boolean(),
    declaredIn: z
      .array(z.object({ file: z.string(), line: lineNumber }))
      .optional()
      .describe(
        'Code files that declare the symbol at the start of a line (function, class, type, constant…), generated code aside. One declaration links the decision to its file; several are ambiguous and link none'
      ),
  }),
])

export const AdrCitationSchema = z.object({
  file: z.string(),
  line: lineNumber,
  decision: decisionNumber.describe('Number of the decision cited'),
  inCode: z
    .boolean()
    .describe('False for Markdown and text files outside the ADR folder'),
})

/**
 * Severity of a signal:
 * - `broken`: certain drift, which alerts;
 * - `review`: probable drift, which goes to the review queue;
 * - `order`: a change that orders the review, without notification;
 * - `info`: the health of the corpus, outside drift.
 */
export const SIGNAL_LEVELS = ['broken', 'review', 'order', 'info'] as const

const signalBase = {
  id: z.string().describe('Stable identifier of the signal'),
  decision: decisionNumber.describe('Decision concerned by the signal'),
}

function signal<
  const Type extends string,
  const Level extends (typeof SIGNAL_LEVELS)[number],
  const Shape extends z.ZodRawShape,
>(type: Type, level: Level, shape: Shape, description: string) {
  return z
    .object({
      type: z.literal(type),
      level: z.literal(level),
      ...signalBase,
      ...shape,
    })
    .describe(description)
}

const referenceId = z.string().describe('Identifier of the code reference')

export const SignalSchema = z.discriminatedUnion('type', [
  signal(
    'path-missing',
    'broken',
    { reference: referenceId },
    'A cited path no longer exists'
  ),
  signal(
    'cited-line-out-of-range',
    'broken',
    { reference: referenceId, fileLineCount: z.int().min(0) },
    'A cited line is beyond the end of the file'
  ),
  signal(
    'cited-line-changed',
    'review',
    { reference: referenceId, citedAt: timestamp, lineChangedAt: timestamp },
    'A cited line was changed after its citation'
  ),
  signal(
    'cited-file-changed',
    'order',
    {
      reference: referenceId,
      citedAt: timestamp,
      commitsSince: z.int().min(1),
    },
    'A cited line sits in a file changed since its citation, so it may have moved'
  ),
  signal(
    'linked-files-changed',
    'order',
    {
      oldestCitedAt: timestamp,
      files: z.array(
        z.object({ path: z.string(), commitsSince: z.int().min(1) })
      ),
    },
    'Files linked to an accepted decision changed since their citation'
  ),
  signal(
    'superseded-decision-cited',
    'broken',
    {
      file: z.string(),
      line: lineNumber,
      supersededBy: z.array(decisionNumber),
    },
    'The code cites a decision that is no longer in force'
  ),
  signal(
    'unknown-decision-cited',
    'broken',
    { file: z.string(), line: lineNumber },
    'The repository cites a decision that does not exist at this reference'
  ),
  signal(
    'index-status-mismatch',
    'broken',
    { indexStatus: z.string(), recordStatus: z.string() },
    'The index and the record give different statuses'
  ),
  signal(
    'anchor-symbol-missing',
    'broken',
    { reference: referenceId },
    'The symbol of an anchored reference no longer exists'
  ),
  signal(
    'anchor-symbol-ambiguous',
    'review',
    { reference: referenceId, matches: z.int().min(2) },
    'Several symbols bear the name of an anchored reference'
  ),
  signal(
    'anchor-content-changed',
    'review',
    { reference: referenceId, currentFingerprint: fingerprint },
    'The symbol of an anchored reference changed since its fingerprint'
  ),
  signal(
    'anchor-lines-changed',
    'review',
    { reference: referenceId },
    'The tracked lines are no longer found in the symbol'
  ),
  signal(
    'anchor-unverified',
    'info',
    {
      reference: referenceId,
      reason: z.enum(['no-fingerprint', 'unsupported-language']),
    },
    'An anchored reference that the engine cannot check'
  ),
  signal(
    'amendment-chain',
    'info',
    { amendedBy: z.array(decisionNumber).min(3) },
    'A decision changed by three decisions or more, a candidate for consolidation'
  ),
  signal(
    'decision-without-code',
    'info',
    {},
    'An accepted decision with no link to the code'
  ),
])

export const FamilySchema = z.object({
  principal: decisionNumber.describe('Main decision of the family'),
  details: z.array(decisionNumber).min(1),
  principalIsDetail: z
    .boolean()
    .describe('True when the main decision is itself a detail of another'),
})

/** A group of decisions: a main decision and its details. */
export const FeatureSchema = z.object({
  id: z.string().regex(FEATURE_ID),
  label: z.string(),
  main: decisionNumber.nullable().describe('Main decision of the feature'),
  source: z
    .enum(['declared', 'proposed'])
    .describe(
      'declared: read in compadr.feature and the glossary; proposed: computed from the relations and the cited code files'
    ),
  decisions: z
    .array(decisionNumber)
    .describe('Every decision of the feature, the main one included'),
  rules: ValidatedRulesSchema.optional().describe(
    'Rules in force that a person validated, from features.yml'
  ),
  staleRecords: z
    .array(decisionNumber)
    .optional()
    .describe(
      'Records of the chain that changed, joined or left it since the validation of the rules; empty when they are current'
    ),
})

/**
 * A rule of an older decision, quoted by the decision that replaces it, and
 * where the engine found it.
 */
export const ReplacedRuleSchema = z.object({
  decision: decisionNumber.describe('Decision that replaces the rule'),
  quote: z.string(),
  target: decisionNumber
    .nullable()
    .describe('Decision where the quote was found once, if any'),
  location: z
    .object({
      section: z.int().min(0).describe('Index in the sections of the target'),
      start: z.int().min(0),
      end: z.int().min(0),
    })
    .nullable()
    .describe(
      'Offsets of the rule in a section of the decision; null when it is elsewhere in the record'
    ),
})

/** How much of a zone the decisions in force reach. */
export const ZONE_COVERAGES = [
  'strong',
  'partial',
  'thin',
  'folder-only',
  'none',
] as const

/** A folder of code files and the decisions in force that reach them. */
export const ZoneSchema = z.object({
  path: z.string().describe('Folder of the zone; "." for the root'),
  own: z
    .boolean()
    .describe(
      'True when the subfolders of the folder are zones of their own: the zone then holds the files directly in the folder'
    ),
  files: z.int().min(0).describe('Code files of the zone'),
  linkedFiles: z
    .int()
    .min(0)
    .describe(
      'Files that a decision in force names: cited by its record, or citing it'
    ),
  crossChecked: z
    .int()
    .min(0)
    .describe('Files that cite a decision whose record cites them too'),
  weight: z
    .number()
    .min(0)
    .describe('Sum of the weights of the links of the zone'),
  decisions: z
    .array(z.object({ number: decisionNumber, weight: z.number().min(0) }))
    .describe(
      'Decisions in force linked to files of the zone, the heaviest first'
    ),
  folderCited: z
    .array(decisionNumber)
    .describe(
      'Decisions whose record cites the folder of the zone or one inside it, which says little about each file'
    ),
  coverage: z.enum(ZONE_COVERAGES),
})

export const DriftReportSchema = z
  .object({
    schemaVersion: z.literal(REPORT_SCHEMA_VERSION),
    generator: z.object({ name: z.literal('compadr'), version: z.string() }),
    repository: z.object({
      name: z.string(),
      ref: z.string().describe('Git reference analysed'),
      commit: z.string().describe('Commit of the reference'),
      adrDir: z.string(),
    }),
    generatedAt: timestamp,
    decisions: z.array(DecisionSchema),
    references: z.array(CodeReferenceSchema),
    citations: z.array(AdrCitationSchema),
    signals: z.array(SignalSchema),
    families: z.array(FamilySchema),
    features: z.array(FeatureSchema).optional(),
    featureProblems: z
      .array(z.string())
      .optional()
      .describe('Declarations of features that the engine left out, and why'),
    replacedRules: z.array(ReplacedRuleSchema).optional(),
    rulePolicy: z
      .enum(RULE_POLICIES)
      .optional()
      .describe('rules.policy of compadr.yml, or its default'),
    configProblems: z
      .array(z.string())
      .optional()
      .describe('Settings of compadr.yml left at their default, and why'),
    assist: z
      .object({
        semantic: z
          .boolean()
          .describe(
            'Whether compadr check --semantic may send the changes to the assist service'
          ),
        exclude: z
          .array(z.string())
          .describe(
            'Paths whose changes never leave the repository: a file, or a folder and everything under it'
          ),
      })
      .optional()
      .describe('assist settings of compadr.yml, or their defaults'),
    zones: z
      .array(ZoneSchema)
      .optional()
      .describe(
        'Folders of code and how much the decisions in force reach them'
      ),
  })
  .meta({
    title: 'Compadr drift report',
    description:
      'Decisions, code references, signals, families and features of one repository at one git reference.',
  })

export type Decision = z.infer<typeof DecisionSchema>
export type Attribution = z.infer<typeof AttributionSchema>
export type CodeReference = z.infer<typeof CodeReferenceSchema>
export type Anchor = z.infer<typeof AnchorSchema>
export type AnchorProposal = z.infer<typeof AnchorProposalSchema>
export type AdrCitation = z.infer<typeof AdrCitationSchema>
export type Signal = z.infer<typeof SignalSchema>
export type SignalType = Signal['type']
export type SignalLevel = (typeof SIGNAL_LEVELS)[number]
export type Family = z.infer<typeof FamilySchema>
export type Feature = z.infer<typeof FeatureSchema>
export type ReplacedRule = z.infer<typeof ReplacedRuleSchema>
export type DecisionText = z.infer<typeof DecisionTextSchema>
export type DriftReport = z.infer<typeof DriftReportSchema>
export type Zone = z.infer<typeof ZoneSchema>
export type ZoneCoverage = (typeof ZONE_COVERAGES)[number]

/** JSON Schema of the drift report, as published in `schema/`. */
export function driftReportJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(DriftReportSchema, { target: 'draft-2020-12' })
}
