// The local MCP server of Compadr: seven tools over the decisions of one
// repository. The server only reads: `propose_decision` returns a record that
// the agent writes in its own branch. Only the `semantic` option of
// `check_change_against_decisions` and the `assist` option of
// `propose_decision` send anything out, to the assist service that
// compadr.yml allows.
import { realpathSync } from 'node:fs'
import { isAbsolute, relative } from 'node:path'
import {
  compactFileDecisions,
  decisionsForFile,
  DECISION_STATUSES,
  normalizeRepositoryPath,
} from '@compadr/format'
import {
  checkChange,
  parseUnifiedDiff,
  proposalOfDraft,
  renderMemoryCard,
  runGit,
} from '@compadr/engine'
import {
  draftFromChange,
  semanticCheck,
  type AssistClient,
} from '@compadr/assist'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { ReportCache, type ReportOptions } from './report-cache.ts'
import {
  CITED_BY_DETAILS,
  CODE_LINK_DETAILS,
  decisionsForSymbol,
  describeDecision,
  draftDecision,
  searchDecisions,
} from './tools.ts'

export interface ServerOptions extends ReportOptions {
  /** Date of `propose_decision`, YYYY-MM-DD. Defaults to today. */
  today?: () => string
  /**
   * Computes the report as soon as the server starts, so that the first call
   * of an agent does not wait for it.
   */
  warm?: boolean
  /**
   * Environment that gives the assist service of the `semantic` and
   * `assist` options: COMPADR_ASSIST_URL and COMPADR_ASSIST_TOKEN. Defaults
   * to the process.
   */
  env?: Record<string, string | undefined>
  /** Builds the client of the assist service. Tests give a fake client. */
  assistClient?: (url: string, token: string) => AssistClient
}

type Result = {
  content: { type: 'text'; text: string }[]
  isError?: boolean
}

// Without indentation: an agent reads JSON as well, and the spaces made up
// more than a third of each answer.
function json(value: unknown): Result {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] }
}

function failure(message: string): Result {
  return { content: [{ type: 'text', text: message }], isError: true }
}

/** A path of the repository, from a relative path or an absolute one. */
async function repositoryPath(
  repository: string,
  path: string
): Promise<string | null> {
  if (!isAbsolute(path)) return normalizeRepositoryPath(path)
  const root = realpathSync(
    (await runGit(repository, 'rev-parse', ['--show-toplevel'])).trim()
  )
  let real = path
  try {
    real = realpathSync(path)
  } catch {
    // A file deleted from the working copy keeps its path.
  }
  const inside = relative(root, real)
  return inside.startsWith('..') || isAbsolute(inside)
    ? null
    : normalizeRepositoryPath(inside)
}

export function createServer(options: ServerOptions): McpServer {
  const cache = new ReportCache(options)
  // A failed computation shows on the first call, which tries again.
  if (options.warm) cache.get().catch(() => {})
  const today = options.today ?? (() => new Date().toISOString().slice(0, 10))
  const env = options.env ?? process.env
  const server = new McpServer({
    name: 'compadr',
    version: options.generatorVersion,
  })

  server.registerTool(
    'memory',
    {
      title: 'Memory of the decisions',
      description:
        'The memory card of the architecture decisions, in Markdown: the features with the rule of their main decision, the zones of the code under decisions with their coverage and decisions, and the other decisions in force. Read it once per session, before you plan a change: it tells which zones to check with decisions_for_file.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const report = await cache.get()
      return {
        content: [{ type: 'text', text: renderMemoryCard(report) }],
      }
    }
  )

  server.registerTool(
    'decisions_for_file',
    {
      title: 'Decisions of a file',
      description:
        'The architecture decisions that apply to a file of the repository: those whose record cites the file or one of its folders, and those that the file cites. "inForce" holds the accepted decisions, which bind any change of the file; a superseded decision leads to the one that replaces it. "context" holds proposed decisions, which do not bind. Decisions linked to the file itself come before those reached through a cited folder. Each decision in force gives its rule (what it requires), the weight of its links to the file, and "read": "rule" when the rule says enough, "lines" when the record cites lines or a symbol of the file, "record" when the record is worth opening. Open a record with get_decision only for "lines" or "record". Call it before changing a file.',
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe('Path of the file in the repository, or an absolute path'),
        detail: z
          .enum(['compact', 'full'])
          .optional()
          .describe(
            'compact (default): the rule, weight and read hint of each decision; full: every link between the decision and the file'
          ),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ path, detail }) => {
      const report = await cache.get()
      const target = await repositoryPath(options.repository, path)
      if (target === null) return failure(`${path} is outside the repository.`)
      const answer = decisionsForFile(report, target)
      return json({
        repository: report.repository.name,
        ref: report.repository.ref,
        commit: report.repository.commit,
        ...(detail === 'full' ? answer : compactFileDecisions(report, answer)),
      })
    }
  )

  server.registerTool(
    'decisions_for_symbol',
    {
      title: 'Decisions of a symbol',
      description:
        'The architecture decisions behind a function, class, type or constant that a decision record cites by name: the decisions whose record cites it, with their rule, the files that declare it at the start of a line ("declaredIn", generated code aside), and, when one file alone declares it, the decisions in force of that file in the compact form of decisions_for_file. Several declarations mean the name is ambiguous. A symbol that no record cites gets an error: use decisions_for_file on its file instead.',
      inputSchema: {
        symbol: z
          .string()
          .min(1)
          .describe('Name of the symbol, as the code declares it'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ symbol }) => {
      const report = await cache.get()
      const answer = decisionsForSymbol(report, symbol.trim())
      return answer === null
        ? failure(
            `No decision record cites ${symbol}. Use decisions_for_file on the file that declares it.`
          )
        : json({
            repository: report.repository.name,
            ref: report.repository.ref,
            commit: report.repository.commit,
            ...answer,
          })
    }
  )

  server.registerTool(
    'check_change_against_decisions',
    {
      title: 'Check a change',
      description:
        'Checks a change against the architecture decisions, before you propose it. Pass the output of `git diff <commit>`, where <commit> is the commit that every answer of this server gives (a few lines of context are enough). Returns the decisions in force that the changed files fall under, as decisions_for_file gives them (a Markdown or text file only brings the decisions whose records cite it), and the signals that the change raises: a removed or renamed path that a decision record cites ("broken"), cited lines that the change modifies ("review"), and an added citation of a decision that is superseded or unknown ("broken"). A signal does not block the change: it names the record to update or reread. With "semantic": true, the answer also holds "semantic": what the assist service of the repository says about the change, when its compadr.yml allows it. Each finding quotes the rule it may break; it is a suggestion to weigh, not a verdict.',
      inputSchema: {
        diff: z
          .string()
          .min(1)
          .describe('Unified diff of the change, as git diff writes it'),
        semantic: z
          .boolean()
          .optional()
          .describe(
            'Also ask the assist service whether the change breaks a decision in force (default: false). Nothing is sent unless compadr.yml sets assist.semantic, and the server needs COMPADR_ASSIST_URL and COMPADR_ASSIST_TOKEN'
          ),
      },
      // With `semantic`, the change goes to the assist service.
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ diff, semantic }) => {
      const files = parseUnifiedDiff(diff)
      if (files.length === 0) {
        return failure(
          'The diff names no file. Pass the output of git diff, in the unified format.'
        )
      }
      const report = await cache.get()
      return json({
        repository: report.repository.name,
        ref: report.repository.ref,
        commit: report.repository.commit,
        ...checkChange(report, files),
        ...(semantic === true
          ? {
              semantic: await semanticCheck(report, diff, {
                url: env.COMPADR_ASSIST_URL,
                token: env.COMPADR_ASSIST_TOKEN,
                client: options.assistClient,
              }),
            }
          : {}),
      })
    }
  )

  server.registerTool(
    'get_decision',
    {
      title: 'Decision record',
      description:
        'The content and state of one architecture decision: status, feature and main decision, relations, its rule, the outline and the text of its Decision section, the rules it replaces and those replaced later, its code links with their drift, and the files that cite it. A long record costs many tokens: pass "sections": "none" to read its rule and its outline first, then the indexes of the subsections you need.',
      inputSchema: {
        number: z.int().min(0).max(9999).describe('Number of the decision'),
        sections: z
          .union([z.array(z.int().min(1)).min(1), z.enum(['all', 'none'])])
          .optional()
          .describe(
            'Subsections of the Decision section to give, by their index in "outline" (from 1; the text before the first subsection, when there is one, has no heading); default: all'
          ),
        codeLinks: z
          .enum(CODE_LINK_DETAILS)
          .optional()
          .describe(
            'grouped: one entry per cited path, with its count and worst drift, and the cited symbols by name; full: every link with its line and date; none. Default: grouped, or none when sections is not all'
          ),
        citedBy: z
          .enum(CITED_BY_DETAILS)
          .optional()
          .describe(
            'count (default): the number of files and citations; files: the files; lines: the files with their lines'
          ),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ number, sections, codeLinks, citedBy }) => {
      const decision = describeDecision(await cache.get(), number, {
        sections,
        codeLinks,
        citedBy,
      })
      return decision === null
        ? failure(`The repository has no decision ${number}.`)
        : json(decision)
    }
  )

  server.registerTool(
    'search_decisions',
    {
      title: 'Search the decisions',
      description:
        'Full-text search over the title, the relations and the decision text of the records. Every word of the query must match. Returns the best matches first, with an excerpt.',
      inputSchema: {
        query: z.string().min(1).describe('Words to find'),
        status: z
          .enum(DECISION_STATUSES)
          .optional()
          .describe('Keep only the decisions with this status'),
        limit: z.int().min(1).max(50).optional().describe('Default: 10'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query, status, limit }) =>
      json(searchDecisions(await cache.get(), query, { status, limit }))
  )

  server.registerTool(
    'propose_decision',
    {
      title: 'Propose a decision',
      description:
        'Drafts a new decision record with the status "proposed", written like the latest record of the repository. The server writes nothing: write the returned content at the returned path, in your own branch, and open a pull request. An agent proposes a decision; a person accepts it. To detail an existing decision, pass its number as parent. Pass the rule: one sentence that says what the decision requires, which agents read before the record. With "assist": true and the diff of your change, the assist service of the repository writes the title, the rule, the sections and the decisions that the record amends or replaces, when its compadr.yml allows it; pass only feature and parent then. The answer names the model and what the guard says of the draft. When the service finds that the change only applies a decision in force, the answer gives "notNeeded" and no record.',
      inputSchema: {
        title: z
          .string()
          .min(1)
          .optional()
          .describe('Title of the decision; the service writes it with assist'),
        context: z.string().optional().describe('Why a decision is needed'),
        decision: z.string().optional().describe('What is decided'),
        consequences: z.string().optional(),
        feature: z
          .string()
          .optional()
          .describe('Identifier of the feature (compadr.feature)'),
        parent: z
          .int()
          .min(0)
          .max(9999)
          .optional()
          .describe('Main decision that this one details'),
        rule: z
          .string()
          .optional()
          .describe(
            'What the decision requires, in one sentence (compadr.rule)'
          ),
        assist: z
          .boolean()
          .optional()
          .describe(
            'Ask the assist service to draft the record from diff (default: false). Nothing is sent unless compadr.yml sets assist.semantic, and the server needs COMPADR_ASSIST_URL and COMPADR_ASSIST_TOKEN'
          ),
        diff: z
          .string()
          .min(1)
          .optional()
          .describe(
            'With assist: unified diff of the change that the record decides, as git diff writes it'
          ),
      },
      // With `assist`, the change goes to the assist service.
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ assist, diff, ...proposal }) => {
      const report = await cache.get()
      const latest = [...report.decisions].sort(
        (a, b) => b.number - a.number
      )[0]
      const template = latest
        ? await cache
            .read(report.repository.commit, latest.file)
            .catch(() => null)
        : null
      if (assist !== true) {
        if (diff !== undefined) {
          return failure(
            'The diff goes with "assist": true. Without it, pass the title and the text of the decision.'
          )
        }
        if (proposal.title === undefined) {
          return failure(
            'Pass the title of the decision, or "assist": true with the diff of the change.'
          )
        }
        return json(
          draftDecision(
            report,
            { ...proposal, title: proposal.title },
            template,
            today()
          )
        )
      }
      if (diff === undefined || parseUnifiedDiff(diff).length === 0) {
        return failure(
          'With "assist": true, pass the diff of the change, as git diff writes it.'
        )
      }
      // The service writes the text: an agent that writes it too would see
      // its own text replaced.
      const written = (
        ['title', 'context', 'decision', 'consequences', 'rule'] as const
      ).filter(field => proposal[field] !== undefined)
      if (written.length > 0) {
        return failure(
          `With "assist": true, the service writes ${written.join(', ')}: pass only feature and parent, or leave out "assist".`
        )
      }
      const drafted = await draftFromChange(report, diff, {
        url: env.COMPADR_ASSIST_URL,
        token: env.COMPADR_ASSIST_TOKEN,
        client: options.assistClient,
      })
      if (drafted.status !== 'done') {
        return failure(`No record was drafted: ${drafted.reason}.`)
      }
      const { suggestion } = drafted
      const drafting = {
        model: suggestion.provenance.model,
        promptVersion: suggestion.provenance.promptVersion,
        problems: drafted.problems.map(({ level, code, item, message }) => ({
          level,
          code,
          item,
          message,
        })),
        excluded: drafted.excluded,
      }
      if (suggestion.notNeeded !== null) {
        return json({ notNeeded: suggestion.notNeeded, assist: drafting })
      }
      return json({
        ...draftDecision(
          report,
          {
            ...proposalOfDraft(suggestion),
            ...(proposal.feature === undefined
              ? {}
              : { feature: proposal.feature }),
            ...(proposal.parent === undefined
              ? {}
              : { parent: proposal.parent }),
          },
          template,
          today()
        ),
        assist: drafting,
      })
    }
  )

  return server
}

/** Serves the tools on the standard input and output. */
export async function serveStdio(options: ServerOptions): Promise<void> {
  await createServer({ warm: true, ...options }).connect(
    new StdioServerTransport()
  )
}
