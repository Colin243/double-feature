import { RECORD_NOT_FOUND } from 'deepspace/worker'
import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import type { Film } from '../lib/films'
import { isYouTubeVideoId, pickTrailer, trailerLimits, trailerQuery, utcDay } from '../lib/trailer'
import type { Trailer, YouTubeVideo } from '../lib/trailer'
import { pinnedTrailers } from '../lib/trailer-pins'
import { resultId } from '../schemas/results'

export const getTrailer: ActionHandler<Env> = async ({ userId, params, tools }) => {
  if (typeof params?.roundId !== 'string' || !params.roundId.trim() ||
      typeof params.filmId !== 'string' || !params.filmId.trim() || Object.keys(params).length !== 2) {
    return { success: false, error: 'invalid_input' }
  }
  const { roundId, filmId } = params
  const round = await tools.get<{ memberIds: string[]; status: string; shortlist: Film[] }>('rounds', roundId)
  if (!round.success) return { success: false, error: 'round_lookup_failed' }
  const { memberIds, status, shortlist } = round.data.record.data
  if (!memberIds?.includes(userId)) return { success: false, error: 'not_member' }
  if (status !== 'revealed') return { success: false, error: 'wrong_status' }

  const result = await tools.get<{ filmId?: string }>('results', resultId(roundId))
  if (!result.success) return { success: false, error: 'result_lookup_failed' }
  const film = shortlist?.find(candidate => candidate.id === filmId)
  if (!film || result.data.record.data.filmId !== filmId) return { success: false, error: 'invalid_input' }

  // The six films we ship have hand-picked trailers: free, and never the wrong film.
  const pinned = Object.hasOwn(pinnedTrailers, filmId) ? pinnedTrailers[filmId] : undefined
  if (pinned) return { success: true, data: { trailer: pinned } }

  const cached = await tools.get<Trailer>('trailers', filmId)
  if (cached.success) {
    const { videoId, title } = cached.data.record.data
    return { success: true, data: { trailer: isYouTubeVideoId(videoId) ? { videoId, title } : null } }
  }
  if (cached.error !== RECORD_NOT_FOUND) return { success: false, error: 'trailer_unavailable' }

  // A fresh search costs real money, so it is limited per person and per day.
  const now = Date.now()
  const day = utcDay(now)
  const today = await tools.query<{ userId?: string }>('trailers', { where: { day }, limit: 500 })
  if (!today.success) return { success: false, error: 'trailer_unavailable' }
  const searchesToday = today.data.records.map(record => record.data)
  const mine = searchesToday.filter(entry => entry.userId === userId).length
  if (mine >= trailerLimits.perUser || searchesToday.length >= trailerLimits.global) {
    return { success: false, error: 'rate_limited' }
  }

  // Provider failures remain retryable. An empty successful search is cached.
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const found = await Promise.race([
      tools.integration<{ videos?: YouTubeVideo[] }>('youtube/search-videos', { q: trailerQuery(film), maxResults: 5 }),
      new Promise<undefined>(resolve => { timer = setTimeout(resolve, 10000) }),
    ])
    if (!found?.success || !Array.isArray(found.data?.videos)) {
      return { success: false, error: 'trailer_unavailable' }
    }
    const trailer = pickTrailer(found.data.videos, film)
    const saved = await tools.create('trailers', { ...(trailer ?? { videoId: '', title: '' }), userId, day, createdMs: now }, filmId)
    return saved.success ? { success: true, data: { trailer } } : { success: false, error: 'trailer_unavailable' }
  } catch {
    return { success: false, error: 'trailer_unavailable' }
  } finally {
    clearTimeout(timer)
  }
}
