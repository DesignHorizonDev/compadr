// The address of a link that the data of a report gives, such as the pull
// request of a branch. Only an https address becomes a link: React already
// refuses `javascript:`, and this keeps out every other scheme too.
export function safeHref(url: string | null | undefined): string | undefined {
  return typeof url === 'string' && /^https:\/\//i.test(url) ? url : undefined
}
