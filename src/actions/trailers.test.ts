import { describe, expect, it, vi } from 'vitest'
import { RECORD_NOT_FOUND } from 'deepspace/worker'
import type { ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { seedFilms } from '../lib/films'
import { pickTrailer, trailerQuery } from '../lib/trailer'
import { TrailerLookupQueue } from '../server/trailer-queue'
import { getTrailer } from './trailers'

const film = seedFilms[1]
const trailer = { videoId: 'OPCug9jyG9k', title: 'Chungking Express 4K | Official Trailer (English)' }
const video = { id: { videoId: trailer.videoId }, snippet: { title: trailer.title } }

function fixture() {
  let cached: Record<string, unknown> | undefined
  const get = vi.fn(async (collection: string) => {
    const data = collection === 'rounds'
      ? { memberIds: ['host', 'guest'], status: 'revealed', shortlist: seedFilms }
      : collection === 'results' ? { filmId: film.id } : cached
    return data
      ? { success: true, data: { record: { data } } }
      : { success: false, error: RECORD_NOT_FOUND }
  })
  const create = vi.fn(async (_collection: string, data: Record<string, unknown>) => {
    cached = data
    return { success: true }
  })
  const integration = vi.fn<() => Promise<unknown>>().mockResolvedValue({ success: true, data: { videos: [video] } })
  const tools = { get, create, integration } as unknown as ActionTools
  const queue = new TrailerLookupQueue()
  const lookup = (userId: string, filmId = film.id) => queue.run(filmId, () => getTrailer({
    userId, params: { roundId: 'round-one', filmId }, tools, env: {} as Env, callerJwt: '',
  }))
  return { lookup, integration, create }
}

describe('trailer lookup', () => {
  it('uses the stored film and searches only once for simultaneous clicks', async () => {
    const { lookup, integration, create } = fixture()
    const result = { success: true, data: { trailer } }
    expect(await Promise.all([lookup('host'), lookup('guest')])).toEqual([result, result])
    expect(integration).toHaveBeenCalledExactlyOnceWith('youtube/search-videos', {
      q: 'Chungking Express 1994 official trailer', maxResults: 5,
    })
    expect(create).toHaveBeenCalledExactlyOnceWith('trailers', trailer, film.id)
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
      { ...video, snippet: { title: 'Chungking Express (2025) official trailer' } },
      { ...video, snippet: { title: 'Unrelated official trailer' } },
      { ...video, snippet: { title: 'Chungking Express 2 Official Trailer' } },
      { ...video, id: { videoId: 'https://other.example' } },
      { ...video, snippet: { title: 'Chungking Express fan-made trailer' } },
    ], film)).toBeNull()
    expect(trailerQuery({ title: 'Undated film', year: null })).toBe('Undated film official trailer')
  })
})
