import { RECORD_NOT_FOUND } from 'deepspace/worker'
import type { ActionHandler, ActionResult, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { seedFilms } from '../lib/films'
import type { Film } from '../lib/films'
import { buildBrief, combineMoods } from '../lib/moods'
import type { Mood, RuntimeLimit } from '../lib/moods'
import { cacheMaxAgeMs, capExceeded, dayKey, discoveryCacheKey } from '../lib/discovery/caps'
import { DiscoveryError, minVerified, runDiscovery } from '../lib/discovery/run'
import type { CallResult, DiscoveryStats, IntegrationCall } from '../lib/discovery/run'
import type { TasteLine } from '../lib/discovery/prompt'
import { filmsToSkip, loadRatings } from './rounds'

type RoundData = {
  roomId: string
  memberIds: string[]
  status: string
  hostMoods: Mood[]
  guestMoods: Mood[]
  hostRuntime: RuntimeLimit
  guestRuntime: RuntimeLimit
  number: number
}
type Room = { hostId: string; guestId: string }
type Discovery = {
  roundId: string
  userId: string
  day: string
  createdMs: number
  cacheKey: string
  status: 'running' | 'ready' | 'failed'
  attempts: number
  fromCache?: boolean | number
  films?: Film[]
}

/** A running search that is older than this has died (the worker was restarted, say) and may be retried. */
const staleRunningMs = 90_000

type DiscoverResult =
  | { status: 'ready'; count: number; cached: boolean }
  | { status: 'fallback'; reason: string }
  | { status: 'busy' }

const done = (data: DiscoverResult): ActionResult<DiscoverResult> => ({ success: true, data })

function withTimeout(work: Promise<CallResult>, ms: number): Promise<CallResult> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<CallResult>(resolve => {
    timer = setTimeout(() => resolve({ success: false, error: 'timeout' }), ms)
  })
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer))
}

/** The integration tools return a result envelope; the pipeline only needs success and data. */
const callThrough = (tools: ActionTools): IntegrationCall => (endpoint, body, timeoutMs) =>
  withTimeout(tools.integration(endpoint, body).then(result => (
    result.success ? { success: true, data: result.data } : { success: false, error: result.error }
  )), timeoutMs)

/** What the players have liked and disliked, in words the model can use. Only films we can name are included. */
function tasteFrom(ratings: { filmId: string; stars: number; tags?: string[] }[], titles: Map<string, string>) {
  const line = (rating: { filmId: string; tags?: string[] }): TasteLine | null => {
    const title = titles.get(rating.filmId)
    return title ? { title, tags: [...new Set(rating.tags ?? [])] } : null
  }
  const pick = (matches: (stars: number) => boolean) => ratings
    .filter(rating => matches(rating.stars)).map(line)
    .filter((entry): entry is TasteLine => entry !== null).slice(0, 3)
  return { liked: pick(stars => stars >= 4), disliked: pick(stars => stars <= 2) }
}

const asRecord = (data: unknown) => data as Discovery

/**
 * Find films for this round's shortlist with a web search, a model and a
 * Wikipedia check. The host opts in. It never fails the round: when anything
 * goes wrong the answer is `fallback` and the round uses our own shortlist.
 *
 * This deliberately runs OUTSIDE the one-at-a-time Durable Object queue that
 * the other round actions use. A search takes seconds, and that queue is shared
 * by every room in the app, so waiting inside it would freeze everyone's
 * ballots. `startRound` (which is quick, and inside the queue) later picks up
 * the stored result.
 */
export const discoverFilms: ActionHandler<Env> = async ({ userId, params, tools }) => {
  if (!params || typeof params.roundId !== 'string' || !params.roundId.trim() ||
      Object.keys(params).some(key => key !== 'roundId' && key !== 'brief') ||
      (params.brief !== undefined && (typeof params.brief !== 'string' || params.brief.length > 500))) {
    return { success: false, error: 'invalid_input' }
  }
  const { roundId } = params

  const found = await tools.get<RoundData>('rounds', roundId)
  if (!found.success) {
    return { success: false, error: found.error === RECORD_NOT_FOUND ? 'round_not_found' : 'round_lookup_failed' }
  }
  const round = found.data.record.data
  if (userId === 'bot' || !round.memberIds.includes(userId)) return { success: false, error: 'not_member' }
  const roomResult = await tools.get<Room>('rooms', round.roomId)
  if (!roomResult.success) return { success: false, error: 'room_lookup_failed' }
  const room = roomResult.data.record.data
  if (room.hostId !== userId) return { success: false, error: 'not_host' }
  if (round.status !== 'setup') return { success: false, error: 'wrong_status' }

  const preferences = [round.hostMoods, round.guestMoods, round.hostRuntime, round.guestRuntime] as const
  const combined = combineMoods(...preferences)
  const brief = (typeof params.brief === 'string' && params.brief.trim()) || buildBrief(...preferences)
  const cacheKey = discoveryCacheKey(brief, combined.moods, combined.maxRuntime)
  const now = Date.now()
  const day = dayKey(now)

  // This round already has a result, or a search is in flight.
  const existingQuery = await tools.query('discoveries', { where: { roundId }, limit: 1 })
  if (!existingQuery.success) return { success: false, error: 'discovery_lookup_failed' }
  const existingRecord = existingQuery.data.records[0]
  const existing = existingRecord ? asRecord(existingRecord.data) : undefined
  if (existing?.status === 'ready') {
    return done({ status: 'ready', count: existing.films?.length ?? 0, cached: true })
  }
  if (existing?.status === 'running' && now - existing.createdMs < staleRunningMs) return done({ status: 'busy' })

  // Someone ran the same search recently: reuse it, for free.
  const cachedQuery = await tools.query('discoveries', { where: { cacheKey, status: 'ready' }, limit: 10 })
  if (!cachedQuery.success) return { success: false, error: 'discovery_lookup_failed' }
  const reusable = cachedQuery.data.records
    .map(record => asRecord(record.data))
    .filter(entry => now - entry.createdMs < cacheMaxAgeMs && (entry.films?.length ?? 0) >= minVerified)
    .sort((a, b) => b.createdMs - a.createdMs)[0]

  const base = {
    roundId, roomId: round.roomId, userId, day, createdMs: now, cacheKey,
    attempts: (existing?.attempts ?? 0) + (reusable ? 0 : 1),
  }
  const write = async (patch: Record<string, unknown>): Promise<boolean> => {
    const saved = existingRecord
      ? await tools.update('discoveries', existingRecord.recordId, { ...base, ...patch })
      : await tools.create('discoveries', { ...base, ...patch })
    return saved.success
  }

  if (reusable) {
    const saved = await write({ status: 'ready', fromCache: true, films: reusable.films, stats: { reusedFrom: reusable.roundId } })
    return saved ? done({ status: 'ready', count: reusable.films?.length ?? 0, cached: true }) : { success: false, error: 'discovery_save_failed' }
  }

  // Paid runs are limited per person and across the app. Every attempt counts, retries included.
  const today = await tools.query('discoveries', { where: { day }, limit: 500 })
  if (!today.success) return { success: false, error: 'discovery_lookup_failed' }
  const attemptsToday = today.data.records.map(record => asRecord(record.data))
  const paidGlobal = attemptsToday.reduce((total, entry) => total + (entry.fromCache ? 0 : entry.attempts ?? 0), 0)
  const paidByUser = attemptsToday.filter(entry => entry.userId === userId)
    .reduce((total, entry) => total + (entry.fromCache ? 0 : entry.attempts ?? 0), 0)
  if (capExceeded(paidByUser, paidGlobal)) return { success: false, error: 'rate_limited' }

  // Claim the round before spending anything. The unique round id means a second
  // click (or a second tab) loses here instead of paying twice.
  if (!(await write({ status: 'running', fromCache: false }))) return done({ status: 'busy' })
  const claimed = await tools.query('discoveries', { where: { roundId }, limit: 1 })
  const claimedRecord = claimed.success ? claimed.data.records[0] : undefined
  if (!claimedRecord) return { success: false, error: 'discovery_save_failed' }
  const finish = (patch: Record<string, unknown>) => tools.update('discoveries', claimedRecord.recordId, patch)

  try {
    const loaded = await loadRatings(tools, round.roomId, room.hostId, room.guestId)
    const skipped = await filmsToSkip(tools, round.roomId, round.number)
    const ratings = loaded.success ? loaded.data : []
    const excludeIds = new Set([...(skipped.success ? skipped.data : []), ...ratings.map(rating => rating.filmId)])
    const titles = new Map(seedFilms.map(film => [film.id, film.title]))
    const { liked, disliked } = tasteFrom(ratings, titles)

    const { films, stats } = await runDiscovery(callThrough(tools), {
      brief, maxRuntimeMinutes: combined.maxRuntime, liked, disliked,
      avoidTitles: [...excludeIds].map(id => titles.get(id)).filter((title): title is string => !!title),
      excludeIds,
    })
    await finish({ status: 'ready', films, stats })
    return done({ status: 'ready', count: films.length, cached: false })
  } catch (error) {
    const code = error instanceof DiscoveryError ? error.code : 'unexpected'
    const stats: DiscoveryStats | undefined = error instanceof DiscoveryError ? error.stats : undefined
    await finish({ status: 'failed', failure: code, stats })
    return done({ status: 'fallback', reason: code })
  }
}
