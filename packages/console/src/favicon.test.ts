import faviconUrl from '@compadr/tokens/favicon.svg'
import { describe, expect, it } from 'vitest'
import { addFavicon } from './favicon.ts'

describe('addFavicon', () => {
  it('links the favicon of the tokens package', () => {
    addFavicon(document)
    const link =
      document.head.querySelector<HTMLLinkElement>('link[rel="icon"]')
    expect(link?.type).toBe('image/svg+xml')
    expect(link?.getAttribute('href')).toBe(faviconUrl)
  })

  it('keeps a single icon link when called twice', () => {
    addFavicon(document)
    addFavicon(document)
    expect(document.head.querySelectorAll('link[rel="icon"]')).toHaveLength(1)
  })
})
