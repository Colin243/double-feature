import { RECORD_NOT_FOUND } from 'deepspace/worker'
import type { ActionHandler, ActionResult, ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { botVotes, validateBallot } from '../lib/ballot'
import type { Votes } from '../lib/ballot'
import { ballotId } from '../schemas/ballots'
import { resultId } from '../schemas/results'
import { finalizeRound } from '../lib/finalize'

type VotingRound = {
  roomId: string
  memberIds: string[]
  status: string
  shortlist: { id: string }[]
  submittedHost: boolean | number
  submittedGuest: boolean | number
}

type Seats = { hostId: string; guestId: string }
const submissionAccepted = { success: true, data: { submitted: true } } as const

async function loadVotingContext(tools: ActionTools, roundId: string, userId: string): Promise<ActionResult<{
  round: VotingRound
  seats: Seats
}>> {
  const found = await tools.get<VotingRound>('rounds', roundId)
  if (!found.success) {
    return { success: false, error: found.error === RECORD_NOT_FOUND ? 'round_not_found' : 'round_lookup_failed' }
  }
  const round = found.data.record.data
  if (userId === 'bot' || !round.memberIds.includes(userId)) return { success: false, error: 'not_member' }
  const room = await tools.get<Seats>('rooms', round.roomId)
  if (!room.success) return { success: false, error: 'room_lookup_failed' }
  const seats = room.data.record.data
  if (userId !== seats.hostId && userId !== seats.guestId) return { success: false, error: 'not_member' }
  return { success: true, data: { round, seats } }
}

// Both callers run inside the RecordRoom mutation queue. Persist the result
// before updating status so a retry after a partial write reuses the same row.
async function revealRound(
  tools: ActionTools, roundId: string, round: VotingRound, seats: Seats,
): Promise<ActionResult<{ revealed: true }>> {
  const id = resultId(roundId)
  const success = { success: true, data: { revealed: true } } as const
  if (round.status !== 'voting' && round.status !== 'revealed') {
    return { success: false, error: 'wrong_status' }
  }
  if (!round.submittedHost || !round.submittedGuest || !seats.guestId) {
    return { success: false, error: 'ballots_pending' }
  }

  const existing = await tools.get('results', id)
  if (!existing.success) {
    if (existing.error !== RECORD_NOT_FOUND) return { success: false, error: 'result_lookup_failed' }

    const [host, guest] = await Promise.all([
      tools.get<{ votes: unknown }>('ballots', ballotId(roundId, seats.hostId)),
      tools.get<{ votes: unknown }>('ballots', ballotId(roundId, seats.guestId)),
    ])
    if (!host.success || !guest.success) return { success: false, error: 'ballot_lookup_failed' }
    const hostVotes = host.data.record.data.votes
    const guestVotes = guest.data.record.data.votes
    if (!validateBallot(hostVotes, round.shortlist) || !validateBallot(guestVotes, round.shortlist)) {
      return { success: false, error: 'ballot_invalid' }
    }

    const result = finalizeRound({ shortlist: round.shortlist, hostVotes, guestVotes, roundId })
    const saved = await tools.create('results', {
      roundId, ...result, ballots: { hostVotes, guestVotes }, memberIds: round.memberIds,
    }, id)
    if (!saved.success) return { success: false, error: 'result_save_failed' }
  }

  if (round.status === 'revealed') return success
  const marked = await tools.update('rounds', roundId, { status: 'revealed' })
  return marked.success ? success : { success: false, error: 'round_update_failed' }
}

export const finalizeRoundAction: ActionHandler<Env> = async ({ userId, params, tools }) => {
  if (!params || Object.keys(params).length !== 1 || typeof params.roundId !== 'string' || !params.roundId.trim()) {
    return { success: false, error: 'invalid_input' }
  }

  const { roundId } = params
  const context = await loadVotingContext(tools, roundId, userId)
  if (!context.success) return context
  return revealRound(tools, roundId, context.data.round, context.data.seats)
}

async function saveBallotOnce(
  tools: ActionTools, roundId: string, userId: string, votes: Votes,
): Promise<ActionResult> {
  const id = ballotId(roundId, userId)
  const previous = await tools.get('ballots', id)
  if (previous.success) return { success: true, data: {} }
  if (previous.error !== RECORD_NOT_FOUND) return { success: false, error: 'ballot_lookup_failed' }

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
  const context = await loadVotingContext(tools, roundId, userId)
  if (!context.success) return context
  const { round, seats } = context.data
  if (round.status !== 'voting' && round.status !== 'revealed') return { success: false, error: 'wrong_status' }
  if (!validateBallot(votes, round.shortlist)) return { success: false, error: 'ballot_invalid' }
  if (round.status === 'revealed') return submissionAccepted
  const { hostId, guestId } = seats
  const isHost = hostId === userId

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
  if (!updated.success) return { success: false, error: 'round_update_failed' }

  const readyRound = { ...round, ...readiness }
  if (readyRound.submittedHost && readyRound.submittedGuest) {
    const revealed = await revealRound(tools, roundId, readyRound, seats)
    if (!revealed.success) return revealed
  }
  return submissionAccepted
}
