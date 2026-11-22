import { describe, expect, it } from 'vitest'
import type { ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { seedFilms } from '../lib/films'
import { resultId } from '../schemas/results'
import { actions } from './index'

const roomId = 'movie-night'
type Data = Record<string, unknown>

/** A small in-memory stand-in for the record tools: rounds, results and one room. */
function fakeRoom(guestId = 'guest') {
  const rounds = new Map<string, Data>()
  const results = new Map<string, Data>()
  let counter = 0
  const record = (recordId: string, data: Data) => ({
    recordId, data: structuredClone(data), createdBy: 'host', createdAt: '', updatedAt: '',
  })
  const store = (collection: string) => (collection === 'rounds' ? rounds : results)

  const tools = {
    get: async (collection: string, id: string) => {
      if (collection === 'rooms') {
        return {
          success: true,
          data: { record: record(roomId, {
            hostId: 'host', guestId, status: 'ready', memberIds: guestId === 'bot' ? ['host'] : ['host', guestId],
          }) },
        }
      }
      const found = store(collection).get(id)
      return found
        ? { success: true, data: { record: record(id, found) } }
        : { success: false, error: 'Record not found' }
    },
    query: async (collection: string, options: {
      where?: Data; orderBy?: string; orderDir?: 'asc' | 'desc'; limit?: number
    } = {}) => {
      let rows = [...store(collection).entries()].filter(([, data]) =>
        Object.entries(options.where ?? {}).every(([key, value]) => data[key] === value))
      if (options.orderBy) {
        const key = options.orderBy
        const sign = options.orderDir === 'desc' ? -1 : 1
        rows = rows.sort(([, a], [, b]) => sign * (Number(a[key]) - Number(b[key])))
      }
      if (options.limit) rows = rows.slice(0, options.limit)
      return { success: true, data: { records: rows.map(([id, data]) => record(id, data)), count: rows.length } }
    },
    create: async (collection: string, data: Data, id?: string) => {
      if (collection === 'rounds') {
        const duplicate = [...rounds.values()].some(round => round.roomId === data.roomId && round.number === data.number)
        if (duplicate) return { success: false, error: 'Duplicate: a record with roomId, number already exists in rounds' }
        const recordId = id ?? `round-${++counter}`
        rounds.set(recordId, structuredClone(data))
        return { success: true, data: { recordId } }
      }
      results.set(id ?? `result-${++counter}`, structuredClone(data))
      return { success: true, data: { recordId: id ?? '' } }
    },
    update: async (collection: string, id: string, patch: Data) => {
      const current = store(collection).get(id)
      if (!current) return { success: false, error: 'Record not found' }
      store(collection).set(id, { ...current, ...structuredClone(patch) })
      return { success: true, data: { recordId: id } }
    },
  } as unknown as ActionTools

  const run = (name: string, userId: string, params: Data) =>
    actions[name]({ userId, params, tools, env: {} as Env, callerJwt: 'test' })
  return { rounds, results, run, host: (name: string, params: Data = { roomId }) => run(name, 'host', params) }
}

/** Mark a round revealed and store the result a finished round would have. */
function reveal(room: ReturnType<typeof fakeRoom>, roundId: string, result: Data) {
  room.rounds.set(roundId, { ...room.rounds.get(roundId), status: 'revealed' })
  room.results.set(resultId(roundId), { roundId, ...result })
}

const roundId = (result: { success: boolean; data?: unknown }) => (result.data as { roundId: string }).roundId

describe('starting another round', () => {
  it('opens round 1, returns it again while it is open, and opens round 2 only after the reveal', async () => {
    const room = fakeRoom()
    const first = await room.host('openSetupRound')
    expect(first.success).toBe(true)
    expect(room.rounds.get(roundId(first))).toMatchObject({ number: 1, status: 'setup' })
    expect(await room.host('openSetupRound')).toEqual(first)

    await room.host('startRound')
    expect(await room.host('openSetupRound')).toEqual(first) // still voting

    reveal(room, roundId(first), { outcome: 'none', filmId: null, ballots: {} })
    const second = await room.host('openSetupRound')
    expect(second.success).toBe(true)
    expect(roundId(second)).not.toBe(roundId(first))
    expect(room.rounds.get(roundId(second))).toMatchObject({
      number: 2, status: 'setup', memberIds: ['host', 'guest'], shortlist: [],
    })
    expect(await room.host('openSetupRound')).toEqual(second)
    expect(room.rounds.size).toBe(2)
  })

  it('only the host can open the next round, and a racing pair of opens makes one round', async () => {
    const room = fakeRoom()
    const first = await room.host('openSetupRound')
    await room.host('startRound')
    reveal(room, roundId(first), { outcome: 'none', filmId: null, ballots: {} })

    expect(await room.run('openSetupRound', 'guest', { roomId })).toEqual({ success: false, error: 'not_host' })
    expect(await room.run('openSetupRound', 'outsider', { roomId })).toEqual({ success: false, error: 'not_host' })

    const [a, b] = await Promise.all([room.host('openSetupRound'), room.host('openSetupRound')])
    expect(a.success && b.success).toBe(true)
    expect(roundId(a)).toBe(roundId(b))
    expect(room.rounds.size).toBe(2)
  })

  it('starts the latest round, leaving the revealed one alone', async () => {
    const room = fakeRoom()
    const first = await room.host('openSetupRound')
    await room.host('startRound')
    reveal(room, roundId(first), { outcome: 'none', filmId: null, ballots: {} })
    const second = await room.host('openSetupRound')

    expect((await room.host('startRound')).success).toBe(true)
    expect(room.rounds.get(roundId(first))?.status).toBe('revealed')
    expect(room.rounds.get(roundId(second))?.status).toBe('voting')
  })

  it('skips the earlier pick and every film either player marked already seen', async () => {
    const room = fakeRoom()
    const first = await room.host('openSetupRound')
    await room.host('startRound')
    const [picked, seenByHost, seenByGuest] = seedFilms.map(film => film.id)
    reveal(room, roundId(first), {
      outcome: 'match', filmId: picked,
      ballots: { hostVotes: { [seenByHost]: 'seen' }, guestVotes: { [seenByGuest]: 'seen', [picked]: 'want' } },
    })
    const second = await room.host('openSetupRound')
    await room.host('startRound')

    const stored = room.rounds.get(roundId(second))!
    const shortlist = (stored.shortlist as { id: string }[]).map(film => film.id)
    for (const skipped of [picked, seenByHost, seenByGuest]) expect(shortlist).not.toContain(skipped)
    expect(shortlist.length).toBe(seedFilms.length - 3)
    expect((stored.inputs as { skippedFilmIds: string[] }).skippedFilmIds.sort())
      .toEqual([picked, seenByHost, seenByGuest].sort())
  })

  it('falls back to the whole seed list when nothing is left', async () => {
    const room = fakeRoom()
    const first = await room.host('openSetupRound')
    await room.host('startRound')
    reveal(room, roundId(first), {
      outcome: 'none', filmId: null,
      ballots: { hostVotes: Object.fromEntries(seedFilms.map(film => [film.id, 'seen'])), guestVotes: {} },
    })
    const second = await room.host('openSetupRound')
    await room.host('startRound')
    expect((room.rounds.get(roundId(second))!.shortlist as unknown[]).length).toBe(Math.min(6, seedFilms.length))
  })

  it('does not skip anything in round 1', async () => {
    const room = fakeRoom()
    const first = await room.host('openSetupRound')
    await room.host('startRound')
    expect((room.rounds.get(roundId(first))!.inputs as { skippedFilmIds: string[] }).skippedFilmIds).toEqual([])
  })
})
