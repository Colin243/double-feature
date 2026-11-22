import { describe, expect, it } from 'vitest'
import type { CollectionSchema } from 'deepspace/schema'
import { schemas } from '../schemas'
import { ballotsSchema } from './ballots'
import { roomSeatClaimsSchema } from './room-seat-claims'
import { roomsSchema } from './rooms'
import { roundsSchema } from './rounds'

const roles = ['*', 'viewer', 'member', 'admin'] as const
const denied = { read: false, create: false, update: false, delete: false }

describe('game collections are server-written and privately read', () => {
  it('lets no role, admin included, read or write ballots or seat claims', () => {
    for (const schema of [ballotsSchema, roomSeatClaimsSchema]) {
      for (const role of roles) expect(schema.permissions[role], `${schema.name} ${role}`).toEqual(denied)
    }
  })

  it('lets no role write rooms or rounds from a client', () => {
    for (const schema of [roomsSchema, roundsSchema]) {
      for (const role of roles) {
        const { create, update, delete: remove } = schema.permissions[role]
        expect({ create, update, remove }, `${schema.name} ${role}`).toEqual({ create: false, update: false, remove: false })
      }
    }
  })

  it('limits room and round reads to the room’s members', () => {
    for (const schema of [roomsSchema, roundsSchema]) {
      expect(schema.collaboratorsField).toBe('memberIds')
      expect(schema.permissions['*'].read).toBe(false)
      expect(schema.permissions.viewer.read).toBe(false)
      expect(schema.permissions.member.read).toBe('collaborator')
      // Admins are not exempt: they read only rooms they belong to.
      expect(schema.permissions.admin.read).toBe('collaborator')
    }
  })

  it('registers every game collection', () => {
    const registered = new Set(schemas.map((schema: CollectionSchema) => schema.name))
    for (const name of ['rooms', 'rounds', 'ballots', 'roomSeatClaims']) expect(registered.has(name)).toBe(true)
  })
})
