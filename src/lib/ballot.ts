export const voteOptions = ['want', 'maybe', 'pass', 'seen'] as const
export type Vote = (typeof voteOptions)[number]
export type Votes = Record<string, Vote>

export function validateBallot(votes: unknown, shortlist: readonly { id: string }[]): votes is Votes {
  if (!votes || typeof votes !== 'object' || Array.isArray(votes) || !shortlist.length) return false
  const entries = Object.entries(votes)
  const filmIds = new Set(shortlist.map(film => film.id))
  return entries.length === filmIds.size &&
    entries.every(([filmId, vote]) => filmIds.has(filmId) && voteOptions.some(option => option === vote))
}

const demoProfile = ['want', 'maybe', 'want', 'pass'] as const

export function botVotes(shortlist: readonly { id: string }[]): Votes {
  return Object.fromEntries(shortlist.map(({ id }) => {
    // Hash the stable film ID so position and retries never change the bot's vote.
    let hash = 2166136261
    for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
    return [id, demoProfile[(hash >>> 0) % demoProfile.length]]
  }))
}
