import { moodChips } from '../moods'
import { candidateId } from './ids'

export type ProposedFilm = {
  id: string
  title: string
  year: number
  moods: string[]
  hook: string
  reason: string
}

export const allowedMoodTags: ReadonlySet<string> =
  new Set(Object.values(moodChips).flatMap(chip => chip.tags))

export const maxProposals = 10

/** Collapse whitespace and drop markdown emphasis. Returns null for anything that looks like markup or a link. */
function plain(value: unknown, min: number, max: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.replace(/[*_#`]+/g, '').replace(/\s+/g, ' ').trim()
  if (text.length < min || text.length > max) return null
  if (/[<>{}\[\]\\]|https?:|www\.|@/i.test(text)) return null
  return text
}

/**
 * Turn the model's reply into films, keeping only the items that pass every
 * check. The reply is untrusted: it was written from web pages, so a page can
 * try to steer it. Nothing here trusts it, and each field is limited to plain
 * text of a sensible length, a tag from our own list, and a plausible year.
 * A bad item is dropped, never repaired. Whether a film really exists is
 * checked afterwards, against Wikipedia.
 */
export function parseModelFilms(reply: string, currentYear = new Date().getUTCFullYear()): ProposedFilm[] {
  const start = reply.indexOf('{')
  const end = reply.lastIndexOf('}')
  if (start < 0 || end <= start) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(reply.slice(start, end + 1))
  } catch {
    return []
  }
  const items = (parsed as { films?: unknown })?.films
  if (!Array.isArray(items)) return []

  const seen = new Set<string>()
  const films: ProposedFilm[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const { title, year, moods, hook, reason } = item as Record<string, unknown>
    const cleanTitle = plain(title, 1, 80)
    const cleanHook = plain(hook, 20, 180)
    const cleanReason = plain(reason, 10, 140)
    if (!cleanTitle || !cleanHook || !cleanReason) continue
    if (typeof year !== 'number' || !Number.isInteger(year) || year < 1900 || year > currentYear + 1) continue
    const tags = Array.isArray(moods)
      ? [...new Set(moods.filter((tag): tag is string => typeof tag === 'string' && allowedMoodTags.has(tag)))].slice(0, 3)
      : []
    if (!tags.length) continue
    const id = candidateId(cleanTitle, year)
    if (seen.has(id)) continue
    seen.add(id)
    films.push({ id, title: cleanTitle, year, moods: tags, hook: cleanHook, reason: cleanReason })
    if (films.length === maxProposals) break
  }
  return films
}
