import { fitsRuntime } from './films'
import type { Film } from './films'
import { fnv1a } from './finalize'
import { moodChips } from './moods'
import type { Mood } from './moods'
import type { Rating } from './rating'

export type FilmRating = Rating & { filmId: string }

export function rankByRatings(
  pool: readonly Film[], moods: readonly Mood[], maxRuntime: number,
  ratings: readonly FilmRating[], roundId: string, catalog: readonly Film[],
) {
  const eligible = pool.filter(film => fitsRuntime(film, maxRuntime))
  const candidates = eligible.length ? eligible : pool
  const moodTags = new Set<string>(moods.flatMap(mood => moodChips[mood].tags))
  const catalogById = new Map(catalog.map(film => [film.id, film]))
  const weights = new Map<string, number>()
  for (const rating of ratings) {
    const weight = rating.stars >= 4 ? 1 : rating.stars <= 2 ? -1 : 0
    for (const tag of new Set(catalogById.get(rating.filmId)?.moods)) {
      weights.set(tag, (weights.get(tag) ?? 0) + weight)
    }
  }
  const scored = candidates.map(film => {
    const tags = [...new Set(film.moods)]
    const moodScore = tags.filter(tag => moodTags.has(tag)).length
    const signal = tags.reduce((total, tag) => total + (weights.get(tag) ?? 0), 0)
    const adjustment = Math.max(-0.5, Math.min(0.5, signal * 0.25))
    return { film, adjustment, score: moodScore + adjustment, tie: fnv1a(`${roundId}:${film.id}`) }
  }).sort((a, b) => b.score - a.score || a.tie - b.tie || a.film.id.localeCompare(b.film.id))

  const selected = scored.slice(0, 6)
  return {
    shortlist: selected.map(({ film }) => film),
    personalized: selected.some(({ adjustment }) => adjustment !== 0),
    runtimeLimitIgnored: Boolean(maxRuntime && !eligible.length),
  }
}
