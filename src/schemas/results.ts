import type { CollectionSchema } from 'deepspace/schema'

export function resultId(roundId: string): string {
  return `result_${roundId}`
}

export const resultsSchema: CollectionSchema = {
  name: 'results',
  uniqueOn: ['roundId'],
  collaboratorsField: 'memberIds',
  columns: [
    { name: 'roundId', storage: 'text', interpretation: 'plain', required: true },
    { name: 'outcome', storage: 'text', interpretation: 'plain' },
    { name: 'filmId', storage: 'text', interpretation: 'plain' },
    { name: 'score', storage: 'number', interpretation: 'plain' },
    { name: 'reason', storage: 'text', interpretation: 'plain' },
    { name: 'ballots', storage: 'text', interpretation: { kind: 'json' } },
    { name: 'memberIds', storage: 'text', interpretation: { kind: 'json' } },
  ],
  permissions: {
    '*': { read: false, create: false, update: false, delete: false },
    viewer: { read: false, create: false, update: false, delete: false },
    member: { read: 'collaborator', create: false, update: false, delete: false },
    admin: { read: 'collaborator', create: false, update: false, delete: false },
  },
}
