// The commands that carry out a review on GitHub. The console never runs
// them: the person who reviews copies them, or acts on the pull request page.
import type { ReviewSummary } from '../reviews.ts'

/** `text` as one argument of a POSIX shell. */
export function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`
}

/** Quotes a shell argument when it holds anything but safe characters. */
export function shellArgument(value: string): string {
  return /^[\w./:@%+=-]+$/.test(value) ? value : shellQuote(value)
}

export interface ReviewCommands {
  accept: string
  requestChanges: string
  /** Null until the reason of the rejection is written. */
  reject: string | null
}

/** The gh commands for the pull request of a review, if it has one. */
export function reviewCommands(
  review: ReviewSummary,
  reason: string
): ReviewCommands | null {
  const pr = review.pullRequest
  if (pr === null) return null
  return {
    accept: `gh pr review ${pr.number} --approve`,
    requestChanges: `gh pr review ${pr.number} --request-changes --body ${shellQuote('<what to change>')}`,
    reject:
      reason.trim() === ''
        ? null
        : `gh pr close ${pr.number} --comment ${shellQuote(`Rejected: ${reason.trim()}`)}`,
  }
}

/** The command that opens a draft pull request for a branch without one. */
export function openPullRequestCommand(
  review: ReviewSummary,
  title: string
): string {
  return `gh pr create --draft --head ${shellQuote(review.branch)} --title ${shellQuote(title)} --body ${shellQuote('Proposes a decision for review.')}`
}
