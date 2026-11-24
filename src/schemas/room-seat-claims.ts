import type { CollectionSchema } from 'deepspace/schema'

const denied = { read: false, create: false, update: false, delete: false } as const

export const roomSeatClaimsSchema: CollectionSchema = {
  name: 'roomSeatClaims',
  columns: [
    { name: 'roomId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'guestId', storage: 'text', interpretation: 'plain', required: true },
  ],
  uniqueOn: ['roomId'],
  permissions: { '*': denied, viewer: denied, member: denied, admin: denied },
}
