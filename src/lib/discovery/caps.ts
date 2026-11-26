import { fnv1a } from '../finalize'

/**
 * Discovery spends real money on every run (a web search, a model call and a
 * handful of Wikipedia lookups, about two cents), and the platform does not
 * rate-limit paid calls. These limits are ours.
 */
export const dailyLimits = { perUser: 5, global: 25 } as const

/** A finished discovery is reused for the same brief for this long. */
export const cacheMaxAgeMs = 24 * 60 * 60 * 1000

export function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** Which limit a new paid run would break, if any. Counts are of paid runs already made today. */
export function capExceeded(paidByUser: number, paidGlobal: number): 'user' | 'global' | null {
  if (paidByUser >= dailyLimits.perUser) return 'user'
  if (paidGlobal >= dailyLimits.global) return 'global'
  return null
}

/** Same brief, same moods and same runtime limit give the same key, whatever the spacing or case. */
export function discoveryCacheKey(brief: string, moods: readonly string[], maxRuntime: number): string {
  const normalised = [brief.toLowerCase().replace(/\s+/g, ' ').trim(), [...moods].sort().join(','), maxRuntime].join('|')
  return `d${fnv1a(normalised).toString(16)}`
}
