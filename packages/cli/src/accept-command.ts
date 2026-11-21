// The correction that accepts a proposed decision: its status becomes
// accepted, on a draft branch that a person reviews and merges. The
// recommendation of the assist service, when there is one, goes into the
// message: a model recommends, a person accepts.
import { recordLanguage } from '@compadr/engine'
import {
  acceptRecordStatus,
  proposedApplied,
  StatusEditError,
  type AcceptRecommendation,
  type DriftReport,
} from '@compadr/format'
import type { Correction } from './publish.ts'

export class AcceptCommandError extends Error {}

/** The recommendation that the person followed, as the message names it. */
export interface FollowedRecommendation {
  recommendation: AcceptRecommendation
  model: string
  promptVersion: string
}

export interface AcceptRequest {
  decision: number
  /** Day of the acceptance, YYYY-MM-DD. */
  date: string
  recommendation?: FollowedRecommendation
}

const pad = (n: number) => String(n).padStart(4, '0')

const TEXTS = {
  en: {
    title: (n: number) => `docs(adr): accept ADR ${pad(n)}`,
    body: (n: number, commit: string) =>
      `A person accepts ADR ${pad(n)}, proposed until commit ${commit}.`,
    cited: (files: number) =>
      files === 1
        ? '1 file of the code already cited it.'
        : `${files} files of the code already cited it.`,
    followed: (r: FollowedRecommendation) =>
      `The assist service recommended it (${r.model}, ${r.promptVersion}).`,
  },
  fr: {
    title: (n: number) => `docs(adr): accepter l'ADR ${pad(n)}`,
    body: (n: number, commit: string) =>
      `Une personne accepte l'ADR ${pad(n)}, proposé jusqu'au commit ${commit}.`,
    cited: (files: number) =>
      files === 1
        ? '1 fichier du code le citait déjà.'
        : `${files} fichiers du code le citaient déjà.`,
    followed: (r: FollowedRecommendation) =>
      `Le service d'assistance l'a recommandé (${r.model}, ${r.promptVersion}).`,
  },
}

export async function buildAcceptCorrection(
  repository: string,
  report: DriftReport,
  request: AcceptRequest,
  readFile: (file: string) => Promise<string>
): Promise<Correction> {
  const decision = report.decisions.find(d => d.number === request.decision)
  if (decision === undefined) {
    throw new AcceptCommandError(
      `no decision ${request.decision} in the report`
    )
  }
  if (decision.status !== 'proposed') {
    throw new AcceptCommandError(
      `ADR ${pad(decision.number)} is ${decision.status}, not proposed`
    )
  }
  if (
    request.recommendation !== undefined &&
    request.recommendation.recommendation !== 'accept'
  ) {
    throw new AcceptCommandError(
      `the recommendation is ${request.recommendation.recommendation}, not accept`
    )
  }
  let text: string
  try {
    text = acceptRecordStatus(await readFile(decision.file), request.date)
  } catch (error) {
    if (error instanceof StatusEditError) {
      throw new AcceptCommandError(
        `ADR ${pad(decision.number)}: ${error.message}`
      )
    }
    throw error
  }
  const commit = report.repository.commit
  const texts = TEXTS[recordLanguage(report)]
  const cited =
    proposedApplied(report).find(p => p.decision.number === decision.number)
      ?.files.length ?? 0
  return {
    repository,
    commit,
    branch: `compadr/accept-${pad(decision.number)}-${commit.slice(0, 8)}`,
    title: texts.title(decision.number),
    body: [
      texts.body(decision.number, commit.slice(0, 8)),
      ...(cited === 0 ? [] : [texts.cited(cited)]),
      ...(request.recommendation === undefined
        ? []
        : [texts.followed(request.recommendation)]),
    ].join(' '),
    files: new Map([[decision.file, text]]),
  }
}
