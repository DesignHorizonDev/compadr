// Design tokens of the console. The brand colors come from the Figma
// collection used by the logo; the neutrals and the state colors come from
// the console mock-up. `css/tokens.css` is generated from this file: run
// `yarn workspace @compadr/tokens css` after a change.

/** Brand colors. Each one is also a color of the logo. */
export const brand = {
  ink: '#0E1726',
  vermilion: '#E14B2D',
  cobalt: '#2B4ACB',
  ochre: '#D9A21B',
  paper: '#F6F4EF',
} as const

/** Neutral colors of the console: backgrounds, borders and text. */
export const neutral = {
  canvas: '#F5F6F8',
  surface: '#FFFFFF',
  surfaceSubtle: '#FAFBFC',
  selected: '#EEF1FB',
  border: '#E4E7EC',
  borderSubtle: '#F0F2F5',
  borderStrong: '#D0D5DD',
  text: '#101828',
  textSecondary: '#344054',
  textTertiary: '#475467',
  // 4.5:1 on the surfaces and the canvas, not on `selected`: a selected item
  // uses `text`, `textSecondary` or cobalt.
  textMuted: '#667085',
  // Below 4.5:1 on a white surface: placeholders and decorative labels only.
  textFaint: '#98A2B3',
} as const

export interface StateColors {
  /** Icons, bars and borders. */
  solid: string
  /** Background of a badge. */
  background: string
  /** Text on `background`. */
  text: string
}

/**
 * Colors of the drift states. They are system colors, distinct from the
 * brand: the red of `broken` is not the vermilion of the logo. The keys
 * follow the signal levels of the drift report, plus `inSync`.
 */
export const states = {
  inSync: { solid: '#1F7A4D', background: '#E3F1EA', text: '#1F6B4A' },
  review: { solid: '#B7791F', background: '#FBF1D8', text: '#8A5A0E' },
  broken: { solid: '#C2342A', background: '#FBE4DE', text: '#A8321C' },
  order: { solid: brand.cobalt, background: '#EEF1FB', text: brand.cobalt },
  info: { solid: '#667085', background: '#F0F2F5', text: '#475467' },
} as const satisfies Record<string, StateColors>

/**
 * Font stacks. The console loads Geist and Geist Mono as variable fonts,
 * whose family names end with "Variable".
 */
export const fonts = {
  sans: "'Geist Variable', 'Geist', ui-sans-serif, system-ui, sans-serif",
  mono: "'Geist Mono Variable', 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
} as const

/** Corner radii, in pixels. */
export const radii = {
  sm: 5,
  md: 8,
  lg: 10,
  xl: 12,
  full: 999,
} as const

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)
}

/** CSS custom properties of every token, in a stable order. */
export function cssVariables(): [string, string][] {
  return [
    ...Object.entries(brand).map(([name, value]): [string, string] => [
      `--compadr-${kebab(name)}`,
      value,
    ]),
    ...Object.entries(neutral).map(([name, value]): [string, string] => [
      `--compadr-${kebab(name)}`,
      value,
    ]),
    ...Object.entries(states).flatMap(([name, colors]): [string, string][] => {
      const prefix = `--compadr-state-${kebab(name)}`
      return [
        [prefix, colors.solid],
        [`${prefix}-bg`, colors.background],
        [`${prefix}-text`, colors.text],
      ]
    }),
    ...Object.entries(fonts).map(([name, value]): [string, string] => [
      `--compadr-font-${name}`,
      value,
    ]),
    ...Object.entries(radii).map(([name, value]): [string, string] => [
      `--compadr-radius-${name}`,
      `${value}px`,
    ]),
  ]
}

/** Content of `css/tokens.css`. */
export function tokensCss(): string {
  const lines = cssVariables().map(([name, value]) => `  ${name}: ${value};`)
  return `/* Generated from packages/tokens/src/tokens.ts. Do not edit. */\n:root {\n${lines.join('\n')}\n}\n`
}
