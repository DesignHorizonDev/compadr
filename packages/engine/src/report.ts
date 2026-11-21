import {
  DriftReportSchema,
  REPORT_SCHEMA_VERSION,
  type AnchorProposal,
  type DriftReport,
} from '@compadr/format'
import { anchorProposals, anchorSignals, symbolIndex } from './anchors.ts'
import {
  computeFeatures,
  featureProblems,
  findReplacedRules,
} from './features.ts'
import { readCorpus } from './read-corpus.ts'
import { computeFamilies } from './relations.ts'
import { Repository, toTimestamp } from './repository.ts'
import { staleRecords } from './rules.ts'
import { computeSignals } from './signals.ts'
import { SymbolReader, type LocateWasm } from './symbols.ts'
import { computeZones } from './zones.ts'

export interface DriftReportOptions {
  /** Git reference to analyse. */
  ref?: string
  /** Folder of the decision records in the repository. */
  adrDir?: string
  /** Name shown in the report. Defaults to the last folder of the path. */
  name?: string
  /** Version of the tool that produces the report. */
  generatorVersion: string
  /** Date of the report. Defaults to now. */
  now?: Date
  /**
   * Where the tree-sitter `.wasm` files are. Defaults to the installed
   * packages; a bundled command line passes its own folder.
   */
  locateWasm?: LocateWasm
}

function lastFolder(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  return trimmed.slice(trimmed.lastIndexOf('/') + 1)
}

/**
 * Reads the repository at `path` and returns its drift report. The report is
 * checked against the published schema before it is returned.
 */
export async function createDriftReport(
  path: string,
  options: DriftReportOptions
): Promise<DriftReport> {
  const repo = await Repository.open(path, options.ref ?? 'HEAD')
  const corpus = await readCorpus(repo, options.adrDir ?? 'docs/adr')
  // The grammars load only when a reference names a symbol or cites lines.
  const index = corpus.references.some(
    reference =>
      reference.kind === 'path' &&
      (reference.anchor !== null || reference.lines !== null)
  )
    ? symbolIndex(repo, await SymbolReader.load(options.locateWasm))
    : null
  const [signals, anchors, proposals] = await Promise.all([
    computeSignals(repo, corpus),
    index ? anchorSignals(repo, corpus, index) : [],
    index
      ? anchorProposals(repo, corpus, index)
      : new Map<string, AnchorProposal>(),
  ])
  const report: DriftReport = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generator: { name: 'compadr', version: options.generatorVersion },
    repository: {
      name: options.name ?? lastFolder(path),
      ref: repo.ref,
      commit: repo.commit,
      adrDir: corpus.adrDir,
    },
    generatedAt: toTimestamp(
      Math.floor((options.now ?? new Date()).getTime() / 1000)
    ),
    decisions: corpus.decisions,
    references: corpus.references.map(reference =>
      reference.kind === 'path'
        ? { ...reference, proposal: proposals.get(reference.id) ?? null }
        : reference
    ),
    citations: corpus.citations,
    signals: [...signals, ...anchors],
    families: computeFamilies(corpus.decisions),
    features: computeFeatures(corpus, path => repo.files.has(path)),
    featureProblems: featureProblems(corpus),
    replacedRules: findReplacedRules(corpus),
    rulePolicy: corpus.config.rulePolicy,
    configProblems: corpus.config.problems,
    assist: corpus.config.assist,
  }
  report.features = report.features?.map(feature =>
    feature.rules === undefined
      ? feature
      : {
          ...feature,
          staleRecords: staleRecords(
            report,
            feature.main,
            feature.rules,
            corpus.records
          ),
        }
  )
  report.zones = computeZones(report, repo.files)
  return DriftReportSchema.parse(report)
}
