type TrailerFilm = { title: string; year: number | null }

export type Trailer = { videoId: string; title: string }

export type YouTubeVideo = {
  id?: { videoId?: unknown }
  snippet?: { title?: unknown }
}

export function isYouTubeVideoId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{11}$/.test(value)
}

export function trailerQuery(film: TrailerFilm): string {
  return [film.title, film.year, 'official trailer'].filter(Boolean).join(' ')
}

function words(value: string): string {
  return value.normalize('NFKD').toLowerCase().replace(/\p{Mark}/gu, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ').trim()
}

const trailerQualifiers = new Set([
  '4k', 'hd', 'uhd', 'official', 'original', 'new', 'restored', 'remastered', 'restoration', 'theatrical',
])
const releaseYear = /^(?:19|20)\d{2}$/

export function pickTrailer(videos: readonly YouTubeVideo[], film: TrailerFilm): Trailer | null {
  const title = words(film.title)
  if (!title) return null

  const matches = videos.flatMap(video => {
    const videoId = video?.id?.videoId
    const label = video?.snippet?.title
    if (!isYouTubeVideoId(videoId) || typeof label !== 'string') return []
    const normalized = words(label)
    // Some uploads put the year first: "1993 The Wedding Banquet Official Trailer".
    const leadingYear = /^((?:19|20)\d{2}) /.exec(normalized)
    const startsWithYear = Boolean(leadingYear && normalized.slice(5).startsWith(`${title} `))
    const body = startsWithYear ? normalized.slice(5) : normalized
    if (!body.startsWith(`${title} `) ||
        /\b(?:fan made|fanmade|concept trailer|reaction|parody)\b/.test(body)) return []
    const remainder = body.slice(title.length + 1)
    const trailerIndex = remainder.search(/\btrailer\b/)
    if (trailerIndex < 0) return []
    const qualifiers = remainder.slice(0, trailerIndex).match(/\S+/g) ?? []
    // Before the word "trailer", accept release years and presentation
    // qualifiers, but reject sequel numbers and subtitles from other films.
    if (qualifiers.some(word => !trailerQualifiers.has(word) && !releaseYear.test(word))) return []
    const years = [
      ...(startsWithYear ? [Number(leadingYear?.[1])] : []),
      ...qualifiers.filter(word => releaseYear.test(word)).map(Number),
    ]
    if (film.year && years.length && !years.includes(film.year)) return []
    const score = Number(/\bofficial trailer\b/.test(normalized)) * 2 +
      Number(Boolean(film.year && years.includes(film.year)))
    return [{ trailer: { videoId, title: label.trim().slice(0, 180) }, score }]
  })
  matches.sort((a, b) => b.score - a.score)
  return matches[0]?.trailer ?? null
}

/**
 * A search costs about 1.3 credits and is not rate-limited by the platform.
 * Pinned films and cached answers are free, so these limits count only fresh
 * searches, per person and across the app, per UTC day.
 */
export const trailerLimits = { perUser: 15, global: 60 } as const

export const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10)
