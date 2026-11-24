import type { Film } from '@/lib/films'

export type Outcome = 'match' | 'closest' | 'none'

const kicker: Record<Outcome, string> = {
  match: 'Tonight’s pick',
  closest: 'Closest call',
  none: 'No match',
}

/**
 * The result of the round. Everything is in the page immediately; the flip is
 * only a short visual flourish, and it is not applied when `animate` is false
 * (the player prefers reduced motion).
 */
export function RevealCard({ outcome, film, reason, animate }: {
  outcome: Outcome
  film?: Film
  reason: string
  animate: boolean
}) {
  return (
    <article
      className={`df-panel df-reveal${animate ? ' df-flip' : ''}`}
      data-testid="reveal-card"
      data-outcome={outcome}
      data-film-id={film?.id ?? ''}
      aria-labelledby="reveal-title"
    >
      <p className="df-reveal-kicker">{kicker[outcome]}</p>
      <h2 id="reveal-title">{film ? film.title : 'No match tonight'}</h2>
      {outcome === 'closest' && (
        <p role="note" className="df-reveal-note">Not a perfect match, but the nearest thing.</p>
      )}
      {film && (
        <p className="df-reveal-meta">
          {film.year} · {film.runtimeMinutes} min · <span className="capitalize">{film.moods.join(' · ')}</span>
        </p>
      )}
      {film && <div>{film.hook}</div>}
      <p className="df-reveal-reason">{reason}</p>
    </article>
  )
}
