import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  hasSigned,
  isExempt,
  isSignature,
  isStaleWrite,
  requestComment,
  run,
  SENTENCE,
} from './cla.mjs'

/** A fake of the part of Octokit that tools/cla.mjs uses. */
function fakeGithub({
  signatures,
  branch = true,
  prAuthor,
  permission = 'none',
}) {
  const calls = []
  let file =
    signatures === undefined
      ? undefined
      : { text: JSON.stringify(signatures), sha: 's1' }
  const notFound = () => Object.assign(new Error('Not Found'), { status: 404 })
  const github = {
    calls,
    file: () => file,
    paginate: async (_method, params) => {
      calls.push(['listComments', params.issue_number])
      return []
    },
    rest: {
      repos: {
        getCollaboratorPermissionLevel: async () => {
          calls.push(['permission'])
          if (permission === 'none') throw notFound()
          return { data: { permission } }
        },
        getContent: async () => {
          if (file === undefined) throw notFound()
          return {
            data: {
              content: Buffer.from(file.text).toString('base64'),
              sha: file.sha,
            },
          }
        },
        createOrUpdateFileContents: async params => {
          calls.push(['write', params.branch, params.sha])
          file = {
            text: Buffer.from(params.content, 'base64').toString('utf8'),
            sha: 's2',
          }
        },
        createCommitStatus: async params => {
          calls.push(['status', params.sha, params.state])
        },
      },
      issues: {
        listComments: Symbol('listComments'),
        createComment: async params => {
          calls.push(['comment', params.issue_number])
        },
      },
      pulls: {
        get: async () => ({
          data: { number: 7, user: prAuthor, head: { sha: 'head' } },
        }),
      },
      git: {
        getRef: async () => {
          if (!branch) throw notFound()
          return { data: {} }
        },
        createTree: async () => {
          calls.push(['tree'])
          return { data: { sha: 't' } }
        },
        createCommit: async params => {
          calls.push(['commit', params.parents.length])
          return { data: { sha: 'c' } }
        },
        createRef: async params => {
          calls.push(['ref', params.ref])
          branch = true
        },
      },
    },
  }
  return github
}

const repo = { owner: 'o', repo: 'r' }
const outsider = { id: 42, login: 'ada', type: 'User' }

describe('the rules of the agreement', () => {
  it('exempts bots and the people of the organization', () => {
    assert.equal(isExempt({ type: 'Bot' }, 'NONE'), true)
    assert.equal(isExempt({ type: 'User' }, 'MEMBER'), true)
    assert.equal(isExempt({ type: 'User' }, 'OWNER'), true)
    assert.equal(isExempt({ type: 'User' }, 'CONTRIBUTOR'), false)
    // An outside collaborator is not covered by a contract of ours.
    assert.equal(isExempt({ type: 'User' }, 'COLLABORATOR', 'read'), false)
    // A private member of the organization reads CONTRIBUTOR in the event.
    assert.equal(isExempt({ type: 'User' }, 'CONTRIBUTOR', 'admin'), true)
    assert.equal(isExempt({ type: 'User' }, 'CONTRIBUTOR', 'write'), true)
    assert.equal(isExempt({ type: 'User' }, 'CONTRIBUTOR', 'triage'), false)
    assert.equal(isExempt({ type: 'User' }, 'FIRST_TIME_CONTRIBUTOR'), false)
  })

  it('takes the exact sentence only, spaces around it aside', () => {
    assert.equal(isSignature(SENTENCE), true)
    assert.equal(isSignature(`  ${SENTENCE}\n`), true)
    assert.equal(isSignature(SENTENCE.toLowerCase()), false)
    assert.equal(isSignature(`${SENTENCE} Thanks!`), false)
    assert.equal(isSignature(undefined), false)
  })

  it('finds a signature by the numeric id, which survives a rename', () => {
    const signatures = [{ id: 42, login: 'old-name' }]
    assert.equal(hasSigned(signatures, outsider), true)
    assert.equal(hasSigned(signatures, { id: 43, login: 'old-name' }), false)
  })

  it('retries a stale write only, and not another refusal', () => {
    assert.equal(isStaleWrite({ status: 409, message: 'Conflict' }), true)
    assert.equal(
      isStaleWrite({ status: 422, message: "sha wasn't supplied." }),
      true
    )
    assert.equal(
      isStaleWrite({ status: 422, message: 'Invalid request: content' }),
      false
    )
    assert.equal(isStaleWrite({ status: 500, message: 'sha' }), false)
  })

  it('asks with the sentence and the link to the agreement', () => {
    const text = requestComment('ada')
    assert.match(text, /@ada/)
    assert.ok(text.includes(SENTENCE))
    assert.match(text, /CLA\.md/)
  })
})

describe('the workflow', () => {
  it('filters the comments on the sentence of tools/cla.mjs', async () => {
    const { readFile } = await import('node:fs/promises')
    const workflow = await readFile(
      new URL('../.github/workflows/cla.yml', import.meta.url),
      'utf8'
    )
    assert.ok(
      workflow.includes(`contains(github.event.comment.body, '${SENTENCE}')`)
    )
  })
})

describe('run', () => {
  const pullRequest = (user, association) => ({
    eventName: 'pull_request_target',
    repo,
    payload: {
      pull_request: {
        number: 7,
        user,
        author_association: association,
        head: { sha: 'head' },
      },
    },
  })

  it('passes a member without reading the signatures', async () => {
    const github = fakeGithub({})
    await run({ github, context: pullRequest(outsider, 'MEMBER') })
    assert.deepEqual(github.calls, [
      ['permission'],
      ['status', 'head', 'success'],
    ])
  })

  it('passes a private member, whom the event shows as a contributor', async () => {
    const github = fakeGithub({ permission: 'admin' })
    await run({ github, context: pullRequest(outsider, 'CONTRIBUTOR') })
    assert.deepEqual(github.calls, [
      ['permission'],
      ['status', 'head', 'success'],
    ])
  })

  it('fails an outsider who has not signed, and asks once', async () => {
    const github = fakeGithub({ signatures: [] })
    await run({ github, context: pullRequest(outsider, 'CONTRIBUTOR') })
    assert.deepEqual(github.calls, [
      ['permission'],
      ['status', 'head', 'failure'],
      ['listComments', 7],
      ['comment', 7],
    ])
  })

  it('passes an outsider who has signed', async () => {
    const github = fakeGithub({ signatures: [{ id: 42 }] })
    await run({ github, context: pullRequest(outsider, 'CONTRIBUTOR') })
    assert.deepEqual(github.calls, [
      ['permission'],
      ['status', 'head', 'success'],
    ])
  })

  const comment = (user, body) => ({
    eventName: 'issue_comment',
    repo,
    payload: {
      issue: { number: 7, pull_request: {} },
      comment: {
        user,
        body,
        created_at: '2026-11-21T10:00:00Z',
        html_url: 'https://example.test/c',
      },
    },
  })

  it('records the signature of the author, on a new branch without parent', async () => {
    const github = fakeGithub({ branch: false, prAuthor: outsider })
    await run({ github, context: comment(outsider, SENTENCE) })
    assert.deepEqual(github.calls, [
      ['tree'],
      ['commit', 0],
      ['ref', 'refs/heads/cla-signatures'],
      ['write', 'cla-signatures', undefined],
      ['status', 'head', 'success'],
    ])
    assert.deepEqual(JSON.parse(github.file().text), [
      {
        login: 'ada',
        id: 42,
        date: '2026-11-21T10:00:00Z',
        version: '1.0',
        pullRequest: 7,
        comment: 'https://example.test/c',
      },
    ])
  })

  it('ignores the sentence posted by someone else than the author', async () => {
    const github = fakeGithub({ signatures: [], prAuthor: outsider })
    await run({
      github,
      context: comment({ id: 99, login: 'eve', type: 'User' }, SENTENCE),
    })
    assert.deepEqual(github.calls, [])
  })

  it('ignores another comment and a comment on an issue', async () => {
    const github = fakeGithub({ signatures: [], prAuthor: outsider })
    await run({ github, context: comment(outsider, 'LGTM') })
    const onIssue = comment(outsider, SENTENCE)
    delete onIssue.payload.issue.pull_request
    await run({ github, context: onIssue })
    assert.deepEqual(github.calls, [])
  })
})
