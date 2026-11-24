/**
 * Trailers. The six films we ship have hand-picked trailers (src/lib/trailer-pins.ts), so the
 * whole path is free and can run in the default suite. A search for a film that is not pinned
 * costs about 1.3 credits and is covered by unit tests and a manual check instead.
 */
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import type { Page } from '@playwright/test'
import { pinnedTrailers } from '../src/lib/trailer-pins'
import { authToken, callAction, liveQuery } from './helpers/privacy'

test.skip(loadAllTestAccounts().length < 3, 'Requires three usable DeepSpace test accounts.')

type Player = { page: Page; token: string }
type Film = { id: string }

async function player(page: Page): Promise<Player> {
  await page.goto('/home')
  return { page, token: await authToken(page) }
}
const act = (who: Player, name: string, params: Record<string, unknown>) => callAction(who.page, who.token, name, params)

async function playRound(host: Player, guest: Player, finish = true) {
  const { roomId, inviteCode } = (await act(host, 'createRoom', {})).body.data as { roomId: string; inviteCode: string }
  await act(guest, 'joinRoom', { code: inviteCode })
  const roundId = ((await act(host, 'openSetupRound', { roomId })).body.data as { roundId: string }).roundId
  await act(host, 'startRound', { roomId })
  const rounds = await liveQuery(host.page, host.token, 'rounds', 1200)
  const shortlist = rounds.records.find(record => record.recordId === roundId)!.data.shortlist as Film[]
  if (!finish) return { roomId, roundId, shortlist, pickId: '' }
  const votes = Object.fromEntries(shortlist.map(film => [film.id, 'want']))
  await Promise.all([act(host, 'submitBallot', { roundId, votes }), act(guest, 'submitBallot', { roundId, votes })])
  const results = await liveQuery(host.page, host.token, 'results', 1200)
  const pickId = results.records.find(record => record.data.roundId === roundId)!.data.filmId as string
  return { roomId, roundId, shortlist, pickId }
}

test('a member gets the hand-picked trailer for the pick, free, and the screen says which video it is', async ({ users }) => {
  const [hostUser, guestUser] = await users(2)
  const [host, guest] = await Promise.all([player(hostUser.page), player(guestUser.page)])
  const { roomId, roundId, pickId } = await playRound(host, guest)
  const pinned = pinnedTrailers[pickId]
  expect(pinned, `the pick ${pickId} should be one of the six pinned films`).toBeTruthy()

  // Both members get the same pinned trailer from the action.
  for (const who of [host, guest]) {
    expect((await act(who, 'getTrailer', { roundId, filmId: pickId })).body).toEqual({ success: true, data: { trailer: pinned } })
  }

  // On the reveal screen nothing loads until the button is pressed.
  await host.page.goto(`/room/${roomId}`)
  const panel = host.page.getByRole('region', { name: 'Trailer' })
  await expect(panel).toBeVisible()
  await expect(panel.locator('iframe')).toHaveCount(0)
  await panel.getByRole('button', { name: 'Watch trailer' }).click()

  const frame = panel.locator('iframe')
  await expect(frame).toHaveAttribute('src', `https://www.youtube-nocookie.com/embed/${pinned.videoId}?autoplay=0`)
  await expect(frame).toHaveAttribute('title', pinned.title)
  await expect(panel.getByText(`Showing: ${pinned.title}`)).toBeVisible()
  await expect(panel.getByRole('link', { name: 'Watch on YouTube' }))
    .toHaveAttribute('href', `https://www.youtube.com/watch?v=${pinned.videoId}`)
})

test('the trailer action refuses anyone who should not have it, before any search', async ({ users }) => {
  const [hostUser, guestUser, outsiderUser] = await users(3)
  const [host, guest, outsider] = await Promise.all([player(hostUser.page), player(guestUser.page), player(outsiderUser.page)])

  // A round still in voting: nothing has been picked, so no trailer.
  const early = await playRound(host, guest, false)
  expect((await act(host, 'getTrailer', { roundId: early.roundId, filmId: early.shortlist[0].id })).body)
    .toEqual({ success: false, error: 'wrong_status' })

  const { roundId, shortlist, pickId } = await playRound(host, guest)
  const notPicked = shortlist.find(film => film.id !== pickId)!.id
  expect((await act(outsider, 'getTrailer', { roundId, filmId: pickId })).body).toEqual({ success: false, error: 'not_member' })
  expect((await act(host, 'getTrailer', { roundId, filmId: notPicked })).body).toEqual({ success: false, error: 'invalid_input' })
  expect((await act(host, 'getTrailer', { roundId, filmId: pickId, extra: 1 })).body).toEqual({ success: false, error: 'invalid_input' })
  expect((await act(host, 'getTrailer', { roundId, filmId: '' })).body).toEqual({ success: false, error: 'invalid_input' })
  expect((await act(host, 'getTrailer', { roundId: 'not-a-round', filmId: pickId })).body.success).toBe(false)
})

test('the trailers collection cannot be read by any client, and a pinned film writes nothing to it', async ({ users }) => {
  const [hostUser, guestUser] = await users(2)
  const [host, guest] = await Promise.all([player(hostUser.page), player(guestUser.page)])
  const { roundId, pickId } = await playRound(host, guest)
  await act(host, 'getTrailer', { roundId, filmId: pickId })
  for (const who of [host, guest]) {
    expect((await liveQuery(who.page, who.token, 'trailers')).records).toEqual([])
  }
})
