import { RECORD_NOT_FOUND } from 'deepspace/worker'
import type { ActionHandler, ActionResult, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { resultId } from '../schemas/results'
import { fitsRuntime, seedFilms } from '../lib/films'
import type { Film } from '../lib/films'
import { buildBrief, combineMoods, moodChips } from '../lib/moods'
import { rankByRatings } from '../lib/ranking'
import type { FilmRating } from '../lib/ranking'
import type { Mood, RuntimeLimit } from '../lib/moods'

type ReadyRoom = {
  hostId: string
  guestId: string
  status: 'waiting' | 'ready'
  memberIds: string[]
}

const demoMoods: readonly Mood[] = ['laugh', 'guessing']

/** A round needs at least this many films to be worth voting on. */
const MIN_SHORTLIST = 3

export const openSetupRound: ActionHandler<Env> = async ({ userId, params, tools }) => {
  if (!params || Object.keys(params).length !== 1 ||
      typeof params.roomId !== 'string' || !params.roomId.trim()) {
    return { success: false, error: 'invalid_input' }
  }

  const { roomId } = params
  const found = await tools.get<ReadyRoom>('rooms', roomId)
  if (!found.success) {
    return {
      success: false,
      error: found.error === RECORD_NOT_FOUND ? 'room_not_found' : 'room_lookup_failed',
    }
  }

  // Server action tools bypass collection permissions.
  const room = found.data.record.data
  if (room.hostId !== userId) return { success: false, error: 'not_host' }
  if (room.status !== 'ready') return { success: false, error: 'wrong_status' }

  // Follow the room's latest round. Opening again while that round is still in
  // setup or voting returns it (idempotent). Once it has been revealed, the
  // next call opens the following round: that is "Start another round".
  const latest = await tools.query<{ number: number; status: string }>('rounds', {
    where: { roomId }, orderBy: 'number', orderDir: 'desc', limit: 1,
  })
  if (!latest.success) return { success: false, error: 'round_lookup_failed' }
  const current = latest.data.records[0]
  if (current && current.data.status !== 'revealed') {
    return { success: true, data: { roundId: current.recordId } }
  }

  const where = { roomId, number: (current?.data.number ?? 0) + 1 }

  // Let DeepSpace assign the ID so the compound uniqueness check handles races.
  const created = await tools.create('rounds', {
    ...where,
    status: 'setup',
    memberIds: [...room.memberIds],
    hostMoods: [],
    guestMoods: room.guestId === 'bot' ? [...demoMoods] : [],
    hostRuntime: 0,
    guestRuntime: 0,
    brief: '',
    shortlist: [],
    submittedHost: false,
    submittedGuest: false,
  })
  if (created.success) return { success: true, data: { roundId: created.data.recordId } }

  // Another request may have inserted the round after the first lookup.
  const recovered = await tools.query('rounds', { where, limit: 1 })
  const winner = recovered.success ? recovered.data.records[0] : undefined
  return winner
    ? { success: true, data: { roundId: winner.recordId } }
    : { success: false, error: 'round_create_failed' }
}

type Round = {
  roomId: string
  number: number
  memberIds: string[]
  status: 'setup' | 'voting' | 'revealed'
  hostMoods: Mood[]
  guestMoods: Mood[]
  hostRuntime: RuntimeLimit
  guestRuntime: RuntimeLimit
}

function isMood(value: unknown): value is Mood {
  return typeof value === 'string' && Object.hasOwn(moodChips, value)
}

export const setMood: ActionHandler<Env> = async ({ userId, params, tools }) => {
  if (!params || Object.keys(params).length !== 3) return { success: false, error: 'invalid_input' }
  const { roundId, moods, runtime } = params
  if (typeof roundId !== 'string' || !roundId.trim() ||
      !Array.isArray(moods) || !moods.every(isMood) ||
      (runtime !== 0 && runtime !== 100 && runtime !== 120)) {
    return { success: false, error: 'invalid_input' }
  }

  const found = await tools.get<Round>('rounds', roundId)
  if (!found.success) {
    return { success: false, error: found.error === RECORD_NOT_FOUND ? 'round_not_found' : 'round_lookup_failed' }
  }
  const round = found.data.record.data
  if (!round.memberIds.includes(userId)) return { success: false, error: 'not_member' }

  const roomResult = await tools.get<ReadyRoom>('rooms', round.roomId)
  if (!roomResult.success) return { success: false, error: 'room_lookup_failed' }
  const room = roomResult.data.record.data
  const isHost = room.hostId === userId
  if (!isHost && (room.guestId !== userId || userId === 'bot')) {
    return { success: false, error: 'not_member' }
  }
  if (round.status !== 'setup') return { success: false, error: 'wrong_status' }

  const chips = [...new Set(moods)]
  const saved = await tools.update<Round>('rounds', roundId, isHost
    ? { hostMoods: chips, hostRuntime: runtime }
    : { guestMoods: chips, guestRuntime: runtime })
  return saved.success ? { success: true, data: { saved: true } } : { success: false, error: 'round_update_failed' }
}

type StoredDiscovery = { status?: string; films?: unknown; fromCache?: boolean | number }

function isStoredFilm(value: unknown): value is Film {
  const film = value as Partial<Film> | null
  return !!film && typeof film.id === 'string' && typeof film.title === 'string' &&
    typeof film.year === 'number' && Array.isArray(film.moods) && typeof film.hook === 'string'
}

type StoredResult = {
  filmId?: string | null
  ballots?: { hostVotes?: Record<string, string>; guestVotes?: Record<string, string> }
}

/**
 * Films this room should not be offered again: every earlier round's pick, and
 * every film either player voted "already seen" on. Reads the earlier results
 * server-side (the ballots inside a result are only readable here and by the
 * room's members after the reveal).
 */
export async function filmsToSkip(
  tools: ActionTools, roomId: string, currentNumber: number,
): Promise<ActionResult<Set<string>>> {
  const skipped = new Set<string>()
  if (currentNumber <= 1) return { success: true, data: skipped }

  const earlier = await tools.query<{ number: number }>('rounds', { where: { roomId }, limit: 50 })
  if (!earlier.success) return { success: false, error: 'round_lookup_failed' }
  for (const earlierRound of earlier.data.records) {
    if (earlierRound.data.number >= currentNumber) continue
    const found = await tools.get<StoredResult>('results', resultId(earlierRound.recordId))
    if (!found.success) {
      if (found.error === RECORD_NOT_FOUND) continue
      return { success: false, error: 'result_lookup_failed' }
    }
    const { filmId, ballots } = found.data.record.data
    if (filmId) skipped.add(filmId)
    for (const votes of [ballots?.hostVotes, ballots?.guestVotes]) {
      for (const [id, vote] of Object.entries(votes ?? {})) if (vote === 'seen') skipped.add(id)
    }
  }
  return { success: true, data: skipped }
}

/**
 * Both players' ratings. A person's ratings follow them across rooms; the demo
 * partner's are scoped to the room they were loaded in.
 */
export async function loadRatings(
  tools: ActionTools, roomId: string, hostId: string, guestId: string,
): Promise<ActionResult<FilmRating[]>> {
  const members = [hostId, guestId]
  const history = await Promise.all(members.map(memberId =>
    tools.query<FilmRating & { userId: string; roomId: string }>('ratings', {
      where: memberId === 'bot' ? { userId: memberId, roomId } : { userId: memberId }, limit: 100,
    }),
  ))
  if (history.some(result => !result.success)) return { success: false, error: 'rating_lookup_failed' }
  const ratings = history.flatMap((result, index) => result.success
    ? result.data.records.map(record => record.data).filter(rating =>
        rating.userId === members[index] && typeof rating.filmId === 'string' &&
        (rating.userId !== 'bot' || rating.roomId === roomId))
    : [])
  return { success: true, data: ratings }
}

export const startRound: ActionHandler<Env> = async ({ userId, params, tools }) => {
  if (!params || typeof params.roomId !== 'string' || !params.roomId.trim() ||
      Object.keys(params).some(key => key !== 'roomId' && key !== 'brief') ||
      (params.brief !== undefined && (typeof params.brief !== 'string' || params.brief.length > 500))) {
    return { success: false, error: 'invalid_input' }
  }
  const { roomId, brief } = params
  const room = await tools.get<ReadyRoom>('rooms', roomId)
  if (!room.success) {
    return { success: false, error: room.error === RECORD_NOT_FOUND ? 'room_not_found' : 'room_lookup_failed' }
  }
  if (room.data.record.data.hostId !== userId) return { success: false, error: 'not_host' }
  if (room.data.record.data.status !== 'ready') return { success: false, error: 'wrong_status' }

  const rounds = await tools.query<Round>('rounds', {
    where: { roomId }, orderBy: 'number', orderDir: 'desc', limit: 1,
  })
  if (!rounds.success) return { success: false, error: 'round_lookup_failed' }
  const record = rounds.data.records[0]
  if (!record) return { success: false, error: 'round_not_found' }
  const round = record.data
  const result = { success: true, data: { roundId: record.recordId } } as const
  if (round.status === 'voting') return result
  if (round.status !== 'setup') return { success: false, error: 'wrong_status' }

  const preferences = [round.hostMoods, round.guestMoods, round.hostRuntime, round.guestRuntime] as const
  const preferred = combineMoods(...preferences)
  const skipped = await filmsToSkip(tools, roomId, round.number)
  if (!skipped.success) return skipped

  const { hostId, guestId } = room.data.record.data
  const loaded = await loadRatings(tools, roomId, hostId, guestId)
  if (!loaded.success) return loaded
  const ratings = loaded.data
  const ratedIds = new Set(ratings.map(rating => rating.filmId))
  const excluded = new Set([...skipped.data, ...ratedIds])

  // Films found by a discovery run for this round (the host opted in), if one
  // finished. Seed films win when both lists have the same film, because they
  // carry a verified runtime.
  const discovery = await tools.query<StoredDiscovery>('discoveries', { where: { roundId: record.recordId }, limit: 1 })
  if (!discovery.success) return { success: false, error: 'round_lookup_failed' }
  const stored = discovery.data.records[0]?.data
  const seedIds = new Map(seedFilms.map(film => [film.id, film]))
  const discovered: Film[] = stored?.status === 'ready' && Array.isArray(stored.films)
    ? stored.films.filter(isStoredFilm).map(film => seedIds.get(film.id) ?? film)
    : []
  const discoveredIds = new Set(discovered.map(film => film.id))
  const universe: Film[] = [...seedFilms, ...discovered.filter(film => !seedIds.has(film.id))]

  // Fresh films come first, and when discovery ran, the films it found come
  // before our own. A small catalog can run out (every film picked, seen or
  // rated), and a round must still be able to start, so when fewer than
  // MIN_SHORTLIST fresh films are left we bring back repeats in order of how
  // little they bother the players: films someone rated, then earlier picks and
  // films marked "already seen". The repeats are recorded and shown.
  const fresh = universe.filter(film => !excluded.has(film.id))
  const freshDiscovered = fresh.filter(film => discoveredIds.has(film.id))
  const tiers = [
    discovered.length && freshDiscovered.length >= MIN_SHORTLIST ? freshDiscovered : fresh,
    universe.filter(film => ratedIds.has(film.id) && !skipped.data.has(film.id)),
    universe.filter(film => skipped.data.has(film.id)),
  ]
  const pool: Film[] = []
  const repeatedFilmIds: string[] = []
  // Only films that fit the players' runtime limit count toward the minimum:
  // otherwise "under 100 minutes" with the two short films already rated would
  // leave a one-film vote while longer films sat unused in the pool.
  const usable = (films: readonly Film[]) => films.filter(film => fitsRuntime(film, preferred.maxRuntime)).length
  tiers.forEach((tier, index) => {
    if (index > 0 && usable(pool) >= MIN_SHORTLIST) return
    pool.push(...tier)
    if (index > 0) repeatedFilmIds.push(...tier.map(film => film.id))
  })

  const ranked = rankByRatings(pool, preferred.moods, preferred.maxRuntime, ratings, record.recordId, universe)
  // Films the search found always make the shortlist, ahead of our own: the
  // search cost something, and ranking alone could push a new film out in favour
  // of six we already had. Our own films fill the remaining places.
  const rank = new Map(ranked.shortlist.map((film, index) => [film.id, index]))
  const found = pool.filter(film => discoveredIds.has(film.id))
    .sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99))
  const shortlist = found.length
    ? [...found, ...ranked.shortlist.filter(film => !discoveredIds.has(film.id))].slice(0, 6)
    : ranked.shortlist
  const snapshot = await tools.create('roundRankingInputs', {
    snapshot: { ...preferred, excludedFilmIds: [...excluded], repeatedFilmIds, ratings, catalog: universe },
  }, record.recordId)
  if (!snapshot.success) return { success: false, error: 'round_inputs_save_failed' }
  const saved = await tools.update('rounds', record.recordId, {
    status: 'voting',
    brief: typeof brief === 'string' && brief.trim() ? brief.trim() : buildBrief(...preferences),
    shortlist,
    inputs: {
      ...preferred, runtimeLimitIgnored: ranked.runtimeLimitIgnored, personalized: ranked.personalized,
      skippedFilmIds: [...skipped.data], repeatedFilmIds,
      discovery: discovered.length
        ? { used: true, count: discovered.length, cached: Boolean(stored?.fromCache) }
        : { used: false },
    },
  })
  return saved.success ? result : { success: false, error: 'round_update_failed' }
}
