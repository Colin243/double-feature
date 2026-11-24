import { describe, expect, it, vi } from 'vitest'
import type { ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { saveRating } from './ratings'

function fixture() {
  const stored = new Map<string, Record<string, unknown>>()
  const get = vi.fn(async (collection: string, id: string) => {
    const data = collection === 'rooms'
      ? { hostId: 'host', guestId: 'guest' }
      : collection === 'rounds'
        ? { roomId: id === 'our-round' ? 'room' : 'other-room', status: 'revealed' }
        : { filmId: 'film' }
    return { success: true, data: { record: { data } } }
  })
  const query = vi.fn(async () => ({ success: true, data: { records: [{ recordId: 'our-round' }] } }))
  const create = vi.fn(async (_collection: string, data: Record<string, unknown>, id: string) => {
    stored.set(id, data)
    return { success: true, data: { recordId: id } }
  })
  const tools = { get, query, create } as unknown as ActionTools
  function save(userId: string, changes: Record<string, unknown> = {}) {
    return saveRating({
      userId, params: { roomId: 'room', roundId: 'our-round', filmId: 'film', stars: 4, ...changes },
      tools, env: {} as Env, callerJwt: '',
    })
  }
  return { save, stored, create, query }
}

describe('saveRating', () => {
  it('edits the same record and keeps each member’s rating separate', async () => {
    const { save, stored, query } = fixture()
    expect(await save('host')).toEqual({ success: true, data: { saved: true } })
    expect(await save('host', { stars: 5, tags: ['great-chemistry'] })).toMatchObject({ success: true })
    expect(await save('guest', { stars: 2 })).toMatchObject({ success: true })
    expect([...stored.keys()]).toEqual(['host_film', 'guest_film'])
    expect(stored.get('host_film')).toEqual({
      userId: 'host', roomId: 'room', filmId: 'film', stars: 5, tags: ['great-chemistry'],
    })
    expect(query).not.toHaveBeenCalled()
  })

  it('accepts the action contract without a round ID', async () => {
    const { save } = fixture()
    expect(await save('host', { roundId: undefined })).toMatchObject({ success: true })
  })

  it('rejects non-members and films that were never picked in the room', async () => {
    const { save, create } = fixture()
    expect(await save('outsider')).toMatchObject({ error: 'not_member' })
    expect(await save('host', { roundId: 'other-round' })).toMatchObject({ error: 'invalid_input' })
    expect(await save('host', { filmId: 'another-film' })).toMatchObject({ error: 'invalid_input' })
    expect(create).not.toHaveBeenCalled()
  })

  it('rejects invalid stars and reaction tags', async () => {
    const { save, create } = fixture()
    expect(await save('host', { stars: 4.5 })).toMatchObject({ error: 'invalid_input' })
    expect(await save('host', { stars: 6 })).toMatchObject({ error: 'invalid_input' })
    expect(await save('host', { tags: ['unknown'] })).toMatchObject({ error: 'invalid_input' })
    expect(create).not.toHaveBeenCalled()
  })
})
