import { expect, it, vi } from 'vitest'
import { seedFilms } from './films'
import { buildWildcardShortlist, eligibleWildcardFilms, resolveWildcard } from './wildcard'

const [first, second, third] = seedFilms

it('excludes films marked seen by either player', () => {
  expect(eligibleWildcardFilms([first, second, third], { [first.id]: 'seen' }, { [second.id]: 'seen' }))
    .toEqual([third])
})

it('keeps two distinct nominations and collapses equivalent film snapshots', () => {
  expect(buildWildcardShortlist(first, second)).toEqual([first, second])
  expect(buildWildcardShortlist(first, { ...first, id: 'manual', title: first.title.toUpperCase() }))
    .toEqual([first])
  expect(buildWildcardShortlist(first, { ...first, id: 'remake', year: first.year + 1 })).toHaveLength(2)
})

it('waits for both decisions, unless the nominations are the same', () => {
  const flip = vi.fn(() => 'guest' as const)
  expect(resolveWildcard(first, second, undefined, flip)).toBeNull()
  expect(resolveWildcard(first, first, undefined, flip)).toEqual({ film: first, reason: 'same_nomination' })
  expect(flip).not.toHaveBeenCalled()
})

it.each(['keep', 'risk'] as const)('flips one coin when both players choose %s', choice => {
  const flip = vi.fn(() => 'guest' as const)
  expect(resolveWildcard(first, second, { host: choice, guest: choice }, flip))
    .toEqual({ film: second, winner: 'guest', reason: 'coin_flip' })
  expect(flip).toHaveBeenCalledTimes(1)
})

it('awards the movie to the only Risk player without flipping', () => {
  const flip = vi.fn(() => 'guest' as const)
  expect(resolveWildcard(first, second, { host: 'risk', guest: 'keep' }, flip))
    .toEqual({ film: first, winner: 'host', reason: 'risk' })
  expect(resolveWildcard(first, second, { host: 'keep', guest: 'risk' }, flip))
    .toEqual({ film: second, winner: 'guest', reason: 'risk' })
  expect(flip).not.toHaveBeenCalled()
})
