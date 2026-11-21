import { beforeAll, describe, expect, it } from 'vitest'
import {
  findLines,
  fingerprint,
  grammarOf,
  matchLines,
  SymbolReader,
  symbolAt,
  type CodeSymbol,
} from './symbols.ts'

let reader: SymbolReader

beforeAll(async () => {
  reader = await SymbolReader.load()
})

const SOURCE = `import { tax } from './tax'

export class BillingService {
  private rate = 0.2

  charge(amount: number) {
    const fee = amount * this.rate
    const round = (value: number) => Math.round(value)
    return round(amount + fee)
  }
}

export const refund = (id: string) => id
const { a, b } = config
export interface Invoice { total: number }
export type Currency = 'EUR' | 'USD'
export enum Status { Open, Paid }
`

const names = (symbols: CodeSymbol[] | null) =>
  symbols?.map(symbol => [symbol.name, symbol.start, symbol.end])

describe('SymbolReader', () => {
  it('lists the named declarations with their qualified names', () => {
    expect(names(reader.symbols('src/billing.ts', SOURCE))).toEqual([
      ['BillingService', 3, 11],
      ['BillingService.rate', 4, 4],
      ['BillingService.charge', 6, 10],
      ['BillingService.charge.round', 8, 8],
      ['refund', 13, 13],
      ['Invoice', 15, 15],
      ['Currency', 16, 16],
      ['Status', 17, 17],
    ])
  })

  it('names one symbol per accessor pair and tells static members apart', () => {
    const source = [
      'class A {',
      '  get v() { return 1 }',
      '  set v(x) {}',
      '  static m() {}',
      '  m() {}',
      '  static only() {}',
      '}',
    ].join('\n')
    expect(names(reader.symbols('a.ts', source))).toEqual([
      ['A', 1, 7],
      ['A.v', 2, 3],
      ['A.static.m', 4, 4],
      ['A.m', 5, 5],
      ['A.only', 6, 6],
    ])
  })

  it('keeps only the top-level variables of modules and namespaces', () => {
    const source = [
      'if (ready) { const total = 1 + 2 }',
      'namespace Billing { export const RATE = 0.2 }',
      'for (const item of items) { const helper = () => item }',
    ].join('\n')
    expect(names(reader.symbols('a.ts', source))).toEqual([
      ['Billing', 2, 2],
      ['Billing.RATE', 2, 2],
      ['helper', 3, 3],
    ])
  })

  it('reads TSX and JavaScript files', () => {
    expect(
      names(
        reader.symbols(
          'web/Button.tsx',
          'export function Button() {\n  return <button />\n}\n'
        )
      )
    ).toEqual([['Button', 1, 3]])
    expect(
      names(
        reader.symbols(
          'eslint.config.mjs',
          'const RULES = []\nexport default RULES\n'
        )
      )
    ).toEqual([['RULES', 1, 1]])
  })

  it('reads no other language', () => {
    expect(reader.symbols('README.md', '# Title')).toBeNull()
    expect(grammarOf('Makefile')).toBeNull()
    expect(grammarOf('src.v2/main')).toBeNull()
    expect(grammarOf('a/B.TSX')).toBe('tsx')
  })
})

describe('symbolAt', () => {
  const symbols = () => reader.symbols('src/billing.ts', SOURCE)!

  it('finds the innermost declaration of a line', () => {
    expect(symbolAt(symbols(), 7)?.name).toBe('BillingService.charge')
    expect(symbolAt(symbols(), 8)?.name).toBe('BillingService.charge.round')
    expect(symbolAt(symbols(), 3)?.name).toBe('BillingService')
  })

  it('finds nothing outside the declarations', () => {
    expect(symbolAt(symbols(), 1)).toBeUndefined()
    expect(symbolAt(symbols(), 14)).toBeUndefined()
  })
})

describe('fingerprint and findLines', () => {
  it('ignores indentation and line breaks', () => {
    expect(fingerprint('a  =\n  1')).toBe(fingerprint('a = 1'))
    expect(fingerprint('a = 1')).toMatch(/^sha256:[0-9a-f]{16}$/)
    expect(fingerprint('a = 2')).not.toBe(fingerprint('a = 1'))
  })

  it('finds tracked lines anywhere in the symbol', () => {
    const charge = reader
      .symbols('src/billing.ts', SOURCE)!
      .find(symbol => symbol.name === 'BillingService.charge')!
    const tracked = fingerprint(
      'const fee = amount * this.rate\nconst round = (value: number) => Math.round(value)'
    )
    expect(findLines(charge, 2, tracked)).toBe(7)
    expect(findLines(charge, 2, fingerprint('return 0'))).toBeNull()
    expect(matchLines(charge, 1, fingerprint('}'))).toEqual([10])
  })
})
