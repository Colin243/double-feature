import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { AuthOverlay, useAuth } from 'deepspace'
import { Button, Input } from '@/components/ui'
import { normalizeInviteCode, pendingInviteKey } from '@/lib/invite-code'
import { roomAction } from '@/lib/room-actions'

export default function HomePage() {
  const { isLoaded, isSignedIn } = useAuth()
  const navigate = useNavigate()
  const [showAuth, setShowAuth] = useState(false)
  const [code, setCode] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  // The SDK's social sign-in callback returns to /home.
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return
    const pending = window.sessionStorage.getItem(pendingInviteKey)
    if (!pending) return
    window.sessionStorage.removeItem(pendingInviteKey)
    const invite = normalizeInviteCode(pending)
    if (invite) navigate(`/join/${invite}`, { replace: true })
  }, [isLoaded, isSignedIn, navigate])

  async function create(solo = false) {
    if (creating) return
    setCreating(true)
    setError('')
    try {
      const { roomId } = await roomAction('createRoom', {})
      const roomUrl = `/room/${encodeURIComponent(roomId)}`
      if (solo) {
        try {
          await roomAction('addDemoPartner', { roomId })
        } catch {
          navigate(roomUrl, { state: { soloSetupFailed: true } })
          return
        }
      }
      navigate(roomUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create a room.')
    } finally {
      setCreating(false)
    }
  }

  function join(event: FormEvent) {
    event.preventDefault()
    const invite = normalizeInviteCode(code)
    if (!invite) {
      setError('Enter a valid eight-character invite code.')
      return
    }
    navigate(`/join/${invite}`)
  }

  return (
    <main className="mx-auto grid w-full max-w-lg gap-6 px-6 py-16">
      <h1 className="text-3xl font-semibold">Movie night</h1>
      <p>Choose a movie together with private votes and a shared reveal.</p>
      {!isLoaded && <p role="status">Loading movie night…</p>}
      {isLoaded && (isSignedIn
        ? <div className="flex flex-wrap gap-3">
            <Button loading={creating} onClick={() => create()}>Create a room</Button>
            <Button disabled={creating} variant="outline" onClick={() => create(true)}>Try it solo</Button>
          </div>
        : <Button onClick={() => setShowAuth(true)}>Sign in to create a room</Button>)}
      <form onSubmit={join} className="grid gap-3">
        <label htmlFor="invite-code">Join with an invite code</label>
        <Input id="invite-code" value={code} onChange={event => setCode(event.target.value)}
          autoCapitalize="characters" autoComplete="off" required />
        <Button type="submit" variant="outline">Continue</Button>
      </form>
      {error && <p role="alert">{error}</p>}
      {showAuth && <AuthOverlay onClose={() => setShowAuth(false)} />}
    </main>
  )
}
