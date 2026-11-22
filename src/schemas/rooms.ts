import type { CollectionSchema } from 'deepspace/schema'

/**
 * A room holds the host, at most one guest, and the invite code.
 *
 * Every write goes through a server action (actions bypass RBAC, so each one
 * checks membership itself). Clients only read, and only rooms they belong to:
 * `member` is the app-wide role, so `read: true` would let any signed-in user
 * read every room and every invite code. `'collaborator'` limits reads to the
 * owner or a userId listed in `memberIds`.
 */
export const roomsSchema: CollectionSchema = {
  name: 'rooms',
  columns: [
    { name: 'hostId', storage: 'text', interpretation: 'plain' },
    // '' while waiting, a user id once joined, or the 'bot' sentinel for the demo partner.
    { name: 'guestId', storage: 'text', interpretation: 'plain' },
    { name: 'inviteCode', storage: 'text', interpretation: 'plain' },
    // 'waiting' (no guest yet) or 'ready'.
    { name: 'status', storage: 'text', interpretation: 'plain' },
    // JSON array of user ids allowed to read this room. The bot is never listed.
    { name: 'memberIds', storage: 'text', interpretation: { kind: 'json' } },
  ],
  uniqueOn: ['inviteCode'],
  collaboratorsField: 'memberIds',
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: 'collaborator', create: false, update: false, delete: false },
    admin: { read: 'collaborator', create: false, update: false, delete: false },
  },
}
