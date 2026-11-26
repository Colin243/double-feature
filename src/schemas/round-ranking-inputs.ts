import type { CollectionSchema } from 'deepspace/schema'

const denied = { read: false, create: false, update: false, delete: false } as const

export const roundRankingInputsSchema: CollectionSchema = {
  name: 'roundRankingInputs',
  columns: [
    { name: 'snapshot', storage: 'text', interpretation: { kind: 'json' }, required: true },
  ],
  permissions: { '*': denied, viewer: denied, member: denied, admin: denied },
}
