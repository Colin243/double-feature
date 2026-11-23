import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import { addDemoPartner, createRoom, joinRoom } from './rooms'
import { openSetupRound, setMood, startRound } from './rounds'
import { finalizeRoundAction, submitBallot } from './ballots'
import { saveRating, seedDemoHistory } from './ratings'
import { discoverFilms } from './discovery'
import { getTrailer } from './trailers'

export const actions: Record<string, ActionHandler<Env>> = {
  createRoom, joinRoom, addDemoPartner, openSetupRound, setMood, startRound, submitBallot,
  finalizeRound: finalizeRoundAction, saveRating, seedDemoHistory, discoverFilms, getTrailer,
}
