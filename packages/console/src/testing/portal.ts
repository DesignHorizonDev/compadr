// A portal source for the tests: each route answers as a console alone
// would, unless the test gives its own answer.
import type { PortalSource } from '../portal.ts'

const none = () => Promise.reject(new Error('no portal'))

export function fakePortal(parts: Partial<PortalSource> = {}): PortalSource {
  return {
    overview: () => Promise.resolve(null),
    queue: () => Promise.resolve({ rows: [] }),
    me: () => Promise.resolve(null),
    people: () => Promise.resolve({ people: [], editors: 0, limit: 5 }),
    setSeat: none,
    signOut: none,
    draftReview: none,
    reviewDraft: none,
    commentDraft: none,
    publishDraft: none,
    githubApp: () => Promise.resolve(null),
    license: () => Promise.resolve(null),
    startGithubApp: none,
    usage: () => Promise.resolve(null),
    setUsageCap: none,
    invitations: () => Promise.resolve(null),
    invite: none,
    ...parts,
  }
}
