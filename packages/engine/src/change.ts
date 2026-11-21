// What `check_change_against_decisions` answers: the decisions that a change
// falls under, and the signals that the change would raise in the drift
// report. The change is a unified diff against the commit of the report.
import {
  decisionsForFile,
  isInForce,
  normalizeRepositoryPath,
  parseAdrFileName,
  type DecisionStatus,
  type DriftReport,
  type FileDecision,
} from '@compadr/format'
import { citedDecisions, isCode } from './read-corpus.ts'

export interface ChangedFile {
  /** Path after the change; the old path for a deleted file. */
  path: string
  /** Path before the change; null for an added file. */
  from: string | null
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  /** Old lines that the change removes or replaces, as runs. */
  removed: { start: number; end: number }[]
  /** Old lines before which the change inserts new lines. */
  insertedBefore: number[]
  /** Lines that the change adds, with their number in the new file. */
  added: { line: number; text: string }[]
}

type ReadFile = ChangedFile & { hunks?: boolean }

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/** `"a/x y.ts"\t2026-01-01` → `x y.ts`. */
function diffPath(raw: string, prefix: string): string | null {
  let path = raw.split('\t')[0]!.trim()
  if (path.startsWith('"') && path.endsWith('"')) {
    path = path.slice(1, -1).replace(/\\(["\\])/g, '$1')
  }
  if (path === '/dev/null') return null
  if (path.startsWith(prefix)) path = path.slice(prefix.length)
  return normalizeRepositoryPath(path)
}

/**
 * Reads a unified diff, as `git diff` writes it, with or without the
 * `a/` and `b/` prefixes. A binary file appears with its status and no line.
 * The counts of each hunk tell its lines from the headers that follow it.
 */
export function parseUnifiedDiff(diff: string): ChangedFile[] {
  const files: ReadFile[] = []
  // Assigned inside `open`: the cast keeps TypeScript from narrowing it to null.
  let file = null as ReadFile | null
  // Lines of the current hunk still to read, on each side.
  let oldLeft = 0
  let newLeft = 0
  let oldLine = 0
  let newLine = 0
  let run: { start: number; end: number } | null = null
  const closeRun = () => {
    if (run && file) file.removed.push(run)
    run = null
  }
  const open = (from: string | null, path: string): ReadFile => {
    closeRun()
    file = {
      path,
      from,
      status: from === null ? 'added' : 'modified',
      removed: [],
      insertedBefore: [],
      added: [],
    }
    files.push(file)
    return file
  }

  for (const line of diff.replace(/\r\n/g, '\n').split('\n')) {
    if (file && (oldLeft > 0 || newLeft > 0)) {
      const current: ChangedFile = file
      if (line.startsWith('-')) {
        if (run && run.end === oldLine - 1) run.end = oldLine
        else {
          closeRun()
          run = { start: oldLine, end: oldLine }
        }
        oldLine++
        oldLeft--
      } else if (line.startsWith('+')) {
        if (!run && current.insertedBefore.at(-1) !== oldLine) {
          current.insertedBefore.push(oldLine)
        }
        current.added.push({ line: newLine, text: line.slice(1) })
        newLine++
        newLeft--
      } else if (line.startsWith(' ') || line === '') {
        closeRun()
        oldLine++
        newLine++
        oldLeft--
        newLeft--
      }
      // "\ No newline at end of file" counts on neither side.
      continue
    }
    closeRun()
    const git =
      /^diff --git "?a\/(.+?)"? "?b\/(.+?)"?$/.exec(line) ??
      /^diff --git (\S+) (\S+)$/.exec(line)
    if (git) {
      open(normalizeRepositoryPath(git[1]!), normalizeRepositoryPath(git[2]!))
      continue
    }
    if (line.startsWith('--- ')) {
      const from = diffPath(line.slice(4), 'a/')
      // A diff without `diff --git` lines starts each file here.
      const current: ReadFile =
        file && file.removed.length + file.added.length === 0 && !file.hunks
          ? file
          : open(from, from ?? '')
      current.from = from
      if (from === null) current.status = 'added'
      continue
    }
    if (!file) continue
    const current: ReadFile = file
    const hunk = HUNK.exec(line)
    if (hunk) {
      current.hunks = true
      oldLeft = hunk[2] === undefined ? 1 : Number(hunk[2])
      newLeft = hunk[4] === undefined ? 1 : Number(hunk[4])
      // `-12,0` inserts after line 12: the next old line is 13.
      oldLine = Number(hunk[1]) + (oldLeft === 0 ? 1 : 0)
      newLine = Number(hunk[3])
    } else if (line.startsWith('+++ ')) {
      const path = diffPath(line.slice(4), 'b/')
      if (path === null) {
        current.status = 'deleted'
        current.path = current.from ?? current.path
      } else {
        current.path = path
        if (current.from === null) current.status = 'added'
        else if (current.from !== path) current.status = 'renamed'
      }
    } else if (line.startsWith('new file mode')) {
      current.status = 'added'
      current.from = null
    } else if (line.startsWith('deleted file mode')) {
      current.status = 'deleted'
      current.path = current.from ?? current.path
    } else if (line.startsWith('rename from ')) {
      current.from = normalizeRepositoryPath(line.slice(12))
      current.status = 'renamed'
    } else if (line.startsWith('rename to ')) {
      current.path = normalizeRepositoryPath(line.slice(10))
      current.status = 'renamed'
    }
  }
  closeRun()
  return files
    .filter(file => file.path !== '')
    .map(file => {
      delete file.hunks
      return file
    })
}

export type ChangeSignal =
  | {
      type: 'cited-path-removed'
      level: 'broken'
      decision: number
      reference: string
      text: string
      path: string
      /** New path of a renamed file, to write in the record. */
      renamedTo: string | null
    }
  | {
      type: 'cited-lines-changed'
      level: 'review'
      decision: number
      reference: string
      text: string
      path: string
      lines: { start: number; end: number }
    }
  | {
      type: 'superseded-decision-cited' | 'unknown-decision-cited'
      level: 'broken'
      decision: number
      path: string
      line: number
      /** Decisions that replace the cited one. */
      supersededBy: number[]
    }

interface ChangeDecision {
  decision: number
  title: string
  /** What the decision requires; absent when the record has no rule. */
  rule?: string
  status: DecisionStatus
  /** `file` when a link names a changed file itself. */
  scope: 'file' | 'folder'
  replaces: number[]
  /** Changed files that the decision applies to. */
  files: string[]
}

function touches(
  file: ChangedFile,
  lines: { start: number; end: number }
): boolean {
  return (
    file.removed.some(
      run => run.start <= lines.end && run.end >= lines.start
    ) ||
    // A line inserted inside the cited block changes it; one inserted just
    // before or after it does not.
    file.insertedBefore.some(line => line > lines.start && line <= lines.end)
  )
}

/** The decisions and the signals of a change, read from the report. */
export function checkChange(report: DriftReport, files: ChangedFile[]) {
  const byNumber = new Map(report.decisions.map(d => [d.number, d]))
  const adrDir = `${report.repository.adrDir}/`

  const inForce = new Map<number, ChangeDecision>()
  const context = new Map<number, ChangeDecision>()
  const collect =
    (into: Map<number, ChangeDecision>, path: string) =>
    (entry: FileDecision) => {
      const rule = byNumber.get(entry.decision)?.rule?.text
      const current = into.get(entry.decision) ?? {
        decision: entry.decision,
        title: entry.title,
        ...(rule === undefined ? {} : { rule }),
        status: entry.status,
        scope: entry.scope,
        replaces: [],
        files: [],
      }
      if (entry.scope === 'file') current.scope = 'file'
      current.replaces = [...new Set([...current.replaces, ...entry.replaces])]
      if (!current.files.includes(path)) current.files.push(path)
      into.set(entry.decision, current)
    }
  for (const file of files) {
    // A file keeps the decisions of its old path, and gains those of its
    // new folder.
    for (const path of new Set([file.from, file.path])) {
      if (path === null) continue
      const answer = decisionsForFile(report, path)
      // A Markdown file that lists decisions, such as a history or a guide,
      // does not fall under them: only the records that cite it count.
      const binds = (entry: FileDecision) =>
        isCode(path) ||
        entry.links.some(link => link.source === 'record-cites-path')
      answer.inForce.filter(binds).forEach(collect(inForce, file.path))
      answer.context.filter(binds).forEach(collect(context, file.path))
    }
  }
  const order = (a: ChangeDecision, b: ChangeDecision) =>
    (a.scope === 'file' ? 0 : 1) - (b.scope === 'file' ? 0 : 1) ||
    b.files.length - a.files.length ||
    a.decision - b.decision

  const signals: ChangeSignal[] = []
  const gone = new Map<string, ChangedFile>()
  for (const file of files) {
    if (file.status === 'deleted' || file.status === 'renamed') {
      gone.set(file.from ?? file.path, file)
    }
  }
  const changed = new Map(
    files
      .filter(file => file.from !== null && file.status !== 'deleted')
      .map(file => [file.from!, file])
  )
  for (const reference of report.references) {
    if (reference.kind !== 'path') continue
    const decision = byNumber.get(reference.decision)
    if (decision === undefined || !isInForce(decision.status)) continue
    for (const path of reference.resolvedPaths) {
      const removed = gone.get(path)
      if (removed) {
        signals.push({
          type: 'cited-path-removed',
          level: 'broken',
          decision: reference.decision,
          reference: reference.id,
          text: reference.text,
          path,
          renamedTo: removed.status === 'renamed' ? removed.path : null,
        })
      }
    }
    const [path] = reference.resolvedPaths
    const file = path === undefined ? undefined : changed.get(path)
    if (
      reference.lines !== null &&
      reference.resolvedPaths.length === 1 &&
      file !== undefined &&
      touches(file, reference.lines)
    ) {
      signals.push({
        type: 'cited-lines-changed',
        level: 'review',
        decision: reference.decision,
        reference: reference.id,
        text: reference.text,
        path: path!,
        lines: reference.lines,
      })
    }
  }

  // A record added by the change can be cited by the same change.
  const added = new Set(
    files
      .filter(file => file.status !== 'deleted' && file.path.startsWith(adrDir))
      .map(file => parseAdrFileName(file.path.slice(adrDir.length))?.number)
      .filter(number => number !== undefined)
  )
  for (const file of files) {
    if (file.path.startsWith(adrDir) || !isCode(file.path)) continue
    for (const { line, text } of file.added) {
      for (const number of new Set(citedDecisions(text))) {
        const decision = byNumber.get(number)
        if (decision === undefined && !added.has(number)) {
          signals.push({
            type: 'unknown-decision-cited',
            level: 'broken',
            decision: number,
            path: file.path,
            line,
            supersededBy: [],
          })
        } else if (decision !== undefined && !isInForce(decision.status)) {
          signals.push({
            type: 'superseded-decision-cited',
            level: 'broken',
            decision: number,
            path: file.path,
            line,
            supersededBy: decision.supersededBy,
          })
        }
      }
    }
  }
  const rank = { broken: 0, review: 1 }
  signals.sort(
    (a, b) => rank[a.level] - rank[b.level] || a.decision - b.decision
  )

  return {
    files: files.map(({ path, from, status }) => ({
      path,
      ...(from !== null && from !== path ? { from } : {}),
      status,
    })),
    signals,
    inForce: [...inForce.values()].sort(order),
    context: [...context.values()].sort(order),
  }
}
