import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui'
import { normalizeInviteCode, pendingInviteKey } from '@/lib/invite-code'
import { roomAction } from '@/lib/room-actions'

export default function JoinRoomPage() {
  const { code: input = '' } = useParams()
  const code = normalizeInviteCode(input)
  const navigate = useNavigate()
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    window.sessionStorage.removeItem(pendingInviteKey)
  }, [])

  async function join() {
    if (!code || joining) return
    setJoining(true)
    setError('')
    try {
      const { roomId } = await roomAction('joinRoom', { code })
      navigate(`/room/${encodeURIComponent(roomId)}`, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join the room.')
    } finally {
      setJoining(false)
    }
  }

  return (
    <main className="mx-auto grid w-full max-w-lg gap-5 px-6 py-16">
      <h1 className="text-3xl font-semibold">Join movie night</h1>
      {code
        ? <Button onClick={join} disabled={joining}>{joining ? 'Joining…' : 'Join room'}</Button>
        : <p role="alert">This invite code is invalid.</p>}
      {error && <p role="alert">{error}</p>}
      <Link to="/home">Back to movie night</Link>
    </main>
  )
}
