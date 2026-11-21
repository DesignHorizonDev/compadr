// The branches of a repository that propose decisions: each branch that
// adds or changes a record with the status "proposed", compared with the
// commit it starts from on the followed reference. Only read-only git
// commands run, and the repository is never written.
import { runGit } from '@compadr/engine'
import { parseAdr, parseAdrFileName } from '@compadr/format'
import type { ProposedRecord } from '../src/reviews.ts'

export interface Branch {
  /** Full name, `refs/heads/x` or `refs/remotes/origin/x`. */
  ref: string
  /** Name without `refs/heads/` or the remote: what a pull request names. */
  name: string
  commit: string
}

const LOCAL = 'refs/heads/'
const REMOTE = /^refs\/remotes\/[^/]+\//

/**
 * The local and remote-tracking branches. A remote branch with the name of a
 * local branch is left out: the local branch is the one the team works on.
 * Of the remote branches that share a name, the one of origin is kept, or
 * else the first: a pull request names its branch without its remote.
 */
export async function branchesOf(repository: string): Promise<Branch[]> {
  const refs = (
    await runGit(repository, 'rev-parse', [
      '--symbolic-full-name',
      '--branches',
      '--remotes',
    ])
  )
    .split('\n')
    .filter(ref => ref !== '' && !ref.endsWith('/HEAD'))
  if (refs.length === 0) return []
  // Each name starts with refs/: none reads as an option. rev-parse would
  // print --end-of-options back as a line of its output.
  const commits = (await runGit(repository, 'rev-parse', refs))
    .trim()
    .split('\n')
  const branches = refs.map((ref, i) => ({
    ref,
    name: ref.startsWith(LOCAL)
      ? ref.slice(LOCAL.length)
      : ref.replace(REMOTE, ''),
    commit: commits[i]!,
  }))
  const kept = new Map<string, Branch>()
  const rank = (b: Branch) =>
    b.ref.startsWith(LOCAL)
      ? 0
      : b.ref.startsWith('refs/remotes/origin/')
        ? 1
        : 2
  for (const branch of branches) {
    const current = kept.get(branch.name)
    if (current === undefined || rank(branch) < rank(current)) {
      kept.set(branch.name, branch)
    }
  }
  return branches.filter(b => kept.get(b.name) === b)
}

/** The records of the ADR folder at a commit, with the object of each. */
async function recordObjects(
  repository: string,
  commit: string,
  adrDir: string
): Promise<Map<string, string>> {
  const listing = await runGit(repository, 'ls-tree', [
    '-z',
    commit,
    '--',
    `${adrDir}/`,
  ])
  const records = new Map<string, string>()
  for (const entry of listing.split('\0')) {
    // <mode> <type> <object>\t<path>
    const tab = entry.indexOf('\t')
    if (tab === -1) continue
    const [, type, object] = entry.slice(0, tab).split(' ')
    const path = entry.slice(tab + 1)
    const name = path.slice(path.lastIndexOf('/') + 1)
    if (type === 'blob' && parseAdrFileName(name) !== null) {
      records.set(path, object!)
    }
  }
  return records
}

/**
 * The records that `commit` adds or changes since `from`, and that have the
 * status "proposed" at `commit`.
 */
export async function proposedRecords(
  repository: string,
  adrDir: string,
  from: string,
  commit: string
): Promise<ProposedRecord[]> {
  const [before, after] = await Promise.all([
    recordObjects(repository, from, adrDir),
    recordObjects(repository, commit, adrDir),
  ])
  const proposed: ProposedRecord[] = []
  for (const [file, object] of after) {
    const previous = before.get(file)
    if (previous === object) continue
    const content = await runGit(repository, 'show', [`${commit}:${file}`])
    const record = parseAdr(file.slice(file.lastIndexOf('/') + 1), content)
    if (record?.status !== 'proposed') continue
    proposed.push({
      number: record.number,
      title: record.title,
      file,
      change: previous === undefined ? 'added' : 'changed',
    })
  }
  return proposed.sort((a, b) => a.number - b.number)
}

/** A branch ahead of the base, with the records it proposes. */
export interface BranchUnderReview {
  branch: Branch
  /** The commit where the branch leaves the base. */
  from: string
  /** Empty for a branch that changes the code without proposing a record. */
  proposed: ProposedRecord[]
}

/**
 * The branches ahead of `base`, compared with it: those that propose
 * decisions, and those that propose none.
 */
export async function findReviews(
  repository: string,
  adrDir: string,
  base: string
): Promise<BranchUnderReview[]> {
  const found: BranchUnderReview[] = []
  for (const branch of await branchesOf(repository)) {
    if (branch.commit === base) continue
    // The commit the branch starts from: a branch behind the base does not
    // propose the records that the base changed since.
    let from: string
    try {
      from = (
        await runGit(repository, 'merge-base', [base, branch.commit])
      ).trim()
    } catch {
      continue // No common history with the base.
    }
    if (from === branch.commit) continue
    const proposed = await proposedRecords(
      repository,
      adrDir,
      from,
      branch.commit
    )
    found.push({ branch, from, proposed })
  }
  return found.sort((a, b) => a.branch.name.localeCompare(b.branch.name))
}
