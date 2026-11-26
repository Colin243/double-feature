/** Lowercase ASCII letters and digits separated by single dashes ("Lust, Caution" -> "lust-caution"). */
export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** The same `slug-year` shape the seed films use, so one film has one id however it was found. */
export function candidateId(title: string, year: number): string {
  return `${slugify(title)}-${year}`
}

/**
 * A title reduced to what identifies it: no "(film)" or "(2018 film)" suffix,
 * no accents or punctuation, no leading "the". Used to decide whether a
 * Wikipedia page is the film we asked about.
 */
export function comparableTitle(title: string): string {
  return slugify(title.replace(/\s*\([^)]*\)\s*$/, '')).replace(/^the-/, '')
}

const words = (text: string) =>
  ` ${text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `

/**
 * Does this title appear, as whole words, in the evidence text? A film the
 * model names that none of the web pages mention is not grounded in anything we
 * can point to, however real it sounds, so it is dropped.
 */
export function appearsIn(title: string, evidence: string): boolean {
  const wanted = words(title.replace(/\s*\([^)]*\)\s*$/, '')).trim()
  if (!wanted) return false
  const haystack = words(evidence)
  return haystack.includes(` ${wanted} `) || (wanted.startsWith('the ') && haystack.includes(` ${wanted.slice(4)} `))
}
