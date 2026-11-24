/**
 * The reveal screen. Rounds are set up through the actions (fast and exact),
 * then each player opens the room page as a real browser session and we check
 * what they see.
 */
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import type { Page } from '@playwright/test'
import { fnv1a } from '../src/lib/finalize'
import { authToken, callAction, liveQuery } from './helpers/privacy'

test.skip(loadAllTestAccounts().length < 2, 'Requires two usable DeepSpace test accounts.')

type Player = { page: Page; token: string }
type Film = { id: string; title: string }

async function player(page: Page): Promise<Player> {
  await page.goto('/home')
  return { page, token: await authToken(page) }
}
const act = (who: Player, name: string, params: Record<string, unknown>) =>
  callAction(who.page, who.token, name, params)
const everyFilm = (shortlist: Film[], vote: string) => Object.fromEntries(shortlist.map(film => [film.id, vote]))

/** A room with a host and a guest (or the demo partner) and a round in voting. */
async function votingRound(host: Player, guest: Player | 'demo') {
  const { roomId, inviteCode } = (await act(host, 'createRoom', {})).body.data as { roomId: string; inviteCode: string }
  if (guest === 'demo') expect((await act(host, 'addDemoPartner', { roomId })).body.success).toBe(true)
  else expect((await act(guest, 'joinRoom', { code: inviteCode })).body.success).toBe(true)
  const roundId = ((await act(host, 'openSetupRound', { roomId })).body.data as { roundId: string }).roundId
  expect((await act(host, 'startRound', { roomId })).body.success).toBe(true)
  const rounds = await liveQuery(host.page, host.token, 'rounds')
  const shortlist = rounds.records.find(record => record.recordId === roundId)!.data.shortlist as Film[]
  return { roomId, roundId, shortlist }
}

async function submit(who: Player, roundId: string, shortlist: Film[], vote: string) {
  const { body } = await act(who, 'submitBallot', { roundId, votes: everyFilm(shortlist, vote) })
  expect(body.success).toBe(true)
}

const open = (who: Player, roomId: string) => who.page.goto(`/room/${roomId}`)
const card = (who: Player) => who.page.getByTestId('reveal-card')

test('both players see the same pick, with receipts and a taste-match score', async ({ users }) => {
  const [hostUser, guestUser] = await users(2)
  const [host, guest] = await Promise.all([player(hostUser.page), player(guestUser.page)])
  const { roomId, roundId, shortlist } = await votingRound(host, guest)
  await submit(host, roundId, shortlist, 'want')
  await submit(guest, roundId, shortlist, 'maybe')
  await Promise.all([open(host, roomId), open(guest, roomId)])

  await expect(card(host)).toBeVisible()
  await expect(card(guest)).toBeVisible()
  const [hostFilm, guestFilm] = await Promise.all([card(host), card(guest)].map(c => c.getAttribute('data-film-id')))
  expect(hostFilm).toBeTruthy()
  expect(hostFilm).toBe(guestFilm)
  // Everything ties on score, so the hash rule decides the pick.
  const expected = [...shortlist].sort((a, b) => fnv1a(`${roundId}:${a.id}`) - fnv1a(`${roundId}:${b.id}`))[0].id
  expect(hostFilm).toBe(expected)
  await expect(card(host)).toHaveAttribute('data-outcome', 'match')
  await expect(card(host)).toContainText('One of you wanted to watch it, and the other was open to it.')

  // Receipts: each player sees their own vote under "You".
  for (const [who, mine, theirs] of [[host, 'Want to watch', 'Maybe'], [guest, 'Maybe', 'Want to watch']] as const) {
    await expect(who.page.getByTestId('taste-match')).toHaveText(`0 of ${shortlist.length} agreed`)
    const first = who.page.locator('.df-receipts li').first()
    await expect(first.locator('dd').nth(0)).toHaveText(mine)
    await expect(first.locator('dd').nth(1)).toHaveText(theirs)
  }
  await expect(host.page.locator('.df-receipts li')).toHaveCount(shortlist.length)
})

test('a closest call is labelled as a compromise and says who passed', async ({ users }) => {
  const [hostUser, guestUser] = await users(2)
  const [host, guest] = await Promise.all([player(hostUser.page), player(guestUser.page)])
  const { roomId, roundId, shortlist } = await votingRound(host, guest)
  await submit(host, roundId, shortlist, 'want')
  await submit(guest, roundId, shortlist, 'pass')
  await Promise.all([open(host, roomId), open(guest, roomId)])

  for (const who of [host, guest]) {
    await expect(card(who)).toHaveAttribute('data-outcome', 'closest')
    await expect(who.page.getByText('Not a perfect match, but the nearest thing.')).toBeVisible()
  }
  await expect(card(host)).toContainText('You wanted to watch it and your partner passed.')
  await expect(card(guest)).toContainText('Your partner wanted to watch it and you passed.')
})

test('with no match only the host can start another round, and it opens round two for both', async ({ users }) => {
  const [hostUser, guestUser] = await users(2)
  const [host, guest] = await Promise.all([player(hostUser.page), player(guestUser.page)])
  const { roomId, roundId, shortlist } = await votingRound(host, guest)
  await submit(host, roundId, shortlist, 'pass')
  await submit(guest, roundId, shortlist, 'pass')
  await Promise.all([open(host, roomId), open(guest, roomId)])

  for (const who of [host, guest]) {
    await expect(card(who)).toHaveAttribute('data-outcome', 'none')
    await expect(card(who)).toHaveAttribute('data-film-id', '')
    await expect(who.page.getByRole('heading', { name: 'No match tonight' })).toBeVisible()
  }
  await expect(host.page.getByRole('button', { name: 'Start another round' })).toBeVisible()
  await expect(guest.page.getByRole('button', { name: 'Start another round' })).toHaveCount(0)
  await expect(guest.page.getByText('Waiting for the host to start another round.')).toBeVisible()

  await host.page.getByRole('button', { name: 'Start another round' }).click()
  for (const who of [host, guest]) {
    await expect(who.page.getByRole('heading', { name: 'What are you in the mood for?' })).toBeVisible()
  }
  const rounds = await liveQuery(host.page, host.token, 'rounds')
  const numbers = rounds.records.filter(record => record.data.roomId === roomId).map(record => Number(record.data.number)).sort()
  expect(numbers).toEqual([1, 2])

  // Round two can be started and voted on like the first.
  await host.page.getByRole('button', { name: 'Start voting' }).click()
  for (const who of [host, guest]) await expect(who.page.getByText(/^1 of \d+ films$/)).toBeVisible()
})

test('a player who is already on the page sees the result appear, and a late arrival sees the same card', async ({ users }) => {
  const [hostUser, guestUser] = await users(2)
  const [host, guest] = await Promise.all([player(hostUser.page), player(guestUser.page)])
  const { roomId, roundId, shortlist } = await votingRound(host, guest)
  await submit(host, roundId, shortlist, 'want')
  await open(host, roomId)
  await expect(host.page.getByRole('heading', { name: 'Ballot submitted' })).toBeVisible()
  await expect(card(host)).toHaveCount(0)

  await submit(guest, roundId, shortlist, 'want')
  await expect(card(host)).toBeVisible()
  const live = await card(host).getAttribute('data-film-id')

  await open(guest, roomId)
  await expect(card(guest)).toBeVisible()
  expect(await card(guest).getAttribute('data-film-id')).toBe(live)
  await expect(card(host)).toContainText('You both picked Want to watch.')
})

test('the flip is skipped when the player prefers reduced motion', async ({ users }) => {
  const [hostUser, guestUser] = await users(2)
  const [host, guest] = await Promise.all([player(hostUser.page), player(guestUser.page)])
  await guest.page.emulateMedia({ reducedMotion: 'reduce' })
  await host.page.emulateMedia({ reducedMotion: 'no-preference' })
  const { roomId, roundId, shortlist } = await votingRound(host, guest)
  await submit(host, roundId, shortlist, 'want')
  await submit(guest, roundId, shortlist, 'want')
  await Promise.all([open(host, roomId), open(guest, roomId)])

  await expect(card(host)).toHaveClass(/df-flip/)
  await expect(card(guest)).toBeVisible()
  await expect(card(guest)).not.toHaveClass(/df-flip/)
  // The content is there either way.
  await expect(card(guest)).toContainText('You both picked Want to watch.')
})

test('the reveal fits a 375px phone with no sideways scrolling', async ({ users }) => {
  const [hostUser, guestUser] = await users(2)
  const [host, guest] = await Promise.all([player(hostUser.page), player(guestUser.page)])
  const { roomId, roundId, shortlist } = await votingRound(host, guest)
  await submit(host, roundId, shortlist, 'want')
  await submit(guest, roundId, shortlist, 'maybe')
  await host.page.setViewportSize({ width: 375, height: 812 })
  await open(host, roomId)
  await expect(card(host)).toBeVisible()
  await expect(host.page.locator('.df-receipts li').first()).toBeVisible()

  const overflow = await host.page.evaluate(() => ({
    page: document.documentElement.scrollWidth - window.innerWidth,
    receipts: (() => {
      const list = document.querySelector('.df-receipts') as HTMLElement
      return list.scrollWidth - list.clientWidth
    })(),
  }))
  expect(overflow.page).toBeLessThanOrEqual(0)
  expect(overflow.receipts).toBeLessThanOrEqual(0)
})

test('no votes reach the other player’s browser before the reveal', async ({ users }) => {
  const [hostUser, guestUser] = await users(2)
  const [host, guest] = await Promise.all([player(hostUser.page), player(guestUser.page)])
  const frames: string[] = []
  guest.page.on('websocket', socket => socket.on('framereceived', frame => {
    frames.push(typeof frame.payload === 'string' ? frame.payload : frame.payload.toString())
  }))
  const { roomId, roundId, shortlist } = await votingRound(host, guest)
  await open(guest, roomId)
  await expect(guest.page.getByText(/^1 of \d+ films$/)).toBeVisible()

  await submit(host, roundId, shortlist, 'want')
  await expect(guest.page.getByText('Partner is ready')).toBeVisible()
  // Nothing the guest's browser has received so far contains a vote. The
  // platform does send every browser the schema list, which names the `votes`
  // column of `ballots` without any data, so that one frame type is skipped.
  // Only frames about THIS round count. The platform also pushes a member's other finished rooms
  // to every browser that member has open, so under parallel tests that share an account a frame
  // about someone else's round (one this account is entitled to see) can arrive here.
  const dataFrames = frames.filter(frame => !frame.includes('"type":"records.list_schemas"') && frame.includes(roundId))
  expect(dataFrames.length).toBeGreaterThan(0)
  for (const frame of dataFrames) {
    expect(frame).not.toContain('hostVotes')
    expect(frame).not.toContain('guestVotes')
    expect(frame).not.toContain('"votes"')
  }

  await submit(guest, roundId, shortlist, 'want')
  await expect(card(guest)).toBeVisible()
  // After the reveal the receipts arrive, because the result row now exists.
  await expect.poll(() => frames.some(frame => frame.includes('hostVotes'))).toBe(true)
})

test('a solo demo room reveals as soon as the host votes, and names the demo partner', async ({ users }) => {
  const [hostUser] = await users(1)
  const host = await player(hostUser.page)
  const { roomId, roundId, shortlist } = await votingRound(host, 'demo')
  await submit(host, roundId, shortlist, 'want')
  await open(host, roomId)

  await expect(card(host)).toBeVisible()
  await expect(host.page.getByRole('heading', { name: 'The receipts' })).toBeVisible()
  await expect(host.page.locator('.df-receipts li').first().locator('dt').nth(1)).toHaveText('Demo partner')
})

test('a browser belonging to someone outside the room receives nothing about it, even just sitting on the home page', async ({ users }) => {
  const [hostUser, guestUser, outsiderUser] = await users(3)
  const [host, guest, outsider] = await Promise.all([player(hostUser.page), player(guestUser.page), player(outsiderUser.page)])
  const heard: string[] = []
  outsider.page.on('websocket', socket => socket.on('framereceived', frame => {
    heard.push(typeof frame.payload === 'string' ? frame.payload : frame.payload.toString())
  }))
  // Reload so the outsider's socket opens after the listener is attached.
  await outsider.page.reload()
  await outsider.page.waitForTimeout(1000)

  const { roomId, roundId, shortlist } = await votingRound(host, guest)
  await submit(host, roundId, shortlist, 'want')
  await submit(guest, roundId, shortlist, 'want')
  await open(host, roomId)
  await expect(card(host)).toBeVisible()
  await outsider.page.waitForTimeout(2500)

  // Nothing about the room, its round, its result or its votes reached the outsider's browser.
  expect(heard.filter(frame => frame.includes(roundId))).toEqual([])
  expect(heard.filter(frame => /hostVotes|guestVotes/.test(frame))).toEqual([])
  expect(heard.length).toBeGreaterThan(0) // the socket was open and receiving, so silence means something
})

test('Keep or Risk reveals one winner to both players after no match', async ({ users }) => {
  const [hostUser, guestUser] = await users(2)
  const [host, guest] = await Promise.all([player(hostUser.page), player(guestUser.page)])
  const { roomId, roundId, shortlist } = await votingRound(host, guest)
  await submit(host, roundId, shortlist, 'pass')
  await submit(guest, roundId, shortlist, 'pass')
  await Promise.all([open(host, roomId), open(guest, roomId)])

  for (const [who, film] of [[host, shortlist[0]], [guest, shortlist[1]]] as const) {
    await who.page.getByRole('button', { name: 'Play Keep or Risk' }).click()
    await who.page.getByLabel('Nominate a film').selectOption(film.id)
    await who.page.getByRole('button', { name: 'Lock nomination' }).click()
  }

  await host.page.getByRole('button', { name: 'Risk', exact: true }).click()
  await expect(host.page.getByText(/Choice locked/)).toBeVisible()
  await guest.page.getByRole('button', { name: 'Keep', exact: true }).click()

  for (const who of [host, guest]) {
    const game = who.page.getByRole('region', { name: 'Keep or Risk' })
    await expect(game.getByText('Tonight’s pick')).toBeVisible()
    await expect(game.getByRole('heading', { name: shortlist[0].title })).toBeVisible()
  }

  await host.page.reload()
  await host.page.getByRole('button', { name: 'Play Keep or Risk' }).click()
  await expect(host.page.getByRole('region', { name: 'Keep or Risk' }).getByRole('heading', { name: shortlist[0].title })).toBeVisible()
})
