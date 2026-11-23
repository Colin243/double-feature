import { expect, it } from 'vitest'
import type { Film } from './films'
import { rankByRatings } from './ranking'

const film = (id: string, moods: string[]): Film =>
  ({ id, title: id, moods, year: 2000, runtimeMinutes: 100, hook: '' })

it('moves a similar film up or down when a past rating changes', () => {
  const watched = film('watched', ['romantic'])
  const similar = film('similar', ['romantic'])
  const different = film('different', ['funny'])
  const pool = [different, similar]
  const rank = (stars: number) => rankByRatings(
    pool, [], 0, [{ filmId: watched.id, stars, tags: [] }], 'round', [...pool, watched],
  )
  expect(rank(5).shortlist).toEqual([similar, different])
  expect(rank(1).shortlist).toEqual([different, similar])
  expect(rank(3).personalized).toBe(false)
})

it('breaks ties deterministically regardless of the input order', () => {
  const pool = [film('one', []), film('two', [])]
  const rank = (candidates: Film[]) => rankByRatings(candidates, [], 0, [], 'round', pool).shortlist
  expect(rank([...pool].reverse())).toEqual(rank(pool))
})
