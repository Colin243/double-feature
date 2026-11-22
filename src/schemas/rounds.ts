import type { CollectionSchema } from 'deepspace/schema'

export const roundsSchema: CollectionSchema = {
  name: 'rounds',
  columns: [
    { name: 'roomId', storage: 'text', interpretation: { kind: 'reference', targetTable: 'rooms', displayColumn: 'inviteCode' } },
    { name: 'brief', storage: 'text', interpretation: 'plain' },
    { name: 'shortlist', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'hostMoods', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'guestMoods', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'hostRuntime', storage: 'number', interpretation: 'plain' },
    { name: 'guestRuntime', storage: 'number', interpretation: 'plain' },
    { name: 'submittedHost', storage: 'number', interpretation: { kind: 'boolean' }, default: false },
    { name: 'submittedGuest', storage: 'number', interpretation: { kind: 'boolean' }, default: false },
    { name: 'status', storage: 'text', interpretation: 'plain' },
  ],
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: true, create: false, update: false, delete: false },
    admin: { read: true, create: false, update: false, delete: false },
  },
}
