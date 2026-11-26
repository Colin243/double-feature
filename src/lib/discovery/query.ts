/** The web search is about the brief only: no names, no ratings, nothing about the players. */
export function buildSearchQuery(brief: string): string {
  const cleaned = brief.replace(/[<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)
  return `${cleaned || 'good films'} movies to watch`
}

export type Snippet = { title: string; text: string }

/** Pull a title and some text out of each Exa result, ignoring anything malformed. */
export function exaSnippets(results: unknown): Snippet[] {
  if (!Array.isArray(results)) return []
  const snippets: Snippet[] = []
  for (const result of results) {
    if (!result || typeof result !== 'object') continue
    const { title, highlights, text } = result as { title?: unknown; highlights?: unknown; text?: unknown }
    const body = Array.isArray(highlights)
      ? highlights.filter((line): line is string => typeof line === 'string').join(' … ')
      : typeof text === 'string' ? text : ''
    if (typeof title === 'string' && body.trim()) snippets.push({ title, text: body })
  }
  return snippets
}
