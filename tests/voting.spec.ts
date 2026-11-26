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
  // With a partner still to vote this shows "Ballot submitted". When this vote
  // completes the round (the demo partner, or the second player) the app goes
  // straight to the result, and whether the sealed screen flashes first is a
  // timing detail, so either screen means the ballot was accepted.
  await expect(
    page.getByRole('heading', { name: 'Ballot submitted' }).or(page.getByTestId('reveal-card')),
  ).toBeVisible()
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

  // How many films fit "Under 100m" depends on what these shared accounts have rated in earlier
  // runs (rated films are left out), so only require that voting started on a shortlist.
  await expect(guest.page.getByText(/^1 of \d+ films$/)).toBeVisible()
  await expect(host.page.getByText(/^1 of \d+ films$/)).toBeVisible()
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
  // Once both ballots are in, both players are taken to the result.
  await expect(host.page.getByTestId('reveal-card')).toBeVisible()
  await expect(guest.page.getByTestId('reveal-card')).toBeVisible()
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
  await expect(page.getByTestId('reveal-card')).toBeVisible()
})
