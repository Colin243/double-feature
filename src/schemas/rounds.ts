import type { CollectionSchema } from 'deepspace/schema'

/**
 * One round of voting inside a room. The shortlist and brief are locked when
 * the round starts. Readiness uses two flat booleans (not a nested map) so two
 * simultaneous submits cannot overwrite each other's flag.
 *
 * Reads are limited to the room's members through `memberIds`, copied from the
 * room when the round is created. Writes go through server actions only.
 */
export const roundsSchema: CollectionSchema = {
  name: 'rounds',
  columns: [
    { name: 'roomId', storage: 'text', interpretation: { kind: 'reference', targetTable: 'rooms', displayColumn: 'inviteCode' } },
    // 1 for the first round in a room, then incrementing.
    { name: 'number', storage: 'number', interpretation: 'plain' },
    { name: 'brief', storage: 'text', interpretation: 'plain' },
    // JSON array of full Film snapshots, not just ids, so the round stays reproducible.
    { name: 'shortlist', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'hostMoods', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'guestMoods', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'hostRuntime', storage: 'number', interpretation: 'plain' },
    { name: 'guestRuntime', storage: 'number', interpretation: 'plain' },
    { name: 'submittedHost', storage: 'number', interpretation: { kind: 'boolean' }, default: false },
    { name: 'submittedGuest', storage: 'number', interpretation: { kind: 'boolean' }, default: false },
    // 'setup', 'voting' or 'revealed'.
    { name: 'status', storage: 'text', interpretation: 'plain' },
    // JSON array of user ids allowed to read this round (copied from the room).
    { name: 'memberIds', storage: 'text', interpretation: { kind: 'json' } },
    // JSON snapshot of what the shortlist was built from (exclusions, ratings used, fallback flag).
    { name: 'inputs', storage: 'text', interpretation: { kind: 'json' } },
  ],
  collaboratorsField: 'memberIds',
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: 'collaborator', create: false, update: false, delete: false },
    admin: { read: 'collaborator', create: false, update: false, delete: false },
  },
}
