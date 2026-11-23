import type { Film } from '../films'
import { appearsIn, candidateId } from './ids'
import { allowedMoodTags, parseModelFilms } from './parse'
import { buildDiscoveryPrompt } from './prompt'
import type { TasteLine } from './prompt'
import { buildSearchQuery, exaSnippets } from './query'
import { matchWikipediaFilm } from './wikipedia'
import type { WikipediaPage } from './wikipedia'

export type CallResult = { success: boolean; data?: unknown; error?: string }
/** Calls one DeepSpace integration. Injected, so the pipeline can be tested without spending money. */
export type IntegrationCall = (endpoint: string, body: Record<string, unknown>, timeoutMs: number) => Promise<CallResult>

export type DiscoveryStats = {
  exaCalls: number; wikiCalls: number; llmCalls: number; costUsd: number
  proposed?: number; ungrounded?: number
  /** Titles dropped, with why, so a run that found nothing can be diagnosed afterwards. Server-only. */
  dropped?: string[]
}
export type DiscoveryFailure = 'search_failed' | 'no_results' | 'model_failed' | 'model_unusable' | 'too_few_verified'

export class DiscoveryError extends Error {
  constructor(readonly code: DiscoveryFailure, readonly stats: DiscoveryStats) {
    super(code)
  }
}

/**
 * Not the newest model on purpose. claude-haiku-5-5 spends its whole token
 * budget on hidden reasoning and returns nothing ("output_budget_exhausted"),
 * and the integration has no setting to switch that off. Haiku 4.5 answers
 * directly: about 700 tokens and under half a cent per run.
 */
export const discoveryModel = 'claude-haiku-4-5'
/**
 * Even a single verified film is worth keeping: `startRound` fills the rest of
 * the shortlist from our own list. Only a search that verifies nothing counts
 * as a failure and falls back entirely.
 */
export const minVerified = 1
/** Each film we verify costs one Wikipedia lookup (about a tenth of a credit). */
export const maxToVerify = 8
const wikipediaLookupCostUsd = 0.0013

export type DiscoveryInput = {
  brief: string
  maxRuntimeMinutes: number
  liked: readonly TasteLine[]
  disliked: readonly TasteLine[]
  avoidTitles: readonly string[]
  /** Film ids not to bring back. */
  excludeIds: ReadonlySet<string>
}

const amount = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

function modelText(data: unknown): string {
  const content = (data as { content?: unknown })?.content
  if (!Array.isArray(content)) return ''
  return content
    .map(block => (block && typeof block === 'object' && (block as { type?: string }).type === 'text'
      ? String((block as { text?: unknown }).text ?? '') : ''))
    .join('')
}

function wikipediaPages(data: unknown): WikipediaPage[] {
  const rows = Array.isArray(data) ? data : (data as { results?: unknown })?.results
  if (!Array.isArray(rows)) return []
  return rows.flatMap(row => {
    const page = row as Partial<WikipediaPage>
    return page && typeof page.title === 'string' && typeof page.key === 'string'
      ? [{ title: page.title, key: page.key, description: page.description ?? null, excerpt: page.excerpt ?? null }]
      : []
  })
}

async function safely(call: IntegrationCall, endpoint: string, body: Record<string, unknown>, timeoutMs: number): Promise<CallResult> {
  try {
    return await call(endpoint, body, timeoutMs)
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'call failed' }
  }
}

/**
 * 1. A web search for the brief finds snippets about films.
 * 2. A model proposes films from those snippets, tuned to what the players have liked.
 * 3. Each proposal is checked against Wikipedia, which drops invented films.
 * Throws a DiscoveryError (carrying what was spent) when it cannot produce enough films.
 */
export async function runDiscovery(
  call: IntegrationCall, input: DiscoveryInput,
): Promise<{ films: Film[]; stats: DiscoveryStats }> {
  const stats: DiscoveryStats = { exaCalls: 0, wikiCalls: 0, llmCalls: 0, costUsd: 0 }

  stats.exaCalls += 1
  const search = await safely(call, 'exa/search', {
    query: buildSearchQuery(input.brief),
    numResults: 10,
    type: 'auto',
    contents: { highlights: { numSentences: 2, highlightsPerUrl: 3, maxCharacters: 600 } },
  }, 20_000)
  if (!search.success) throw new DiscoveryError('search_failed', stats)
  stats.costUsd += amount((search.data as { costUsd?: unknown })?.costUsd)
  const snippets = exaSnippets((search.data as { results?: unknown })?.results)
  if (!snippets.length) throw new DiscoveryError('no_results', stats)

  const prompt = buildDiscoveryPrompt({
    brief: input.brief,
    moodTags: [...allowedMoodTags],
    maxRuntimeMinutes: input.maxRuntimeMinutes,
    liked: input.liked,
    disliked: input.disliked,
    avoidTitles: input.avoidTitles,
    snippets,
  })
  stats.llmCalls += 1
  const reply = await safely(call, 'anthropic/chat-completion', {
    model: discoveryModel,
    max_tokens: 1500,
    temperature: 0.2,
    system: prompt.system,
    messages: [{ role: 'user', content: prompt.user }],
  }, 25_000)
  if (!reply.success) throw new DiscoveryError('model_failed', stats)
  stats.costUsd += amount((reply.data as { costUsd?: unknown })?.costUsd)
  const parsed = parseModelFilms(modelText(reply.data))
  stats.proposed = parsed.length
  // A film the web pages never mention is dropped even if it sounds real: models
  // readily pair a real title with another film's description.
  const grounded = parsed.filter(film => appearsIn(film.title, prompt.evidence))
  stats.ungrounded = parsed.length - grounded.length
  stats.dropped = parsed.filter(film => !grounded.includes(film)).map(film => `${film.title} (${film.year}): not in the web pages`)
  const proposals = grounded.filter(film => !input.excludeIds.has(film.id))
  if (!proposals.length) throw new DiscoveryError('model_unusable', stats)

  const checked = await Promise.all(proposals.slice(0, maxToVerify).map(async proposal => {
    stats.wikiCalls += 1
    stats.costUsd += wikipediaLookupCostUsd
    const found = await safely(call, 'wikipedia/search-pages', { query: `${proposal.title} ${proposal.year} film`, limit: 3 }, 8_000)
    if (!found.success) return null
    const match = matchWikipediaFilm(wikipediaPages(found.data), proposal.title, proposal.year)
    return match ? { proposal, match } : null
  }))

  proposals.slice(0, maxToVerify).forEach((proposal, index) => {
    if (!checked[index]) stats.dropped = [...(stats.dropped ?? []), `${proposal.title} (${proposal.year}): not confirmed on Wikipedia`]
  })

  const films: Film[] = []
  const seen = new Set<string>()
  for (const entry of checked) {
    if (!entry) continue
    const id = candidateId(entry.proposal.title, entry.match.year)
    if (seen.has(id) || input.excludeIds.has(id)) continue
    seen.add(id)
    films.push({
      id,
      title: entry.proposal.title,
      year: entry.match.year,
      runtimeMinutes: null,
      moods: entry.proposal.moods,
      hook: entry.proposal.hook,
      reason: entry.proposal.reason,
      sourceUrl: entry.match.sourceUrl,
      source: 'discovered',
    })
  }
  if (films.length < minVerified) throw new DiscoveryError('too_few_verified', stats)
  return { films, stats }
}
