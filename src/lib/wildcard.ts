import type { Votes } from './ballot'
import type { Film } from './films'

export function eligibleWildcardFilms(shortlist: readonly Film[], hostVotes: Votes, guestVotes: Votes): Film[] {
  return shortlist.filter(film => hostVotes[film.id] !== 'seen' && guestVotes[film.id] !== 'seen')
}

function titleKey(title: string): string {
  return title.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase()
}

export function sameWildcardFilm(host: Film, guest: Film): boolean {
  return host.id === guest.id || (host.year === guest.year && titleKey(host.title) === titleKey(guest.title))
}

export function buildWildcardShortlist(host: Film, guest: Film): Film[] {
  return sameWildcardFilm(host, guest) ? [host] : [host, guest]
}

export type WildcardChoice = 'keep' | 'risk'

type WildcardDecision = { host: WildcardChoice; guest: WildcardChoice }

export function resolveWildcard(
  host: Film,
  guest: Film,
  decisions?: WildcardDecision,
  flipCoin = () => (crypto.getRandomValues(new Uint8Array(1))[0] & 1) === 0 ? 'host' as const : 'guest' as const,
) {
  if (buildWildcardShortlist(host, guest).length === 1) {
    return { film: host, reason: 'same_nomination' as const }
  }
  if (!decisions) return null

  const tied = decisions.host === decisions.guest
  const winner = tied ? flipCoin() : decisions.host === 'risk' ? 'host' : 'guest'
  return { film: winner === 'host' ? host : guest, winner, reason: tied ? 'coin_flip' as const : 'risk' as const }
}

export type WildcardView =
  | { phase: 'nomination'; ready: Record<'host' | 'guest', boolean> }
  | { phase: 'decision'; ready: Record<'host' | 'guest', boolean>; picks: Record<'host' | 'guest', Film> }
  | { phase: 'finished'; picks: Partial<Record<'host' | 'guest', Film>>; choices: Partial<WildcardDecision>; result: NonNullable<ReturnType<typeof resolveWildcard>> }
