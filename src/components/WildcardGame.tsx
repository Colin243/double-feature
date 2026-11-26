import { useEffect, useState } from 'react'
import { Button, Input } from '@/components/ui'
import type { Film } from '@/lib/films'
import { roomAction } from '@/lib/room-actions'
import type { WildcardView } from '@/lib/wildcard'

export function WildcardGame({ roundId, isHost, partnerLabel, eligible }: {
  roundId: string
  isHost: boolean
  partnerLabel: string
  eligible: Film[]
}) {
  const [game, setGame] = useState<WildcardView>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [filmId, setFilmId] = useState('')
  const [title, setTitle] = useState('')
  const [year, setYear] = useState('')
  const seat = isHost ? 'host' : 'guest'
  const waiting = game && game.phase !== 'finished' && game.ready[seat]

  useEffect(() => {
    if (game && !waiting) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    async function refresh() {
      try {
        const view = await roomAction('getWildcard', { roundId })
        if (!active) return
        setGame(view)
        setError('')
        if (view.phase === 'finished' || !view.ready[seat]) return
      } catch (err) {
        if (!active) return
        setError(err instanceof Error ? err.message : 'Could not load Keep or Risk.')
      }
      timer = setTimeout(refresh, 2000)
    }
    if (waiting) timer = setTimeout(refresh, 1500)
    else void refresh()
    return () => { active = false; clearTimeout(timer) }
  }, [game, roundId, seat, waiting])

  async function submit(request: () => Promise<WildcardView>) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      setGame(await request())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your choice.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="df-panel grid gap-3" aria-label="Keep or Risk">
      <h3>Keep or Risk</h3>
      {!game && !error && <p role="status">Loading the tiebreaker…</p>}
      {game?.phase === 'nomination' && (waiting
        ? <p role="status">Pick locked. Waiting for {partnerLabel.toLowerCase()}.</p>
        : <form className="grid gap-2" onSubmit={event => {
          event.preventDefault()
          void submit(() => roomAction('nominateWildcard', filmId
            ? { roundId, filmId }
            : { roundId, manualTitle: title, year: Number(year) }))
        }}>
          <label className="grid gap-1">
            Nominate a film
            <select className="rounded border bg-background p-2" value={filmId} onChange={event => setFilmId(event.target.value)}>
              <option value="">Enter a title manually</option>
              {eligible.map(film => <option key={film.id} value={film.id}>{film.title}</option>)}
            </select>
          </label>
          {!filmId && <>
            <label>Movie title<Input required maxLength={120} value={title} onChange={event => setTitle(event.target.value)} /></label>
            <label>Release year<Input required type="number" min={1888} max={new Date().getUTCFullYear() + 1}
              value={year} onChange={event => setYear(event.target.value)} /></label>
          </>}
          <Button type="submit" loading={busy}>Lock nomination</Button>
        </form>)}
      {game?.phase === 'decision' && <>
        <p>Your pick: <strong>{game.picks[seat].title}</strong></p>
        <p>{partnerLabel} picked <strong>{game.picks[isHost ? 'guest' : 'host'].title}</strong></p>
        {waiting ? <p role="status">Choice locked. Waiting for {partnerLabel.toLowerCase()}.</p> : <>
          <p>Keep gives your partner’s pick the edge. Risk backs yours. Matching choices flip a coin.</p>
          <div className="flex gap-2">
            <Button disabled={busy} variant="outline" onClick={() => submit(() => roomAction('chooseWildcard', { roundId, choice: 'keep' }))}>Keep</Button>
            <Button disabled={busy} onClick={() => submit(() => roomAction('chooseWildcard', { roundId, choice: 'risk' }))}>Risk</Button>
          </div>
        </>}
      </>}
      {game?.phase === 'finished' && <div role="status">
        <p>Tonight’s pick</p>
        <h4>{game.result.film.title}</h4>
        {game.result.reason === 'same_nomination' ? <p>You both nominated this film.</p> : <>
          <p className="capitalize">You chose {game.choices[seat]} · {partnerLabel} chose {game.choices[isHost ? 'guest' : 'host']}</p>
          {game.result.reason === 'coin_flip' && <p>The coin flip decided the pick.</p>}
        </>}
      </div>}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
