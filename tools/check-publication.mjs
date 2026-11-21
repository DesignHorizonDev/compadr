// Checks that nothing private enters the repository: public IP address,
// private key, token, password in a URL, personal commit address. Run in CI on
// the tracked files and on the history. Patterns are added here.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const PATTERNS = [
  // A public IP address. Private, local, documentation and reserved ranges are
  // accepted: none of them names a reachable server.
  {
    name: 'public IP address',
    regex:
      /(?<![\d.])(?!10\.|127\.|0\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|2(2[4-9]|[3-5]\d)\.|192\.0\.2\.|198\.51\.100\.|203\.0\.113\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|198\.1[89]\.|192\.0\.0\.|192\.88\.99\.)(\d{1,3}\.){3}\d{1,3}(?!\.?\d)/,
  },
  { name: 'private key', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'GitHub token', regex: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  {
    name: 'password in a URL',
    regex: /:\/\/[^\s:@/]+:(?!<password>)[^\s@/]{6,}@/,
  },
]

// Commits carry the GitHub noreply address of their author or a Design
// Horizon address, never a personal one.
const ALLOWED_ADDRESS =
  /(@users\.noreply\.github\.com|^noreply@github\.com|@designhorizon\.io)$/

const SKIPPED = new Set(['yarn.lock', 'tools/check-publication.mjs'])

const findings = []

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(file => file && !SKIPPED.has(file))
for (const file of files) {
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      for (const { name, regex } of PATTERNS) {
        if (regex.test(line)) findings.push(`${file}:${i + 1}: ${name}`)
      }
    })
}

const addresses = execFileSync(
  'git',
  ['log', '--format=%h %ae%n%h %ce', 'HEAD'],
  { encoding: 'utf8' }
)
  .split('\n')
  .filter(Boolean)
for (const line of addresses) {
  const [sha, address] = line.split(' ')
  if (!ALLOWED_ADDRESS.test(address)) {
    findings.push(`commit ${sha}: address ${address} is not allowed`)
  }
}

if (findings.length > 0) {
  console.error('✖ Private data found:')
  for (const finding of findings) console.error(`  ${finding}`)
  process.exit(1)
}
const commits = addresses.length / 2
console.log(
  `✔ ${files.length} files and ${commits} ${commits === 1 ? 'commit' : 'commits'}, nothing private.`
)
