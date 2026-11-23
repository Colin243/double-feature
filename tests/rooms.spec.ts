import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import type { Page } from '@playwright/test'

test.skip(loadAllTestAccounts().length < 3, 'Requires three usable DeepSpace test accounts.')

const roomRoute = /\/room\/[^/]+$/
const ready = 'Both players are here'
const full = 'This room already has a partner.'

async function createRoom(page: Page) {
  await page.goto('/home')
  await page.getByRole('button', { name: 'Create a room' }).click()
  await expect(page).toHaveURL(roomRoute)
  await expect(page.getByText('Waiting for your partner')).toBeVisible()
  const code = await page.getByText(/^[A-HJ-NP-Z2-9]{8}$/).innerText()
  return { code, url: page.url() }
}

async function openInvite(page: Page, code: string) {
  await page.goto(`/join/${code}`)
  await expect(page.getByRole('button', { name: 'Join room' })).toBeEnabled()
}

async function submit(page: Page, action: 'joinRoom' | 'addDemoPartner', button: string) {
  const [response] = await Promise.all([
    page.waitForResponse(response =>
      response.url().endsWith(`/api/actions/${action}`) && response.request().method() === 'POST',
    ),
    page.getByRole('button', { name: button }).click(),
  ])
  expect(response.ok()).toBe(true)
  return await response.json() as { success: boolean; error?: string }
}

test('host creates a room, guest joins by code, and outsider cannot read it', async ({ users, page }) => {
  const [host, guest, outsider] = await users(3)
  const { code, url } = await createRoom(host.page)

  await page.goto(`/join/${code}`)
  await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible()

  await outsider.page.goto(url)
  await expect(outsider.page.getByText('This room is unavailable to you.')).toBeVisible()

  await openInvite(host.page, code)
  await host.page.getByRole('button', { name: 'Join room' }).click()
  await expect(host.page.getByRole('alert')).toContainText('You already host this room')
  await host.page.goto(url)

  await guest.page.goto('/home')
  await guest.page.getByLabel('Join with an invite code').fill(code.toLowerCase())
  await guest.page.getByRole('button', { name: 'Continue' }).click()
  await guest.page.getByRole('button', { name: 'Join room' }).click()
  await expect(guest.page).toHaveURL(url)
  await expect(guest.page.getByText(ready)).toBeVisible()
  await expect(host.page.getByText(ready)).toBeVisible()

  await openInvite(guest.page, code)
  await guest.page.getByRole('button', { name: 'Join room' }).click()
  await expect(guest.page).toHaveURL(url)

  await openInvite(outsider.page, code)
  await outsider.page.getByRole('button', { name: 'Join room' }).click()
  await expect(outsider.page.getByRole('alert')).toHaveText(full)
})

test('two guests competing for one seat get one success and one room_full', async ({ users }) => {
  const [host, first, second] = await users(3)
  const { code, url } = await createRoom(host.page)
  await Promise.all([openInvite(first.page, code), openInvite(second.page, code)])

  const results = await Promise.all([
    submit(first.page, 'joinRoom', 'Join room'),
    submit(second.page, 'joinRoom', 'Join room'),
  ])
  expect(results.filter(result => result.success)).toHaveLength(1)
  expect(results.filter(result => !result.success)).toEqual([{ success: false, error: 'room_full' }])

  const [winner, loser] = results[0].success ? [first, second] : [second, first]
  await expect(winner.page).toHaveURL(url)
  await expect(winner.page.getByText(ready)).toBeVisible()
  await expect(loser.page.getByRole('alert')).toHaveText(full)
  await loser.page.goto(url)
  await expect(loser.page.getByText('This room is unavailable to you.')).toBeVisible()
})

test('a guest and the demo partner compete for the same seat', async ({ users }) => {
  const [host, guest] = await users(2)
  const { code, url } = await createRoom(host.page)
  await openInvite(guest.page, code)

  // Dispatch both while the room is still waiting. Once a real guest joins,
  // the live room update can hide the demo button before the other click.
  await host.page.route('**/api/actions/addDemoPartner', async route => {
    await guest.page.getByRole('button', { name: 'Join room' }).click()
    await route.continue()
  })
  const guestResponse = guest.page.waitForResponse(response =>
    response.url().endsWith('/api/actions/joinRoom') && response.request().method() === 'POST',
  )
  const [demo, response] = await Promise.all([
    submit(host.page, 'addDemoPartner', 'Play with a demo partner'),
    guestResponse,
  ])
  expect(response.ok()).toBe(true)
  const joined = await response.json() as { success: boolean; error?: string }
  expect([demo, joined].filter(result => result.success)).toHaveLength(1)
  expect((demo.success ? joined : demo).error).toBe('room_full')
  await expect(host.page.getByText(demo.success ? 'Demo partner joined' : ready)).toBeVisible()
  if (joined.success) await expect(guest.page).toHaveURL(url)
  else await expect(guest.page.getByRole('alert')).toHaveText(full)
})

test('returning to Home after sign-in resumes the pending invite in the same tab', async ({ users, page }) => {
  const [host, guest] = await users(2)
  const { code, url } = await createRoom(host.page)
  await page.goto(`/join/${code}`)

  const signInPanel = page.getByRole('heading', { name: 'Sign in to continue' }).locator('..')
  await signInPanel.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByTestId('auth-overlay')).toBeVisible()

  // Model the app-side callback landing with a real signed-in fixture session.
  // The external social provider round trip is checked separately.
  const cookies = await guest.page.context().cookies(url)
  expect(cookies.length).toBeGreaterThan(0)
  await page.context().addCookies(cookies)
  await page.goto('/home')

  await expect(page).toHaveURL(new URL(`/join/${code}`, url).href)
  await page.getByRole('button', { name: 'Join room' }).click()
  await expect(page).toHaveURL(url)
  await expect(page.getByText(ready)).toBeVisible()

  // The pending invite should have been consumed once.
  await page.goto('/home')
  await expect(page.getByRole('button', { name: 'Create a room' })).toBeVisible()
  await expect(page).toHaveURL(new URL('/home', url).href)
})
