/**
 * Collection Schemas
 *
 * All collections with columns and RBAC permissions.
 * Single source of truth — imported by both worker and frontend.
 *
 * Add schemas by creating a file in src/schemas/ and importing it here.
 */

import type { CollectionSchema } from 'deepspace/schema'
import { usersSchema } from './schemas/users-schema'
import { settingsSchema } from './schemas/admin-schema'
import { roomsSchema } from './schemas/rooms'
import { roomSeatClaimsSchema } from './schemas/room-seat-claims'
import { roundsSchema } from './schemas/rounds'
import { ballotsSchema } from './schemas/ballots'
import { resultsSchema } from './schemas/results'

export const schemas: CollectionSchema[] = [
  usersSchema,
  settingsSchema,
  roomsSchema,
  roomSeatClaimsSchema,
  roundsSchema,
  ballotsSchema,
  resultsSchema,
]
