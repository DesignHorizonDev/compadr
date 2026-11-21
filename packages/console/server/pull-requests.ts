// The open pull requests of a repository, read with the GitHub CLI. They
// only name the pull request of a branch under review: without gh, without
// a GitHub remote or without network, the reviews show their branch alone.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { PullRequestLink } from '../src/reviews.ts'

const exec = promisify(execFile)

export interface OpenPullRequest extends PullRequestLink {
  /** Branch of the pull request, as a branch name without its remote. */
  branch: string
}

/** Runs gh in the repository and returns its standard output. */
export type GhRunner = (repository: string, args: string[]) => Promise<string>

export const runGh: GhRunner = async (repository, args) =>
  (
    await exec('gh', args, {
      cwd: repository,
      timeout: 15_000,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' },
    })
  ).stdout

interface GhPullRequest {
  number: number
  title: string
  url: string
  isDraft: boolean
  headRefName: string
}

/** The open pull requests, or none when gh cannot list them. */
export async function openPullRequests(
  repository: string,
  run: GhRunner = runGh
): Promise<OpenPullRequest[]> {
  let output: string
  try {
    output = await run(repository, [
      'pr',
      'list',
      '--state',
      'open',
      '--limit',
      '100',
      '--json',
      'number,title,url,isDraft,headRefName',
    ])
  } catch {
    return []
  }
  try {
    return (JSON.parse(output) as GhPullRequest[]).map(pr => ({
      number: pr.number,
      title: pr.title,
      url: pr.url,
      draft: pr.isDraft,
      branch: pr.headRefName,
    }))
  } catch {
    return []
  }
}
