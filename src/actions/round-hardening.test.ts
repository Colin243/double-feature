import { describe, expect, it, vi } from 'vitest'
import type { ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import {
  hasValidRoundMutationSignature,
  signRoundMutation,
} from '../server/round-mutations'

// Every film is longer than the longest runtime limit a player can choose, so
// the shortlist has to fall back to all films.
vi.mock('../lib/films', async importOriginal => ({
  ...(await importOriginal<typeof import('../lib/films')>()),
  seedFilms: ['a', 'b', 'c'].map((id, index) => ({
    id, title: id.toUpperCase(), year: 2000 + index, runtimeMinutes: 150 + index,
    moods: ['funny'], hook: 'A long film.',
  })),
}))

describe('runtime limit that no film satisfies', () => {
  function setup(round: Record<string, unknown>) {
    const update = vi.fn(async () => ({ success: true, data: { recordId: 'r1' } }))
    const tools = {
      get: async () => ({
        success: true,
        data: { record: { recordId: 'room', data: { hostId: 'host', guestId: 'guest', status: 'ready', memberIds: ['host', 'guest'] } } },
      }),
      query: async () => ({
        success: true,
        data: { records: [{ recordId: 'r1', data: round }], count: 1 },
      }),
      create: async () => ({ success: true, data: { recordId: 'r1' } }),
      update,
    } as unknown as ActionTools
    return { update, tools }
  }

  it('records that the limit was ignored so the vote screen can say so', async () => {
    const { actions } = await import('./index')
    const { update, tools } = setup({
      status: 'setup', hostMoods: ['laugh'], guestMoods: [], hostRuntime: 100, guestRuntime: 0,
    })
    const result = await actions.startRound({
      userId: 'host', params: { roomId: 'room' }, tools, env: {} as Env, callerJwt: 'test',
    })
    expect(result.success).toBe(true)
    expect(update).toHaveBeenCalledWith('rounds', 'r1', expect.objectContaining({
      status: 'voting',
      inputs: expect.objectContaining({ maxRuntime: 100, runtimeLimitIgnored: true }),
    }))
    const patch = (update.mock.calls[0] as unknown[])[2] as { shortlist: unknown[] }
    expect(patch.shortlist).toHaveLength(3)
  })

  it('does not flag a round that set no runtime limit', async () => {
    const { actions } = await import('./index')
    const { update, tools } = setup({
      status: 'setup', hostMoods: [], guestMoods: [], hostRuntime: 0, guestRuntime: 0,
    })
    await actions.startRound({
      userId: 'host', params: { roomId: 'room' }, tools, env: {} as Env, callerJwt: 'test',
    })
    expect(update).toHaveBeenCalledWith('rounds', 'r1', expect.objectContaining({
      inputs: expect.objectContaining({ runtimeLimitIgnored: false }),
    }))
  })
})

describe('round mutation signatures', () => {
  const secret = 'app-secret'
  const body = JSON.stringify({ name: 'submitBallot', userId: 'host', params: { roundId: 'r1' } })

  it('accepts the signature the action router produces', async () => {
    const signature = await signRoundMutation(secret, body)
    expect(await hasValidRoundMutationSignature(secret, body, signature)).toBe(true)
  })

  it('rejects a missing, wrong, or reused signature', async () => {
    const signature = await signRoundMutation(secret, body)
    expect(await hasValidRoundMutationSignature(secret, body, '')).toBe(false)
    expect(await hasValidRoundMutationSignature(secret, body, 'deadbeef')).toBe(false)
    expect(await hasValidRoundMutationSignature('other-secret', body, signature)).toBe(false)
    // The same signature must not authorize a different acting user.
    const forged = JSON.stringify({ name: 'submitBallot', userId: 'guest', params: { roundId: 'r1' } })
    expect(await hasValidRoundMutationSignature(secret, forged, signature)).toBe(false)
  })

  it('fails closed when the app secret is empty', async () => {
    // The SDK refuses a zero-length HMAC key, so nothing can be signed with one,
    // and verification never accepts a signature against an empty secret.
    await expect(signRoundMutation('', body)).rejects.toThrow()
    expect(await hasValidRoundMutationSignature('', body, 'anything')).toBe(false)
  })
})
