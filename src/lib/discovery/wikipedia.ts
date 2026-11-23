import { comparableTitle } from './ids'

export type WikipediaPage = {
  title: string
  key: string
  description?: string | null
  excerpt?: string | null
}

export type WikipediaMatch = { year: number; sourceUrl: string }

const wikiBase = 'https://en.wikipedia.org/wiki/'

/** "2000 film by Wong Kar-wai" -> 2000. Pages for films named like other things carry the year in the title instead: "Us (2019 film)". */
function releaseYear(page: WikipediaPage): number | null {
  const fromDescription = /^(\d{4})\b.*\bfilm\b/i.exec(page.description ?? '')
  if (fromDescription) return Number(fromDescription[1])
  const fromTitle = /\((\d{4}) (?:[A-Za-z-]+ )*film\)\s*$/i.exec(page.title)
  return fromTitle ? Number(fromTitle[1]) : null
}

const isFilm = (page: WikipediaPage) =>
  /\bfilm\b/i.test(page.description ?? '') || /\bfilm\)\s*$/i.test(page.title)

/**
 * Is one of these search results the film a model said exists? This is what
 * stops an invented title from reaching players: a made-up name finds only
 * unrelated pages. The result must be a film, have the same title once
 * suffixes and punctuation are ignored, and a release year within one year of
 * the claimed one (sources disagree by a year for festival releases). The
 * year Wikipedia gives is the one we keep.
 */
export function matchWikipediaFilm(
  results: readonly WikipediaPage[], title: string, year: number,
): WikipediaMatch | null {
  const wanted = comparableTitle(title)
  if (!wanted) return null
  for (const page of results) {
    if (!isFilm(page) || comparableTitle(page.title) !== wanted) continue
    const found = releaseYear(page)
    if (found === null || Math.abs(found - year) > 1) continue
    return { year: found, sourceUrl: `${wikiBase}${encodeURIComponent(page.key)}` }
  }
  return null
}
