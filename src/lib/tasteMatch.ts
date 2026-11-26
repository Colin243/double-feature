import type { Votes } from './ballot'

/** How many of the shortlisted films the two players voted the same way on. */
export function tasteMatch(
  hostVotes: Votes,
  guestVotes: Votes,
  shortlist: readonly { id: string }[],
): { agreed: number; total: number } {
  let agreed = 0
  for (const { id } of shortlist) {
    if (hostVotes[id] !== undefined && hostVotes[id] === guestVotes[id]) agreed += 1
  }
  return { agreed, total: shortlist.length }
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/**
 * The server writes reasons from a neutral point of view ("The host wanted to
 * watch it and the guest passed."). Show each player their own view of it.
 * `partner` is how to refer to the other player, for example "your partner" or
 * "the demo partner".
 */
export function personalizeReason(reason: string, viewerIsHost: boolean, partner = 'your partner'): string {
  const host = viewerIsHost ? 'you' : partner
  const guest = viewerIsHost ? partner : 'you'
  return reason
    .replace(/\bThe host\b/g, capitalize(host))
    .replace(/\bthe host\b/g, host)
    .replace(/\bThe guest\b/g, capitalize(guest))
    .replace(/\bthe guest\b/g, guest)
}
