// Collects the signatures of the contributor license agreement (CLA.md) in
// pull requests. Run by .github/workflows/cla.yml, from the default branch:
// the code of a pull request never runs here.
//
// - On a pull request, the check `cla` passes when its author is exempt or
//   has signed. Otherwise it fails, and one comment says how to sign.
// - A comment of the author of the pull request that is exactly SENTENCE
//   records the signature, then the check passes.
//
// The signatures live in signatures.json on the branch cla-signatures, which
// holds nothing else. The contents API refuses a write on a stale file, so two
// signatures at the same time cannot overwrite each other.

export const SENTENCE = 'I have read the CLA of Compadr and I accept it.'
export const BRANCH = 'cla-signatures'
export const FILE = 'signatures.json'
export const CONTEXT = 'cla'
const AGREEMENT = 'https://github.com/DesignHorizonDev/compadr/blob/main/CLA.md'
// Marks the comment of this tool, so that it is posted once per pull request.
const MARKER = '<!-- compadr-cla -->'

/**
 * Whether an author needs no signature: a bot, or a person of the
 * organization, whose work is covered by their contract.
 *
 * The event of a pull request hides a private membership of the
 * organization: its author_association then reads CONTRIBUTOR. The
 * permission of the author on the repository is read from the API instead.
 * Only the organization gives the write permission.
 */
export function isExempt(user, association, permission) {
  return (
    user.type === 'Bot' ||
    ['OWNER', 'MEMBER'].includes(association) ||
    ['admin', 'maintain', 'write'].includes(permission)
  )
}

async function permissionOf(github, repo, user) {
  if (user.type === 'Bot') return 'none'
  try {
    const { data } = await github.rest.repos.getCollaboratorPermissionLevel({
      ...repo,
      username: user.login,
    })
    return data.permission
  } catch (error) {
    // A person outside the repository has no permission to read.
    if (error.status === 404) return 'none'
    throw error
  }
}

/** Whether a comment is the sentence that signs the agreement. */
export function isSignature(body) {
  return typeof body === 'string' && body.trim() === SENTENCE
}

/** Whether the list of signatures holds the account, by its numeric id. */
export function hasSigned(signatures, user) {
  return signatures.some(signature => signature.id === user.id)
}

/** The comment that asks the author to sign. */
export function requestComment(login) {
  return [
    MARKER,
    `Thank you for your contribution, @${login}.`,
    '',
    `Before we can merge it, please read the [contributor license agreement](${AGREEMENT}). You keep the copyright of your contribution. If you accept the agreement, post a comment in this pull request with exactly this sentence:`,
    '',
    '```text',
    SENTENCE,
    '```',
    '',
    'The signature covers all your later contributions.',
  ].join('\n')
}

async function readSignatures(github, repo) {
  try {
    const { data } = await github.rest.repos.getContent({
      ...repo,
      path: FILE,
      ref: BRANCH,
    })
    const text = Buffer.from(data.content, 'base64').toString('utf8')
    return { signatures: JSON.parse(text), sha: data.sha }
  } catch (error) {
    if (error.status === 404) return { signatures: [], sha: undefined }
    throw error
  }
}

/** Creates the branch with an empty commit, without the code of the repository. */
async function ensureBranch(github, repo) {
  try {
    await github.rest.git.getRef({ ...repo, ref: `heads/${BRANCH}` })
    return
  } catch (error) {
    if (error.status !== 404) throw error
  }
  const { data: tree } = await github.rest.git.createTree({
    ...repo,
    tree: [
      {
        path: 'README.md',
        mode: '100644',
        type: 'blob',
        content:
          'Signatures of the contributor license agreement of Compadr, written by tools/cla.mjs.\n',
      },
    ],
  })
  const { data: commit } = await github.rest.git.createCommit({
    ...repo,
    message: 'chore(cla): start the signatures',
    tree: tree.sha,
    parents: [],
  })
  await github.rest.git.createRef({
    ...repo,
    ref: `refs/heads/${BRANCH}`,
    sha: commit.sha,
  })
}

/**
 * Whether a refused write comes from a file that changed since it was read:
 * 409, or 422 when the API names the sha. Another 422 is a real error.
 */
export function isStaleWrite(error) {
  if (error.status === 409) return true
  return error.status === 422 && /\bsha\b/i.test(String(error.message))
}

async function record(github, repo, signature) {
  await ensureBranch(github, repo)
  let stale
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { signatures, sha } = await readSignatures(github, repo)
    if (signatures.some(s => s.id === signature.id)) return
    const next = [...signatures, signature]
    try {
      await github.rest.repos.createOrUpdateFileContents({
        ...repo,
        path: FILE,
        branch: BRANCH,
        message: `chore(cla): signature of ${signature.login}`,
        content: Buffer.from(`${JSON.stringify(next, null, 2)}\n`).toString(
          'base64'
        ),
        ...(sha === undefined ? {} : { sha }),
      })
      return
    } catch (error) {
      // Another signature was written in between: read again and retry.
      if (!isStaleWrite(error)) throw error
      stale = error
    }
  }
  throw stale
}

async function setStatus(github, repo, sha, signed) {
  await github.rest.repos.createCommitStatus({
    ...repo,
    sha,
    context: CONTEXT,
    state: signed ? 'success' : 'failure',
    description: signed
      ? 'The contributor license agreement is signed.'
      : 'The author has not signed the contributor license agreement.',
    target_url: AGREEMENT,
  })
}

async function askOnce(github, repo, number, login) {
  const comments = await github.paginate(github.rest.issues.listComments, {
    ...repo,
    issue_number: number,
    per_page: 100,
  })
  if (comments.some(comment => comment.body?.includes(MARKER))) return
  await github.rest.issues.createComment({
    ...repo,
    issue_number: number,
    body: requestComment(login),
  })
}

/** Entry point of the workflow, through actions/github-script. */
export async function run({ github, context }) {
  const repo = context.repo
  const event = context.payload

  if (context.eventName === 'pull_request_target') {
    const pr = event.pull_request
    const permission = await permissionOf(github, repo, pr.user)
    if (isExempt(pr.user, pr.author_association, permission)) {
      await setStatus(github, repo, pr.head.sha, true)
      return
    }
    const { signatures } = await readSignatures(github, repo)
    const signed = hasSigned(signatures, pr.user)
    await setStatus(github, repo, pr.head.sha, signed)
    if (!signed) await askOnce(github, repo, pr.number, pr.user.login)
    return
  }

  if (context.eventName === 'issue_comment') {
    if (!event.issue.pull_request || !isSignature(event.comment.body)) return
    const { data: pr } = await github.rest.pulls.get({
      ...repo,
      pull_number: event.issue.number,
    })
    // Only the author of the pull request signs for it.
    if (event.comment.user.id !== pr.user.id) return
    await record(github, repo, {
      login: pr.user.login,
      id: pr.user.id,
      date: event.comment.created_at,
      version: '1.0',
      pullRequest: pr.number,
      comment: event.comment.html_url,
    })
    await setStatus(github, repo, pr.head.sha, true)
  }
}
