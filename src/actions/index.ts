import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import { addDemoPartner, createRoom, joinRoom } from './rooms'

export const actions: Record<string, ActionHandler<Env>> = { createRoom, joinRoom, addDemoPartner }
