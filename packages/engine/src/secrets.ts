// Secrets that never leave the machine in an assist request. The masking is
// deterministic: the same text always gives the same masked text, so the
// hash of a request, the replay of the service and the guard stay coherent.
// A masked value keeps its line, and the name it is assigned to stays: the
// model still sees that a secret is written in the code.

/**
 * Version of the patterns. A change of the patterns changes the requests, so
 * a suggestion kept in a repository names the version it was made with.
 */
export const SECRET_MASK_VERSION = 1

export type SecretKind =
  | 'private-key'
  | 'aws-access-key'
  | 'github-token'
  | 'gitlab-token'
  | 'slack-token'
  | 'stripe-key'
  | 'anthropic-key'
  | 'openai-key'
  | 'google-api-key'
  | 'npm-token'
  | 'jwt'
  | 'url-password'
  | 'assigned-secret'

/** The text that replaces a secret. */
export function secretMask(kind: SecretKind): string {
  return `[masked:${kind}]`
}

// Tokens with a prefix of their provider: few false positives.
const PREFIXED: [SecretKind, RegExp][] = [
  ['anthropic-key', /\bsk-ant-[A-Za-z0-9_-]{20,}/g],
  ['openai-key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/g],
  ['aws-access-key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  [
    'github-token',
    /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/g,
  ],
  ['gitlab-token', /\bglpat-[A-Za-z0-9_-]{20,}/g],
  ['slack-token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/g],
  ['stripe-key', /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['npm-token', /\bnpm_[A-Za-z0-9]{36}\b/g],
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g],
]

// The password of a URL: `scheme://user:<password>@host`.
const URL_PASSWORD = /([a-z][a-z0-9+.-]*:\/\/[^/\s:@'"]+:)([^@\s/'"]+)(@)/gi

// A literal assigned to a name, such as `password = "…"`, `"apiKey": "…"` or
// `CLIENT_SECRET: '…'`. The name is read word by word (`authToken`,
// `db_password`, `JWT-SECRET`), so `tokenizer` or `passport` are not secrets.
// A value without quotes (shell, YAML) is not masked.
const ASSIGNED =
  /((?:^|[^A-Za-z0-9_$-])["']?([A-Za-z_$][A-Za-z0-9_$-]*)["']?\s*(?:=|:|:=|=>)\s*)(["'`])([^"'`\s]{8,})\3/g

const SECRET_WORDS = new Set([
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
  'apikey',
  'credential',
  'credentials',
])
const SECRET_PAIRS = new Set([
  'api key',
  'access key',
  'private key',
  'auth key',
  'secret key',
  'client secret',
])

/** Whether a name says that its value is a secret, read word by word. */
export function secretName(name: string): boolean {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[\s_$-]+/)
    .filter(word => word !== '')
  return words.some(
    (word, i) =>
      SECRET_WORDS.has(word) ||
      (i > 0 && SECRET_PAIRS.has(`${words[i - 1]} ${word}`))
  )
}

const PLACEHOLDER =
  /^(?:\$\{|\{\{|<|%|process\.env|env\(|changeme|example|dummy|placeholder|your[_-]|x{4,}|\*{4,}|\.{3})/i

/** Shannon entropy of a string, in bits per character. */
function entropy(value: string): number {
  const counts = new Map<string, number>()
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1)
  let bits = 0
  for (const count of counts.values()) {
    const p = count / value.length
    bits -= p * Math.log2(p)
  }
  return bits
}

/** Whether an assigned literal looks like a real secret, not a placeholder. */
function looksSecret(value: string): boolean {
  if (PLACEHOLDER.test(value)) return false
  if (value.startsWith('[masked:')) return false
  return entropy(value) >= 3
}

/** Masks the secrets of one line, without changing its other characters. */
export function maskSecretsInLine(line: string): string {
  let text = line
  for (const [kind, pattern] of PREFIXED) {
    text = text.replace(pattern, secretMask(kind))
  }
  text = text.replace(
    URL_PASSWORD,
    (_, before: string, _password: string, after: string) =>
      `${before}${secretMask('url-password')}${after}`
  )
  text = text.replace(
    ASSIGNED,
    (match, before: string, name: string, quote: string, value: string) =>
      secretName(name) && looksSecret(value)
        ? `${before}${quote}${secretMask('assigned-secret')}${quote}`
        : match
  )
  return text
}

const PEM_BEGIN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY( BLOCK)?-----/
const PEM_END = /-----END [A-Z0-9 ]*PRIVATE KEY( BLOCK)?-----/

/**
 * Masks the secrets of a text, line by line. The body of a private key
 * becomes one mask per line, so the text keeps its number of lines. The
 * `prefix` of a line (the `+`, `-` or space of a diff) stays as it is.
 */
function maskLines(
  lines: string[],
  prefixOf: (line: string) => string | null
): string[] {
  let inKey = false
  return lines.map(line => {
    const prefix = prefixOf(line)
    if (prefix === null) return line
    const content = line.slice(prefix.length)
    if (inKey) {
      if (PEM_END.test(content)) inKey = false
      else return `${prefix}${secretMask('private-key')}`
      return line
    }
    if (PEM_BEGIN.test(content)) {
      inKey = !PEM_END.test(content)
      return line.replace(
        /(PRIVATE KEY(?: BLOCK)?-----)(.+?)(-----END)/,
        `$1${secretMask('private-key')}$3`
      )
    }
    return `${prefix}${maskSecretsInLine(content)}`
  })
}

/** Masks the secrets of a whole text, such as a record or an excerpt of code. */
export function maskSecrets(text: string): string {
  return maskLines(text.split('\n'), () => '').join('\n')
}

/**
 * Masks the secrets of one file of a unified diff. Only the lines of the
 * hunks change: the header, the `---` and `+++` lines and the `@@` lines
 * stay, so the diff parses the same way and keeps its line numbers.
 */
export function maskSecretsInDiff(diff: string): string {
  let inHunk = false
  return maskLines(diff.split('\n'), line => {
    if (line.startsWith('@@')) {
      inHunk = true
      return null
    }
    if (line.startsWith('diff --git ')) {
      inHunk = false
      return null
    }
    if (!inHunk) return null
    const first = line[0]
    return first === '+' || first === '-' || first === ' ' ? first : null
  }).join('\n')
}

// Files that hold secrets by their nature: they never leave, whatever their
// content. Templates of environment files stay, since they hold placeholders.
const SECRET_FILES =
  /(?:^|\/)(?:\.env(?:\.(?!(?:example|sample|template|dist)$)[^/]+)?|[^/]+\.(?:pem|key|p12|pfx|jks|keystore|tfvars|tfstate)|id_(?:rsa|dsa|ecdsa|ed25519)|\.npmrc|\.netrc|\.pgpass|credentials(?:\.json)?)$/i

/** Whether a file holds secrets by its nature and never leaves. */
export function secretFile(path: string): boolean {
  return SECRET_FILES.test(path)
}
