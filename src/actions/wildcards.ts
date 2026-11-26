import { RECORD_NOT_FOUND } from 'deepspace/worker'
import type { ActionHandler } from 'deepspace/worker'
import type { Env } from '../../worker'
import type { Votes } from '../lib/ballot'
import type { Film } from '../lib/films'
import { eligibleWildcardFilms, resolveWildcard, sameWildcardFilm } from '../lib/wildcard'
import type { WildcardChoice, WildcardView } from '../lib/wildcard'
import { resultId } from '../schemas/results'

type Seat = 'host' | 'guest'
type Game = {
  picks: Partial<Record<Seat, Film>>
  choices: Partial<Record<Seat, WildcardChoice>>
  result?: NonNullable<ReturnType<typeof resolveWildcard>>
}

function publicGame(game: Game): WildcardView {
  const { picks, choices, result } = game
  if (result) return { phase: 'finished', picks, choices, result }
  if (picks.host && picks.guest) {
    return { phase: 'decision', picks: { host: picks.host, guest: picks.guest }, ready: { host: !!choices.host, guest: !!choices.guest } }
  }
  return { phase: 'nomination', ready: { host: !!picks.host, guest: !!picks.guest } }
}

function invalid() {
  return { success: false, error: 'invalid_input' } as const
}

function wildcardAction(operation: 'read' | 'nominate' | 'choose'): ActionHandler<Env> {
  return async ({ userId, params, tools }) => {
    const { roundId, filmId, manualTitle, year, choice } = params ?? {}
    const expected = operation === 'read' ? 1 : operation === 'nominate' && filmId === undefined ? 3 : 2
    if (typeof roundId !== 'string' || !roundId.trim() || Object.keys(params ?? {}).length !== expected) return invalid()
    if (operation === 'nominate' && filmId !== undefined && (typeof filmId !== 'string' || !filmId.trim())) return invalid()
    if (operation === 'choose' && choice !== 'keep' && choice !== 'risk') return invalid()
    if (operation === 'nominate' && filmId === undefined &&
        (typeof manualTitle !== 'string' || !manualTitle.trim() || manualTitle.trim().length > 120 ||
          typeof year !== 'number' || !Number.isInteger(year) || year < 1888 || year > new Date().getUTCFullYear() + 1)) {
      return invalid()
    }

    const round = await tools.get<{ roomId: string; status: string; shortlist: Film[] }>('rounds', roundId)
    if (!round.success) return { success: false, error: 'round_lookup_failed' }
    const source = round.data.record.data
    const room = await tools.get<{ hostId: string; guestId: string; status: string }>('rooms', source.roomId)
    if (!room.success) return { success: false, error: 'room_lookup_failed' }
    const { hostId, guestId, status } = room.data.record.data
    const seat = userId === hostId ? 'host' : userId === guestId && guestId !== 'bot' ? 'guest' : null
    if (!seat) return { success: false, error: 'not_member' }
    if (status !== 'ready' || source.status !== 'revealed') return { success: false, error: 'wrong_status' }

    const result = await tools.get<{ outcome: string; ballots: { hostVotes: Votes; guestVotes: Votes } }>('results', resultId(roundId))
    if (!result.success) return { success: false, error: 'result_lookup_failed' }
    const { outcome, ballots } = result.data.record.data
    if (outcome !== 'none') return { success: false, error: 'wrong_status' }

    const stored = await tools.get<{ game: Game }>('wildcards', roundId)
    if (!stored.success && stored.error !== RECORD_NOT_FOUND) return { success: false, error: 'wildcard_lookup_failed' }
    const game: Game = stored.success ? stored.data.record.data.game : { picks: {}, choices: {} }
    if (operation === 'read' || game.result) return { success: true, data: publicGame(game) }

    const latest = await tools.query('rounds', {
      where: { roomId: source.roomId }, orderBy: 'number', orderDir: 'desc', limit: 1,
    })
    if (!latest.success) return { success: false, error: 'round_lookup_failed' }
    if (latest.data.records[0]?.recordId !== roundId) return { success: false, error: 'wrong_status' }

    if (operation === 'nominate') {
      if (game.picks[seat]) return { success: true, data: publicGame(game) }
      const eligible = eligibleWildcardFilms(source.shortlist, ballots.hostVotes, ballots.guestVotes)
      const title = typeof manualTitle === 'string' ? manualTitle.trim() : ''
      const film = filmId === undefined && typeof year === 'number'
        ? { id: `manual:${year}:${title.toLowerCase()}`, title, year, runtimeMinutes: 0, moods: [], hook: '' }
        : eligible.find(candidate => candidate.id === filmId)
      if (!film) return invalid()
      const original = source.shortlist.find(candidate => sameWildcardFilm(candidate, film))
      if (original && !eligible.includes(original)) return invalid()
      const nomination = original ?? film
      game.picks[seat] = nomination
      if (guestId === 'bot') game.picks.guest = eligible.find(candidate => !sameWildcardFilm(candidate, nomination)) ?? nomination
    } else {
      if (!game.picks.host || !game.picks.guest) return { success: false, error: 'wrong_status' }
      if (game.choices[seat]) return { success: true, data: publicGame(game) }
      if (choice !== 'keep' && choice !== 'risk') return invalid()
      game.choices[seat] = choice
      if (guestId === 'bot') game.choices.guest = (crypto.getRandomValues(new Uint8Array(1))[0] & 1) ? 'risk' : 'keep'
    }

    const { host, guest } = game.picks
    const decisions = game.choices.host && game.choices.guest
      ? { host: game.choices.host, guest: game.choices.guest }
      : undefined
    if (host && guest) {
      const resolved = resolveWildcard(host, guest, decisions)
      if (resolved) game.result = resolved
    }

    // Commit the choice and any winner in one record write. The shared queue
    // prevents two requests from independently resolving the same game.
    const saved = await tools.create('wildcards', { game }, roundId)
    return saved.success ? { success: true, data: publicGame(game) } : { success: false, error: 'wildcard_save_failed' }
  }
}

export const getWildcard = wildcardAction('read')
export const nominateWildcard = wildcardAction('nominate')
export const chooseWildcard = wildcardAction('choose')
