import { RECORD_NOT_FOUND } from 'deepspace/worker'
import type { ActionHandler, ActionResult, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { resultId } from '../schemas/results'
import { seedFilms } from '../lib/films'
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
async function filmsToSkip(
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
  const members = [hostId, guestId]
  const history = await Promise.all(members.map(userId =>
    tools.query<FilmRating & { userId: string; roomId: string }>('ratings', {
      where: userId === 'bot' ? { userId, roomId } : { userId }, limit: 100,
    }),
  ))
  if (history.some(result => !result.success)) return { success: false, error: 'rating_lookup_failed' }
  const ratings = history.flatMap((result, index) => result.success
    ? result.data.records.map(record => record.data).filter(rating =>
        rating.userId === members[index] && typeof rating.filmId === 'string' &&
        (rating.userId !== 'bot' || rating.roomId === roomId))
    : [])
  const excluded = new Set([...skipped.data, ...ratings.map(rating => rating.filmId)])
  const pool = seedFilms.filter(film => !excluded.has(film.id))
  if (!pool.length) return { success: false, error: 'no_new_films' }

  const ranked = rankByRatings(pool, preferred.moods, preferred.maxRuntime, ratings, record.recordId, seedFilms)
  const snapshot = await tools.create('roundRankingInputs', {
    snapshot: { ...preferred, excludedFilmIds: [...excluded], ratings, catalog: seedFilms },
  }, record.recordId)
  if (!snapshot.success) return { success: false, error: 'round_inputs_save_failed' }
  const saved = await tools.update('rounds', record.recordId, {
    status: 'voting',
    brief: typeof brief === 'string' && brief.trim() ? brief.trim() : buildBrief(...preferences),
    shortlist: ranked.shortlist,
    inputs: {
      ...preferred, runtimeLimitIgnored: ranked.runtimeLimitIgnored, personalized: ranked.personalized,
      skippedFilmIds: [...skipped.data],
    },
  })
  return saved.success ? result : { success: false, error: 'round_update_failed' }
}
