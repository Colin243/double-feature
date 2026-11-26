import { describe, expect, it, vi } from 'vitest'
import type { ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { seedFilms } from '../lib/films'
import { dailyLimits, dayKey } from '../lib/discovery/caps'
import { actions } from './index'

type Data = Record<string, unknown>
const roomId = 'movie-night'
const roundId = 'round-1'

const proposal = (title: string, year: number, moods = ['romantic', 'wistful']) => ({
  title, year, moods, hook: `A quiet story about ${title} and the people in it.`, reason: 'Fits the bittersweet brief.',
})
const defaultProposals = [
  proposal('Us and Them', 2018), proposal('Happy Together', 1997), proposal('Lovesick', 2014), proposal('Man in Love', 2014),
]
// Happy Together is also a seed film, so the seed version should win when both exist.
const wikipedia = new Map<string, number>([['Us and Them', 2018], ['Happy Together', 1997], ['Lovesick', 2014], ['Man in Love', 2014]])

type Setup = {
  guestId?: string
  roundStatus?: string
  proposals?: unknown[]
  exaFails?: boolean
  rows?: { collection: string; id: string; data: Data }[]
}

/** In-memory records plus a scripted Exa, model and Wikipedia. */
function world(setup: Setup = {}) {
  const store: Record<string, Map<string, Data>> = {
    rooms: new Map(), rounds: new Map(), discoveries: new Map(), ratings: new Map(), results: new Map(), roundRankingInputs: new Map(),
  }
  const guestId = setup.guestId ?? 'guest'
  store.rooms.set(roomId, { hostId: 'host', guestId, status: 'ready', memberIds: guestId === 'bot' ? ['host'] : ['host', guestId] })
  store.rounds.set(roundId, {
    roomId, number: 1, status: setup.roundStatus ?? 'setup', memberIds: ['host', 'guest'],
    hostMoods: ['heartbreak'], guestMoods: [], hostRuntime: 120, guestRuntime: 0, shortlist: [],
  })
  for (const row of setup.rows ?? []) (store[row.collection] ??= new Map()).set(row.id, row.data)
  let counter = 0
  const calls: { endpoint: string; body: Record<string, unknown> }[] = []
  const record = (recordId: string, data: Data) => ({ recordId, data: structuredClone(data), createdBy: 'host', createdAt: '', updatedAt: '' })

  const integration = vi.fn(async (endpoint: string, body: Record<string, unknown>) => {
    calls.push({ endpoint, body })
    if (endpoint === 'exa/search') {
      return setup.exaFails
        ? { success: false, error: 'exa down' }
        : { success: true, data: { results: [{ title: 'Best romance films', highlights: ['Us and Them (2018), Happy Together (1997), Lovesick (2014), Man in Love (2014), Invented One, Invented Two and Invented Three are all bittersweet stories.'] }], costUsd: 0.007 } }
    }
    if (endpoint === 'anthropic/chat-completion') {
      return { success: true, data: { content: [{ type: 'text', text: JSON.stringify({ films: setup.proposals ?? defaultProposals }) }], costUsd: 0.000004 } }
    }
    const title = String(body.query).replace(/ \d{4} film$/, '')
    const year = wikipedia.get(title)
    return { success: true, data: year ? [{ title, key: title.replace(/ /g, '_'), description: `${year} film by someone` }] : [] }
  })

  const tools = {
    get: async (collection: string, id: string) => {
      const found = store[collection]?.get(id)
      return found ? { success: true, data: { record: record(id, found) } } : { success: false, error: 'Record not found' }
    },
    query: async (collection: string, options: { where?: Data; limit?: number } = {}) => {
      let rows = [...(store[collection] ?? new Map()).entries()].filter(([, data]) =>
        Object.entries(options.where ?? {}).every(([key, value]) => data[key] === value))
      if (options.limit) rows = rows.slice(0, options.limit)
      return { success: true, data: { records: rows.map(([id, data]) => record(id, data)), count: rows.length } }
    },
    create: async (collection: string, data: Data, id?: string) => {
      if (collection === 'discoveries' && [...store.discoveries.values()].some(entry => entry.roundId === data.roundId)) {
        return { success: false, error: 'Duplicate: a record with roundId already exists in discoveries' }
      }
      const recordId = id ?? `${collection}-${++counter}`
      store[collection].set(recordId, structuredClone(data))
      return { success: true, data: { recordId } }
    },
    update: async (collection: string, id: string, patch: Data) => {
      const current = store[collection].get(id)
      if (!current) return { success: false, error: 'Record not found' }
      store[collection].set(id, { ...current, ...structuredClone(patch) })
      return { success: true, data: { recordId: id } }
    },
    integration,
  } as unknown as ActionTools

  const run = (name: string, userId: string, params: Data) =>
    actions[name]({ userId, params, tools, env: {} as Env, callerJwt: 'test' })
  return {
    store, calls, integration,
    discover: (userId = 'host', params: Data = { roundId }) => run('discoverFilms', userId, params),
    start: () => run('startRound', 'host', { roomId }),
    discovery: () => store.discoveries.get([...store.discoveries.keys()][0]) as Data,
    shortlist: () => (store.rounds.get(roundId)!.shortlist as { id: string; source?: string; runtimeMinutes: number | null }[]),
    inputs: () => store.rounds.get(roundId)!.inputs as Data,
  }
}

const ready = { status: 'ready', cached: false }

describe('discoverFilms', () => {
  it('finds, verifies and stores films, then startRound builds the shortlist from them', async () => {
    const w = world()
    const result = await w.discover()
    expect(result).toEqual({ success: true, data: { ...ready, count: 4 } })
    expect(w.discovery()).toMatchObject({ status: 'ready', attempts: 1, userId: 'host', day: dayKey(Date.now()) })
    expect((w.discovery().stats as { exaCalls: number; llmCalls: number; wikiCalls: number })).toMatchObject({ exaCalls: 1, llmCalls: 1, wikiCalls: 4 })
    expect(w.calls.map(call => call.endpoint).sort()).toEqual(
      ['anthropic/chat-completion', 'exa/search', 'wikipedia/search-pages', 'wikipedia/search-pages', 'wikipedia/search-pages', 'wikipedia/search-pages'])

    expect((await w.start()).success).toBe(true)
    const shortlist = w.shortlist()
    // Discovered films come first; a film we already have keeps our version, which carries its runtime.
    expect(shortlist.map(film => film.id).sort()).toEqual(['happy-together-1997', 'lovesick-2014', 'man-in-love-2014', 'us-and-them-2018'])
    expect(shortlist.find(film => film.id === 'happy-together-1997')).toMatchObject({ runtimeMinutes: 96 })
    expect(shortlist.find(film => film.id === 'us-and-them-2018')).toMatchObject({ runtimeMinutes: null, source: 'discovered' })
    expect(w.inputs()).toMatchObject({ discovery: { used: true, count: 4, cached: false } })
  })

  it('falls back to the seed shortlist, without failing the round, when the search breaks', async () => {
    const w = world({ exaFails: true })
    expect(await w.discover()).toEqual({ success: true, data: { status: 'fallback', reason: 'search_failed' } })
    expect(w.discovery()).toMatchObject({ status: 'failed', failure: 'search_failed', attempts: 1 })
    expect((await w.start()).success).toBe(true)
    expect(w.shortlist().every(film => film.source === undefined)).toBe(true)
    expect(w.shortlist().length).toBeGreaterThanOrEqual(3)
    expect(w.inputs()).toMatchObject({ discovery: { used: false } })
  })

  it('keeps a single verified film and fills the rest of the shortlist from our own list', async () => {
    const w = world({ proposals: [proposal('Us and Them', 2018), proposal('Invented One', 2001), proposal('Invented Two', 2002)] })
    expect(await w.discover()).toEqual({ success: true, data: { ...ready, count: 1 } })
    expect((await w.start()).success).toBe(true)
    const shortlist = w.shortlist()
    // The film the search found comes first and is not pushed out by our own six.
    expect(shortlist[0]).toMatchObject({ id: 'us-and-them-2018', source: 'discovered' })
    // The round's limit is "under 2 hours", so our two longest films are left out.
    expect(shortlist).toHaveLength(1 + seedFilms.filter(film => (film.runtimeMinutes ?? 0) < 120).length)
    expect(shortlist.slice(1).every(film => film.source === undefined)).toBe(true)
    expect(w.inputs()).toMatchObject({ discovery: { used: true, count: 1 } })
  })

  it('falls back entirely when nothing the model proposed checks out', async () => {
    const w = world({ proposals: [proposal('Invented One', 2001), proposal('Invented Two', 2002), proposal('Invented Three', 2003)] })
    expect(await w.discover()).toEqual({ success: true, data: { status: 'fallback', reason: 'too_few_verified' } })
    expect((await w.start()).success).toBe(true)
    expect(w.inputs()).toMatchObject({ discovery: { used: false } })
  })

  it('reuses a recent search for the same brief, for free', async () => {
    const w = world()
    await w.discover()
    // A second round in another room with the same brief and moods.
    w.store.rounds.set('round-2', { ...w.store.rounds.get(roundId)!, roomId: 'other-room' })
    w.store.rooms.set('other-room', { hostId: 'host', guestId: 'guest', status: 'ready', memberIds: ['host', 'guest'] })
    const before = w.integration.mock.calls.length
    const again = await w.discover('host', { roundId: 'round-2' })
    expect(again).toEqual({ success: true, data: { status: 'ready', cached: true, count: 4 } })
    expect(w.integration.mock.calls.length).toBe(before)
    const copy = w.store.discoveries.get([...w.store.discoveries.keys()][1])!
    expect(copy).toMatchObject({ roundId: 'round-2', fromCache: true, attempts: 0 })
  })

  it('does not reuse an old search, or one for a different brief', async () => {
    const old = world({ rows: [{ collection: 'discoveries', id: 'd-old', data: {
      roundId: 'older-round', userId: 'host', day: '2020-01-01', createdMs: Date.now() - 25 * 3600_000, cacheKey: 'x', status: 'ready', attempts: 1,
      films: defaultProposals.map(film => ({ ...film, id: film.title })),
    } }] })
    await old.discover()
    expect(old.integration).toHaveBeenCalled()
    const different = world()
    await different.discover('host', { roundId, brief: 'A completely different evening' })
    expect(different.integration).toHaveBeenCalled()
  })

  it('returns a finished result again without searching, and does not search twice at once', async () => {
    const w = world()
    await w.discover()
    const calls = w.integration.mock.calls.length
    expect(await w.discover()).toEqual({ success: true, data: { status: 'ready', cached: true, count: 4 } })
    expect(w.integration.mock.calls.length).toBe(calls)

    const racing = world()
    const results = await Promise.all([racing.discover(), racing.discover()])
    expect(results.map(result => (result as { data: { status: string } }).data.status).sort()).toEqual(['busy', 'ready'])
    expect(racing.calls.filter(call => call.endpoint === 'exa/search')).toHaveLength(1)
  })

  it('treats a fresh running search as busy, and retries a dead one', async () => {
    const fresh = world({ rows: [{ collection: 'discoveries', id: 'd1', data: { roundId, status: 'running', createdMs: Date.now(), attempts: 1, day: dayKey(Date.now()), userId: 'host' } }] })
    expect(await fresh.discover()).toEqual({ success: true, data: { status: 'busy' } })
    expect(fresh.integration).not.toHaveBeenCalled()

    const dead = world({ rows: [{ collection: 'discoveries', id: 'd1', data: { roundId, status: 'running', createdMs: Date.now() - 5 * 60_000, attempts: 1, day: dayKey(Date.now()), userId: 'host' } }] })
    expect(await dead.discover()).toMatchObject({ success: true, data: { status: 'ready' } })
    expect(dead.discovery()).toMatchObject({ attempts: 2 })
  })

  it('only the host can search, only in setup, and only with valid input', async () => {
    const w = world()
    expect(await w.discover('guest')).toEqual({ success: false, error: 'not_host' })
    expect(await w.discover('outsider')).toEqual({ success: false, error: 'not_member' })
    expect(await w.discover('bot')).toEqual({ success: false, error: 'not_member' })
    expect(await w.discover('host', { roundId: 'missing' })).toEqual({ success: false, error: 'round_not_found' })
    expect(await w.discover('host', { roundId, extra: 1 })).toEqual({ success: false, error: 'invalid_input' })
    expect(await w.discover('host', { roundId, brief: 'x'.repeat(501) })).toEqual({ success: false, error: 'invalid_input' })
    expect(await w.discover('host', { roundId: '' })).toEqual({ success: false, error: 'invalid_input' })
    expect(w.integration).not.toHaveBeenCalled()
    expect(await world({ roundStatus: 'voting' }).discover()).toEqual({ success: false, error: 'wrong_status' })
  })

  it('stops a person after their daily limit, and everyone after the app-wide limit, spending nothing', async () => {
    const today = dayKey(Date.now())
    const attempts = (count: number, userId: string, prefix: string) => Array.from({ length: count }, (_, index) => ({
      collection: 'discoveries', id: `${prefix}${index}`,
      data: { roundId: `${prefix}${index}`, userId, day: today, createdMs: Date.now(), cacheKey: 'other', status: 'failed', attempts: 1 },
    }))
    const person = world({ rows: attempts(dailyLimits.perUser, 'host', 'mine') })
    expect(await person.discover()).toEqual({ success: false, error: 'rate_limited' })
    expect(person.integration).not.toHaveBeenCalled()

    const everyone = world({ rows: attempts(dailyLimits.global, 'someone-else', 'theirs') })
    expect(await everyone.discover()).toEqual({ success: false, error: 'rate_limited' })
    expect(everyone.integration).not.toHaveBeenCalled()

    // Yesterday's runs do not count, and a reused (free) result is never counted.
    const yesterday = world({ rows: attempts(dailyLimits.perUser, 'host', 'old').map(row => ({ ...row, data: { ...row.data, day: '2020-01-01' } })) })
    expect(await yesterday.discover()).toMatchObject({ success: true, data: { status: 'ready' } })
    const free = world({ rows: attempts(dailyLimits.perUser, 'host', 'free').map(row => ({ ...row, data: { ...row.data, fromCache: true } })) })
    expect(await free.discover()).toMatchObject({ success: true, data: { status: 'ready' } })
  })

  it('counts every paid retry of the same round against the limit', async () => {
    const w = world({ exaFails: true })
    for (let attempt = 1; attempt <= dailyLimits.perUser; attempt++) {
      expect(await w.discover()).toEqual({ success: true, data: { status: 'fallback', reason: 'search_failed' } })
      expect(w.discovery()).toMatchObject({ attempts: attempt })
    }
    expect(await w.discover()).toEqual({ success: false, error: 'rate_limited' })
    expect(w.calls.filter(call => call.endpoint === 'exa/search')).toHaveLength(dailyLimits.perUser)
  })

  it('tells the model what the players liked and which films to avoid, but never who they are', async () => {
    const [chungking, lust] = [seedFilms[1], seedFilms[5]]
    const w = world({ rows: [
      { collection: 'ratings', id: 'host_c', data: { userId: 'host', roomId: 'x', filmId: chungking.id, stars: 5, tags: ['great-chemistry'] } },
      { collection: 'ratings', id: 'guest_l', data: { userId: 'guest', roomId: 'y', filmId: lust.id, stars: 1, tags: ['too-slow'] } },
    ] })
    await w.discover()
    const prompt = String((w.calls.find(call => call.endpoint === 'anthropic/chat-completion')!.body.messages as { content: string }[])[0].content)
    expect(prompt).toContain(`They liked: ${chungking.title} (great-chemistry)`)
    expect(prompt).toContain(`They disliked: ${lust.title} (too-slow)`)
    expect(prompt).toContain(chungking.title)
    // Nothing that identifies a person or a room is sent anywhere.
    for (const call of w.calls) {
      const sent = JSON.stringify(call.body)
      for (const secret of ['host', 'guest', roomId, roundId, 'userId']) expect(sent).not.toContain(secret)
    }
  })

  it('leaves out films the players have rated, even when the model suggests them', async () => {
    const w = world({ rows: [
      { collection: 'ratings', id: 'host_u', data: { userId: 'host', roomId: 'x', filmId: 'us-and-them-2018', stars: 4, tags: [] } },
    ] })
    await w.discover()
    expect((w.discovery().films as { id: string }[]).map(film => film.id)).not.toContain('us-and-them-2018')
    await w.start()
    expect(w.shortlist().map(film => film.id)).not.toContain('us-and-them-2018')
  })

  it('tops up with our own films when fewer than three discovered films are still fresh at the start', async () => {
    const w = world()
    expect(await w.discover()).toMatchObject({ data: { status: 'ready', count: 4 } })
    // Between the search and the start, two of the found films get rated.
    w.store.ratings.set('host_u', { userId: 'host', roomId: 'x', filmId: 'us-and-them-2018', stars: 4, tags: [] })
    w.store.ratings.set('host_m', { userId: 'host', roomId: 'x', filmId: 'man-in-love-2014', stars: 4, tags: [] })
    await w.start()
    const ids = w.shortlist().map(film => film.id)
    expect(ids).toContain('lovesick-2014')
    expect(ids.length).toBeGreaterThanOrEqual(3)
    expect(ids.some(id => seedFilms.some(film => film.id === id))).toBe(true)
  })
})
