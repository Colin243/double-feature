import type { CollectionSchema } from 'deepspace/schema'

/** Supply this as the DeepSpace record ID when writing a ballot. */
export function ballotId(roundId: string, userId: string): string {
  return `${roundId}_${userId}`
}

/**
 * Private votes. No role can read or write this collection from a client, so
 * only server actions touch it (they bypass RBAC and must check membership
 * themselves). `roundId` and `userId` let actions query ballots by round;
 * `lockedAt` is set on submit and means the ballot can no longer change.
 */
export const ballotsSchema: CollectionSchema = {
  name: 'ballots',
  columns: [
    { name: 'roundId', storage: 'text', interpretation: 'plain' },
    { name: 'userId', storage: 'text', interpretation: 'plain' },
    { name: 'votes', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'lockedAt', storage: 'number', interpretation: 'plain' },
  ],
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: false, create: false, update: false, delete: false },
    admin: { read: false, create: false, update: false, delete: false },
  },
}
