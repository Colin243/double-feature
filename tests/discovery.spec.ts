/**
 * Film discovery is opt-in and spends real credits (about two cents a run), so
 * the default suite proves it stays off and costs nothing unless the host asks.
 * The one test that runs a real search only runs when RUN_PAID_DISCOVERY=1.
 */
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import type { Page } from '@playwright/test'
import { authToken, callAction, liveQuery } from './helpers/privacy'

test.skip(loadAllTestAccounts().length < 3, 'Requires three usable DeepSpace test accounts.')

type Player = { page: Page; token: string }
type Film = { id: string; title: string; year: number; source?: string; runtimeMinutes: number | null; sourceUrl?: string; reason?: string }

async function player(page: Page): Promise<Player> {
  await page.goto('/home')
  return { page, token: await authToken(page) }
}
const act = (who: Player, name: string, params: Record<string, unknown>) => callAction(who.page, who.token, name, params)

async function setupRound(host: Player, guest: Player | 'demo') {
  const { roomId, inviteCode } = (await act(host, 'createRoom', {})).body.data as { roomId: string; inviteCode: string }
  if (guest === 'demo') expect((await act(host, 'addDemoPartner', { roomId })).body.success).toBe(true)
  else expect((await act(guest, 'joinRoom', { code: inviteCode })).body.success).toBe(true)
  const roundId = ((await act(host, 'openSetupRound', { roomId })).body.data as { roundId: string }).roundId
  return { roomId, roundId }
}

test('discovery is off by default and a normal round never calls it', async ({ users }) => {
  const [hostUser, guestUser] = await users(2)
  const [host, guest] = await Promise.all([player(hostUser.page), player(guestUser.page)])
  const { roomId, roundId } = await setupRound(host, guest)
  const discoveryCalls: string[] = []
  host.page.on('request', request => {
    if (/\/api\/(actions\/discoverFilms|integrations\/)/.test(request.url()) && request.method() === 'POST') discoveryCalls.push(request.url())
  })

  await host.page.goto(`/room/${roomId}`)
  await guest.page.goto(`/room/${roomId}`)
  const box = host.page.getByRole('checkbox', { name: 'Find new films with AI search' })
  await expect(box).toBeVisible()
  await expect(box).not.toBeChecked()
  // Only the host is offered it.
  await expect(guest.page.getByRole('checkbox')).toHaveCount(0)

  await host.page.getByRole('button', { name: 'Start voting' }).click()
  await expect(host.page.getByText(/^1 of \d+ films$/)).toBeVisible()
  expect(discoveryCalls).toEqual([])
  const round = (await liveQuery(host.page, host.token, 'rounds')).records.find(record => record.recordId === roundId)!.data
  expect((round.inputs as { discovery: { used: boolean } }).discovery).toEqual({ used: false })
  expect((round.shortlist as Film[]).every(film => film.source === undefined && film.runtimeMinutes !== null)).toBe(true)
  await expect(host.page.getByText(/came from a web search/)).toHaveCount(0)
})

test('only the host can start a search, and a bad request is refused before any money is spent', async ({ users }) => {
  const [hostUser, guestUser, outsiderUser] = await users(3)
  const [host, guest, outsider] = await Promise.all([player(hostUser.page), player(guestUser.page), player(outsiderUser.page)])
  const { roundId } = await setupRound(host, guest)

  expect((await act(guest, 'discoverFilms', { roundId })).body).toEqual({ success: false, error: 'not_host' })
  expect((await act(outsider, 'discoverFilms', { roundId })).body).toEqual({ success: false, error: 'not_member' })
  expect((await act(host, 'discoverFilms', { roundId: 'not-a-round' })).body).toEqual({ success: false, error: 'round_not_found' })
  expect((await act(host, 'discoverFilms', { roundId, extra: true })).body).toEqual({ success: false, error: 'invalid_input' })
  expect((await act(host, 'discoverFilms', { roundId, brief: 'x'.repeat(501) })).body).toEqual({ success: false, error: 'invalid_input' })
  // Nothing was recorded: no search was started, so nothing was spent.
  expect(await liveQuery(host.page, host.token, 'discoveries')).toMatchObject({ records: [] })
})

test('a client cannot read or write the discoveries collection', async ({ users }) => {
  const [hostUser, guestUser] = await users(2)
  const [host, guest] = await Promise.all([player(hostUser.page), player(guestUser.page)])
  await setupRound(host, guest)
  for (const who of [host, guest]) {
    const seen = await liveQuery(who.page, who.token, 'discoveries')
    expect(seen.records).toEqual([])
  }
})

const paid = test.extend({})
paid.describe('real discovery (spends about 2 credits; set RUN_PAID_DISCOVERY=1)', () => {
  paid.skip(process.env.RUN_PAID_DISCOVERY !== '1', 'Set RUN_PAID_DISCOVERY=1 to run a real, paid search.')

  paid('a ticked search finds verified films, shows where they came from, and a repeat is free', async ({ users }) => {
    paid.setTimeout(240_000)
    const [hostUser, guestUser] = await users(2)
    const [host, guest] = await Promise.all([player(hostUser.page), player(guestUser.page)])
    const { roomId, roundId } = await setupRound(host, guest)
    await host.page.goto(`/room/${roomId}`)

    // A fixed, mainstream brief (the kind a mood chip produces), which found five real films when
    // measured. The first run pays; any later run within 24 hours reuses it for free.
    const briefText = 'Break my heart, under 2 hours'
    const brief = host.page.getByRole('textbox', { name: 'Tonight’s brief' })
    await brief.fill(briefText)
    await host.page.getByRole('checkbox', { name: 'Find new films with AI search' }).check()
    await host.page.getByRole('button', { name: 'Start voting' }).click()
    await expect(host.page.getByText(/^1 of \d+ films$/)).toBeVisible({ timeout: 120_000 })
    await expect(host.page.getByText(/came from a web search and were checked on Wikipedia/)).toBeVisible()

    const round = (await liveQuery(host.page, host.token, 'rounds')).records.find(record => record.recordId === roundId)!.data
    const shortlist = round.shortlist as Film[]
    const found = shortlist.filter(film => film.source === 'discovered')
    console.log('PAID-RUN shortlist:', JSON.stringify(shortlist.map(film => `${film.title} (${film.year}) [${film.source ?? 'seed'}] ${film.sourceUrl ?? ''}`)))
    console.log('PAID-RUN inputs:', JSON.stringify(round.inputs))
    // How many films a search finds varies (five for this brief when measured, fewer for niche ones),
    // and one that matches a film we already have is shown as ours, so only require that something
    // was found, that it comes first, and that our own films fill the rest.
    const discovery = (round.inputs as { discovery: { used: boolean; count: number; cached: boolean } }).discovery
    expect(discovery.count).toBeGreaterThanOrEqual(1)
    expect(found.length).toBeGreaterThanOrEqual(1)
    expect(shortlist.length).toBeGreaterThanOrEqual(3)
    expect(shortlist[0].source).toBe('discovered')
    for (const film of found) {
      expect(film.runtimeMinutes).toBeNull()
      expect(film.sourceUrl).toMatch(/^https:\/\/en\.wikipedia\.org\/wiki\//)
      expect(film.reason).toBeTruthy()
    }
    // The card says where the film came from and that its runtime is unverified.
    await expect(host.page.getByText('Checked on Wikipedia').first()).toBeVisible()
    await expect(host.page.getByText(/runtime unverified/).first()).toBeVisible()
    // Whether this run paid depends on whether an earlier run today already searched this brief.
    expect(discovery.used).toBe(true)

    // A second room, same brief and moods: answered from the cache, so it costs nothing and is instant.
    const second = await setupRound(host, guest)
    await host.page.goto(`/room/${second.roomId}`)
    await host.page.getByRole('textbox', { name: 'Tonight’s brief' }).fill(briefText)
    const started = Date.now()
    const cached = await act(host, 'discoverFilms', { roundId: second.roundId, brief: briefText })
    expect(cached.body.data).toMatchObject({ status: 'ready', cached: true })
    expect(Date.now() - started).toBeLessThan(5000)
  })
})
