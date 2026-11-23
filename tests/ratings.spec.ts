/**
 * Ratings: private to the person who gave them, editable, and used (without
 * ever being shown) to shape the next round.
 *
 * The test accounts are shared and ratings cannot be deleted, so these tests
 * only assert things that hold no matter how many ratings an account already
 * has from earlier runs.
 */
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import type { Page } from '@playwright/test'
import { agentTool, authToken, callAction, clientWrite, liveQuery, userIdOf } from './helpers/privacy'

test.skip(loadAllTestAccounts().length < 3, 'Requires three usable DeepSpace test accounts.')

type Player = { page: Page; token: string; id: string }
type Film = { id: string; title: string }

async function player(page: Page): Promise<Player> {
  await page.goto('/home')
  const token = await authToken(page)
  return { page, token, id: await userIdOf(page, token) }
}
const act = (who: Player, name: string, params: Record<string, unknown>) => callAction(who.page, who.token, name, params)
const everyFilm = (shortlist: Film[], vote: string) => Object.fromEntries(shortlist.map(film => [film.id, vote]))

/** A host and guest, one finished round (everyone wants everything), and the film that was picked. */
async function revealedRound(host: Player, guest: Player) {
  const { roomId, inviteCode } = (await act(host, 'createRoom', {})).body.data as { roomId: string; inviteCode: string }
  expect((await act(guest, 'joinRoom', { code: inviteCode })).body.success).toBe(true)
  const roundId = ((await act(host, 'openSetupRound', { roomId })).body.data as { roundId: string }).roundId
  expect((await act(host, 'startRound', { roomId })).body.success).toBe(true)
  const rounds = await liveQuery(host.page, host.token, 'rounds')
  const shortlist = rounds.records.find(record => record.recordId === roundId)!.data.shortlist as Film[]
  await Promise.all([
    act(host, 'submitBallot', { roundId, votes: everyFilm(shortlist, 'want') }),
    act(guest, 'submitBallot', { roundId, votes: everyFilm(shortlist, 'want') }),
  ])
  const results = await liveQuery(host.page, host.token, 'results')
  const filmId = results.records.find(record => record.data.roundId === roundId)!.data.filmId as string
  expect(filmId).toBeTruthy()
  return { roomId, roundId, filmId, shortlist }
}

const ratingsFor = async (who: Player, filmId: string) =>
  (await liveQuery(who.page, who.token, 'ratings')).records.filter(record => record.data.filmId === filmId)

test('each player rates the pick, sees only their own rating, and an edit replaces it', async ({ users }) => {
  const [hostUser, guestUser, outsiderUser] = await users(3)
  const [host, guest, outsider] = await Promise.all([player(hostUser.page), player(guestUser.page), player(outsiderUser.page)])
  const { roomId, roundId, filmId } = await revealedRound(host, guest)

  expect((await act(host, 'saveRating', { roomId, roundId, filmId, stars: 5, tags: ['great-chemistry'] })).body)
    .toEqual({ success: true, data: { saved: true } })
  expect((await act(guest, 'saveRating', { roomId, roundId, filmId, stars: 2, tags: ['too-slow', 'too-slow'] })).body.success).toBe(true)

  // Each player reads exactly their own rating of this film, and nobody else's.
  for (const [who, stars, tags] of [[host, 5, ['great-chemistry']], [guest, 2, ['too-slow']]] as const) {
    const own = await ratingsFor(who, filmId)
    expect(own).toHaveLength(1)
    expect(own[0].data).toMatchObject({ userId: who.id, filmId, stars, tags })
  }
  // An outsider cannot read either rating, by socket or by the HTTP tools.
  const seenByOutsider = await ratingsFor(outsider, filmId)
  expect(seenByOutsider.filter(record => [host.id, guest.id].includes(record.data.userId as string))).toEqual([])
  for (const owner of [host, guest]) {
    const listed = await agentTool(outsider.page, outsider.token, 'records_query', { collection: 'ratings', where: { filmId } })
    expect(listed.status).toBe(200)
    const rows = (listed.body.result?.data?.records ?? []) as { data: { userId: string } }[]
    expect(rows.filter(row => row.data.userId === owner.id)).toEqual([])
    const direct = await agentTool(outsider.page, outsider.token, 'records_get', { collection: 'ratings', recordId: `${owner.id}_${filmId}` })
    expect(direct.status).not.toBe(200)
  }
  // The partner cannot read it through the HTTP tools either.
  const partnerView = await agentTool(guest.page, guest.token, 'records_get', { collection: 'ratings', recordId: `${host.id}_${filmId}` })
  expect(partnerView.status).not.toBe(200)

  // Editing replaces the rating instead of adding a second one.
  expect((await act(host, 'saveRating', { roomId, roundId, filmId, stars: 1, tags: [] })).body.success).toBe(true)
  const edited = await ratingsFor(host, filmId)
  expect(edited).toHaveLength(1)
  expect(edited[0].data).toMatchObject({ stars: 1, tags: [] })
})

test('only the pick of a finished round in your own room can be rated, with valid input', async ({ users }) => {
  const [hostUser, guestUser, outsiderUser] = await users(3)
  const [host, guest, outsider] = await Promise.all([player(hostUser.page), player(guestUser.page), player(outsiderUser.page)])
  const { roomId, roundId, filmId, shortlist } = await revealedRound(host, guest)
  const other = shortlist.find(film => film.id !== filmId)!.id
  const before = await ratingsFor(host, other)

  const good = { roomId, roundId, filmId, stars: 4, tags: [] as string[] }
  for (const [label, params] of [
    ['stars 0', { ...good, stars: 0 }], ['stars 6', { ...good, stars: 6 }], ['stars 2.5', { ...good, stars: 2.5 }],
    ['stars as text', { ...good, stars: '5' }], ['unknown tag', { ...good, tags: ['loved-it'] }],
    ['tags not a list', { ...good, tags: 'too-slow' }], ['extra field', { ...good, userId: 'someone-else' }],
    ['a film that was not picked', { ...good, filmId: other }], ['a made-up film', { ...good, filmId: 'not-a-film-1999' }],
    ['a round from another room', { ...good, roundId: 'not-a-round' }],
  ] as const) {
    const { body } = await act(host, 'saveRating', params)
    expect(body, label).toEqual({ success: false, error: 'invalid_input' })
  }
  expect((await act(outsider, 'saveRating', good)).body).toEqual({ success: false, error: 'not_member' })
  // Nothing above was saved: the host's rating of that other film is exactly what it was.
  expect(await ratingsFor(host, other)).toEqual(before)
})

test('a client cannot write ratings directly', async ({ users }) => {
  const [hostUser, guestUser] = await users(2)
  const [host, guest] = await Promise.all([player(hostUser.page), player(guestUser.page)])
  const { filmId } = await revealedRound(host, guest)
  const before = await Promise.all([host, guest].map(who => ratingsFor(who, filmId)))
  for (const who of [host, guest]) {
    const result = await clientWrite(who.page, who.token, 'ratings', `${who.id}_${filmId}`, {
      userId: who.id, roomId: 'x', filmId, stars: 5, tags: [],
    })
    expect(result.accepted).toBe(false)
    expect(result.error).toBeTruthy()
    expect(result.error).not.toMatch(/no ack/)
  }
  // Nothing changed, whatever ratings these accounts already had from earlier runs.
  expect(await Promise.all([host, guest].map(who => ratingsFor(who, filmId)))).toEqual(before)
})

test('the next round always starts, and any rated film that comes back is flagged as a repeat', async ({ users }) => {
  const [hostUser, guestUser] = await users(2)
  const [host, guest] = await Promise.all([player(hostUser.page), player(guestUser.page)])
  const { roomId, roundId, filmId } = await revealedRound(host, guest)
  expect((await act(host, 'saveRating', { roomId, roundId, filmId, stars: 5, tags: ['great-chemistry'] })).body.success).toBe(true)

  const second = await act(host, 'openSetupRound', { roomId })
  const nextId = (second.body.data as { roundId: string }).roundId
  expect(nextId).not.toBe(roundId)
  expect((await act(host, 'startRound', { roomId })).body.success).toBe(true)

  const rounds = await liveQuery(host.page, host.token, 'rounds')
  const next = rounds.records.find(record => record.recordId === nextId)!.data
  const shortlist = (next.shortlist as Film[]).map(film => film.id)
  const inputs = next.inputs as { skippedFilmIds: string[]; repeatedFilmIds: string[] }
  expect(shortlist.length).toBeGreaterThanOrEqual(3)
  expect(inputs.skippedFilmIds).toContain(filmId)
  // Every film the host has rated (this run or an earlier one) is either left out or marked as a repeat.
  const rated = (await liveQuery(host.page, host.token, 'ratings')).records.map(record => record.data.filmId as string)
  for (const id of shortlist.filter(film => rated.includes(film))) expect(inputs.repeatedFilmIds).toContain(id)
  // The ratings themselves never appear on the round, which both players can read.
  expect(JSON.stringify(next)).not.toContain('great-chemistry')
})

test('the reveal screen lets a player rate the pick, remembers it after a reload, and offers another night', async ({ users }) => {
  const [hostUser, guestUser] = await users(2)
  const [host, guest] = await Promise.all([player(hostUser.page), player(guestUser.page)])
  const { roomId, filmId } = await revealedRound(host, guest)
  await Promise.all([host.page.goto(`/room/${roomId}`), guest.page.goto(`/room/${roomId}`)])

  const panel = host.page.getByRole('region', { name: 'Your rating' })
  await expect(panel).toBeVisible()
  // This account may already have rated this film in an earlier run, in which case the
  // panel starts filled in. Make the tag selected without relying on its starting state.
  await expect(panel.getByRole('button', { name: '4 stars' })).toBeVisible()
  await panel.getByRole('button', { name: '4 stars' }).click()
  const tag = panel.getByRole('button', { name: 'Great chemistry' })
  if ((await tag.getAttribute('aria-pressed')) !== 'true') await tag.click()
  await panel.getByRole('button', { name: 'Save rating' }).click()
  await expect(panel.getByText('Rating saved.')).toBeVisible()

  await host.page.reload()
  const again = host.page.getByRole('region', { name: 'Your rating' })
  await expect(again.getByRole('button', { name: '4 stars' })).toHaveAttribute('aria-pressed', 'true')
  await expect(again.getByRole('button', { name: 'Great chemistry' })).toHaveAttribute('aria-pressed', 'true')
  await expect(again.getByRole('button', { name: '5 stars' })).toHaveAttribute('aria-pressed', 'false')

  // The partner's panel shows the partner's own rating (whatever it is), never the host's.
  const theirs = (await ratingsFor(guest, filmId))[0]?.data as { stars?: number; tags?: string[] } | undefined
  const partner = guest.page.getByRole('region', { name: 'Your rating' })
  await expect(partner.getByRole('button', { name: '4 stars' })).toHaveAttribute('aria-pressed', String(theirs?.stars === 4))
  await expect(partner.getByRole('button', { name: 'Great chemistry' }))
    .toHaveAttribute('aria-pressed', String(Boolean(theirs?.tags?.includes('great-chemistry'))))

  await expect(host.page.getByRole('button', { name: 'Start another round' })).toBeVisible()
  await expect(guest.page.getByText('Waiting for the host to start another round.')).toBeVisible()
})

test('demo ratings are only for a demo room and only for the demo partner', async ({ users }) => {
  const [hostUser, guestUser] = await users(2)
  const [host, guest] = await Promise.all([player(hostUser.page), player(guestUser.page)])
  // A room with a real guest cannot load demo ratings.
  const real = await act(host, 'createRoom', {})
  const realRoom = (real.body.data as { roomId: string; inviteCode: string })
  await act(guest, 'joinRoom', { code: realRoom.inviteCode })
  expect((await act(host, 'seedDemoHistory', { roomId: realRoom.roomId })).body).toEqual({ success: false, error: 'not_demo_room' })

  // A demo room: only the host can, and it adds nothing for the human.
  const { roomId } = (await act(host, 'createRoom', {})).body.data as { roomId: string }
  expect((await act(host, 'addDemoPartner', { roomId })).body.success).toBe(true)
  expect((await act(guest, 'seedDemoHistory', { roomId })).body.success).toBe(false)
  const before = (await liveQuery(host.page, host.token, 'ratings')).records.length
  await host.page.goto(`/room/${roomId}`)
  await host.page.getByRole('button', { name: 'Set up voting' }).click()
  await host.page.getByRole('button', { name: 'Load demo ratings' }).click()
  await expect(host.page.getByText('Demo ratings loaded.')).toBeVisible()
  expect((await liveQuery(host.page, host.token, 'ratings')).records.length).toBe(before)

  await host.page.getByRole('button', { name: 'Start voting' }).click()
  await expect(host.page.getByText(/^1 of \d+ films$/)).toBeVisible()
  const rounds = await liveQuery(host.page, host.token, 'rounds')
  const round = rounds.records.find(record => record.data.roomId === roomId)!.data
  const inputs = round.inputs as { repeatedFilmIds: string[] }
  const ids = (round.shortlist as Film[]).map(film => film.id)
  // The demo partner rated these two, so they are out unless the catalog ran short.
  for (const rated of ['chungking-express-1994', 'lust-caution-2007']) {
    if (ids.includes(rated)) expect(inputs.repeatedFilmIds).toContain(rated)
  }
})
