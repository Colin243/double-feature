import { describe, expect, it, vi } from 'vitest'
import { RECORD_NOT_FOUND } from 'deepspace/worker'
import type { ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { seedFilms } from '../lib/films'
import type { Film } from '../lib/films'
import { isYouTubeVideoId, pickTrailer, trailerLimits, trailerQuery, utcDay } from '../lib/trailer'
import { pinnedTrailers } from '../lib/trailer-pins'
import { TrailerLookupQueue } from '../server/trailer-queue'
import { getTrailer } from './trailers'

// A film that is not one of the six pinned ones, as a film found by discovery would be.
const film: Film = {
  id: 'some-new-film-2020', title: 'Some New Film', year: 2020, runtimeMinutes: 100, moods: ['romantic'], hook: 'A film.',
}
const trailer = { videoId: 'OPCug9jyG9k', title: 'Some New Film | Official Trailer (English)' }
const video = { id: { videoId: trailer.videoId }, snippet: { title: trailer.title } }
const today = utcDay(Date.now())

function fixture(existing: Record<string, unknown>[] = []) {
  const rows = [...existing]
  let cached: Record<string, unknown> | undefined
  const get = vi.fn(async (collection: string) => {
    const data = collection === 'rounds'
      ? { memberIds: ['host', 'guest'], status: 'revealed', shortlist: [...seedFilms, film] }
      : collection === 'results' ? { filmId: pick.id } : cached
    return data
      ? { success: true, data: { record: { data } } }
      : { success: false, error: RECORD_NOT_FOUND }
  })
  const create = vi.fn(async (_collection: string, data: Record<string, unknown>) => {
    cached = data
    rows.push(data)
    return { success: true }
  })
  const query = vi.fn(async (_collection: string, options: { where?: { day?: string } } = {}) => ({
    success: true,
    data: { records: rows.filter(row => row.day === options.where?.day).map(data => ({ data })) },
  }))
  const integration = vi.fn<() => Promise<unknown>>().mockResolvedValue({ success: true, data: { videos: [video] } })
  const tools = { get, create, query, integration } as unknown as ActionTools
  const queue = new TrailerLookupQueue()
  const pick = { id: film.id }
  const lookup = (userId: string, filmId = pick.id) => queue.run(filmId, () => getTrailer({
    userId, params: { roundId: 'round-one', filmId }, tools, env: {} as Env, callerJwt: '',
  }))
  return {
    lookup, integration, create, query, rows,
    cache: (data: Record<string, unknown>) => { cached = data },
    pickFilm: (id: string) => { pick.id = id },
  }
}

describe('trailer lookup', () => {
  it('uses the stored film and searches only once for simultaneous clicks', async () => {
    const { lookup, integration, create } = fixture()
    const result = { success: true, data: { trailer } }
    expect(await Promise.all([lookup('host'), lookup('guest')])).toEqual([result, result])
    expect(integration).toHaveBeenCalledExactlyOnceWith('youtube/search-videos', {
      q: 'Some New Film 2020 official trailer', maxResults: 5,
    })
    expect(create).toHaveBeenCalledExactlyOnceWith('trailers', { ...trailer, userId: 'host', day: today, createdMs: expect.any(Number) }, film.id)
  })

  it('does not block a different film while a lookup is pending', async () => {
    const queue = new TrailerLookupQueue()
    let release = () => {}
    const held = new Promise<string>(resolve => { release = () => resolve('first') })
    const first = queue.run('first', () => held)
    const duplicate = vi.fn(async () => 'cached')
    const second = queue.run('first', duplicate)
    try {
      expect(await queue.run('another', async () => 'ready')).toBe('ready')
      expect(duplicate).not.toHaveBeenCalled()
    } finally {
      release()
    }
    expect(await first).toBe('first')
    expect(await second).toBe('cached')
  })

  it('checks authorization and the revealed pick before spending anything', async () => {
    const { lookup, integration } = fixture()
    expect(await lookup('outsider')).toMatchObject({ error: 'not_member' })
    expect(await lookup('host', seedFilms[0].id)).toMatchObject({ error: 'invalid_input' })
    expect(integration).not.toHaveBeenCalled()
  })

  it('retries provider failures and caches a confirmed miss', async () => {
    const { lookup, integration, create } = fixture()
    integration.mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce({ success: true, data: { videos: [] } })
    expect(await lookup('host')).toMatchObject({ error: 'trailer_unavailable' })
    expect(create).not.toHaveBeenCalled()
    const miss = { success: true, data: { trailer: null } }
    expect(await lookup('host')).toEqual(miss)
    expect(await lookup('guest')).toEqual(miss)
    expect(integration).toHaveBeenCalledTimes(2)
  })

  it('rejects a different release, unrelated trailers, and invalid video IDs', () => {
    expect(pickTrailer([
      { ...video, snippet: { title: 'Some New Film (2025) official trailer' } },
      { ...video, snippet: { title: 'Unrelated official trailer' } },
      { ...video, snippet: { title: 'Some New Film 2 Official Trailer' } },
      { ...video, id: { videoId: 'https://other.example' } },
      { ...video, snippet: { title: 'Some New Film fan-made trailer' } },
    ], film)).toBeNull()
    expect(trailerQuery({ title: 'Undated film', year: null })).toBe('Undated film official trailer')
  })
})

describe('pinned trailers', () => {
  it('has a hand-picked trailer for every film we ship, with a valid video id', () => {
    const ids = seedFilms.map(entry => pinnedTrailers[entry.id]?.videoId)
    for (const [index, id] of ids.entries()) expect(isYouTubeVideoId(id), seedFilms[index].id).toBe(true)
    expect(new Set(ids).size).toBe(seedFilms.length)
    for (const entry of seedFilms) expect(pinnedTrailers[entry.id].title.length).toBeGreaterThan(10)
    // Nothing pinned for a film we do not ship.
    expect(Object.keys(pinnedTrailers).every(id => seedFilms.some(entry => entry.id === id))).toBe(true)
  })

  it('serves a shipped film from its pin, free: no search, no cache, no count against the limits', async () => {
    const { lookup, integration, create, query, pickFilm } = fixture()
    const wedding = seedFilms.find(entry => entry.id === 'the-wedding-banquet-1993')!
    pickFilm(wedding.id)
    expect(await lookup('host', wedding.id)).toEqual({ success: true, data: { trailer: pinnedTrailers[wedding.id] } })
    expect(integration).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(query).not.toHaveBeenCalled()
  })

  it('still checks authorization and the revealed pick before serving a pin', async () => {
    const { lookup, pickFilm } = fixture()
    pickFilm('lust-caution-2007')
    expect(await lookup('outsider', 'lust-caution-2007')).toMatchObject({ error: 'not_member' })
    // A pinned film that was not the pick is refused, so the action cannot be used as a trailer lookup.
    expect(await lookup('host', 'chungking-express-1994')).toMatchObject({ error: 'invalid_input' })
  })
})

describe('daily limits on fresh searches', () => {
  const rowsFor = (userId: string, count: number, day = today) =>
    Array.from({ length: count }, (_, index) => ({ videoId: 'OPCug9jyG9k', title: `t${index}`, userId, day, createdMs: 1 }))

  it('stops a person after their daily limit, spending nothing, but not another person', async () => {
    const { lookup, integration } = fixture(rowsFor('host', trailerLimits.perUser))
    expect(await lookup('host')).toEqual({ success: false, error: 'rate_limited' })
    expect(integration).not.toHaveBeenCalled()
    expect(await lookup('guest')).toMatchObject({ success: true })
    expect(integration).toHaveBeenCalledTimes(1)
  })

  it('stops everyone after the app-wide limit', async () => {
    const { lookup, integration } = fixture(rowsFor('someone-else', trailerLimits.global))
    expect(await lookup('host')).toEqual({ success: false, error: 'rate_limited' })
    expect(integration).not.toHaveBeenCalled()
  })

  it('does not count yesterday, and never limits a cached answer or a pin', async () => {
    const yesterday = fixture(rowsFor('host', trailerLimits.perUser, '2020-01-01'))
    expect(await yesterday.lookup('host')).toMatchObject({ success: true })

    const cachedOnes = fixture(rowsFor('host', trailerLimits.perUser))
    cachedOnes.cache({ videoId: 'OPCug9jyG9k', title: 'cached' })
    expect(await cachedOnes.lookup('host')).toEqual({ success: true, data: { trailer: { videoId: 'OPCug9jyG9k', title: 'cached' } } })
    expect(cachedOnes.integration).not.toHaveBeenCalled()

    const pinned = fixture(rowsFor('host', trailerLimits.perUser))
    pinned.pickFilm('happy-together-1997')
    expect(await pinned.lookup('host', 'happy-together-1997')).toMatchObject({ success: true })
  })

  it('counts a confirmed miss as a search, because it was paid for', async () => {
    const { lookup, integration, rows } = fixture()
    integration.mockResolvedValueOnce({ success: true, data: { videos: [] } })
    expect(await lookup('host')).toEqual({ success: true, data: { trailer: null } })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ userId: 'host', day: today })
  })
})

// Real results from YouTube for "The Wedding Banquet 1993 official trailer" (23 Nov 2026).
const weddingResults = [
  ['FZf75jjmDO0', '1993 The Wedding Banquet Official Trailer 1  Samuel Goldwyn Films'],
  ['kWy_IzW04YM', 'The Wedding Banquet | Official Trailer | Bleecker Street'],
  ['6SVnXwUXYW4', 'The Wedding Banquet – Official Trailer'],
  ['3YvK-2Osu7E', '《囍宴》The Wedding Banquet ｜藍光發行 Blu-ray｜全新數位修復預告 Trailer｜中影'],
  ['l61gmu9olZY', 'The Wedding Banquet | Official Teaser | Bleecker Street'],
].map(([videoId, label]) => ({ id: { videoId }, snippet: { title: label } }))

describe('choosing a trailer from search results', () => {
  const wedding = { title: 'The Wedding Banquet', year: 1993 }

  it('accepts an upload whose title starts with the year, and prefers it to an undated remake trailer', () => {
    // This is the real bug: the 1993 trailer was rejected for starting with "1993", and the
    // 2025 remake's trailer (top hit for the remake's distributor) was chosen instead.
    expect(pickTrailer(weddingResults, wedding)).toMatchObject({ videoId: 'FZf75jjmDO0' })
  })

  it('rejects a year-first title for a different year', () => {
    expect(pickTrailer([{ id: { videoId: 'abcdefghijk' }, snippet: { title: '2025 The Wedding Banquet Official Trailer' } }], wedding)).toBeNull()
  })

  it('documents the limit: a remake trailer with no year can still be chosen when it is the only candidate', () => {
    // The caption under the player shows the video's title, so the mismatch is visible.
    expect(pickTrailer(weddingResults.slice(1, 2), wedding)).toMatchObject({ videoId: 'kWy_IzW04YM' })
  })
})
