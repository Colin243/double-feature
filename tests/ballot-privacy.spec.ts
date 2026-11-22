/**
 * Ballot privacy and concurrency.
 *
 * Needs three DeepSpace test accounts (host, guest, outsider). Every check talks
 * to the app the way a hostile client could: raw WebSocket subscriptions, raw
 * client writes, and direct action calls with a real session token.
 *
 * An empty subscription result only counts as evidence when a control
 * subscription for something the same user may read returns rows, so each
 * "cannot read" assertion is paired with a "can read" control.
 */
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import type { Page } from '@playwright/test'
import { authToken, callAction, clientWrite, liveQuery } from './helpers/privacy'

test.skip(loadAllTestAccounts().length < 3, 'Requires three usable DeepSpace test accounts.')

type Player = { page: Page; token: string }
type Film = { id: string }

async function player(page: Page): Promise<Player> {
  await page.goto('/home')
  return { page, token: await authToken(page) }
}

const act = (who: Player, name: string, params: Record<string, unknown>) =>
  callAction(who.page, who.token, name, params)

/** A host and guest in a ready room whose round is in voting, with its shortlist. */
async function votingRound(host: Player, guest: Player) {
  const created = await act(host, 'createRoom', {})
  const { roomId, inviteCode } = created.body.data as { roomId: string; inviteCode: string }
  expect((await act(guest, 'joinRoom', { code: inviteCode })).body.success).toBe(true)
  const opened = await act(host, 'openSetupRound', { roomId })
  const roundId = (opened.body.data as { roundId: string }).roundId
  expect((await act(host, 'startRound', { roomId })).body.success).toBe(true)

  const rounds = await liveQuery(host.page, host.token, 'rounds')
  const round = rounds.records.find(record => record.recordId === roundId)
  expect(round, 'the host must be able to read their own round (control)').toBeTruthy()
  const shortlist = round!.data.shortlist as Film[]
  expect(shortlist.length).toBeGreaterThan(0)
  return { roomId, roundId, shortlist }
}

const ballotOf = (shortlist: Film[], vote: string) =>
  Object.fromEntries(shortlist.map(film => [film.id, vote]))

test('no account can read ballots, not even its own, even with a live subscription open', async ({ users }) => {
  const [hostUser, guestUser, outsiderUser] = await users(3)
  const [host, guest, outsider] = await Promise.all([player(hostUser.page), player(guestUser.page), player(outsiderUser.page)])
  const { roundId, shortlist } = await votingRound(host, guest)

  // Subscribe first, then submit while the subscriptions are open, so a leak
  // through record_change broadcasts would also show up.
  const watchers = Promise.all([host, guest, outsider].map(who => liveQuery(who.page, who.token, 'ballots', 4000)))
  await new Promise(resolve => setTimeout(resolve, 800))
  const submissions = await Promise.all([
    act(host, 'submitBallot', { roundId, votes: ballotOf(shortlist, 'want') }),
    act(guest, 'submitBallot', { roundId, votes: ballotOf(shortlist, 'maybe') }),
  ])
  expect(submissions.map(result => result.body.success)).toEqual([true, true])

  for (const seen of await watchers) {
    expect(seen.records).toEqual([])
    expect(seen.changes).toEqual([])
  }
  // A fresh subscription after both ballots exist is still empty.
  for (const who of [host, guest, outsider]) {
    expect((await liveQuery(who.page, who.token, 'ballots')).records).toEqual([])
  }
})

test('an outsider cannot read the room or round that members can', async ({ users }) => {
  const [hostUser, guestUser, outsiderUser] = await users(3)
  const [host, guest, outsider] = await Promise.all([player(hostUser.page), player(guestUser.page), player(outsiderUser.page)])
  const { roomId, roundId } = await votingRound(host, guest)

  for (const [collection, id] of [['rooms', roomId], ['rounds', roundId]] as const) {
    for (const member of [host, guest]) {
      const seen = await liveQuery(member.page, member.token, collection)
      expect(seen.records.map(record => record.recordId), `${collection} control for a member`).toContain(id)
    }
    const seen = await liveQuery(outsider.page, outsider.token, collection)
    expect(seen.records.map(record => record.recordId)).not.toContain(id)
  }
})

test('an outsider cannot run any room or round action on someone else’s room', async ({ users }) => {
  const [hostUser, guestUser, outsiderUser] = await users(3)
  const [host, guest, outsider] = await Promise.all([player(hostUser.page), player(guestUser.page), player(outsiderUser.page)])
  const { roomId, roundId, shortlist } = await votingRound(host, guest)

  const attempts: [string, Record<string, unknown>][] = [
    ['submitBallot', { roundId, votes: ballotOf(shortlist, 'want') }],
    ['setMood', { roundId, moods: ['laugh'], runtime: 0 }],
    ['startRound', { roomId }],
    ['openSetupRound', { roomId }],
    ['addDemoPartner', { roomId }],
  ]
  for (const [name, params] of attempts) {
    const { body } = await act(outsider, name, params)
    expect(body.success, `${name} by an outsider`).toBe(false)
    expect(['not_member', 'not_host', 'wrong_status', 'room_full'], `${name} error`).toContain(body.error)
  }
  // The outsider's failed attempts left no mark: the room still has its guest.
  const rooms = await liveQuery(host.page, host.token, 'rooms')
  const room = rooms.records.find(record => record.recordId === roomId)
  expect(room?.data.guestId).not.toBe('')
  expect((room?.data.memberIds as string[]).length).toBe(2)
})

test('only the host can open or start a round', async ({ users }) => {
  const [hostUser, guestUser] = await users(2)
  const [host, guest] = await Promise.all([player(hostUser.page), player(guestUser.page)])
  const created = await act(host, 'createRoom', {})
  const { roomId, inviteCode } = created.body.data as { roomId: string; inviteCode: string }
  await act(guest, 'joinRoom', { code: inviteCode })

  expect((await act(guest, 'openSetupRound', { roomId })).body.error).toBe('not_host')
  const opened = await act(host, 'openSetupRound', { roomId })
  expect(opened.body.success).toBe(true)
  expect((await act(guest, 'startRound', { roomId })).body.error).toBe('not_host')
  expect((await act(guest, 'addDemoPartner', { roomId })).body.error).toBe('not_host')
})

test('one ballot does not publish a reveal result', async ({ users }) => {
  const [hostUser, guestUser] = await users(2)
  const [host, guest] = await Promise.all([player(hostUser.page), player(guestUser.page)])
  const { roundId, shortlist } = await votingRound(host, guest)
  expect((await act(host, 'submitBallot', { roundId, votes: ballotOf(shortlist, 'want') })).body)
    .toEqual({ success: true, data: { submitted: true } })
  expect((await act(host, 'finalizeRound', { roundId })).body)
    .toEqual({ success: false, error: 'ballots_pending' })
  for (const who of [host, guest]) {
    const seen = await liveQuery(who.page, who.token, 'results')
    expect(seen.errors).toEqual([])
    expect(seen.records.some(record => record.data.roundId === roundId)).toBe(false)
  }
})

test('simultaneous ballots publish exactly one shared result', async ({ users }) => {
  const [hostUser, guestUser, outsiderUser] = await users(3)
  const [host, guest, outsider] = await Promise.all([player(hostUser.page), player(guestUser.page), player(outsiderUser.page)])
  const { roundId, shortlist } = await votingRound(host, guest)

  const [fromHost, fromGuest] = await Promise.all([
    act(host, 'submitBallot', { roundId, votes: ballotOf(shortlist, 'want') }),
    act(guest, 'submitBallot', { roundId, votes: ballotOf(shortlist, 'pass') }),
  ])
  expect(fromHost.body).toEqual({ success: true, data: { submitted: true } })
  expect(fromGuest.body).toEqual({ success: true, data: { submitted: true } })

  const sharedResults = []
  for (const who of [host, guest]) {
    const rounds = await liveQuery(who.page, who.token, 'rounds')
    const round = rounds.records.find(record => record.recordId === roundId)
    // A raw socket returns the number-stored flags as 1/0; the app's client turns them into booleans.
    expect(Boolean(round?.data.submittedHost)).toBe(true)
    expect(Boolean(round?.data.submittedGuest)).toBe(true)
    expect(round?.data.status).toBe('revealed')
    const seen = await liveQuery(who.page, who.token, 'results')
    expect(seen.errors).toEqual([])
    const results = seen.records.filter(record => record.data.roundId === roundId)
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      recordId: `result_${roundId}`,
      data: { outcome: 'closest', score: 2, filmId: expect.any(String) },
    })
    sharedResults.push(results[0].data)
  }
  expect(sharedResults[0]).toEqual(sharedResults[1])
  const hidden = await liveQuery(outsider.page, outsider.token, 'results')
  expect(hidden.errors).toEqual([])
  expect(hidden.records.some(record => record.data.roundId === roundId)).toBe(false)
})

test('malformed ballots are rejected without locking the player out', async ({ users }) => {
  const [hostUser, guestUser] = await users(2)
  const [host, guest] = await Promise.all([player(hostUser.page), player(guestUser.page)])
  const { roundId, shortlist } = await votingRound(host, guest)
  const [first, ...rest] = shortlist
  const complete = ballotOf(shortlist, 'want')

  const bad: Record<string, unknown>[] = [
    {},
    Object.fromEntries(rest.map(film => [film.id, 'want'])),
    { ...complete, 'not-a-film-2000': 'want' },
    { ...complete, [first.id]: 'love-it' },
    { ...complete, [first.id]: 5 },
  ]
  for (const votes of bad) {
    const { body } = await act(host, 'submitBallot', { roundId, votes })
    expect(body).toEqual({ success: false, error: 'ballot_invalid' })
  }
  expect((await act(host, 'submitBallot', { roundId, votes: null })).body.success).toBe(false)
  expect((await act(host, 'submitBallot', { roundId, votes: complete, extra: true })).body.error).toBe('invalid_input')

  // Nothing above was recorded, so a valid ballot still goes through.
  const rounds = await liveQuery(host.page, host.token, 'rounds')
  expect(Boolean(rounds.records.find(record => record.recordId === roundId)?.data.submittedHost)).toBe(false)
  expect((await act(host, 'submitBallot', { roundId, votes: complete })).body.success).toBe(true)
})

test('no action response ever contains votes', async ({ users }) => {
  const [hostUser, guestUser] = await users(2)
  const [host, guest] = await Promise.all([player(hostUser.page), player(guestUser.page)])
  const created = await act(host, 'createRoom', {})
  const { roomId, inviteCode } = created.body.data as { roomId: string; inviteCode: string }
  const responses = [created]
  responses.push(await act(guest, 'joinRoom', { code: inviteCode }))
  const opened = await act(host, 'openSetupRound', { roomId })
  responses.push(opened)
  const roundId = (opened.body.data as { roundId: string }).roundId
  responses.push(await act(guest, 'setMood', { roundId, moods: ['laugh'], runtime: 0 }))
  responses.push(await act(host, 'startRound', { roomId }))
  const rounds = await liveQuery(host.page, host.token, 'rounds')
  const shortlist = rounds.records.find(record => record.recordId === roundId)!.data.shortlist as Film[]
  responses.push(await act(host, 'submitBallot', { roundId, votes: ballotOf(shortlist, 'want') }))
  // Submitting twice, and from the other seat, must not echo anything back either.
  responses.push(await act(host, 'submitBallot', { roundId, votes: ballotOf(shortlist, 'pass') }))
  responses.push(await act(guest, 'submitBallot', { roundId, votes: ballotOf(shortlist, 'maybe') }))

  for (const response of responses) {
    expect(response.status).toBe(200)
    expect(response.raw).not.toMatch(/"votes"/)
    for (const film of shortlist) expect(response.raw).not.toContain(film.id)
  }
})

test('a client cannot write rooms, rounds or ballots directly', async ({ users }) => {
  const [hostUser, guestUser] = await users(2)
  const [host, guest] = await Promise.all([player(hostUser.page), player(guestUser.page)])
  const { roomId, roundId } = await votingRound(host, guest)

  const forged = [
    // Forge a ballot for the other player.
    ['ballots', `${roundId}_forged`, { roundId, userId: 'forged', votes: {}, lockedAt: 1 }],
    // Flip the partner's ready flag, take over the guest seat, rewrite the shortlist.
    ['rounds', roundId, { submittedGuest: true }],
    ['rounds', roundId, { shortlist: [] }],
    ['rooms', roomId, { guestId: 'forged-user' }],
    // Claim a seat directly, or create a room without the action.
    ['roomSeatClaims', `${roomId}_claim`, { roomId: 'other', guestId: 'forged' }],
    ['rooms', 'client-made-room', { hostId: 'x', guestId: '', inviteCode: 'ZZZZZZZZ', status: 'waiting', memberIds: ['x'] }],
  ] as const

  for (const who of [host, guest]) {
    for (const [collection, id, data] of forged) {
      const result = await clientWrite(who.page, who.token, collection, id, { ...data })
      expect(result.accepted, `client write to ${collection}`).toBe(false)
      // A timeout is not proof of rejection; require an explicit refusal.
      expect(result.error, `client write to ${collection}`).toBeTruthy()
      expect(result.error).not.toMatch(/no ack/)
    }
  }

  // And nothing changed: flags still false, the shortlist intact, the seat unchanged.
  const rounds = await liveQuery(host.page, host.token, 'rounds')
  const round = rounds.records.find(record => record.recordId === roundId)
  expect(Boolean(round?.data.submittedGuest)).toBe(false)
  expect((round?.data.shortlist as Film[]).length).toBeGreaterThan(0)
  const rooms = await liveQuery(host.page, host.token, 'rooms')
  expect(rooms.records.find(record => record.recordId === roomId)?.data.guestId).not.toBe('forged-user')
  expect(rooms.records.some(record => record.recordId === 'client-made-room')).toBe(false)
})
