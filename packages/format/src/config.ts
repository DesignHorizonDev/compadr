// The settings of Compadr for one repository: `compadr.yml` in the ADR
// folder, next to `features.yml`. The file is optional; each setting has a
// default.
//
//   rules:
//     policy: preferred
//   assist:
//     semantic: true
//     exclude:
//       - config/secrets/
import { normalizeRepositoryPath } from './file-decisions.ts'
import { parseYaml } from './yaml.ts'

/** Name of the settings file, in the ADR folder. */
export const COMPADR_CONFIG = 'compadr.yml'

/**
 * How `compadr check` treats the rule of a decision (`compadr.rule`):
 * - `derived`: the first sentence of the decision is enough, nothing is said;
 * - `preferred`: a decision in force without a rule that stands alone gets a
 *   notice, which does not fail the check;
 * - `required`: a decision in force without `compadr.rule` fails the check.
 */
export const RULE_POLICIES = ['derived', 'preferred', 'required'] as const
export type RulePolicy = (typeof RULE_POLICIES)[number]

export const DEFAULT_RULE_POLICY: RulePolicy = 'preferred'

/** What the repository lets the assist service read. */
export interface AssistSettings {
  /**
   * Whether `compadr check --semantic` may send the changes of the repository
   * to the assist service. Off unless the file turns it on.
   */
  semantic: boolean
  /**
   * Paths whose changes never leave the repository: a file, or a folder and
   * everything under it.
   */
  exclude: string[]
}

export interface CompadrConfig {
  rulePolicy: RulePolicy
  assist: AssistSettings
  /** Settings left at their default, with the reason. */
  problems: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readRules(rules: unknown, config: CompadrConfig): void {
  if (rules === undefined || rules === null) return
  if (!isRecord(rules)) {
    config.problems.push(`${COMPADR_CONFIG}: rules is not a map`)
    return
  }
  const policy = rules.policy
  if (policy === undefined || policy === null) return
  if (
    typeof policy === 'string' &&
    (RULE_POLICIES as readonly string[]).includes(policy)
  ) {
    config.rulePolicy = policy as RulePolicy
  } else {
    config.problems.push(
      `${COMPADR_CONFIG}: rules.policy is ${JSON.stringify(policy)}, not one of ${RULE_POLICIES.join(', ')}`
    )
  }
}

// A setting of `assist` that cannot be read turns the semantic check off: an
// exclusion that the file meant to declare must not be skipped.
function readAssist(assist: unknown, config: CompadrConfig): void {
  if (assist === undefined || assist === null) return
  if (!isRecord(assist)) {
    config.problems.push(`${COMPADR_CONFIG}: assist is not a map`)
    return
  }
  const exclude = assist.exclude
  let paths: string[] = []
  if (exclude !== undefined && exclude !== null) {
    if (
      !Array.isArray(exclude) ||
      !exclude.every(path => typeof path === 'string' && path.trim() !== '')
    ) {
      config.problems.push(
        `${COMPADR_CONFIG}: assist.exclude is not a list of paths, so the semantic check stays off`
      )
      return
    }
    // An entry is a path or the start of a path. A pattern such as
    // `src/*.ts` would match no file and keep nothing out: it turns the
    // semantic check off instead. Brackets and braces stay literal, since
    // web frameworks name folders `[id]` or `{id}`.
    const pattern = (exclude as string[]).find(path => /[*?]/.test(path))
    if (pattern !== undefined) {
      config.problems.push(
        `${COMPADR_CONFIG}: assist.exclude holds the pattern ${JSON.stringify(pattern)}, but it lists paths and folders, not patterns, so the semantic check stays off`
      )
      return
    }
    paths = (exclude as string[]).map(path =>
      normalizeRepositoryPath(path.trim())
    )
  }
  const semantic = assist.semantic
  if (semantic !== undefined && semantic !== null) {
    if (typeof semantic !== 'boolean') {
      config.problems.push(
        `${COMPADR_CONFIG}: assist.semantic is ${JSON.stringify(semantic)}, not true or false, so the semantic check stays off`
      )
      return
    }
    config.assist.semantic = semantic
  }
  config.assist.exclude = paths
}

/** Reads `compadr.yml`. A setting that cannot be read keeps its default. */
export function parseCompadrConfig(text: string): CompadrConfig {
  const config: CompadrConfig = {
    rulePolicy: DEFAULT_RULE_POLICY,
    assist: { semantic: false, exclude: [] },
    problems: [],
  }
  let data: unknown
  try {
    data = parseYaml(text)
  } catch (error) {
    config.problems.push(
      `${COMPADR_CONFIG} is not valid YAML: ${String(error)}`
    )
    return config
  }
  if (data === null || data === undefined) return config
  if (!isRecord(data)) {
    config.problems.push(`${COMPADR_CONFIG} is not a map`)
    return config
  }
  readRules(data.rules, config)
  readAssist(data.assist, config)
  return config
}

/** Whether the settings keep a path of the repository from the assist service. */
export function excludedFromAssist(
  settings: Pick<AssistSettings, 'exclude'>,
  path: string
): boolean {
  const normal = normalizeRepositoryPath(path)
  return settings.exclude.some(
    entry => normal === entry || normal.startsWith(`${entry}/`)
  )
}
