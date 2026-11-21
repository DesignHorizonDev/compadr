import { describe, expect, it } from 'vitest'
import { parseUnifiedDiff } from './change.ts'
import {
  maskSecrets,
  maskSecretsInDiff,
  maskSecretsInLine,
  secretFile,
} from './secrets.ts'

// The tokens are built at run time, so that no scanner reads a token in the
// sources. None of them is a real credential.
const github = 'ghp_' + 'A1b2C3d4'.repeat(5)
const anthropic = 'sk-ant-' + 'api03-' + 'Zq9'.repeat(10)
const stripe = 'sk_' + 'test_' + 'Q7w'.repeat(8)
const aws = 'AKIA' + 'IOSFODNN7EXAMPLE'
// The markers of a private key and a URL with a password, split for the same
// reason and for the check of publication.
const KEY = 'PRIVATE ' + 'KEY-----'
const begin = (kind = '') => `-----BEGIN ${kind}${KEY}`
const end = (kind = '') => `-----END ${kind}${KEY}`
const databaseUrl = (password: string) =>
  'DATABASE_URL=postgres://app:' + password + '@db:5432/app'
const jwt = [
  'eyJhbGciOiJIUzI1NiJ9',
  'eyJzdWIiOiIxMjM0NTY3ODkwIn0',
  'dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
].join('.')

describe('maskSecretsInLine', () => {
  it('masks tokens that carry the prefix of their provider', () => {
    expect(maskSecretsInLine(`const token = ${github}`)).toBe(
      'const token = [masked:github-token]'
    )
    expect(maskSecretsInLine(`key: ${anthropic}`)).toBe(
      'key: [masked:anthropic-key]'
    )
    expect(maskSecretsInLine(`stripe(${stripe})`)).toBe(
      'stripe([masked:stripe-key])'
    )
    expect(maskSecretsInLine(`id=${aws};`)).toBe('id=[masked:aws-access-key];')
    expect(maskSecretsInLine(`Bearer ${jwt}`)).toBe('Bearer [masked:jwt]')
  })

  it('masks the password of a URL and keeps the user and the host', () => {
    expect(maskSecretsInLine(databaseUrl('s3cr3tPassw0rd'))).toBe(
      databaseUrl('[masked:url-password]')
    )
  })

  it('masks a literal assigned to a name that says it is a secret', () => {
    expect(maskSecretsInLine('const apiKey = "f8Kq2pLz9xVb4nTr"')).toBe(
      'const apiKey = "[masked:assigned-secret]"'
    )
    expect(maskSecretsInLine(`  "client_secret": 'Uu7#kP0q!zR2mW9e',`)).toBe(
      `  "client_secret": '[masked:assigned-secret]',`
    )
    expect(maskSecretsInLine('DB_PASSWORD: `n0Tm4yb3-H3re`')).toBe(
      'DB_PASSWORD: `[masked:assigned-secret]`'
    )
  })

  it('reads a name word by word, whatever its case', () => {
    for (const line of [
      'const authToken = "Zx9fQ2lKp8VwR3"',
      'dbPassword: "Zx9fQ2lKp8VwR3",',
      'const jwtSecret = "Zx9fQ2lKp8VwR3"',
      'GITHUB_TOKEN="Zx9fQ2lKp8VwR3"',
      'this.clientSecret = "Zx9fQ2lKp8VwR3"',
      '$apiKey = "Zx9fQ2lKp8VwR3";',
    ]) {
      expect(maskSecretsInLine(line), line).toContain(
        '[masked:assigned-secret]'
      )
    }
    for (const line of [
      'const tokenizerModel = "bert-base-uncased"',
      'const passportNumber = "Zx9fQ2lKp8VwR3"',
      'const keyboardLayout = "Zx9fQ2lKp8VwR3"',
      'TOKEN=Zx9fQ2lKp8VwR3',
    ]) {
      expect(maskSecretsInLine(line), line).toBe(line)
    }
  })

  it('keeps placeholders, references to the environment and plain words', () => {
    for (const line of [
      'const password = process.env.DB_PASSWORD',
      'password: "${DB_PASSWORD}"',
      'token = "<your token>"',
      'secret = "changeme123"',
      'apiKey = "xxxxxxxxxxxx"',
      'const tokenizer = "wordpiece"',
      'const passwordLabel = "Password"',
      'password = "aaaaaaaaaa"',
    ]) {
      expect(maskSecretsInLine(line)).toBe(line)
    }
  })

  it('gives the same text twice, and leaves a masked text as it is', () => {
    const line = `const token = ${github}; const apiKey = "f8Kq2pLz9xVb4nTr"`
    const once = maskSecretsInLine(line)
    expect(maskSecretsInLine(line)).toBe(once)
    expect(maskSecretsInLine(once)).toBe(once)
  })
})

describe('maskSecrets', () => {
  it('masks the body of a private key and keeps the number of lines', () => {
    const text = [
      'before',
      begin('RSA '),
      'MIIEowIBAAKCAQEA0Z3VS5JJcds3xfn',
      'kq9XsT4YmLs2HcFNmEulYkLMeWUAeRk',
      end('RSA '),
      'after',
    ].join('\n')
    const masked = maskSecrets(text)
    expect(masked.split('\n')).toEqual([
      'before',
      begin('RSA '),
      '[masked:private-key]',
      '[masked:private-key]',
      end('RSA '),
      'after',
    ])
  })

  it('masks a private key written on one line', () => {
    expect(maskSecrets(`key: "${begin()}\\nMIIEv\\n${end()}"`)).toBe(
      `key: "${begin()}[masked:private-key]${end()}"`
    )
  })
})

describe('maskSecretsInDiff', () => {
  const diff = [
    'diff --git a/src/client.ts b/src/client.ts',
    'index 1111111..2222222 100644',
    '--- a/src/client.ts',
    '+++ b/src/client.ts',
    '@@ -1,3 +1,3 @@',
    ' import { connect } from "./db"',
    `-const token = process.env.TOKEN`,
    `+const token = "${github}"`,
    ' connect(token)',
    '',
  ].join('\n')

  it('masks the lines of the hunks and keeps the headers', () => {
    const masked = maskSecretsInDiff(diff)
    expect(masked).toContain('+const token = "[masked:github-token]"')
    expect(masked).toContain('-const token = process.env.TOKEN')
    expect(masked.split('\n').slice(0, 5)).toEqual(diff.split('\n').slice(0, 5))
    expect(masked).not.toContain(github)
  })

  it('keeps the files, the line numbers and the number of lines of the diff', () => {
    const before = parseUnifiedDiff(diff)
    const after = parseUnifiedDiff(maskSecretsInDiff(diff))
    expect(after.map(f => f.path)).toEqual(before.map(f => f.path))
    expect(after[0]!.added.map(l => l.line)).toEqual(
      before[0]!.added.map(l => l.line)
    )
    expect(maskSecretsInDiff(diff).split('\n')).toHaveLength(
      diff.split('\n').length
    )
  })
})

describe('secretFile', () => {
  it('names the files that hold secrets by their nature', () => {
    for (const path of [
      '.env',
      'apps/web/.env.local',
      '.env.production',
      'certs/server.pem',
      'keys/signing.key',
      'infra/prod.tfvars',
      'infra/terraform.tfstate',
      '.ssh/id_ed25519',
      '.npmrc',
      'gcp/credentials.json',
    ]) {
      expect(secretFile(path), path).toBe(true)
    }
  })

  it('keeps templates of environment files and ordinary code', () => {
    for (const path of [
      '.env.example',
      'apps/web/.env.sample',
      '.env.template',
      'src/env.ts',
      'src/keyboard.ts',
      'src/credentials-form.tsx',
    ]) {
      expect(secretFile(path), path).toBe(false)
    }
  })
})
