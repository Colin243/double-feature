import { describe, expect, it, vi } from 'vitest'
import type { ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { roomSeatClaimsSchema } from '../schemas/room-seat-claims'
import { actions } from './index'
import { normalizeInviteCode } from '../lib/invite-code'

const roomId = 'movie-night'
const code = 'ABCDEFGH'
const hostId = 'host'

function setup() {
  let room = { hostId, guestId: '', status: 'waiting', memberIds: [hostId] }
  let claim: { roomId: string; guestId: string } | undefined
  const record = (data: Record<string, unknown>) => ({
    recordId: roomId, data: { ...data }, createdBy: hostId, createdAt: '', updatedAt: '',
  })
  const create = vi.fn(async (_collection: string, input: { roomId: string; guestId: string }) => {
    if (claim) return { success: false, error: 'Duplicate' }
    claim = input
    return { success: true, data: { recordId: 'generated-claim-id' } }
  })
  const update = vi.fn(async (_collection: string, _id: string, patch: Partial<typeof room>) => {
    room = { ...room, ...patch }
    return { success: true, data: { recordId: roomId } } as const
  })
  const tools = {
    create,
    update,
    get: async () => ({ success: true, data: { record: record(room) } }),
    query: async (collection: string) => {
      const rows = collection === 'rooms' ? [room] : claim ? [claim] : []
      return { success: true, data: { records: rows.map(record), count: rows.length } }
    },
  } as unknown as ActionTools
  const context = (userId: string, params: Record<string, unknown>) => ({
    userId, params, tools, env: {} as Env, callerJwt: 'test',
  })
  return {
    join: (userId: string) => actions.joinRoom(context(userId, { code })),
    demo: (userId = hostId) => actions.addDemoPartner(context(userId, { roomId })),
    current: () => room,
    create,
    update,
  }
}

describe('room seat claims', () => {
  it('allows only one guest when both read the empty seat', async () => {
    const room = setup()
    const results = await Promise.all([room.join('guest-a'), room.join('guest-b')])
    expect(results.filter(result => result.success)).toHaveLength(1)
    expect(results.find(result => !result.success)?.error).toBe('room_full')
    const winner = results[0].success ? 'guest-a' : 'guest-b'
    expect(room.current()).toMatchObject({ guestId: winner, status: 'ready', memberIds: [hostId, winner] })
    expect(room.create).toHaveBeenCalledTimes(2)
    expect(room.update).toHaveBeenCalledTimes(1)
  })

  it('uses the same seat for a real guest and the demo partner', async () => {
    const room = setup()
    const results = await Promise.all([room.demo(), room.join('guest-a')])
    expect(results.filter(result => result.success)).toHaveLength(1)
    expect(results.find(result => !result.success)?.error).toBe('room_full')
    const guest = results[0].success ? 'bot' : 'guest-a'
    expect(room.current()).toMatchObject({
      guestId: guest, status: 'ready', memberIds: guest === 'bot' ? [hostId] : [hostId, guest],
    })
    expect(room.update).toHaveBeenCalledTimes(1)
  })

  it('lets the winner repair an interrupted update and repeat a completed join', async () => {
    const room = setup()
    room.update.mockRejectedValueOnce(new Error('connection lost'))
    await expect(room.join('guest-a')).rejects.toThrow('connection lost')
    expect(room.current().status).toBe('waiting')
    expect(await room.join('guest-b')).toEqual({ success: false, error: 'room_full' })
    expect(await room.demo()).toEqual({ success: false, error: 'room_full' })
    expect(await room.join('guest-a')).toEqual({ success: true, data: { roomId } })
    expect(await room.join('guest-a')).toEqual({ success: true, data: { roomId } })
    expect(room.current().memberIds).toEqual([hostId, 'guest-a'])
    expect(room.update).toHaveBeenCalledTimes(2)
  })

  it('denies unauthorized claims and keeps the bot out of membership', async () => {
    const room = setup()
    expect(await room.join(hostId)).toEqual({ success: false, error: 'own_room' })
    expect(await room.demo('outsider')).toEqual({ success: false, error: 'not_host' })
    expect(room.create).not.toHaveBeenCalled()
    expect((await room.demo()).success).toBe(true)
    expect(room.current()).toMatchObject({ guestId: 'bot', status: 'ready', memberIds: [hostId] })
  })

  it('registers uniqueness by room and denies all client operations', () => {
    expect(roomSeatClaimsSchema.uniqueOn).toEqual(['roomId'])
    for (const role of ['*', 'viewer', 'member', 'admin']) {
      expect(roomSeatClaimsSchema.permissions[role]).toEqual({
        read: false, create: false, update: false, delete: false,
      })
    }
  })
})

describe('createRoom', () => {
  function setupCreation(failures: ('collision' | 'storage')[] = []) {
    const create = vi.fn(async (_collection: string, data: { inviteCode: string }) => {
      const failure = failures.shift()
      if (failure === 'collision') {
        return { success: false, error: `Duplicate: a record with inviteCode=${data.inviteCode} already exists in rooms` }
      }
      if (failure === 'storage') return { success: false, error: 'storage unavailable' }
      return { success: true, data: { recordId: roomId } }
    })
    return {
      create,
      run: (params: Record<string, unknown> = {}) => actions.createRoom({
        userId: hostId, params, tools: { create } as unknown as ActionTools,
        env: {} as Env, callerJwt: 'test',
      }),
    }
  }

  it('initializes a host-only waiting room and returns a joinable code', async () => {
    const { run, create } = setupCreation()
    const result = await run()
    expect(result.success).toBe(true)
    const inviteCode = create.mock.calls[0][1].inviteCode
    expect(normalizeInviteCode(inviteCode.toLowerCase())).toBe(inviteCode)
    expect(result).toEqual({ success: true, data: { roomId, inviteCode } })
    expect(create).toHaveBeenCalledWith('rooms', {
      hostId, guestId: '', status: 'waiting', memberIds: [hostId], inviteCode,
    })
  })

  it('retries a confirmed invite-code collision', async () => {
    const { run, create } = setupCreation(['collision'])
    expect((await run()).success).toBe(true)
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('still retries when only the tail of the SDK duplicate message changes', async () => {
    const create = vi.fn()
      .mockResolvedValueOnce({ success: false, error: 'Duplicate: a record with inviteCode=ZZZZZZZZ is taken' })
      .mockResolvedValueOnce({ success: true, data: { recordId: roomId } })
    const result = await actions.createRoom({
      userId: hostId, params: {}, tools: { create } as unknown as ActionTools,
      env: {} as Env, callerJwt: 'test',
    })
    expect(result.success).toBe(true)
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('does not treat a duplicate on a different field as an invite-code collision', async () => {
    const create = vi.fn().mockResolvedValue({ success: false, error: 'Duplicate: a record with hostId=host already exists in rooms' })
    const result = await actions.createRoom({
      userId: hostId, params: {}, tools: { create } as unknown as ActionTools,
      env: {} as Env, callerJwt: 'test',
    })
    expect(result).toEqual({ success: false, error: 'room_create_failed' })
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('stops after three collisions', async () => {
    const { run, create } = setupCreation(['collision', 'collision', 'collision'])
    expect(await run()).toEqual({ success: false, error: 'room_create_failed' })
    expect(create).toHaveBeenCalledTimes(3)
  })

  it('rejects supplied identity and does not retry unrelated storage failures', async () => {
    const { run, create } = setupCreation(['storage'])
    expect(await run({ hostId: 'other' })).toEqual({ success: false, error: 'invalid_input' })
    expect(create).not.toHaveBeenCalled()
    expect(await run()).toEqual({ success: false, error: 'room_create_failed' })
    expect(create).toHaveBeenCalledTimes(1)
  })
})
