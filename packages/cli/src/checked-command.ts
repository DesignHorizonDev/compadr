// `compadr mark-checked`: records that a person checked references of the
// decision records against the code, on a new branch.
import { recordLanguage } from '@compadr/engine'
import {
  writeChecked,
  type CheckedReference,
  type DriftReport,
} from '@compadr/format'
import type { Correction } from './publish.ts'

export class CheckedCommandError extends Error {}

export interface CheckedRequest {
  /** Identifiers of the references, as in the report. */
  references: string[]
  /** UTC date and time of the commit that was checked. */
  at: string
  /** The person who checked. Without it, git blame names the author. */
  by?: string
  branch?: string
  title?: string
  body?: string
}

const pad = (n: number) => String(n).padStart(4, '0')

const TEXTS = {
  en: {
    title: (n: number) =>
      n === 1
        ? 'docs(adr): mark a reference as checked'
        : `docs(adr): mark ${n} references as checked`,
    intro: (commit: string) =>
      `A person checked these references against the code at commit ${commit}. Compadr records the date in compadr.checked: their drift signals start from it.`,
  },
  fr: {
    title: (n: number) =>
      n === 1
        ? 'docs(adr): marquer une référence comme vérifiée'
        : `docs(adr): marquer ${n} références comme vérifiées`,
    intro: (commit: string) =>
      `Une personne a vérifié ces références dans le code au commit ${commit}. Compadr consigne la date dans compadr.checked : leurs signaux de dérive partent de cette date.`,
  },
}

/** The branch that records the checks, one record file at a time. */
export async function buildCheckedCorrection(
  repository: string,
  report: DriftReport,
  request: CheckedRequest,
  readFile: (file: string) => Promise<string>
): Promise<Correction> {
  const references = new Map(report.references.map(r => [r.id, r]))
  const decisions = new Map(report.decisions.map(d => [d.number, d]))
  const byFile = new Map<string, CheckedReference[]>()
  const lines: string[] = []
  for (const id of new Set(request.references)) {
    const reference = references.get(id)
    if (reference === undefined) {
      throw new CheckedCommandError(`no reference ${id} in the report`)
    }
    const decision = decisions.get(reference.decision)!
    const checks = byFile.get(decision.file) ?? []
    checks.push({
      text: reference.text,
      at: request.at,
      ...(request.by === undefined ? {} : { by: request.by }),
    })
    byFile.set(decision.file, checks)
    lines.push(`- ADR ${pad(decision.number)}: \`${reference.text}\``)
  }
  const files = new Map<string, string>()
  for (const [file, checks] of byFile) {
    files.set(file, writeChecked(await readFile(file), checks))
  }
  const commit = report.repository.commit
  const texts = TEXTS[recordLanguage(report)]
  return {
    repository,
    commit,
    branch: request.branch ?? `compadr/checked-${commit.slice(0, 8)}`,
    title: request.title ?? texts.title(lines.length),
    body:
      request.body ??
      `${texts.intro(commit.slice(0, 8))}\n\n${lines.join('\n')}`,
    files,
  }
}
