import { describe, expect, it, vi } from 'vitest'
import type { ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { roundsSchema } from '../schemas/rounds'
import { actions } from './index'
import { ballotId, ballotsSchema } from '../schemas/ballots'
import { botVotes } from '../lib/ballot'
import { isRoundMutation, RoundMutationQueue } from '../server/round-mutations'

const roomId = 'movie-night'
const roundId = 'round-one'

function setup(guestId = 'guest', status = 'ready') {
  const memberIds = guestId === 'bot' ? ['host'] : ['host', guestId]
  let saved: Record<string, unknown> | undefined
  const results = new Map<string, Record<string, unknown>>()
  const ballots = new Map<string, Record<string, unknown>>()
  const record = (recordId: string, data: Record<string, unknown>) => ({
    recordId, data, createdBy: 'host', createdAt: '', updatedAt: '',
  })
  const create = vi.fn(async (collection: string, data: Record<string, unknown>, id?: string) => {
    if (collection === 'results' && id) {
      results.set(id, structuredClone(data))
      return { success: true, data: { recordId: id } }
    }
    if (collection === 'ballots' && id) {
      // Mirror the SDK's explicit-ID upsert, including the risk of overwrites.
      ballots.set(id, structuredClone(data))
      return { success: true, data: { recordId: id } }
    }
    if (saved) return { success: false, error: 'Duplicate room round' }
    saved = structuredClone(data)
    return { success: true, data: { recordId: roundId } }
  })
  let failNextUpdate = false
  let failReveal = false
  const tools = {
    get: vi.fn(async (collection: string, id: string) => {
      if (collection === 'results') {
        const result = results.get(id)
        return result
          ? { success: true, data: { record: record(id, result) } }
          : { success: false, error: 'Record not found' }
      }
      if (collection === 'ballots') {
        const ballot = ballots.get(id)
        return ballot
          ? { success: true, data: { record: record(id, ballot) } }
          : { success: false, error: 'Record not found' }
      }
      if (collection === 'rounds') {
        return saved
          ? { success: true, data: { record: record(roundId, saved) } }
          : { success: false, error: 'Record not found' }
      }
      return {
        success: true,
        data: { record: record(roomId, { hostId: 'host', guestId, status, memberIds }) },
      }
    }),
    query: vi.fn(async () => ({
      success: true,
      data: { records: saved ? [record(roundId, saved)] : [], count: saved ? 1 : 0 },
    })),
    create,
    update: vi.fn(async (_collection: string, _id: string, patch: Record<string, unknown>) => {
      if (failNextUpdate || (failReveal && patch.status === 'revealed')) {
        failReveal = false
        failNextUpdate = false
        return { success: false, error: 'injected update failure' }
      }
      saved = { ...saved, ...structuredClone(patch) }
      return { success: true, data: { recordId: roundId } }
    }),
  }
  const queue = new RoundMutationQueue()
  const run = (name: string, userId: string, params: Record<string, unknown>) =>
    actions[name]({ userId, params, tools: tools as unknown as ActionTools, env: {} as Env, callerJwt: 'test' })
  return {
    tools,
    saved: () => saved,
    ballots,
    results,
    failReveal: () => { failReveal = true },
    finalize: (userId = 'host') =>
      queue.run(() => run('finalizeRound', userId, { roundId })),
    failUpdate: () => { failNextUpdate = true },
    submit: (userId: string, votes: unknown) =>
      queue.run(() => run('submitBallot', userId, { roundId, votes })),
    run: (userId = 'host', params: Record<string, unknown> = { roomId }) =>
      run('openSetupRound', userId, params),
    mood: (userId: string, moods: string[], runtime: number) =>
      queue.run(() => run('setMood', userId, { roundId, moods, runtime })),
    start: (brief?: string, userId = 'host') =>
      queue.run(() => run('startRound', userId, { roomId, brief })),
  }
}

describe('openSetupRound', () => {
  it('opens round one for a ready host with the right membership and defaults', async () => {
    const room = setup()
    expect(await room.run()).toEqual({ success: true, data: { roundId } })
    expect(room.tools.get).toHaveBeenCalledWith('rooms', roomId)
    expect(room.tools.query).toHaveBeenCalledWith('rounds', { where: { roomId, number: 1 }, limit: 1 })
    expect(room.tools.create).toHaveBeenCalledWith('rounds', {
      roomId, number: 1, status: 'setup', memberIds: ['host', 'guest'],
      hostMoods: [], guestMoods: [], hostRuntime: 0, guestRuntime: 0,
      brief: '', shortlist: [], submittedHost: false, submittedGuest: false,
    })

    const demo = setup('bot')
    expect((await demo.run()).success).toBe(true)
    expect(demo.saved()).toMatchObject({ memberIds: ['host'], guestMoods: ['laugh', 'guessing'] })
  })

  it('rejects guests, outsiders, waiting rooms, and unexpected fields', async () => {
    const room = setup()
    for (const user of ['guest', 'outsider']) {
      expect(await room.run(user)).toEqual({ success: false, error: 'not_host' })
    }
    expect(await room.run('host', { roomId, userId: 'guest' }))
      .toEqual({ success: false, error: 'invalid_input' })
    expect(room.tools.create).not.toHaveBeenCalled()

    const waiting = setup('', 'waiting')
    expect(await waiting.run()).toEqual({ success: false, error: 'wrong_status' })
    expect(waiting.tools.create).not.toHaveBeenCalled()
  })

  it('returns one round ID across racing opens and preserves saved preferences on reopen', async () => {
    expect(roundsSchema.uniqueOn).toEqual(['roomId', 'number'])
    const room = setup()
    const expected = { success: true, data: { roundId } }
    expect(await Promise.all([room.run(), room.run()])).toEqual([expected, expected])
    expect(room.tools.create).toHaveBeenCalledTimes(2)

    const saved = room.saved()
    expect(saved).toBeDefined()
    Object.assign(saved!, { hostMoods: ['heartbreak'], hostRuntime: 100 })
    expect(await room.run()).toEqual(expected)
    expect(room.tools.create).toHaveBeenCalledTimes(2)
    expect(room.saved()).toMatchObject({ hostMoods: ['heartbreak'], hostRuntime: 100 })
  })
})

describe('setup mutations', () => {
  it('validates moods and lets each member update only their own fields', async () => {
    const room = setup()
    await room.run()
    expect(await room.mood('outsider', ['laugh'], 100)).toEqual({ success: false, error: 'not_member' })
    expect(await room.mood('guest', ['constructor'], 100)).toEqual({ success: false, error: 'invalid_input' })
    expect(await room.mood('guest', [], 90)).toEqual({ success: false, error: 'invalid_input' })
    expect(await room.start(undefined, 'guest')).toEqual({ success: false, error: 'not_host' })
    expect(room.tools.update).not.toHaveBeenCalled()
    await Promise.all([room.mood('host', ['laugh', 'laugh'], 120), room.mood('guest', [], 100)])
    expect(room.tools.update.mock.calls.map(call => call[2])).toEqual([
      { hostMoods: ['laugh'], hostRuntime: 120 },
      { guestMoods: [], guestRuntime: 100 },
    ])
  })

  it('includes a mood save queued before Start in the locked shortlist', async () => {
    const room = setup()
    await room.run()
    const [saved, started] = await Promise.all([room.mood('guest', ['laugh'], 100), room.start()])
    expect(saved.success).toBe(true)
    expect(started).toEqual({ success: true, data: { roundId } })
    expect(room.saved()).toMatchObject({
      status: 'voting', brief: 'Make me laugh, under 100 minutes',
      inputs: { moods: ['laugh'], maxRuntime: 100 },
    })
    const shortlist = room.saved()?.shortlist as { runtimeMinutes: number }[]
    expect(shortlist.length).toBeGreaterThan(0)
    expect(shortlist.every(film => film.runtimeMinutes < 100)).toBe(true)
  })

  it('rejects a save queued after Start and preserves the first brief on a repeat Start', async () => {
    const room = setup()
    await room.run()
    const [started, saved, repeated] = await Promise.all([
      room.start('  Movie night  '), room.mood('guest', ['guessing'], 100), room.start('Overwrite'),
    ])
    expect(started).toEqual({ success: true, data: { roundId } })
    expect(saved).toEqual({ success: false, error: 'wrong_status' })
    expect(repeated).toEqual(started)
    expect(room.tools.update).toHaveBeenCalledTimes(1)
    expect(room.saved()).toMatchObject({ status: 'voting', brief: 'Movie night', guestMoods: [], guestRuntime: 0 })
  })
})

describe('private ballot submission', () => {
  async function startVoting(guestId?: string) {
    const room = setup(guestId)
    await room.run()
    await room.start()
    const shortlist = room.saved()?.shortlist as { id: string }[]
    const votes = (value: string) => Object.fromEntries(shortlist.map(({ id }) => [id, value]))
    return { room, shortlist, votes }
  }

  const submitted = { success: true, data: { submitted: true } }

  it('keeps the first of two competing ballots and sets the players’ flags independently', async () => {
    expect(isRoundMutation('submitBallot')).toBe(true)
    const { room, votes } = await startVoting()
    expect(await Promise.all([room.submit('host', votes('want')), room.submit('host', votes('pass'))]))
      .toEqual([submitted, submitted])
    expect(room.ballots.get(ballotId(roundId, 'host'))).toMatchObject({ votes: votes('want') })
    expect(room.saved()).toMatchObject({ submittedHost: true, submittedGuest: false })
    expect(await room.submit('guest', votes('maybe'))).toEqual(submitted)
    expect(room.saved()).toMatchObject({ submittedHost: true, submittedGuest: true })
    expect(room.ballots.size).toBe(2)
  })

  it('repairs a failed readiness update without replacing the stored ballot', async () => {
    const { room, votes } = await startVoting()
    room.failUpdate()
    expect(await room.submit('host', votes('want'))).toEqual({ success: false, error: 'round_update_failed' })
    const firstBallot = room.ballots.get(ballotId(roundId, 'host'))
    expect(firstBallot).toMatchObject({ votes: votes('want'), lockedAt: expect.any(Number) })
    expect(room.saved()?.submittedHost).toBe(false)
    expect(await room.submit('host', votes('seen'))).toEqual(submitted)
    expect(room.ballots.get(ballotId(roundId, 'host'))).toBe(firstBallot)
    expect(room.saved()?.submittedHost).toBe(true)
  })

  it('stores deterministic demo votes and returns readiness only', async () => {
    const { room, shortlist, votes } = await startVoting('bot')
    expect(await room.submit('host', votes('want'))).toEqual(submitted)
    expect(room.ballots.get(ballotId(roundId, 'bot'))).toMatchObject({ votes: botVotes(shortlist) })
    expect(botVotes([...shortlist].reverse())).toEqual(botVotes(shortlist))
    expect(room.saved()).toMatchObject({ submittedHost: true, submittedGuest: true })
    expect(Object.values(ballotsSchema.permissions).every(role => role.read === false)).toBe(true)
  })

  it('rejects outsiders and incomplete ballots before any write', async () => {
    const { room, votes } = await startVoting()
    expect(await room.submit('outsider', votes('want'))).toEqual({ success: false, error: 'not_member' })
    expect(await room.submit('host', {})).toEqual({ success: false, error: 'ballot_invalid' })
    expect(room.ballots.size).toBe(0)
  })
})

describe('round reveal', () => {
  async function setupVoting() {
    const room = setup()
    await room.run()
    await room.start()
    const shortlist = room.saved()?.shortlist as { id: string }[]
    const votes = Object.fromEntries(shortlist.map(({ id }) => [id, 'want']))
    return { room, votes }
  }

  it('requires both ballots and rejects an outsider before publishing', async () => {
    const { room, votes } = await setupVoting()
    await room.submit('host', votes)
    expect(await room.finalize()).toEqual({ success: false, error: 'ballots_pending' })
    expect(await room.finalize('outsider')).toEqual({ success: false, error: 'not_member' })
    expect(room.results.size).toBe(0)
    expect(room.saved()?.status).toBe('voting')
  })

  it('writes one member-scoped result on simultaneous submissions and never rewrites it', async () => {
    const { room, votes } = await setupVoting()
    expect(isRoundMutation('finalizeRound')).toBe(true)
    const submitted = { success: true, data: { submitted: true } }
    expect(await Promise.all([room.submit('host', votes), room.submit('guest', votes)]))
      .toEqual([submitted, submitted])
    const id = `result_${roundId}`
    const savedResult = room.results.get(id)
    expect(savedResult).toMatchObject({
      roundId, outcome: 'match', score: 3, memberIds: ['host', 'guest'],
      ballots: { hostVotes: votes, guestVotes: votes },
    })
    expect(room.saved()?.status).toBe('revealed')
    expect(await room.submit('guest', votes)).toEqual(submitted)
    expect(await room.finalize('guest')).toEqual({ success: true, data: { revealed: true } })
    expect(room.results.size).toBe(1)
    expect(room.results.get(id)).toBe(savedResult)
  })

  it('finishes an interrupted reveal without rewriting the stored result', async () => {
    const { room, votes } = await setupVoting()
    await room.submit('host', votes)
    room.failReveal()
    expect(await room.submit('guest', votes)).toEqual({ success: false, error: 'round_update_failed' })
    const stored = room.results.get(`result_${roundId}`)
    expect(stored).toBeDefined()
    expect(room.saved()?.status).toBe('voting')
    expect(await room.finalize()).toEqual({ success: true, data: { revealed: true } })
    expect(room.results.get(`result_${roundId}`)).toBe(stored)
    expect(room.saved()?.status).toBe('revealed')
  })
})
