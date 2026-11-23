import { useState } from 'react'
import { Button } from '@/components/ui'
import { roomAction } from '@/lib/room-actions'
import type { Trailer } from '@/lib/trailer'

export function TrailerEmbed({ roundId, filmId }: { roundId: string; filmId: string }) {
  const [trailer, setTrailer] = useState<Trailer | null>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  async function loadTrailer() {
    if (loading) return
    setLoading(true)
    setError(false)
    try {
      const result = await roomAction('getTrailer', { roundId, filmId })
      setTrailer(result.trailer)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="df-panel" aria-label="Trailer">
      {trailer === undefined && (
        <Button type="button" loading={loading} onClick={loadTrailer}>{error ? 'Try trailer again' : 'Watch trailer'}</Button>
      )}
      {error && <p role="status">The trailer is temporarily unavailable.</p>}
      {trailer === null && <p role="status">No trailer found for this film.</p>}
      {trailer && (
        <>
          <iframe
            className="aspect-video w-full rounded-md"
            title={trailer.title}
            src={`https://www.youtube-nocookie.com/embed/${trailer.videoId}?autoplay=0`}
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
          <p>Showing: {trailer.title}</p>
          <a href={`https://www.youtube.com/watch?v=${trailer.videoId}`} target="_blank" rel="noreferrer">
            Watch on YouTube
          </a>
        </>
      )}
    </section>
  )
}
