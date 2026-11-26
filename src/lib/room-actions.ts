import { getAuthToken } from 'deepspace'
import type { Votes } from './ballot'
import type { Mood, RuntimeLimit } from './moods'
import type { Rating } from './rating'
import type { Trailer } from './trailer'

import type { WildcardChoice, WildcardView } from './wildcard'

export type DiscoverResult =
  | { status: 'ready'; count: number; cached: boolean }
  | { status: 'fallback'; reason: string }
  | { status: 'busy' }

type RoomActions = {
  discoverFilms: { params: { roundId: string; brief?: string }; data: DiscoverResult }
  getWildcard: { params: { roundId: string }; data: WildcardView }
  nominateWildcard: { params: { roundId: string } & ({ filmId: string } | { manualTitle: string; year: number }); data: WildcardView }
  chooseWildcard: { params: { roundId: string; choice: WildcardChoice }; data: WildcardView }
  getTrailer: { params: { roundId: string; filmId: string }; data: { trailer: Trailer | null } }
  seedDemoHistory: { params: { roomId: string }; data: { saved: true } }
  saveRating: { params: { roomId: string; filmId: string; roundId?: string } & Rating; data: { saved: true } }
  openSetupRound: { params: { roomId: string }; data: { roundId: string } }
  setMood: { params: { roundId: string; moods: Mood[]; runtime: RuntimeLimit }; data: { saved: true } }
  startRound: { params: { roomId: string; brief?: string }; data: { roundId: string } }
  submitBallot: { params: { roundId: string; votes: Votes }; data: { submitted: true } }
  createRoom: { params: Record<string, never>; data: { roomId: string; inviteCode: string } }
  joinRoom: { params: { code: string }; data: { roomId: string } }
  addDemoPartner: { params: { roomId: string }; data: { roomId: string } }
}

const messages: Record<string, string> = {
  rate_limited: 'The film search has reached its limit for today.',
  invalid_input: 'Check your input and try again.',
  wrong_status: 'This round has moved on.',
  ballot_invalid: 'Choose one vote for every film before submitting.',
  not_member: 'This round is unavailable to you.',
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
