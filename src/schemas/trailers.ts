import type { CollectionSchema } from 'deepspace/schema'

const denied = { read: false, create: false, update: false, delete: false } as const

export const trailersSchema: CollectionSchema = {
  name: 'trailers',
  columns: [
    { name: 'videoId', storage: 'text', interpretation: 'plain' },
    { name: 'title', storage: 'text', interpretation: 'plain' },
  ],
  permissions: { '*': denied, viewer: denied, member: denied, admin: denied },
}
