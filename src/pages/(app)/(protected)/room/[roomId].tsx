import { useState } from 'react'
import { useAuth, useQuery } from 'deepspace'
import { Link, useParams } from 'react-router-dom'
import { Button } from '@/components/ui'
import { RoomRound } from '@/components/RoomRound'
import { roomAction } from '@/lib/room-actions'

type Room = { hostId: string; guestId: string; inviteCode: string; status: 'waiting' | 'ready' }

export default function RoomPage() {
  const { roomId = '' } = useParams()
  const { userId } = useAuth()
  const { records, status } = useQuery<Room>('rooms', { where: { recordId: roomId }, limit: 1 })
  const room = records[0]?.data
  const [adding, setAdding] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

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

  async function copyInvite(code: string) {
    setError('')
    try {
      await navigator.clipboard.writeText(new URL(`/join/${code}`, window.location.origin).href)
      setCopied(true)
    } catch {
      setError('Could not copy the link. Share the invite code instead.')
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
            <RoomRound roomId={roomId} isHost={room.hostId === userId}
              partnerLabel={room.guestId === 'bot' ? 'Demo partner' : 'Your partner'} />
          )}
          {room.hostId === userId && room.status === 'waiting' && (
            <>
              <p>Invite code <strong>{room.inviteCode}</strong></p>
              <Button variant="outline" onClick={() => copyInvite(room.inviteCode)}>
                {copied ? 'Link copied' : 'Copy invite link'}
              </Button>
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
