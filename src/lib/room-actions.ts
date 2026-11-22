import { getAuthToken } from 'deepspace'

type RoomActions = {
  createRoom: { params: Record<string, never>; data: { roomId: string; inviteCode: string } }
  joinRoom: { params: { code: string }; data: { roomId: string } }
  addDemoPartner: { params: { roomId: string }; data: { roomId: string } }
}

const messages: Record<string, string> = {
  invalid_input: 'Check your invite code and try again.',
  own_room: 'You already host this room. Open it from your original room link.',
  room_full: 'This room already has a partner.',
  room_not_found: 'This room could not be found. Check the invite and try again.',
}

export async function roomAction<Name extends keyof RoomActions>(
  name: Name,
  params: RoomActions[Name]['params'],
): Promise<RoomActions[Name]['data']> {
  const token = await getAuthToken()
  if (!token) throw new Error('Sign in to continue.')
  const response = await fetch(`/api/actions/${name}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (response.status === 401) throw new Error('Your session expired. Sign in and try again.')
  if (!response.ok) throw new Error('The room request failed. Try again.')
  const result = await response.json() as
    | { success: true; data: RoomActions[Name]['data'] }
    | { success: false; error: string }
  if (!result.success) throw new Error(messages[result.error] ?? 'The room request failed. Try again.')
  return result.data
}
