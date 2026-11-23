import { useState } from 'react'
import { useAuth, useQuery } from 'deepspace'
import { Button } from '@/components/ui'
import { ratingId, reactionLabels } from '@/lib/rating'
import type { Rating, ReactionTag } from '@/lib/rating'
import { roomAction } from '@/lib/room-actions'

const emptyRating: Rating = { stars: 0, tags: [] }

export function FilmRating({ roomId, roundId, filmId }: { roomId: string; roundId: string; filmId: string }) {
  const { userId } = useAuth()
  if (!userId) return null
  return <RatingEditor key={ratingId(userId, filmId)} roomId={roomId} roundId={roundId} filmId={filmId} userId={userId} />
}

function RatingEditor({ roomId, roundId, filmId, userId }: { roomId: string; roundId: string; filmId: string; userId: string }) {
  const { records, status } = useQuery<Rating>('ratings', {
    where: { userId, filmId }, limit: 1,
  })
  const [draft, setDraft] = useState<Rating>()
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean }>()
  const rating = draft ?? records[0]?.data ?? emptyRating

  function change(next: Rating) {
    setDraft(next)
    setFeedback(undefined)
  }

  function toggleTag(tag: ReactionTag) {
    const tags = rating.tags.includes(tag)
      ? rating.tags.filter(value => value !== tag)
      : [...rating.tags, tag]
    change({ ...rating, tags })
  }

  async function save() {
    if (busy || !rating.stars) return
    setBusy(true)
    setFeedback(undefined)
    try {
      await roomAction('saveRating', { roomId, roundId, filmId, stars: rating.stars, tags: rating.tags })
      setFeedback({ text: 'Rating saved.' })
    } catch (error) {
      setFeedback({ text: error instanceof Error ? error.message : 'Could not save your rating.', error: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="df-panel" aria-label="Your rating">
      <h3>Your rating</h3>
      <p>Optional. Only you can see your rating.</p>
      {status === 'loading' && <p role="status">Loading your rating…</p>}
      {status === 'error' && <p role="alert">Could not load your rating.</p>}
      {status === 'ready' && (
        <>
          <fieldset className="df-rating-options" disabled={busy}>
            <legend>Stars</legend>
            {[1, 2, 3, 4, 5].map(stars => (
              <Button key={stars} type="button" variant={rating.stars === stars ? 'default' : 'outline'}
                aria-pressed={rating.stars === stars} aria-label={`${stars} ${stars === 1 ? 'star' : 'stars'}`}
                onClick={() => change({ ...rating, stars })}>{stars} ★</Button>
            ))}
          </fieldset>
          <fieldset className="df-rating-options" disabled={busy}>
            <legend>Reactions</legend>
            {(Object.keys(reactionLabels) as ReactionTag[]).map(tag => (
              <Button key={tag} type="button" variant={rating.tags.includes(tag) ? 'default' : 'outline'}
                aria-pressed={rating.tags.includes(tag)} onClick={() => toggleTag(tag)}>
                {reactionLabels[tag]}
              </Button>
            ))}
          </fieldset>
          <Button type="button" loading={busy} disabled={!draft || !rating.stars} onClick={save}>Save rating</Button>
        </>
      )}
      {feedback && <p role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
    </section>
  )
}
