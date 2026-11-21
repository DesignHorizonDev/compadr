// Features group the decision records: each record declares its feature in
// `compadr.feature`, and a detail decision names the main decision of its
// feature in `compadr.parent`. The glossary of the repository, `features.yml`
// in the ADR folder, gives each feature its label and its main decision.
import { isMap } from 'yaml'
import { z } from 'zod'
import { parseYaml, parseYamlDocument } from './yaml.ts'
import {
  ConflictSchema,
  ConsolidatedRuleSchema,
  ReplacedPointSchema,
} from './assist.ts'
import { editFrontmatter, ensureMap } from './frontmatter-edit.ts'

/** Name of the glossary file, in the ADR folder. */
export const FEATURE_GLOSSARY = 'features.yml'

/** A feature identifier: lowercase ASCII words joined by hyphens. */
export const FEATURE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Fingerprint of the text of a record: `sha256:` and 16 hexadecimal digits. */
export const RECORD_HASH = /^sha256:[0-9a-f]{16}$/

const decisionNumber = z.int().min(0).max(9999)

/**
 * The rules in force of a feature, consolidated along the amendments of its
 * main decision by the assist service, then validated by a person. `chain`
 * gives the fingerprint of each record as it was read: a record that changes
 * since makes the rules stale.
 */
export const ValidatedRulesSchema = z.object({
  decision: decisionNumber.describe('Main decision whose chain was read'),
  validated: z.iso.date().describe('Day of the validation'),
  model: z.string(),
  promptVersion: z.string(),
  chain: z
    .array(
      z.object({
        decision: decisionNumber,
        hash: z.string().regex(RECORD_HASH),
      })
    )
    .min(1),
  rules: z.array(ConsolidatedRuleSchema).min(1),
  replaced: z.array(ReplacedPointSchema),
  conflicts: z.array(ConflictSchema),
})

export type ValidatedRules = z.infer<typeof ValidatedRulesSchema>

export interface FeatureEntry {
  id: string
  label: string
  /** Main decision of the feature. */
  main: number | null
  /** Rules in force that a person validated, when the glossary holds them. */
  rules?: ValidatedRules
}

export interface FeatureGlossary {
  features: FeatureEntry[]
  /** Entries left out, with the reason. */
  problems: string[]
}

export class FeatureGlossaryError extends Error {}

/** A decision number, from 0 to 9999, or null. */
function readNumber(value: unknown): number | null {
  if (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 9999
  ) {
    return value
  }
  if (typeof value === 'string' && /^\d{1,4}$/.test(value.trim())) {
    return Number(value.trim())
  }
  return null
}

/**
 * Reads a glossary. An entry with an invalid identifier or shape is left out
 * and named in `problems`; a file that is not a YAML map has no feature.
 */
export function parseFeatureGlossary(text: string): FeatureGlossary {
  let data: unknown
  try {
    data = parseYaml(text)
  } catch (error) {
    return {
      features: [],
      problems: [`${FEATURE_GLOSSARY} is not valid YAML: ${String(error)}`],
    }
  }
  if (data === null || data === undefined) return { features: [], problems: [] }
  if (typeof data !== 'object' || Array.isArray(data)) {
    return { features: [], problems: [`${FEATURE_GLOSSARY} is not a map`] }
  }
  const features: FeatureEntry[] = []
  const problems: string[] = []
  for (const [id, value] of Object.entries(data as Record<string, unknown>)) {
    if (!FEATURE_ID.test(id)) {
      problems.push(`${id}: not a feature identifier (lowercase-words)`)
      continue
    }
    // `billing:` alone names a feature without label nor main decision.
    if (value !== null && (typeof value !== 'object' || Array.isArray(value))) {
      problems.push(`${id}: not a map of label and main`)
      continue
    }
    const entry = (value ?? {}) as Record<string, unknown>
    const label =
      typeof entry.label === 'string' && entry.label.trim() !== ''
        ? entry.label.trim()
        : id
    const main = readNumber(entry.main)
    if (main === null && entry.main !== undefined && entry.main !== null) {
      problems.push(`${id}: main is not a decision number`)
    }
    let rules: ValidatedRules | null = null
    if (entry.rules !== undefined && entry.rules !== null) {
      const parsed = ValidatedRulesSchema.safeParse(entry.rules)
      if (parsed.success) rules = parsed.data
      else {
        const issue = parsed.error.issues[0]
        problems.push(
          `${id}: rules are left out (${[...(issue?.path ?? [])].join('.') || 'rules'}: ${issue?.message ?? 'invalid'})`
        )
      }
    }
    features.push({ id, label, main, ...(rules === null ? {} : { rules }) })
  }
  return { features, problems }
}

const GLOSSARY_HEADER = [
  '# Features of the decision records. Each record names its feature in',
  '# compadr.feature, and a detail decision names the main decision in',
  '# compadr.parent.',
].join('\n')

/**
 * Writes `features` into the glossary `existing` (or a new one). Other
 * features and the comments of the file are kept.
 */
export function writeFeatureGlossary(
  existing: string | null,
  features: readonly FeatureEntry[]
): string {
  const document = parseYamlDocument(existing ?? '')
  if (document.errors.length > 0) {
    throw new FeatureGlossaryError(
      `${FEATURE_GLOSSARY} is not valid YAML: ${document.errors[0]!.message}`
    )
  }
  if (document.contents !== null && !isMap(document.contents)) {
    throw new FeatureGlossaryError(`${FEATURE_GLOSSARY} is not a map`)
  }
  for (const feature of features) {
    if (!FEATURE_ID.test(feature.id)) {
      throw new FeatureGlossaryError(
        `${feature.id}: not a feature identifier (lowercase-words)`
      )
    }
    if (!isMap(document.get(feature.id, true))) {
      // An entry without a body, or with a value that is not a map, is
      // replaced: the glossary reads no feature data in it.
      document.set(
        feature.id,
        document.createNode(
          feature.main === null
            ? { label: feature.label }
            : { label: feature.label, main: feature.main }
        )
      )
      continue
    }
    document.setIn([feature.id, 'label'], feature.label)
    if (feature.main === null) document.deleteIn([feature.id, 'main'])
    else document.setIn([feature.id, 'main'], feature.main)
  }
  const yaml = document.toString({
    lineWidth: 0,
    flowCollectionPadding: false,
  })
  return existing === null || existing.trim() === ''
    ? `${GLOSSARY_HEADER}\n${yaml}`
    : yaml
}

export interface FeatureEdit {
  feature: string
  /** Main decision of the feature, or null for the main decision itself. */
  parent: number | null
}

/**
 * Sets `compadr.feature` and `compadr.parent` in the frontmatter of a record.
 * A null parent removes `compadr.parent`.
 */
export function applyFeatureEdit(markdown: string, edit: FeatureEdit): string {
  if (!FEATURE_ID.test(edit.feature)) {
    throw new FeatureGlossaryError(
      `${edit.feature}: not a feature identifier (lowercase-words)`
    )
  }
  return editFrontmatter(markdown, document => {
    ensureMap(document, ['compadr'])
    document.setIn(['compadr', 'feature'], edit.feature)
    if (edit.parent === null) document.deleteIn(['compadr', 'parent'])
    else document.setIn(['compadr', 'parent'], edit.parent)
  })
}

/**
 * Writes the validated rules of one feature into the glossary. The feature
 * must already have an entry; the other entries and the comments are kept.
 */
export function writeValidatedRules(
  existing: string,
  feature: string,
  rules: ValidatedRules
): string {
  const document = parseYamlDocument(existing)
  if (document.errors.length > 0) {
    throw new FeatureGlossaryError(
      `${FEATURE_GLOSSARY} is not valid YAML: ${document.errors[0]!.message}`
    )
  }
  if (!isMap(document.contents) || !isMap(document.get(feature, true))) {
    throw new FeatureGlossaryError(
      `${FEATURE_GLOSSARY} has no entry for the feature ${feature}`
    )
  }
  document.setIn(
    [feature, 'rules'],
    document.createNode(ValidatedRulesSchema.parse(rules))
  )
  return document.toString({ lineWidth: 0, flowCollectionPadding: false })
}
