// What a semantic check found, kept next to the drift report so that the
// console can show it: the findings that the guard kept for one change, with
// the model and the instructions that wrote them. A finding is a suggestion:
// a person reads it and decides.
import { z } from 'zod'
import { AssistRepositorySchema, CheckFindingSchema } from './assist.ts'

export const SEMANTIC_FINDINGS_SCHEMA_VERSION = 1

/** End of the name of a findings file, next to the reports. */
export const SEMANTIC_FINDINGS_SUFFIX = '.findings.json'

export const SemanticFindingSchema = CheckFindingSchema.extend({
  title: z.string().describe('Title of the decision'),
  line: z
    .int()
    .min(1)
    .nullable()
    .describe('Line of evidence.path in the new file, when the diff adds it'),
  notices: z
    .array(z.string())
    .describe('What the guard could not verify, for the reviewer to weigh'),
})

export const SemanticFindingsSchema = z
  .object({
    schemaVersion: z.literal(SEMANTIC_FINDINGS_SCHEMA_VERSION),
    repository: AssistRepositorySchema.describe(
      'Repository and commit of the change'
    ),
    base: z
      .string()
      .regex(/^[0-9a-f]{40}$/)
      .nullable()
      .describe(
        'Commit that the change starts from, with --base; null for --diff'
      ),
    generatedAt: z.iso.datetime(),
    model: z.string(),
    promptVersion: z.string(),
    findings: z.array(SemanticFindingSchema),
    rejected: z.int().min(0).describe('Findings that the guard removed'),
    excluded: z
      .array(z.string())
      .describe('Changed files that compadr.yml kept from the service'),
  })
  .meta({
    title: 'Compadr semantic findings',
    description:
      'Findings of the assist service on one change, after the guard of Compadr. Each one is a suggestion for a person to review.',
  })

export type SemanticFinding = z.infer<typeof SemanticFindingSchema>
export type SemanticFindings = z.infer<typeof SemanticFindingsSchema>

/** JSON Schema of the findings file, as published in `schema/`. */
export function semanticFindingsJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(SemanticFindingsSchema, { target: 'draft-2020-12' })
}
