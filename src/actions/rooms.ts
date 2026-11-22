import { RECORD_NOT_FOUND } from 'deepspace/worker'
import type { ActionHandler, ActionResult, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { generateInviteCode, normalizeInviteCode } from '../lib/invite-code'

type Room = {
  hostId: string
  guestId: string
  status: 'waiting' | 'ready'
}
type SeatClaim = { roomId: string; guestId: string }
type JoinResult = ActionResult<{ roomId: string }>

const demoGuestId = 'bot'
const claimsCollection = 'roomSeatClaims'

async function claimSeat(
  tools: ActionTools,
  roomId: string,
  room: Room,
  guestId: string,
): Promise<JoinResult> {
  const joined = { success: true, data: { roomId } } as const
  if (room.guestId || room.status !== 'waiting') {
    return room.guestId === guestId && room.status === 'ready'
      ? joined
      : { success: false, error: 'room_full' }
  }

  // Explicit IDs upsert in this SDK. Let it generate an ID so uniqueOn
  // rejects a second insert for the same room.
  const claim = await tools.create(claimsCollection, { roomId, guestId })
  if (!claim.success) {
    const existing = await tools.query<SeatClaim>(claimsCollection, { where: { roomId }, limit: 1 })
    const winner = existing.success ? existing.data.records[0]?.data : undefined
    if (!winner) return { success: false, error: 'seat_claim_failed' }
    if (winner.guestId !== guestId) return { success: false, error: 'room_full' }
  }

  // The claim survives a failed update so the same guest can retry.
  const updated = await tools.update('rooms', roomId, {
    guestId,
    status: 'ready',
    memberIds: guestId === demoGuestId ? [room.hostId] : [room.hostId, guestId],
  })
  return updated.success ? joined : { success: false, error: 'room_update_failed' }
}

export const createRoom: ActionHandler<Env> = async ({ userId, params, tools }) => {
  if (!params || typeof params !== 'object' || Array.isArray(params) ||
      Object.keys(params).length !== 0 || userId === demoGuestId) {
    return { success: false, error: 'invalid_input' }
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const inviteCode = generateInviteCode()
    const result = await tools.create('rooms', {
      hostId: userId,
      guestId: '',
      status: 'waiting',
      memberIds: [userId],
      inviteCode,
    })
    if (result.success) {
      return { success: true, data: { roomId: result.data.recordId, inviteCode } }
    }

    // The RecordRoom SDK reports a uniqueOn conflict as "Duplicate: a record with
    // <field>=<value> already exists in <collection>". Match the stable prefix and
    // the field name (not the whole sentence) so a wording change in the tail
    // does not turn a retryable collision into a hard failure.
    const collided = typeof result.error === 'string' &&
      result.error.startsWith('Duplicate:') && result.error.includes('inviteCode=')
    if (!collided) break
  }

  return { success: false, error: 'room_create_failed' }
}

export const joinRoom: ActionHandler<Env> = async ({ userId, params, tools }) => {
  if (!params || Object.keys(params).length !== 1 || typeof params.code !== 'string') {
    return { success: false, error: 'invalid_input' }
  }
  const code = normalizeInviteCode(params.code)
  if (!code || userId === demoGuestId) {
    return { success: false, error: 'invalid_input' }
  }

  const found = await tools.query<Room>('rooms', { where: { inviteCode: code }, limit: 1 })
  if (!found.success) return { success: false, error: 'room_lookup_failed' }
  const room = found.data.records[0]
  if (!room) return { success: false, error: 'room_not_found' }
  if (room.data.hostId === userId) return { success: false, error: 'own_room' }
  return claimSeat(tools, room.recordId, room.data, userId)
}

export const addDemoPartner: ActionHandler<Env> = async ({ userId, params, tools }) => {
  if (!params || Object.keys(params).length !== 1 || typeof params.roomId !== 'string' || !params.roomId.trim()) {
    return { success: false, error: 'invalid_input' }
  }

  const { roomId } = params
  const found = await tools.get<Room>('rooms', roomId)
  if (!found.success) {
    return {
      success: false,
      error: found.error === RECORD_NOT_FOUND ? 'room_not_found' : 'room_lookup_failed',
    }
  }
  const room = found.data.record.data
  if (room.hostId !== userId) return { success: false, error: 'not_host' }
  return claimSeat(tools, roomId, room, demoGuestId)
}
