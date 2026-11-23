import { useEffect, useState, type ReactNode } from 'react'
import { useQuery } from 'deepspace'
import { Button, Textarea } from '@/components/ui'
import { roomAction } from '@/lib/room-actions'
import { RoundReveal } from '@/components/RoundReveal'
import { buildBrief, moodChips } from '@/lib/moods'
import type { Mood, RuntimeLimit } from '@/lib/moods'
import { validateBallot, voteLabels, voteOptions } from '@/lib/ballot'
import type { Vote, Votes } from '@/lib/ballot'
import type { Film } from '@/lib/films'
import './room-round.css'

type Round = {
  status: 'setup' | 'voting' | 'revealed'
  hostMoods: Mood[]
  guestMoods: Mood[]
  hostRuntime: RuntimeLimit
  guestRuntime: RuntimeLimit
  shortlist: Film[]
  inputs?: { runtimeLimitIgnored?: boolean; personalized?: boolean; repeatedFilmIds?: string[] }
  submittedHost: boolean
  submittedGuest: boolean
}

const runtimes = [[0, 'Any'], [120, 'Under 2h'], [100, 'Under 100m']] as const

function useRoundRequest() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function run(task: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await task()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the round.')
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run }
}

function RoundShell({ children }: { children: ReactNode }) {
  return (
    <section className="df-round" aria-label="Movie night voting">
      <header className="df-round-header">
        <strong>Double Feature</strong>
        <span>Movie night room</span>
      </header>
      {children}
    </section>
  )
}

export function RoomRound({ roomId, isHost, isDemo = false, partnerLabel = 'Your partner' }: {
  roomId: string
  isHost: boolean
  isDemo?: boolean
  partnerLabel?: string
}) {
  // Always show the room's latest round: a new round opens after a reveal.
  const { records, status } = useQuery<Round>('rounds', {
    where: { roomId }, orderBy: 'number', orderDir: 'desc', limit: 1,
  })
  const round = records[0]
  const { busy, error, run } = useRoundRequest()

  if (status === 'loading') return <p role="status">Loading round…</p>
  if (status === 'error') return <p role="alert">Could not load the round.</p>
  if (!round) return (
    <RoundShell>
      {isHost
        ? <Button loading={busy} onClick={() => run(async () => { await roomAction('openSetupRound', { roomId }) })}>
            Set up voting
          </Button>
        : <p role="status">Waiting for the host to set up voting.</p>}
      {error && <p role="alert">{error}</p>}
    </RoundShell>
  )

  return (
    <RoundShell>
      {round.data.status === 'setup'
        ? <MoodSetup key={round.recordId} round={round.data} roundId={round.recordId} roomId={roomId} isHost={isHost} isDemo={isDemo} />
        : round.data.status === 'revealed'
          ? <RoundReveal key={round.recordId} roomId={roomId} roundId={round.recordId}
              shortlist={round.data.shortlist} isHost={isHost} partnerLabel={partnerLabel} />
          : <Voting key={round.recordId} round={round.data} roundId={round.recordId} isHost={isHost} />}
    </RoundShell>
  )
}

function MoodSetup({ round, roundId, roomId, isHost, isDemo }: {
  round: Round; roundId: string; roomId: string; isHost: boolean; isDemo: boolean
}) {
  const storedMoods = isHost ? round.hostMoods : round.guestMoods
  const storedRuntime = isHost ? round.hostRuntime : round.guestRuntime
  const [draft, setDraft] = useState<{ moods: Mood[]; runtime: RuntimeLimit }>()
  const [demoLoaded, setDemoLoaded] = useState(false)
  const [brief, setBrief] = useState<string>()
  const [saved, setSaved] = useState(false)
  const { busy, error, run } = useRoundRequest()
  const moods = draft?.moods ?? storedMoods
  const runtime = draft?.runtime ?? storedRuntime

  const preview = buildBrief(
    isHost ? moods : round.hostMoods, isHost ? round.guestMoods : moods,
    isHost ? runtime : round.hostRuntime, isHost ? round.guestRuntime : runtime,
  )
  async function save() {
    await roomAction('setMood', { roundId, moods, runtime })
    setSaved(true)
  }
  function change(nextMoods: Mood[], nextRuntime: RuntimeLimit) {
    setDraft({ moods: nextMoods, runtime: nextRuntime })
    setSaved(false)
  }

  return (
    <>
      <div className="df-round-heading">
        <h2>What are you in the mood for?</h2>
        <p>Pick the moods and runtime that work for you tonight.</p>
      </div>
      <div className="df-round-grid">
        <section className="df-panel" aria-label="Your preferences">
          <fieldset disabled={busy}>
            <legend>Mood</legend>
            <div className="df-options">
              {(Object.keys(moodChips) as Mood[]).map(mood => (
                <Button key={mood} variant="outline" aria-pressed={moods.includes(mood)}
                  onClick={() => change(moods.includes(mood) ? moods.filter(value => value !== mood) : [...moods, mood], runtime)}>
                  {moodChips[mood].label}
                </Button>
              ))}
            </div>
          </fieldset>
          <fieldset disabled={busy} className="df-runtime">
            <legend>Runtime limit</legend>
            <div className="df-options">
              {runtimes.map(([value, label]) => (
                <Button key={value} variant="outline" aria-pressed={runtime === value}
                  onClick={() => change(moods, value)}>{label}</Button>
              ))}
            </div>
          </fieldset>
          <div className="df-options">
            <Button variant="outline" disabled={busy} onClick={() => run(save)}>Save preferences</Button>
            {saved && <span className="df-ready" role="status">Preferences saved</span>}
          </div>
        </section>
        <section className="df-panel">
          <h3>Tonight’s brief</h3>
          {isHost ? (
            <>
              <Textarea aria-label="Tonight’s brief" maxLength={500} value={brief ?? preview}
                onChange={event => setBrief(event.target.value)} disabled={busy} />
              <p>Edit the brief before voting starts.</p>
              {isDemo && (
                <div>
                  <p>Add sample ratings for the demo partner.</p>
                  <Button variant="outline" disabled={busy || demoLoaded} onClick={() => run(async () => {
                    await roomAction('seedDemoHistory', { roomId })
                    setDemoLoaded(true)
                  })}>Load demo ratings</Button>
                  {demoLoaded && <p role="status">Demo ratings loaded.</p>}
                </div>
              )}
              <Button loading={busy} onClick={() => run(async () => {
                if (draft && !saved) await save()
                await roomAction('startRound', { roomId, brief })
              })}>Start voting</Button>
            </>
          ) : <><p>{preview}</p><p role="status">Waiting for the host to start voting.</p></>}
        </section>
      </div>
      {error && <p role="alert">{error}</p>}
    </>
  )
}

function Voting({ round, roundId, isHost }: { round: Round; roundId: string; isHost: boolean }) {
  const [index, setIndex] = useState(0)
  const [votes, setVotes] = useState<Votes>({})
  const [review, setReview] = useState(false)
  const [justSubmitted, setJustSubmitted] = useState(false)
  const { busy, error, run } = useRoundRequest()
  const submitted = justSubmitted || (isHost ? round.submittedHost : round.submittedGuest)
  const partnerReady = isHost ? round.submittedGuest : round.submittedHost
  const film = round.shortlist[index]
  const complete = validateBallot(votes, round.shortlist)

  useEffect(() => {
    if (submitted || review || !film || round.status !== 'voting') return
    function onKey(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
          (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable]'))) return
      const vote = voteOptions[Number(event.key) - 1]
      if (!/^[1-4]$/.test(event.key) || !vote) return
      event.preventDefault()
      setVotes(current => ({ ...current, [film.id]: vote }))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [film, review, round.status, submitted])

  if (submitted || round.status === 'revealed') return (
    <>
      <div className="df-round-heading">
        <h2>Ballot submitted</h2>
        <p>Your votes are sealed.</p>
      </div>
      <section className="df-panel df-readiness" aria-label="Ballot readiness">
        <div><strong>You</strong><span className="df-ready">Ready</span></div>
        <div><strong>Your partner</strong><span className={partnerReady ? 'df-ready' : ''}>{partnerReady ? 'Ready' : 'Still voting'}</span></div>
      </section>
      <p role="status">{partnerReady ? 'Both ballots are in.' : 'This screen updates when your partner submits.'}</p>
    </>
  )

  if (!film) return <p role="alert">No films are available for this round.</p>

  if (review) return (
    <>
      <div className="df-round-heading">
        <h2>Review your votes</h2>
        <p>You can go back and edit your choices before submitting.</p>
      </div>
      <div className="df-round-grid">
        <ul className="df-ballot-list">
          {round.shortlist.map((entry, position) => (
            <li key={entry.id}>
              <Button variant="outline" disabled={busy}
                onClick={() => { setIndex(position); setReview(false) }}>
                <span>{entry.title}</span><strong>{voteLabels[votes[entry.id]]}</strong>
              </Button>
            </li>
          ))}
        </ul>
        <section className="df-panel">
          <h3>Ready to submit?</h3>
          <p>Your partner only sees that you’re ready.</p>
          <Button loading={busy} disabled={!complete} onClick={() => run(async () => {
            await roomAction('submitBallot', { roundId, votes })
            setJustSubmitted(true)
          })}>Submit ballot</Button>
          <Button variant="outline" disabled={busy} onClick={() => setReview(false)}>Back to voting</Button>
        </section>
      </div>
      {error && <p role="alert">{error}</p>}
    </>
  )

  const last = index === round.shortlist.length - 1
  function next() {
    if (last && complete) setReview(true)
    else if (last) setIndex(round.shortlist.findIndex(entry => !votes[entry.id]))
    else setIndex(index + 1)
  }

  return (
    <>
      <div className="df-progress"><strong>{index + 1} of {round.shortlist.length} films</strong><span>Private vote</span></div>
      {round.inputs?.personalized && <p>Past ratings helped order tonight’s shortlist.</p>}
      {!!round.inputs?.repeatedFilmIds?.length && (
        <p role="status">You’ve seen most of the catalog, so some of these films are repeats.</p>
      )}
      {round.shortlist.length < 3 && (
        <p>{round.shortlist.length === 1 ? '1 film available to vote on.' : '2 films available to vote on.'}</p>
      )}
      {round.inputs?.runtimeLimitIgnored && (
        <p role="status">No films fit your runtime limit, so these are the closest options.</p>
      )}
      <div className="df-round-grid">
        <article className="df-panel df-film">
          <picture>
            <source media="(min-width: 900px)" srcSet="/double-feature/film-art-desktop.svg" />
            <img src="/double-feature/film-art-mobile.svg" alt="" width="310" height="126" />
          </picture>
          <h2>{film.title}</h2>
          <p>{film.year} · {film.runtimeMinutes} min</p>
          <div>{film.hook}</div>
          <p className="capitalize">{film.moods.join(' · ')}</p>
        </article>
        <div className="df-vote-side">
          <section className="df-panel">
            <h3>Would you watch it?</h3>
            <div className="df-vote-options">
              {voteOptions.map(vote => (
                <Button key={vote} variant="outline" aria-pressed={votes[film.id] === vote}
                  onClick={() => setVotes(current => ({ ...current, [film.id]: vote }))}>
                  {voteLabels[vote]}
                </Button>
              ))}
            </div>
            <p className="df-keyboard">Use keys 1–4 to vote.</p>
            <div className="df-vote-options df-card-nav">
              <Button variant="outline" disabled={index === 0} onClick={() => setIndex(index - 1)}>Previous</Button>
              <Button disabled={!votes[film.id]} onClick={next}>
                {last ? complete ? 'Review votes' : 'Next unvoted film' : 'Next film'}
              </Button>
            </div>
          </section>
          <div className="df-panel df-partner" role="status">{partnerReady ? 'Partner is ready' : 'Partner is still voting'}</div>
        </div>
      </div>
    </>
  )
}
