import { describe, expect, it } from 'vitest'
import type { ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { seedFilms } from '../lib/films'
import { ratingId } from '../lib/rating'
import { resultId } from '../schemas/results'
import { actions } from './index'

const roomId = 'movie-night'
type Data = Record<string, unknown>

/** A small in-memory stand-in for the record tools: rounds, results and one room. */
function fakeRoom(guestId = 'guest') {
  const rounds = new Map<string, Data>()
  const results = new Map<string, Data>()
  const ratings = new Map<string, Data>()
  const snapshots = new Map<string, Data>()
  let counter = 0
  const record = (recordId: string, data: Data) => ({
    recordId, data: structuredClone(data), createdBy: 'host', createdAt: '', updatedAt: '',
  })
  const stores = { rounds, results, ratings, roundRankingInputs: snapshots }
  const store = (collection: string) => stores[collection as keyof typeof stores]

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
      store(collection).set(id ?? `result-${++counter}`, structuredClone(data))
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
  return { rounds, results, ratings, snapshots, run, host: (name: string, params: Data = { roomId }) => run(name, 'host', params) }
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

  it('still starts a round when every film has been seen, and says which are repeats', async () => {
    const room = fakeRoom()
    const first = await room.host('openSetupRound')
    await room.host('startRound')
    reveal(room, roundId(first), {
      outcome: 'none', filmId: null,
      ballots: { hostVotes: Object.fromEntries(seedFilms.map(film => [film.id, 'seen'])), guestVotes: {} },
    })
    const second = await room.host('openSetupRound')
    expect(await room.host('startRound')).toEqual(second)

    const stored = room.rounds.get(roundId(second))!
    expect(stored.status).toBe('voting')
    expect((stored.shortlist as unknown[]).length).toBe(Math.min(6, seedFilms.length))
    expect((stored.inputs as { repeatedFilmIds: string[] }).repeatedFilmIds.sort())
      .toEqual(seedFilms.map(film => film.id).sort())
  })

  it('never fails to start after a player has rated every film, in any room', async () => {
    // The failure this guards against: ratings follow a person across rooms, so a
    // player who had rated all the films could not start a round anywhere.
    const room = fakeRoom()
    for (const film of seedFilms) {
      room.ratings.set(ratingId('host', film.id), { filmId: film.id, userId: 'host', stars: 4, tags: [] })
    }
    const opened = await room.host('openSetupRound')
    expect(await room.host('startRound')).toEqual(opened)
    const stored = room.rounds.get(roundId(opened))!
    expect((stored.shortlist as unknown[]).length).toBeGreaterThanOrEqual(3)
    expect((stored.inputs as { repeatedFilmIds: string[] }).repeatedFilmIds.length).toBe(seedFilms.length)
  })

  it('brings back rated films before earlier picks and films marked seen', async () => {
    const room = fakeRoom()
    const first = await room.host('openSetupRound')
    await room.host('startRound')
    const [picked, seen, rated1, rated2, rated3, fresh] = seedFilms.map(film => film.id)
    reveal(room, roundId(first), {
      outcome: 'match', filmId: picked,
      ballots: { hostVotes: { [seen]: 'seen' }, guestVotes: {} },
    })
    for (const id of [rated1, rated2, rated3]) {
      room.ratings.set(ratingId('host', id), { filmId: id, userId: 'host', stars: 3, tags: [] })
    }
    const second = await room.host('openSetupRound')
    await room.host('startRound')

    // One fresh film is not enough, so the three rated films come back; the
    // earlier pick and the film marked seen stay out.
    const stored = room.rounds.get(roundId(second))!
    const ids = (stored.shortlist as { id: string }[]).map(film => film.id).sort()
    expect(ids).toEqual([fresh, rated1, rated2, rated3].sort())
    expect((stored.inputs as { repeatedFilmIds: string[] }).repeatedFilmIds.sort()).toEqual([rated1, rated2, rated3].sort())
  })

  it('has no repeats while enough fresh films remain', async () => {
    const room = fakeRoom()
    const opened = await room.host('openSetupRound')
    room.ratings.set(ratingId('host', seedFilms[0].id), { filmId: seedFilms[0].id, userId: 'host', stars: 5, tags: [] })
    await room.host('startRound')
    expect((room.rounds.get(roundId(opened))!.inputs as { repeatedFilmIds: string[] }).repeatedFilmIds).toEqual([])
  })

  it('excludes ratings from either member and locks the ranking snapshot when voting starts', async () => {
    const room = fakeRoom()
    const first = await room.host('openSetupRound')
    const rated = seedFilms[0].id
    const otherRated = seedFilms[1].id
    const outsiderRated = seedFilms[2].id
    room.ratings.set(ratingId('host', rated), { filmId: rated, userId: 'host', stars: 5, tags: [] })
    room.ratings.set(ratingId('guest', otherRated), { filmId: otherRated, userId: 'guest', stars: 1, tags: [] })
    room.ratings.set(ratingId('outsider', outsiderRated), { filmId: outsiderRated, userId: 'outsider', stars: 5 })
    expect(await room.host('startRound')).toEqual(first)
    const id = roundId(first)
    const initial = structuredClone(room.snapshots.get(id))
    expect(initial).toMatchObject({ snapshot: { excludedFilmIds: [rated, otherRated], ratings: [{ stars: 5 }, { stars: 1 }] } })
    const round = room.rounds.get(id)!
    expect(round.inputs).not.toHaveProperty('ratings')
    const ids = (round.shortlist as { id: string }[]).map(film => film.id)
    expect(ids).not.toContain(rated)
    expect(ids).not.toContain(otherRated)
    expect(ids).toContain(outsiderRated)

    room.ratings.set(ratingId('host', rated), { filmId: rated, userId: 'host', stars: 1, tags: [] })
    expect(await room.host('startRound')).toEqual(first)
    expect(room.snapshots.get(id)).toEqual(initial)
  })

  it('seeds room-scoped demo ratings idempotently and only for a demo host', async () => {
    const room = fakeRoom('bot')
    expect(await room.run('seedDemoHistory', 'guest', { roomId })).toMatchObject({ error: 'not_host' })
    expect(await fakeRoom().host('seedDemoHistory')).toMatchObject({ error: 'not_demo_room' })
    expect(await room.host('seedDemoHistory')).toMatchObject({ success: true })
    expect(await room.host('seedDemoHistory')).toMatchObject({ success: true })
    expect(room.ratings.size).toBe(2)
    for (const rating of room.ratings.values()) expect(rating).toMatchObject({ userId: 'bot', roomId })

    const foreign = seedFilms[0].id
    room.ratings.set('other-demo-rating', { userId: 'bot', roomId: 'elsewhere', filmId: foreign, stars: 5 })
    const opened = await room.host('openSetupRound')
    expect(await room.host('startRound')).toEqual(opened)
    const ids = (room.rounds.get(roundId(opened))?.shortlist as { id: string }[]).map(film => film.id)
    expect(ids).toContain(foreign)
    for (const rating of room.ratings.values()) {
      if (rating.roomId === roomId) expect(ids).not.toContain(rating.filmId)
    }
  })

  it('does not skip anything in round 1', async () => {
    const room = fakeRoom()
    const first = await room.host('openSetupRound')
    await room.host('startRound')
    expect((room.rounds.get(roundId(first))!.inputs as { skippedFilmIds: string[] }).skippedFilmIds).toEqual([])
  })
})
