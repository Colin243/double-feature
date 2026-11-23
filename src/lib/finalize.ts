import type { Vote, Votes } from './ballot'

export type RoundResult = {
  outcome: 'match' | 'closest' | 'none'
  filmId: string | null
  score: number
  reason: string
}

type Candidate = { filmId: string; score: number; hash: number; reason: string }

export function fnv1a(value: string): number {
  let hash = 2166136261
  for (const byte of new TextEncoder().encode(value)) {
    hash = Math.imul(hash ^ byte, 16777619)
  }
  return hash >>> 0
}

const closestPoints = { want: 2, maybe: 1, pass: 0 } as const
const voteReasons = { want: 'wanted to watch it', maybe: 'was open to it', pass: 'passed' } as const

function better(current: Candidate | undefined, next: Candidate): Candidate {
  if (!current || next.score > current.score) return next
  if (next.score < current.score) return current
  if (next.hash < current.hash || (next.hash === current.hash && next.filmId < current.filmId)) return next
  return current
}

function isScorable(vote: Vote | undefined): vote is keyof typeof closestPoints {
  return vote === 'want' || vote === 'maybe' || vote === 'pass'
}

export function finalizeRound({ shortlist, hostVotes, guestVotes, roundId }: {
  shortlist: readonly { id: string }[]
  hostVotes: Votes
  guestVotes: Votes
  roundId: string
}): RoundResult {
  let match: Candidate | undefined
  let closest: Candidate | undefined
  for (const { id: filmId } of shortlist) {
    const host = hostVotes[filmId]
    const guest = guestVotes[filmId]
    if (!isScorable(host) || !isScorable(guest)) continue
    const hash = fnv1a(`${roundId}:${filmId}`)
    if (host !== 'pass' && guest !== 'pass') {
      const score = 1 + Number(host === 'want') + Number(guest === 'want')
      const reason = score === 3
        ? 'You both picked Want to watch.'
        : score === 1
          ? 'You both picked Maybe.'
          : 'One of you wanted to watch it, and the other was open to it.'
      match = better(match, { filmId, hash, score, reason })
    } else {
      const score = closestPoints[host] + closestPoints[guest]
      if (score > 0) {
        const reason = `The host ${voteReasons[host]} and the guest ${voteReasons[guest]}.`
        closest = better(closest, { filmId, hash, score, reason })
      }
    }
  }

  const winner = match ?? closest
  return winner
    ? { outcome: match ? 'match' : 'closest', filmId: winner.filmId, score: winner.score, reason: winner.reason }
    : { outcome: 'none', filmId: null, score: 0, reason: 'No film got enough support from both ballots.' }
}
