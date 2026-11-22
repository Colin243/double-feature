import type { ActionHandler, ActionResult, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { botVotes, validateBallot } from '../lib/ballot'
import type { Votes } from '../lib/ballot'
import { ballotId } from '../schemas/ballots'

type VotingRound = {
  roomId: string
  memberIds: string[]
  status: string
  shortlist: { id: string }[]
}

async function saveBallotOnce(
  tools: ActionTools, roundId: string, userId: string, votes: Votes,
): Promise<ActionResult> {
  const id = ballotId(roundId, userId)
  const previous = await tools.get('ballots', id)
  if (previous.success) return { success: true, data: {} }
  if (previous.error !== 'Record not found') return { success: false, error: 'ballot_lookup_failed' }

  // The RecordRoom queue keeps the explicit-ID upsert behind the absence check.
  const saved = await tools.create('ballots', { roundId, userId, votes, lockedAt: Date.now() }, id)
  return saved.success ? { success: true, data: {} } : { success: false, error: 'ballot_save_failed' }
}

export const submitBallot: ActionHandler<Env> = async ({ userId, params, tools }) => {
  if (!params || Object.keys(params).length !== 2 ||
      typeof params.roundId !== 'string' || !params.roundId.trim() || !Object.hasOwn(params, 'votes')) {
    return { success: false, error: 'invalid_input' }
  }
  const { roundId, votes } = params
  const found = await tools.get<VotingRound>('rounds', roundId)
  if (!found.success) {
    return { success: false, error: found.error === 'Record not found' ? 'round_not_found' : 'round_lookup_failed' }
  }
  const round = found.data.record.data
  if (userId === 'bot' || !round.memberIds.includes(userId)) return { success: false, error: 'not_member' }
  if (round.status !== 'voting') return { success: false, error: 'wrong_status' }
  if (!validateBallot(votes, round.shortlist)) return { success: false, error: 'ballot_invalid' }

  const room = await tools.get<{ hostId: string; guestId: string }>('rooms', round.roomId)
  if (!room.success) return { success: false, error: 'room_lookup_failed' }
  const { hostId, guestId } = room.data.record.data
  const isHost = hostId === userId
  if (!isHost && guestId !== userId) return { success: false, error: 'not_member' }

  const saved = await saveBallotOnce(tools, roundId, userId, votes)
  if (!saved.success) return saved

  if (guestId === 'bot') {
    const demo = await saveBallotOnce(tools, roundId, 'bot', botVotes(round.shortlist))
    if (!demo.success) return demo
  }

  const readiness = guestId === 'bot'
    ? { submittedHost: true, submittedGuest: true }
    : isHost ? { submittedHost: true } : { submittedGuest: true }
  const updated = await tools.update<{ submittedHost: boolean; submittedGuest: boolean }>(
    'rounds', roundId, readiness,
  )
  return updated.success
    ? { success: true, data: { submitted: true } }
    : { success: false, error: 'round_update_failed' }
}
