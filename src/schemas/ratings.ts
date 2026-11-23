import type { CollectionSchema } from 'deepspace/schema'

const denied = { read: false, create: false, update: false, delete: false } as const
const ownerRead = { ...denied, read: 'own' } as const

export const ratingsSchema: CollectionSchema = {
  name: 'ratings',
  ownerField: 'userId',
  columns: [
    { name: 'userId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'filmId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'roomId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'stars', storage: 'number', interpretation: 'plain', required: true },
    { name: 'tags', storage: 'text', interpretation: { kind: 'json' } },
  ],
  permissions: { '*': denied, viewer: denied, member: ownerRead, admin: ownerRead },
}
