import { expect, it, vi } from 'vitest'
import type { ActionTools } from 'deepspace/worker'
import type { Env } from '../../worker'
import { seedFilms } from '../lib/films'
import { RoundMutationQueue } from '../server/round-mutations'
import { chooseWildcard, getWildcard, nominateWildcard } from './wildcards'

function fixture(guestId = 'guest') {
  let latestRound = 'round'
  const queue = new RoundMutationQueue()
  let game: unknown
  const create = vi.fn(async (_collection: string, data: { game: unknown }) => {
    game = structuredClone(data.game)
    return { success: true }
  })
  const get = async (collection: string) => {
    const data = {
      rounds: { roomId: 'room', status: 'revealed', shortlist: seedFilms },
      rooms: { hostId: 'host', guestId, status: 'ready' },
      results: { outcome: 'none', ballots: { hostVotes: { [seedFilms[2].id]: 'seen' }, guestVotes: {} } },
      wildcards: game ? { game: structuredClone(game) } : undefined,
    }[collection]
    return data ? { success: true, data: { record: { data } } } : { success: false, error: 'Record not found' }
  }
  const tools = { get, create, query: async () => ({ success: true, data: { records: [{ recordId: latestRound }] } }) } as unknown as ActionTools
  const run = (action: typeof getWildcard, userId: string, params = {}) => queue.run(() => action({
    tools, userId, callerJwt: '', params: { roundId: 'round', ...params }, env: {} as Env,
  }))
  return { run, create, advance: () => { latestRound = 'fresh-round' } }
}

it('hides picks and choices until both lock and persists the result across retries', async () => {
  const { run, create } = fixture()
  await run(nominateWildcard, 'host', { filmId: seedFilms[0].id })
  expect(await run(getWildcard, 'guest')).toEqual({
    success: true, data: { phase: 'nomination', ready: { host: true, guest: false } },
  })
  await run(nominateWildcard, 'guest', { filmId: seedFilms[1].id })
  expect(await run(chooseWildcard, 'host', { choice: 'risk' })).toMatchObject({
    success: true, data: { phase: 'decision', ready: { host: true, guest: false } },
  })
  const pending = await run(getWildcard, 'guest')
  expect(pending).not.toHaveProperty('data.choices')
  const finished = await run(chooseWildcard, 'guest', { choice: 'keep' })
  expect(finished).toMatchObject({ success: true, data: {
    phase: 'finished', result: { film: seedFilms[0], winner: 'host' },
  } })
  expect(await run(chooseWildcard, 'guest', { choice: 'risk' })).toEqual(finished)
  expect(create).toHaveBeenCalledTimes(4)
})

it('rejects outsiders and blocks seen films, including manual aliases', async () => {
  const { run, create } = fixture()
  expect(await run(getWildcard, 'outsider')).toMatchObject({ error: 'not_member' })
  expect(await run(nominateWildcard, 'host', { filmId: seedFilms[2].id })).toMatchObject({ error: 'invalid_input' })
  expect(await run(nominateWildcard, 'host', { manualTitle: seedFilms[2].title.toUpperCase(), year: seedFilms[2].year }))
    .toMatchObject({ error: 'invalid_input' })
  expect(create).not.toHaveBeenCalled()
})

it('completes the demo partner’s nomination and decision automatically', async () => {
  const { run } = fixture('bot')
  expect(await run(nominateWildcard, 'host', { filmId: seedFilms[0].id })).toMatchObject({
    success: true, data: { phase: 'decision', picks: { guest: seedFilms[1] } },
  })
  expect(await run(chooseWildcard, 'host', { choice: 'risk' })).toMatchObject({
    success: true, data: { phase: 'finished', choices: { host: 'risk' } },
  })
})

it('stops wildcard writes once the host starts a fresh round', async () => {
  const { run, create, advance } = fixture()
  await run(nominateWildcard, 'host', { filmId: seedFilms[0].id })
  advance()
  expect(await run(nominateWildcard, 'guest', { filmId: seedFilms[1].id })).toMatchObject({ error: 'wrong_status' })
  expect(create).toHaveBeenCalledTimes(1)
})
