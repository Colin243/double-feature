import type { CollectionSchema } from 'deepspace/schema'

const denied = { read: false, create: false, update: false, delete: false } as const

/**
 * One row per round that asked for discovery: the verified films it found (or
 * why it found none), what it cost, and when. Server-only. The films reach
 * players through the round's shortlist, never through this collection.
 * `attempts` counts every paid run (a retry of a failed round pays again), and
 * the daily limits add those up per person and across the app.
 */
export const discoveriesSchema: CollectionSchema = {
  name: 'discoveries',
  uniqueOn: ['roundId'],
  columns: [
    { name: 'roundId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'roomId', storage: 'text', interpretation: 'plain' },
    { name: 'userId', storage: 'text', interpretation: 'plain' },
    // UTC day, YYYY-MM-DD, for the daily limits.
    { name: 'day', storage: 'text', interpretation: 'plain' },
    { name: 'createdMs', storage: 'number', interpretation: 'plain' },
    // Same brief, moods and runtime limit share a key so a finished run can be reused.
    { name: 'cacheKey', storage: 'text', interpretation: 'plain' },
    // 'running', 'ready' or 'failed'.
    { name: 'status', storage: 'text', interpretation: 'plain' },
    { name: 'attempts', storage: 'number', interpretation: 'plain' },
    { name: 'fromCache', storage: 'number', interpretation: { kind: 'boolean' }, default: false },
    { name: 'failure', storage: 'text', interpretation: 'plain' },
    { name: 'films', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'stats', storage: 'text', interpretation: { kind: 'json' } },
  ],
  permissions: { '*': denied, viewer: denied, member: denied, admin: denied },
}
