// `compadr features`: writes the features of a repository as a plan that a
// person edits, then writes the plan into the records and the glossary, on a
// new branch.
import {
  applyFeatureEdit,
  FEATURE_GLOSSARY,
  FEATURE_ID,
  writeFeatureGlossary,
  type DriftReport,
} from '@compadr/format'
import { parse as parseYaml } from 'yaml'
import type { Correction } from './publish.ts'

export class FeaturesCommandError extends Error {}

export interface PlannedFeature {
  id: string
  label: string
  main: number
  details: number[]
}

const pad = (n: number) => String(n).padStart(4, '0')

/** A YAML comment that stays on one line. */
const comment = (text: string) => text.replace(/\s+/g, ' ').trim()

/**
 * The plan of the features of a report, as YAML: the declared features, or
 * the proposed grouping. The titles of the decisions are comments.
 */
export function formatFeaturePlan(report: DriftReport): string {
  const titles = new Map(report.decisions.map(d => [d.number, d.title]))
  const features = report.features ?? []
  const source = features.some(f => f.source === 'proposed')
    ? 'proposed by Compadr from the relations between the records and the code files they cite'
    : 'declared in the repository'
  const lines = [
    `# Features of ${report.repository.name} at ${report.repository.commit.slice(0, 8)}, ${source}.`,
    '# Edit the identifiers, labels, main decisions and details, then write the',
    '# plan on a branch with: compadr features <repository> --plan <this file>',
    'features:',
  ]
  const grouped = new Set<number>()
  for (const feature of features) {
    if (feature.main === null) continue
    lines.push(
      `  ${feature.id}:`,
      `    label: ${JSON.stringify(feature.label)}`,
      `    main: ${feature.main} # ${comment(titles.get(feature.main) ?? '')}`,
      '    details:'
    )
    grouped.add(feature.main)
    const details = feature.decisions.filter(n => n !== feature.main)
    if (details.length === 0) lines[lines.length - 1] += ' []'
    for (const n of details) {
      lines.push(`      - ${n} # ${comment(titles.get(n) ?? '')}`)
      grouped.add(n)
    }
  }
  const rest = report.decisions.filter(d => !grouped.has(d.number))
  if (rest.length > 0) {
    lines.push('', '# Not in a feature:')
    for (const d of rest) lines.push(`#   ${pad(d.number)} ${comment(d.title)}`)
  }
  return `${lines.join('\n')}\n`
}

function decisionNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : null
}

/**
 * Reads a plan and checks it against the report: each feature has a valid
 * identifier and a main decision of the folder, and a decision belongs to one
 * feature at most. Every problem is listed in one FeaturesCommandError.
 */
export function parseFeaturePlan(
  text: string,
  report: DriftReport
): PlannedFeature[] {
  let data: unknown
  try {
    data = parseYaml(text)
  } catch (error) {
    throw new FeaturesCommandError(
      `the plan is not valid YAML: ${(error as Error).message}`
    )
  }
  const features = (data as { features?: unknown } | null)?.features
  if (typeof features !== 'object' || features === null) {
    throw new FeaturesCommandError('the plan has no features map')
  }
  const known = new Set(report.decisions.map(d => d.number))
  const owner = new Map<number, string>()
  const problems: string[] = []
  const planned: PlannedFeature[] = []
  const claim = (id: string, n: number) => {
    if (!known.has(n)) {
      problems.push(`${id}: ADR ${pad(n)} is not in the folder`)
    } else if (owner.has(n)) {
      problems.push(`${id}: ADR ${pad(n)} is already in ${owner.get(n)}`)
    } else {
      owner.set(n, id)
    }
  }
  for (const [id, value] of Object.entries(features)) {
    if (!FEATURE_ID.test(id)) {
      problems.push(`${id}: not a feature identifier (lowercase-words)`)
      continue
    }
    const entry = (value ?? {}) as Record<string, unknown>
    const main = decisionNumber(entry.main)
    if (main === null) {
      problems.push(`${id}: main is not a decision number`)
      continue
    }
    const rawDetails = entry.details ?? []
    if (!Array.isArray(rawDetails)) {
      problems.push(`${id}: details is not a list`)
      continue
    }
    const details: number[] = []
    for (const item of rawDetails) {
      const n = decisionNumber(item)
      if (n === null) problems.push(`${id}: ${String(item)} is not a number`)
      else details.push(n)
    }
    // A detail written twice counts once; the main decision is no detail.
    const unique = [...new Set(details)]
    claim(id, main)
    for (const n of unique) {
      if (n === main) {
        problems.push(`${id}: ADR ${pad(n)} is both main decision and detail`)
      } else {
        claim(id, n)
      }
    }
    planned.push({
      id,
      label:
        typeof entry.label === 'string' && entry.label.trim() !== ''
          ? entry.label.trim()
          : id,
      main,
      details: unique.filter(n => n !== main).sort((a, b) => a - b),
    })
  }
  if (problems.length > 0) {
    throw new FeaturesCommandError(
      `the plan has ${problems.length} problem${problems.length === 1 ? '' : 's'}:\n${problems.map(p => `  - ${p}`).join('\n')}`
    )
  }
  return planned
}

export interface FeaturesRequest {
  branch?: string
  title?: string
  body?: string
}

/**
 * The branch that writes a plan: `compadr.feature` and `compadr.parent` in
 * each record of a feature, and the glossary. A record that already declares
 * its feature and parent is left as it is.
 */
export async function buildFeatureCorrection(
  repository: string,
  report: DriftReport,
  plan: readonly PlannedFeature[],
  request: FeaturesRequest,
  readFile: (file: string) => Promise<string | null>
): Promise<Correction> {
  const decisions = new Map(report.decisions.map(d => [d.number, d]))
  const files = new Map<string, string>()
  for (const feature of plan) {
    const members: [number, number | null][] = [
      [feature.main, null],
      ...feature.details.map(n => [n, feature.main] as [number, number]),
    ]
    for (const [number, parent] of members) {
      const decision = decisions.get(number)!
      if (decision.feature === feature.id && decision.parent === parent) {
        continue
      }
      const markdown = await readFile(decision.file)
      if (markdown === null) {
        throw new FeaturesCommandError(`${decision.file} cannot be read`)
      }
      files.set(
        decision.file,
        applyFeatureEdit(markdown, { feature: feature.id, parent })
      )
    }
  }
  const glossaryPath = `${report.repository.adrDir}/${FEATURE_GLOSSARY}`
  const glossary = await readFile(glossaryPath)
  const written = writeFeatureGlossary(
    glossary,
    plan.map(({ id, label, main }) => ({ id, label, main }))
  )
  if (written !== glossary) files.set(glossaryPath, written)
  if (files.size === 0) {
    throw new FeaturesCommandError('the repository already declares this plan')
  }

  const commit = report.repository.commit
  const count = `${plan.length} feature${plan.length === 1 ? '' : 's'}`
  return {
    repository,
    commit,
    branch: request.branch ?? `compadr/features-${commit.slice(0, 8)}`,
    title:
      request.title ?? `docs(adr): group the decision records into ${count}`,
    body:
      request.body ??
      [
        `Compadr groups the decision records into ${count}. Each record names its feature in \`compadr.feature\` and its main decision in \`compadr.parent\`; \`${glossaryPath}\` gives each feature its label.`,
        '',
        ...plan.map(
          f =>
            `- **${f.label}** (\`${f.id}\`): main decision ${pad(f.main)}${f.details.length > 0 ? `, details ${f.details.map(pad).join(', ')}` : ''}`
        ),
        '',
        `Planned from commit ${commit.slice(0, 8)}.`,
      ].join('\n'),
    files,
  }
}
