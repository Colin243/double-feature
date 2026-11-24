import { describe, expect, it } from 'vitest'
import { validateBallot } from './ballot'
import type { Film } from './films'
import { buildBrief, rankSeedFilms } from './moods'

const films: Film[] = [
  { id: 'quiet', title: 'Quiet', year: 2000, runtimeMinutes: 85, moods: ['wistful'], hook: '' },
  { id: 'fun', title: 'Fun', year: 2000, runtimeMinutes: 90, moods: ['playful'], hook: '' },
  { id: 'long', title: 'Long', year: 2000, runtimeMinutes: 120, moods: ['funny'], hook: '' },
]

describe('mood shortlist', () => {
  it('merges chips without duplicates and chooses the shorter nonzero limit', () => {
    expect(buildBrief(['laugh'], ['laugh', 'heartbreak'], 120, 100))
      .toBe('Make me laugh and break my heart, under 100 minutes')
    expect(buildBrief([], [], 0, 120)).toBe('Open to any mood, under 2 hours')
  })

  it('filters strictly under the limit, ranks by mood, and preserves seed order on ties', () => {
    expect(rankSeedFilms(films, ['laugh'], 120).map(film => film.id)).toEqual(['fun', 'quiet'])
    expect(rankSeedFilms(films, [], 0).map(film => film.id)).toEqual(['quiet', 'fun', 'long'])
  })

  it('falls back when nothing fits and returns independent snapshots', () => {
    const shortlist = rankSeedFilms(films, ['laugh'], 80)
    expect(shortlist.map(film => film.id)).toEqual(['fun', 'long', 'quiet'])
    expect(shortlist[0]).not.toBe(films[1])
    expect(shortlist[0].moods).not.toBe(films[1].moods)
  })
})

describe('ballot validation', () => {
  const shortlist = films.slice(0, 2)

  it('accepts one valid vote for each film', () => {
    expect(validateBallot({ quiet: 'want', fun: 'seen' }, shortlist)).toBe(true)
  })

  it.each([
    { quiet: 'want' },
    { quiet: 'want', fun: 'maybe', extra: 'pass' },
    { quiet: 'want', long: 'maybe' },
    { quiet: 'want', fun: 'skip' },
    [['want', 'maybe']],
  ])('rejects incomplete or invalid ballots: %j', votes => {
    expect(validateBallot(votes, shortlist)).toBe(false)
  })
})
