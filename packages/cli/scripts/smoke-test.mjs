// Runs the built command line on a small repository and checks that it reads
// the symbols of the code and serves the MCP tools. The tests run the
// sources; only this script loads the bundle, its .wasm files and the bundled
// MCP SDK. Run after `yarn build`.
import { execFileSync, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url))
const work = mkdtempSync(join(tmpdir(), 'compadr-smoke-'))
const repo = join(work, 'repo')
const git = (...args) =>
  execFileSync(
    'git',
    [
      '-C',
      repo,
      '-c',
      'user.name=Compadr',
      '-c',
      'user.email=smoke@example.com',
      ...args,
    ],
    { encoding: 'utf8' }
  )

try {
  for (const [file, content] of Object.entries({
    'src/billing.ts':
      'export class BillingService {\n  charge(amount: number) {\n    return amount\n  }\n}\n',
    'docs/adr/0001-billing.md':
      '# 1. Billing\n\nStatus: accepted\n\nSee `src/billing.ts:3`.\n',
  })) {
    mkdirSync(dirname(join(repo, file)), { recursive: true })
    writeFileSync(join(repo, file), content)
  }
  git('init', '-q', '-b', 'main')
  git('add', '.')
  git('commit', '-q', '-m', 'Smoke test')

  const out = join(work, 'report.json')
  execFileSync('node', [cli, 'drift', repo, '--out', out], { stdio: 'inherit' })
  const report = JSON.parse(readFileSync(out, 'utf8'))
  const proposal = report.references[0]?.proposal
  if (proposal?.text !== 'src/billing.ts#BillingService.charge') {
    throw new Error(`unexpected proposal: ${JSON.stringify(proposal)}`)
  }
  console.log(`✔ the built CLI proposes ${proposal.text}`)

  // The MCP server of the bundle answers a tool call on stdio.
  const server = spawn('node', [cli, 'mcp', repo], {
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  const lines = createInterface({ input: server.stdout })
  const answered = id =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`no answer ${id}`)),
        30_000
      )
      lines.on('line', line => {
        const message = JSON.parse(line)
        if (message.id === id) {
          clearTimeout(timer)
          resolve(message)
        }
      })
    })
  const send = message => server.stdin.write(`${JSON.stringify(message)}\n`)
  try {
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'smoke', version: '0.0.0' },
      },
    })
    await answered(1)
    send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    send({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'decisions_for_file',
        arguments: { path: 'src/billing.ts' },
      },
    })
    const result = JSON.parse((await answered(2)).result.content[0].text)
    if (result.inForce[0]?.decision !== 1) {
      throw new Error(`unexpected answer: ${JSON.stringify(result)}`)
    }
    console.log('✔ the built MCP server gives the decisions of a file')
  } finally {
    server.kill()
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}
