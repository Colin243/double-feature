import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import type { Page } from '@playwright/test'

test.skip(loadAllTestAccounts().length < 2, 'Requires two usable DeepSpace test accounts.')

async function createRoom(page: Page) {
  await page.goto('/home')
  await page.getByRole('button', { name: 'Create a room' }).click()
  await expect(page).toHaveURL(/\/room\/[^/]+$/)
  return page.getByText(/^[A-HJ-NP-Z2-9]{8}$/).innerText()
}

async function chooseAllFilms(page: Page, choice: 'Want to watch' | 'Maybe') {
  const progress = page.getByText(/^1 of [1-6] films$/)
  await expect(progress).toBeVisible()
  const count = Number((await progress.innerText()).split(' ')[2])
  for (let film = 0; film < count; film++) {
    await page.getByRole('button', { name: choice, exact: true }).click()
    await page.getByRole('button', { name: film === count - 1 ? 'Review votes' : 'Next film', exact: true }).click()
  }
  await expect(page.getByRole('heading', { name: 'Review your votes' })).toBeVisible()
}

async function submit(page: Page) {
  const responsePromise = page.waitForResponse(response =>
    response.url().endsWith('/api/actions/submitBallot') && response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Submit ballot', exact: true }).click()
  const response = await responsePromise
  expect(response.ok()).toBe(true)
  expect(await response.json()).toEqual({ success: true, data: { submitted: true } })
  await expect(page.getByRole('heading', { name: 'Ballot submitted' })).toBeVisible()
}

test('desktop players save preferences, vote privately, and see live readiness', async ({ users }) => {
  const [host, guest] = await users(2)
  await host.page.setViewportSize({ width: 1280, height: 900 })
  const code = await createRoom(host.page)
  await guest.page.goto(`/join/${code}`)
  await guest.page.getByRole('button', { name: 'Join room', exact: true }).click()
  await host.page.getByRole('button', { name: 'Set up voting' }).click()

  await guest.page.getByRole('button', { name: 'Make me laugh' }).click()
  await guest.page.getByRole('button', { name: 'Under 100m' }).click()
  await guest.page.getByRole('button', { name: 'Save preferences' }).click()
  await expect(guest.page.getByText('Preferences saved')).toBeVisible()
  await expect(host.page.getByRole('textbox', { name: 'Tonight’s brief' }))
    .toHaveValue('Make me laugh, under 100 minutes')
  await host.page.getByRole('textbox', { name: 'Tonight’s brief' }).fill('A short movie night')
  await host.page.getByRole('button', { name: 'Start voting' }).click()

  await expect(guest.page.getByText('1 of 2 films')).toBeVisible()
  await expect(host.page.getByText('1 of 2 films')).toBeVisible()
  await expect(host.page.locator('.df-round-grid')).toHaveCSS('grid-template-columns', /px .*px/)
  await host.page.keyboard.press('1')
  await expect(host.page.getByRole('button', { name: 'Want to watch', exact: true }))
    .toHaveAttribute('aria-pressed', 'true')
  await chooseAllFilms(host.page, 'Want to watch')
  await submit(host.page)

  await expect(guest.page.getByText('Partner is ready')).toBeVisible()
  await expect(guest.page.getByRole('button', { name: 'Want to watch', exact: true }))
    .toHaveAttribute('aria-pressed', 'false')
  await chooseAllFilms(guest.page, 'Maybe')
  await submit(guest.page)
  await expect(host.page.getByText('Both ballots are in.')).toBeVisible()
  await expect(guest.page.getByText('Both ballots are in.')).toBeVisible()
})

// Ballot privacy itself (clients cannot read `ballots`, outsiders cannot submit)
// is covered by the ballot-privacy tests, not here. This one checks the phone
// layout and that a solo demo room reaches "both ballots in".
test('a phone-sized demo room reaches both ballots in', async ({ users }) => {
  const [host] = await users(1)
  const { page } = host
  await page.setViewportSize({ width: 390, height: 844 })
  await createRoom(page)
  await page.getByRole('button', { name: 'Play with a demo partner' }).click()
  await page.getByRole('button', { name: 'Set up voting' }).click()
  await page.getByRole('button', { name: 'Start voting' }).click()
  await expect(page.locator('.df-round-grid')).toHaveCSS('grid-template-columns', /^\d+(\.\d+)?px$/)
  await chooseAllFilms(page, 'Want to watch')
  await submit(page)
  await expect(page.getByText('Both ballots are in.')).toBeVisible()
})
