// Names the people of the pull request behind a commit, read with the GitHub
// CLI. The engine attributes a record or a check without a declared name to
// the author of the commit that wrote it. When that commit came through a
// merged pull request, the people who approved it, or else the person who
// merged it, replace that author. Without gh, without a GitHub remote or
// without network, the report keeps the commit author, and the server asks
// again a minute later.
import type { Attribution, DriftReport } from '@compadr/format'
import { runGh, type GhRunner } from './pull-requests.ts'

export type PullRequestAttribution = Required<
  Pick<Attribution, 'names' | 'pullRequest'>
>

/**
 * The pull request attribution of a commit, or null when there is none. The
 * promise fails when gh cannot answer.
 */
export type CommitLookup = (
  repository: string,
  commit: string
) => Promise<PullRequestAttribution | null>

interface GhCommitPull {
  number: number
  title: string
  html_url: string
  merged_at: string | null
  merge_commit_sha: string | null
}

interface GhPullView {
  reviews: { author: { login: string } | null; state: string }[]
  mergedBy: { login: string } | null
}

/**
 * Reviewers whose last verdict is an approval, in the order of their first
 * review. A comment is no verdict: it leaves an approval in place.
 */
export function approvers(reviews: GhPullView['reviews']): string[] {
  const verdicts = new Map<string, string>()
  for (const { author, state } of reviews) {
    if (author === null || state === 'COMMENTED' || state === 'PENDING') {
      continue
    }
    verdicts.set(author.login, state)
  }
  return [...verdicts]
    .filter(([, state]) => state === 'APPROVED')
    .map(([login]) => login)
}

/**
 * The merged pull request of a commit and its approvers, or else its
 * merger, as GitHub logins. Null when gh finds no merged pull request; an
 * error when gh cannot answer.
 */
export async function pullRequestOfCommit(
  repository: string,
  commit: string,
  run: GhRunner = runGh
): Promise<PullRequestAttribution | null> {
  const pulls = JSON.parse(
    await run(repository, [
      'api',
      `repos/{owner}/{repo}/commits/${commit}/pulls`,
    ])
  ) as GhCommitPull[]
  const merged = pulls.filter(pull => pull.merged_at !== null)
  // The pull request whose merge made the commit, or else the first one
  // that brought it.
  const pull =
    merged.find(p => p.merge_commit_sha === commit) ?? merged[0] ?? null
  if (pull === null) return null
  const view = JSON.parse(
    await run(repository, [
      'pr',
      'view',
      String(pull.number),
      '--json',
      'reviews,mergedBy',
    ])
  ) as GhPullView
  const approved = approvers(view.reviews)
  const link = { number: pull.number, title: pull.title, url: pull.html_url }
  if (approved.length > 0) {
    return {
      names: approved,
      pullRequest: { ...link, role: 'approved' },
    }
  }
  if (view.mergedBy === null) return null
  return {
    names: [view.mergedBy.login],
    pullRequest: { ...link, role: 'merged' },
  }
}

const CONCURRENCY = 4
/** Time during which a failed lookup is not tried again. */
export const RETRY_AFTER_MS = 60_000

/**
 * A lookup that asks gh once per commit and repository, with at most
 * CONCURRENCY calls at a time. A commit keeps its answer while the server
 * runs: a merged pull request does not change. A failure is kept for
 * `retryAfter` milliseconds only, so that a server started offline or before
 * `gh auth login` names the pull requests once gh answers.
 */
export function commitLookup(
  find: CommitLookup = (repository, commit) =>
    pullRequestOfCommit(repository, commit),
  retryAfter = RETRY_AFTER_MS
): CommitLookup {
  const answers = new Map<string, Promise<PullRequestAttribution | null>>()
  const waiting: (() => void)[] = []
  let running = 0
  const slot = async () => {
    if (running >= CONCURRENCY) {
      await new Promise<void>(done => waiting.push(done))
    } else {
      running++
    }
  }
  const release = () => {
    // The slot passes to the next waiter as it is: a call made in between
    // finds it taken.
    const next = waiting.shift()
    if (next === undefined) running--
    else next()
  }
  return (repository, commit) => {
    const key = `${repository}\0${commit}`
    let answer = answers.get(key)
    if (answer === undefined) {
      answer = slot().then(async () => {
        try {
          return await find(repository, commit)
        } finally {
          release()
        }
      })
      answers.set(key, answer)
      answer.catch(() => {
        setTimeout(() => {
          if (answers.get(key) === answer) answers.delete(key)
        }, retryAfter).unref()
      })
    }
    return answer
  }
}

/**
 * The report with each attribution to a commit author replaced by the
 * people of the pull request of that commit, when there is one. A declared
 * name stays first. The report itself is left unchanged. `complete` is false
 * when gh could not answer for a commit, whose author then stays.
 */
export async function attributeToPullRequests(
  repository: string,
  report: DriftReport,
  lookup: CommitLookup
): Promise<{ report: DriftReport; complete: boolean }> {
  const commits = new Set<string>()
  const fromCommit = (attribution: Attribution | undefined) =>
    attribution?.source === 'commit' && attribution.commit !== undefined
      ? attribution.commit
      : null
  for (const decision of report.decisions) {
    const commit = fromCommit(decision.attribution)
    if (commit !== null) commits.add(commit)
  }
  for (const reference of report.references) {
    const commit = fromCommit(reference.checkedBy)
    if (commit !== null) commits.add(commit)
  }
  if (commits.size === 0) return { report, complete: true }
  let complete = true
  const found = new Map(
    await Promise.all(
      [...commits].map(async commit => {
        try {
          return [commit, await lookup(repository, commit)] as const
        } catch {
          complete = false
          return [commit, null] as const
        }
      })
    )
  )
  const replace = (attribution: Attribution | undefined) => {
    const commit = fromCommit(attribution)
    const pull = commit === null ? null : (found.get(commit) ?? null)
    return pull === null
      ? attribution
      : { ...pull, source: 'pull-request' as const, commit: commit! }
  }
  const attributed = {
    ...report,
    decisions: report.decisions.map(decision =>
      fromCommit(decision.attribution) === null
        ? decision
        : { ...decision, attribution: replace(decision.attribution) }
    ),
    references: report.references.map(reference =>
      fromCommit(reference.checkedBy) === null
        ? reference
        : { ...reference, checkedBy: replace(reference.checkedBy) }
    ),
  }
  return { report: attributed, complete }
}
