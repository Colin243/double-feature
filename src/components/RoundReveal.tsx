import { useState } from 'react'
import { useQuery } from 'deepspace'
import { Button } from '@/components/ui'
import { FilmRating } from '@/components/FilmRating'
import { TrailerEmbed } from '@/components/TrailerEmbed'
import { WildcardGame } from '@/components/WildcardGame'
import { eligibleWildcardFilms } from '@/lib/wildcard'
import { Receipts } from '@/components/Receipts'
import { RevealCard } from '@/components/RevealCard'
import type { Outcome } from '@/components/RevealCard'
import type { Votes } from '@/lib/ballot'
import type { Film } from '@/lib/films'
import { roomAction } from '@/lib/room-actions'
import { personalizeReason } from '@/lib/tasteMatch'
import { usePrefersReducedMotion } from '@/lib/use-reduced-motion'

// A "none" outcome is stored with a null film and a live read has no filmId
// field at all, so a missing film always means "no match".
type Result = {
  outcome: Outcome
  filmId?: string | null
  reason: string
  ballots: { hostVotes: Votes; guestVotes: Votes }
}

export function RoundReveal({ roomId, roundId, shortlist, isHost, partnerLabel }: {
  roomId: string
  roundId: string
  shortlist: Film[]
  isHost: boolean
  partnerLabel: string
}) {
  const { records, status } = useQuery<Result>('results', { where: { roundId }, limit: 1 })
  const reducedMotion = usePrefersReducedMotion()
  const [showWildcard, setShowWildcard] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const result = records[0]?.data

  async function startAnother() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await roomAction('openSetupRound', { roomId })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start another round.')
    } finally {
      setBusy(false)
    }
  }

  if (status === 'error') return <p role="alert">Could not load the result.</p>
  if (!result) return <p role="status">{status === 'loading' ? 'Loading the result…' : 'Revealing the result…'}</p>

  const film = result.filmId ? shortlist.find(entry => entry.id === result.filmId) : undefined
  const partner = partnerLabel.toLowerCase()

  return (
    <>
      <div className="df-round-grid">
        <RevealCard
          outcome={result.outcome}
          film={film}
          reason={personalizeReason(result.reason, isHost, partner)}
          animate={!reducedMotion}
        />
        <div className="df-vote-side">
          {film && <TrailerEmbed key={film.id} roundId={roundId} filmId={film.id} />}
          {film && <FilmRating key={film.id} roomId={roomId} roundId={roundId} filmId={film.id} />}
          {result.outcome === 'none' && (showWildcard
            ? <WildcardGame key={roundId} roundId={roundId} isHost={isHost} partnerLabel={partnerLabel}
                eligible={eligibleWildcardFilms(shortlist, result.ballots.hostVotes, result.ballots.guestVotes)} />
            : <Button variant="outline" onClick={() => setShowWildcard(true)}>Play Keep or Risk</Button>)}
          <section className="df-panel" aria-label="Next round">
            {isHost ? (
              <>
                <h3>{film ? 'Another movie night?' : 'Try again?'}</h3>
                {!film && <p>Nothing worked for both of you. You can start another round.</p>}
                <Button loading={busy} onClick={startAnother}>Start another round</Button>
              </>
            ) : (
              <p role="status">Waiting for the host to start another round.</p>
            )}
          </section>
          <Receipts
            shortlist={shortlist}
            hostVotes={result.ballots.hostVotes}
            guestVotes={result.ballots.guestVotes}
            viewerIsHost={isHost}
            partnerLabel={partnerLabel}
          />
        </div>
      </div>
      {error && <p role="alert">{error}</p>}
    </>
  )
}
