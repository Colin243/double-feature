import type { CollectionSchema } from 'deepspace/schema'

/** Supply this as the DeepSpace record ID when writing a ballot. */
export function ballotId(roundId: string, userId: string): string {
  return `${roundId}_${userId}`
}

export const ballotsSchema: CollectionSchema = {
  name: 'ballots',
  columns: [
    { name: 'votes', storage: 'text', interpretation: { kind: 'json' } },
  ],
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: false, create: false, update: false, delete: false },
    admin: { read: false, create: false, update: false, delete: false },
  },
}
