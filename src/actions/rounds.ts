import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import { seedFilms } from '../lib/films'
import { buildBrief, combineMoods, moodChips, rankSeedFilms } from '../lib/moods'
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
      error: found.error === 'Record not found' ? 'room_not_found' : 'room_lookup_failed',
    }
  }

  // Server action tools bypass collection permissions.
  const room = found.data.record.data
  if (room.hostId !== userId) return { success: false, error: 'not_host' }
  if (room.status !== 'ready') return { success: false, error: 'wrong_status' }

  const where = { roomId, number: 1 }
  const existing = await tools.query('rounds', { where, limit: 1 })
  if (!existing.success) return { success: false, error: 'round_lookup_failed' }
  const round = existing.data.records[0]
  if (round) return { success: true, data: { roundId: round.recordId } }

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
    return { success: false, error: found.error === 'Record not found' ? 'round_not_found' : 'round_lookup_failed' }
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

export const startRound: ActionHandler<Env> = async ({ userId, params, tools }) => {
  if (!params || typeof params.roomId !== 'string' || !params.roomId.trim() ||
      Object.keys(params).some(key => key !== 'roomId' && key !== 'brief') ||
      (params.brief !== undefined && (typeof params.brief !== 'string' || params.brief.length > 500))) {
    return { success: false, error: 'invalid_input' }
  }
  const { roomId, brief } = params
  const room = await tools.get<ReadyRoom>('rooms', roomId)
  if (!room.success) {
    return { success: false, error: room.error === 'Record not found' ? 'room_not_found' : 'room_lookup_failed' }
  }
  if (room.data.record.data.hostId !== userId) return { success: false, error: 'not_host' }
  if (room.data.record.data.status !== 'ready') return { success: false, error: 'wrong_status' }

  const rounds = await tools.query<Round>('rounds', { where: { roomId, number: 1 }, limit: 1 })
  if (!rounds.success) return { success: false, error: 'round_lookup_failed' }
  const record = rounds.data.records[0]
  if (!record) return { success: false, error: 'round_not_found' }
  const round = record.data
  const result = { success: true, data: { roundId: record.recordId } } as const
  if (round.status === 'voting') return result
  if (round.status !== 'setup') return { success: false, error: 'wrong_status' }

  const preferences = [round.hostMoods, round.guestMoods, round.hostRuntime, round.guestRuntime] as const
  const inputs = combineMoods(...preferences)
  const saved = await tools.update('rounds', record.recordId, {
    status: 'voting',
    brief: typeof brief === 'string' && brief.trim() ? brief.trim() : buildBrief(...preferences),
    shortlist: rankSeedFilms(seedFilms, inputs.moods, inputs.maxRuntime),
    inputs,
  })
  return saved.success ? result : { success: false, error: 'round_update_failed' }
}
