import { describe, expect, it } from 'vitest'
import { finalizeRound, fnv1a } from './finalize'
import type { Votes } from './ballot'

function score(hostVotes: Votes, guestVotes: Votes, order = Object.keys(hostVotes), roundId = 'round') {
  return finalizeRound({ shortlist: order.map(id => ({ id })), hostVotes, guestVotes, roundId })
}

describe('finalizeRound', () => {
  it('prefers want/want over want/maybe and maybe/maybe', () => {
    expect(score({ a: 'want', b: 'maybe', c: 'maybe' }, { a: 'want', b: 'want', c: 'maybe' }))
      .toMatchObject({ outcome: 'match', filmId: 'a', score: 3 })
    expect(score({ b: 'maybe', c: 'maybe' }, { b: 'want', c: 'maybe' }))
      .toMatchObject({ outcome: 'match', filmId: 'b', score: 2 })
    expect(score({ c: 'maybe' }, { c: 'maybe' })).toMatchObject({ outcome: 'match', score: 1 })
  })

  it('prefers any match to a closest call and excludes seen films', () => {
    expect(score({ a: 'want', b: 'maybe', c: 'want' }, { a: 'pass', b: 'maybe', c: 'seen' }))
      .toMatchObject({ outcome: 'match', filmId: 'b', score: 1 })
    expect(score({ a: 'want', c: 'want' }, { a: 'pass', c: 'seen' }))
      .toEqual({ outcome: 'closest', filmId: 'a', score: 2, reason: 'The host wanted to watch it and the guest passed.' })
  })

  it('ranks closest calls by points and explains a guest preference', () => {
    expect(score({ a: 'maybe', b: 'pass' }, { a: 'pass', b: 'want' }))
      .toEqual({ outcome: 'closest', filmId: 'b', score: 2, reason: 'The host passed and the guest wanted to watch it.' })
  })

  it('returns none for an empty shortlist, seen films, and mutual passes', () => {
    expect(score({}, {})).toMatchObject({ outcome: 'none', filmId: null, score: 0 })
    expect(score({ a: 'pass', b: 'seen' }, { a: 'pass', b: 'want' }))
      .toMatchObject({ outcome: 'none', filmId: null, score: 0 })
  })

  it('uses unsigned FNV-1a and breaks ties independently of shortlist order', () => {
    expect(fnv1a('hello')).toBe(0x4f9f2cab)
    const votes = { a: 'want', b: 'want' } as const
    const first = score(votes, votes, ['a', 'b'], 'round')
    expect(first.filmId).toBe(fnv1a('round:a') < fnv1a('round:b') ? 'a' : 'b')
    expect(score(votes, votes, ['b', 'a'], 'round')).toEqual(first)
    expect(score(votes, votes, ['a', 'b'], 'other-round').filmId)
      .toBe(fnv1a('other-round:a') < fnv1a('other-round:b') ? 'a' : 'b')
  })
})
