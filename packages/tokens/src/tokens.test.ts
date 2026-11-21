import { readFileSync } from 'node:fs'
import { SIGNAL_LEVELS } from '@compadr/format'
import { describe, expect, it } from 'vitest'
import { brand, cssVariables, neutral, states, tokensCss } from './tokens.ts'

/** WCAG 2 relative luminance of a `#RRGGBB` color. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(i => {
    const channel = parseInt(hex.slice(i, i + 2), 16) / 255
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ]
  return (light + 0.05) / (dark + 0.05)
}

function asset(name: string): string {
  return readFileSync(new URL(`../assets/${name}`, import.meta.url), 'utf8')
}

describe('tokens', () => {
  it('matches the committed CSS (run `yarn workspace @compadr/tokens css`)', () => {
    const committed = readFileSync(
      new URL('../css/tokens.css', import.meta.url),
      'utf8'
    )
    expect(committed).toBe(tokensCss())
  })

  it('names every CSS variable once', () => {
    const names = cssVariables().map(([name]) => name)
    expect(new Set(names).size).toBe(names.length)
    expect(names).toContain('--compadr-state-broken-bg')
    expect(names).toContain('--compadr-text-muted')
  })

  it.each(['text', 'textSecondary', 'textTertiary', 'textMuted'] as const)(
    'keeps %s readable on the surfaces (4.5:1)',
    name => {
      for (const surface of [
        neutral.surface,
        neutral.surfaceSubtle,
        neutral.canvas,
      ]) {
        expect(contrast(neutral[name], surface)).toBeGreaterThanOrEqual(4.5)
      }
    }
  )

  it.each([
    ['text', neutral.text],
    ['textSecondary', neutral.textSecondary],
    ['textTertiary', neutral.textTertiary],
    ['cobalt', brand.cobalt],
  ])('keeps %s readable on the selected background (4.5:1)', (_, color) => {
    expect(contrast(color, neutral.selected)).toBeGreaterThanOrEqual(4.5)
  })

  it('gives a color to every signal level of the drift report', () => {
    expect(Object.keys(states).sort()).toEqual(
      [...SIGNAL_LEVELS, 'inSync'].sort()
    )
  })

  it.each(Object.keys(states) as (keyof typeof states)[])(
    'keeps the %s badge readable (4.5:1) and its solid color visible (3:1)',
    name => {
      const colors = states[name]
      expect(contrast(colors.text, colors.background)).toBeGreaterThanOrEqual(
        4.5
      )
      expect(contrast(colors.solid, neutral.surface)).toBeGreaterThanOrEqual(3)
    }
  )

  it('keeps the red of broken distinct from the brand vermilion', () => {
    expect(states.broken.solid).not.toBe(brand.vermilion)
  })
})

describe('logo and favicon', () => {
  const brandColors = new Set<string>(Object.values(brand))

  it.each(['logo-light.svg', 'logo-dark.svg', 'favicon.svg'])(
    '%s uses the brand colors only',
    name => {
      const fills = [...asset(name).matchAll(/fill="([^"]+)"/g)].map(
        match => match[1]
      )
      expect(fills.length).toBeGreaterThan(0)
      for (const fill of fills) expect(brandColors).toContain(fill)
    }
  )

  it.each(['logo-light.svg', 'logo-dark.svg', 'favicon.svg'])(
    '%s has a title and no background',
    name => {
      const svg = asset(name)
      expect(svg).toContain('<title>Compadr</title>')
      expect(svg).not.toContain('<rect')
    }
  )

  it('draws the dark logo with the same shapes as the light one', () => {
    const shapes = (svg: string) =>
      [...svg.matchAll(/ d="([^"]+)"/g)].map(match => match[1])
    expect(shapes(asset('logo-dark.svg'))).toEqual(
      shapes(asset('logo-light.svg'))
    )
  })

  it('turns ink into paper in the dark logo, except the R', () => {
    // "comp" and the third panel turn to paper; the R, drawn last, turns to
    // ink so that it stays visible on its panel.
    const fills = (svg: string) =>
      [...svg.matchAll(/fill="([^"]+)"/g)].map(match => match[1])
    const expected = fills(asset('logo-light.svg')).map(fill =>
      fill === brand.ink ? brand.paper : fill
    )
    expected[expected.length - 1] = brand.ink
    expect(fills(asset('logo-dark.svg'))).toEqual(expected)
  })
})
