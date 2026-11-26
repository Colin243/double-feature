import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth, useQuery } from 'deepspace'
import { Link, useLocation, useParams } from 'react-router-dom'
import { Button, Input, Label } from '@/components/ui'
import { RoomRound } from '@/components/RoomRound'
import { roomAction } from '@/lib/room-actions'

type Room = { hostId: string; guestId: string; inviteCode: string; status: 'waiting' | 'ready' }

export default function RoomPage() {
  const { roomId = '' } = useParams()
  const location = useLocation()
  const { userId } = useAuth()
  const { records, status } = useQuery<Room>('rooms', { where: { recordId: roomId }, limit: 1 })
  const room = records[0]?.data
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState(() => location.state?.soloSetupFailed
    ? 'Your room is ready. Try adding the demo partner again.'
    : '')

  async function addPartner() {
    if (adding) return
    setAdding(true)
    setError('')
    try {
      await roomAction('addDemoPartner', { roomId })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add a demo partner.')
    } finally {
      setAdding(false)
    }
  }

  return (
    <main className="mx-auto grid w-full max-w-[1200px] gap-5 px-4 py-8 sm:px-8">
      <h1 className="text-3xl font-semibold">Movie night room</h1>
      {status === 'loading' && <p role="status">Loading room…</p>}
      {status === 'error' && <p role="alert">Could not load the room.</p>}
      {status === 'ready' && !room && <p role="status">This room is unavailable to you.</p>}
      {status === 'ready' && room && (
        <>
          <p role="status">{room.guestId === 'bot' ? 'Demo partner joined' : room.status === 'ready' ? 'Both players are here' : 'Waiting for your partner'}</p>
          {room.status === 'ready' && userId && (
            <RoomRound roomId={roomId} isHost={room.hostId === userId} isDemo={room.guestId === 'bot'}
              partnerLabel={room.guestId === 'bot' ? 'Demo partner' : 'Your partner'} />
          )}
          {room.hostId === userId && room.status === 'waiting' && (
            <>
              <p>Invite code <strong>{room.inviteCode}</strong></p>
              <WaitingRoomInvite key={room.inviteCode} code={room.inviteCode} />
              <Button onClick={addPartner} disabled={adding}>
                {adding ? 'Adding…' : 'Play with a demo partner'}
              </Button>
            </>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <Link to="/home">Back to movie night</Link>
    </main>
  )
}

function WaitingRoomInvite({ code }: { code: string }) {
  const input = useRef<HTMLInputElement>(null)
  const [feedback, setFeedback] = useState('')
  const link = new URL(`/join/${encodeURIComponent(code)}`, window.location.origin).href

  async function copyInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      await navigator.clipboard.writeText(link)
      setFeedback('Invite link copied.')
    } catch {
      input.current?.focus()
      input.current?.select()
      setFeedback('Copy the selected link manually.')
    }
  }

  return (
    <form onSubmit={copyInvite} className="grid gap-2">
      <Label htmlFor="room-invite-link">Invite link</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input id="room-invite-link" ref={input} readOnly value={link} onFocus={event => event.currentTarget.select()} />
        <Button type="submit" variant="outline">Copy invite link</Button>
      </div>
      {feedback && <p role="status">{feedback}</p>}
    </form>
  )
}
