export const reactionLabels = {
  'loved-the-ending': 'Loved the ending',
  'too-slow': 'Too slow',
  'great-chemistry': 'Great chemistry',
} as const

export type ReactionTag = keyof typeof reactionLabels

export type Rating = {
  stars: number
  tags: ReactionTag[]
}

export function ratingId(userId: string, filmId: string): string {
  return `${userId}_${filmId}`
}

export function isReactionTag(value: unknown): value is ReactionTag {
  return typeof value === 'string' && Object.hasOwn(reactionLabels, value)
}
