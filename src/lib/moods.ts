import { fitsRuntime } from './films'
import type { Film } from './films'

export const moodChips = {
  laugh: { label: 'Make me laugh', tags: ['funny', 'playful', 'heartwarming'] },
  heartbreak: { label: 'Break my heart', tags: ['wistful', 'romantic', 'intense'] },
  guessing: { label: 'Keep me guessing', tags: ['suspenseful', 'intense'] },
} as const

export type Mood = keyof typeof moodChips
export type RuntimeLimit = 0 | 100 | 120

export function combineMoods(
  hostMoods: readonly Mood[],
  guestMoods: readonly Mood[],
  hostRuntime: RuntimeLimit,
  guestRuntime: RuntimeLimit,
) {
  return {
    moods: [...new Set([...hostMoods, ...guestMoods])],
    maxRuntime: hostRuntime && guestRuntime
      ? Math.min(hostRuntime, guestRuntime)
      : hostRuntime || guestRuntime,
  }
}

export function buildBrief(
  hostMoods: readonly Mood[],
  guestMoods: readonly Mood[],
  hostRuntime: RuntimeLimit,
  guestRuntime: RuntimeLimit,
): string {
  const { moods, maxRuntime } = combineMoods(hostMoods, guestMoods, hostRuntime, guestRuntime)
  const labels = moods.map(mood => moodChips[mood].label.toLowerCase())
  const text = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(labels)
  const brief = text ? text[0].toUpperCase() + text.slice(1) : 'Open to any mood'
  const runtime = maxRuntime === 120 ? '2 hours' : `${maxRuntime} minutes`
  return maxRuntime ? `${brief}, under ${runtime}` : brief
}

export function rankSeedFilms(films: readonly Film[], moods: readonly Mood[], maxRuntime: number): Film[] {
  const eligible = films.filter(film => fitsRuntime(film, maxRuntime))
  const candidates = eligible.length ? eligible : films
  const tags = new Set<string>(moods.flatMap(mood => moodChips[mood].tags))

  return candidates
    .map(film => ({ film, score: new Set(film.moods.filter(tag => tags.has(tag))).size }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map(({ film }) => ({ ...film, moods: [...film.moods] }))
}
