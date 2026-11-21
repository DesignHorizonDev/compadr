// The token that a portal with sign-in asks for on each request that
// writes. The portal puts it in a cookie that the page can read, and checks
// that the request repeats it in a header: a page of another site can send
// the cookie, but it cannot read it.

export const CSRF_HEADER = 'X-Compadr-CSRF'

/** The headers that carry the token, or none without a portal session. */
export function csrfHeaders(
  // The server of the portal reads this module too, without a document.
  cookies: string = (globalThis as { document?: { cookie: string } }).document
    ?.cookie ?? ''
): Record<string, string> {
  for (const part of cookies.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === 'compadr_csrf' || name === '__Host-compadr_csrf') {
      try {
        return { [CSRF_HEADER]: decodeURIComponent(rest.join('=')) }
      } catch {
        return {}
      }
    }
  }
  return {}
}
