// `compadr index`, `compadr map` and `compadr agents`: the corrections that
// write the generated files on a new branch.
import {
  AGENTS_FILES,
  INDEX_FILE,
  MAP_FILE,
  recordLanguage,
  renderAgentsExcerpt,
  renderIndex,
  renderMemoryCard,
  writeAgentsExcerpt,
} from '@compadr/engine'
import type { DriftReport } from '@compadr/format'
import type { Correction } from './publish.ts'

export class GeneratedFileUpToDateError extends Error {}

export interface GeneratedRequest {
  branch?: string
  title?: string
  body?: string
}

const TEXTS = {
  index: {
    en: {
      title: 'docs(adr): list the decisions in force',
      body: (file: string) =>
        `Compadr writes \`${file}\`. The file lists the decisions in force, by feature.`,
    },
    fr: {
      title: 'docs(adr): lister les décisions en vigueur',
      body: (file: string) =>
        `Compadr écrit \`${file}\`. Ce fichier liste les décisions en vigueur, par fonctionnalité.`,
    },
  },
  map: {
    en: {
      title: 'docs(adr): map the decisions for coding agents',
      body: (file: string) =>
        `Compadr writes \`${file}\`. The file gives coding agents the features, the zones of the code under decisions and the decisions in force.`,
    },
    fr: {
      title: 'docs(adr): cartographier les décisions pour les agents',
      body: (file: string) =>
        `Compadr écrit \`${file}\`. Ce fichier donne aux agents les fonctionnalités, les zones du code sous décision et les décisions en vigueur.`,
    },
  },
  agents: {
    en: {
      title: 'docs: point coding agents to the architecture decisions',
      body: (file: string) =>
        `Compadr writes its excerpt in \`${file}\`. The excerpt tells coding agents where the decisions are and how to read them.`,
    },
    fr: {
      title: 'docs: indiquer aux agents les décisions d’architecture',
      body: (file: string) =>
        `Compadr écrit son extrait dans \`${file}\`. L’extrait indique aux agents où trouver les décisions et comment les lire.`,
    },
  },
}

const FROM = { en: 'Generated from commit', fr: 'Généré à partir du commit' }

function correction(
  repository: string,
  report: DriftReport,
  kind: 'index' | 'map' | 'agents',
  file: string,
  content: string,
  request: GeneratedRequest
): Correction {
  const language = recordLanguage(report)
  const texts = TEXTS[kind][language]
  const commit = report.repository.commit
  return {
    repository,
    commit,
    branch: request.branch ?? `compadr/${kind}-${commit.slice(0, 8)}`,
    title: request.title ?? texts.title,
    body:
      request.body ??
      `${texts.body(file)}\n\n${FROM[language]} ${commit.slice(0, 8)}.`,
    files: new Map([[file, content]]),
  }
}

/** The branch that writes `INDEX.md` in the ADR folder. */
export function buildIndexCorrection(
  repository: string,
  report: DriftReport,
  current: string | null,
  request: GeneratedRequest
): Correction {
  const file = `${report.repository.adrDir}/${INDEX_FILE}`
  const content = renderIndex(report)
  if (current === content) {
    throw new GeneratedFileUpToDateError(`${file} is up to date`)
  }
  return correction(repository, report, 'index', file, content, request)
}

/** The branch that writes `MAP.md` in the ADR folder. */
export function buildMapCorrection(
  repository: string,
  report: DriftReport,
  current: string | null,
  request: GeneratedRequest
): Correction {
  const file = `${report.repository.adrDir}/${MAP_FILE}`
  const content = renderMemoryCard(report)
  if (current === content) {
    throw new GeneratedFileUpToDateError(`${file} is up to date`)
  }
  return correction(repository, report, 'map', file, content, request)
}

/**
 * The file that receives the excerpt: the one named, or else the first of
 * AGENTS.md and CLAUDE.md that exists, or else AGENTS.md.
 */
export function agentsFile(
  named: string | undefined,
  exists: (file: string) => boolean
): string {
  return named ?? AGENTS_FILES.find(exists) ?? AGENTS_FILES[0]
}

/** The branch that writes the excerpt in `file`. */
export function buildAgentsCorrection(
  repository: string,
  report: DriftReport,
  file: string,
  current: string | null,
  request: GeneratedRequest
): Correction {
  const content = writeAgentsExcerpt(current, renderAgentsExcerpt(report))
  if (current === content) {
    throw new GeneratedFileUpToDateError(`${file} is up to date`)
  }
  return correction(repository, report, 'agents', file, content, request)
}
