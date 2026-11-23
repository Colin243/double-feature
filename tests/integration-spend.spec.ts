/**
 * Paid integrations (Exa, the model, Wikipedia) are called only by server
 * actions, which have their own daily limits. The scaffold also ships a route
 * that lets any signed-in browser call any integration, billed to the app
 * owner, with no limits at all. This app has no use for it, so it must be shut:
 * otherwise anyone with an account could spend the owner's credits.
 */
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import { authToken } from './helpers/privacy'

test.skip(loadAllTestAccounts().length < 1, 'Requires one usable DeepSpace test account.')

const paidCalls: [string, Record<string, unknown>][] = [
  ['wikipedia/search-pages', { query: 'In the Mood for Love 2000 film', limit: 1 }],
  ['exa/search', { query: 'romance films', numResults: 1 }],
  ['anthropic/chat-completion', { model: 'claude-haiku-5-5', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }],
  ['amazon/search-products', { query: 'popcorn' }],
  ['youtube/search-videos', { q: 'Chungking Express official trailer', maxResults: 1 }],
]

for (const [endpoint, body] of paidCalls) {
  test(`a signed-in browser cannot call ${endpoint} and spend the owner's credits`, async ({ users }) => {
    const [user] = await users(1)
    await user.page.goto('/home')
    const token = await authToken(user.page)
    const response = await user.page.request.post(`/api/integrations/${endpoint}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: body,
    })
    expect(response.status()).toBe(403)
    // Nothing from the provider came back.
    const text = await response.text()
    expect(text).not.toContain('"results"')
    expect(text).not.toContain('"content"')
  })
}

test('the integration catalog the api-status page lists is still readable', async ({ users }) => {
  const [user] = await users(1)
  await user.page.goto('/home')
  const token = await authToken(user.page)
  const response = await user.page.request.get('/api/integrations', { headers: { Authorization: `Bearer ${token}` } })
  expect(response.status()).toBe(200)
})
