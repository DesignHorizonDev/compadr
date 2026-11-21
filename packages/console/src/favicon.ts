import faviconUrl from '@compadr/tokens/favicon.svg'

/** Links the Compadr icon from the page, once. */
export function addFavicon(document: Document): void {
  const link =
    document.head.querySelector<HTMLLinkElement>('link[rel="icon"]') ??
    document.head.appendChild(document.createElement('link'))
  link.rel = 'icon'
  link.type = 'image/svg+xml'
  link.href = faviconUrl
}
