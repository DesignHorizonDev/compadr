// A client that answers without any service or model, for the tests and for
// trying the commands. Its suggestions are built from the request alone and
// always pass the guard, unless a test gives its own answer.
import { assistInputHash, parseUnifiedDiff } from '@compadr/engine'
import {
  ASSIST_SCHEMA_VERSION,
  type AssistRequest,
  type AssistSuggestion,
} from '@compadr/format'
import type { AssistClient } from './client.ts'

/** The content of a suggestion, without its kind, version, status or provenance. */
export type FakeAnswer = (
  request: AssistRequest
) => Record<string, unknown> | undefined

export interface FakeAssistClientOptions {
  /** Replaces the content that the client builds, for a test. */
  answer?: FakeAnswer
  /** Date of the suggestions (default: now). */
  now?: () => Date
}

/** First line of a text that a quote can copy: no heading, no blank, at least 12 characters. */
function quotable(text: string): string {
  for (const line of text.split('\n')) {
    const clean = line.replace(/^\s*(?:[-*>]|\d+\.)\s*/, '').trim()
    if (clean.startsWith('#') || clean.length < 12) continue
    // Cut at a word, inside the line, so that the quote stays word for word.
    return clean.length <= 80
      ? clean
      : clean.slice(0, clean.lastIndexOf(' ', 80))
  }
  return ''
}

function content(request: AssistRequest): Record<string, unknown> {
  switch (request.kind) {
    case 'check': {
      const sent = new Map(request.decisions.map(d => [d.number, d]))
      const findings = request.signals
        .filter(signal => sent.has(signal.decision))
        .map(signal => ({
          decision: signal.decision,
          verdict: 'at-risk',
          quote: quotable(sent.get(signal.decision)!.text),
          evidence: { path: signal.path, text: '' },
          explanation: `The change touches what decision ${signal.decision} cites (${signal.type}).`,
        }))
        .filter(finding => finding.quote !== '')
      return { findings }
    }
    case 'consolidate':
      return {
        rules: request.records
          .map(record => ({
            rule: `Rule of decision ${record.number}.`,
            sources: [record.number],
            quote: quotable(record.text),
          }))
          .filter(rule => rule.quote !== ''),
        replaced: [],
        conflicts: [],
      }
    case 'plain':
      return {
        summary: `Decision ${request.record.number}: ${quotable(request.record.text) || 'no text'}.`,
      }
    case 'draft':
      return {
        notNeeded: null,
        title: `Decision ${request.nextNumber}`,
        rule: 'To be completed by the author.',
        amends: [],
        supersedes: [],
        context: 'To be completed by the author.',
        decision: [],
        consequences: 'To be completed by the author.',
        codeRefs: parseUnifiedDiff(request.diff).map(file => file.path),
      }
    case 'accept': {
      const quote = quotable(request.record.text)
      const first = request.code[0]
      const line = first?.text.split('\n').find(l => l.trim() !== '')
      return {
        recommendation: request.code.length > 0 ? 'accept' : 'keep-proposed',
        explanation: `The code cites decision ${request.record.number} in ${request.code.length} excerpt(s).`,
        points:
          quote === ''
            ? []
            : [
                {
                  quote,
                  evidence:
                    first === undefined || line === undefined
                      ? null
                      : { path: first.path, text: line },
                  finding: 'The code applies this point.',
                },
              ],
        amendments: [],
      }
    }
  }
}

/** A client that builds its suggestions from the request, without a model. */
export function fakeAssistClient(
  options: FakeAssistClientOptions = {}
): AssistClient {
  const now = options.now ?? (() => new Date())
  return {
    suggest(request) {
      const body = options.answer?.(request) ?? content(request)
      return Promise.resolve({
        kind: request.kind,
        schemaVersion: ASSIST_SCHEMA_VERSION,
        status: 'suggested',
        provenance: {
          model: 'fake',
          promptVersion: 'fake-1',
          inputHash: assistInputHash(request),
          createdAt: now().toISOString(),
        },
        ...body,
      } as AssistSuggestion)
    },
  }
}
