import { RECORD_NOT_FOUND } from 'deepspace/worker'
import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import { resultId } from '../schemas/results'
import { isReactionTag, ratingId } from '../lib/rating'

export const saveRating: ActionHandler<Env> = async ({ userId, params, tools }) => {
  const { roomId, roundId, filmId, stars, tags = [] } = params ?? {}
  if (Object.keys(params ?? {}).some(key => !['roomId', 'roundId', 'filmId', 'stars', 'tags'].includes(key)) ||
      typeof roomId !== 'string' || !roomId.trim() ||
      (roundId !== undefined && (typeof roundId !== 'string' || !roundId.trim())) ||
      typeof filmId !== 'string' || !filmId.trim() ||
      typeof stars !== 'number' || !Number.isInteger(stars) || stars < 1 || stars > 5 ||
      !Array.isArray(tags) || !tags.every(isReactionTag)) {
    return { success: false, error: 'invalid_input' }
  }

  const room = await tools.get<{ hostId: string; guestId: string }>('rooms', roomId)
  if (!room.success) {
    return { success: false, error: room.error === RECORD_NOT_FOUND ? 'room_not_found' : 'room_lookup_failed' }
  }
  const { hostId, guestId } = room.data.record.data
  if (userId === 'bot' || (userId !== hostId && userId !== guestId)) {
    return { success: false, error: 'not_member' }
  }

  let roundIds: string[]
  if (roundId) {
    const round = await tools.get<{ roomId: string; status: string }>('rounds', roundId)
    if (!round.success) {
      return { success: false, error: round.error === RECORD_NOT_FOUND ? 'invalid_input' : 'round_lookup_failed' }
    }
    if (round.data.record.data.roomId !== roomId || round.data.record.data.status !== 'revealed') {
      return { success: false, error: 'invalid_input' }
    }
    roundIds = [roundId]
  } else {
    const rounds = await tools.query('rounds', {
      where: { roomId, status: 'revealed' }, orderBy: 'number', orderDir: 'desc', limit: 50,
    })
    if (!rounds.success) return { success: false, error: 'round_lookup_failed' }
    roundIds = rounds.data.records.map(round => round.recordId)
  }

  for (const id of roundIds) {
    const result = await tools.get<{ filmId?: string }>('results', resultId(id))
    if (!result.success) {
      if (result.error === RECORD_NOT_FOUND) continue
      return { success: false, error: 'result_lookup_failed' }
    }
    if (result.data.record.data.filmId !== filmId) continue

    const saved = await tools.create('ratings', {
      userId, roomId, filmId, stars, tags: [...new Set(tags)],
    }, ratingId(userId, filmId))
    return saved.success
      ? { success: true, data: { saved: true } }
      : { success: false, error: 'rating_save_failed' }
  }

  return { success: false, error: 'invalid_input' }
}

export const seedDemoHistory: ActionHandler<Env> = async ({ userId, params, tools }) => {
  if (typeof params?.roomId !== 'string' || !params.roomId.trim() || Object.keys(params).length !== 1) {
    return { success: false, error: 'invalid_input' }
  }

  const { roomId } = params
  const room = await tools.get<{ hostId: string; guestId: string }>('rooms', roomId)
  if (!room.success) {
    return { success: false, error: room.error === RECORD_NOT_FOUND ? 'room_not_found' : 'room_lookup_failed' }
  }
  if (room.data.record.data.hostId !== userId) return { success: false, error: 'not_host' }
  if (room.data.record.data.guestId !== 'bot') return { success: false, error: 'not_demo_room' }

  const examples = [
    { filmId: 'chungking-express-1994', stars: 5, tags: ['great-chemistry'] },
    { filmId: 'lust-caution-2007', stars: 2, tags: ['too-slow'] },
  ]
  for (const example of examples) {
    const saved = await tools.create('ratings', {
      ...example, userId: 'bot', roomId,
    }, `bot_${roomId}_${example.filmId}`)
    if (!saved.success) return { success: false, error: 'rating_save_failed' }
  }
  return { success: true, data: { saved: true } }
}
