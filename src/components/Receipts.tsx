import { voteLabels } from '@/lib/ballot'
import type { Votes } from '@/lib/ballot'
import type { Film } from '@/lib/films'
import { tasteMatch } from '@/lib/tasteMatch'

/**
 * Both players' votes, side by side. They come from the result row, which the
 * server writes only after both ballots are in, so nothing here is available
 * before the reveal.
 */
export function Receipts({ shortlist, hostVotes, guestVotes, viewerIsHost, partnerLabel }: {
  shortlist: Film[]
  hostVotes: Votes
  guestVotes: Votes
  viewerIsHost: boolean
  partnerLabel: string
}) {
  const mine = viewerIsHost ? hostVotes : guestVotes
  const theirs = viewerIsHost ? guestVotes : hostVotes
  const { agreed, total } = tasteMatch(hostVotes, guestVotes, shortlist)
  const label = (votes: Votes, id: string) => (votes[id] ? voteLabels[votes[id]] : '—')

  return (
    <section className="df-panel" aria-labelledby="receipts-title">
      <h3 id="receipts-title">The receipts</h3>
      <p role="status" data-testid="taste-match">{agreed} of {total} agreed</p>
      <ul className="df-receipts">
        {shortlist.map(film => (
          <li key={film.id} data-agreed={mine[film.id] !== undefined && mine[film.id] === theirs[film.id]}>
            <strong>{film.title}</strong>
            <dl>
              <div><dt>You</dt><dd>{label(mine, film.id)}</dd></div>
              <div><dt>{partnerLabel}</dt><dd>{label(theirs, film.id)}</dd></div>
            </dl>
          </li>
        ))}
      </ul>
    </section>
  )
}
