/**
 * Integration Billing Config
 *
 * Configure who pays for each integration's API calls.
 *
 * - 'developer': The app owner pays (default).
 * - 'user': The calling user pays.
 *
 * Every integration requires a signed-in caller. Set `anonymous: true` on a
 * 'developer' integration to let signed-out visitors call it too — the owner
 * then pays for anyone who can reach the app.
 *
 * Integrations not listed here default to 'developer' with sign-in required.
 *
 * IMPORTANT: any integration backed by per-user connected accounts (Google,
 * Composio) must be 'user' — the api-worker resolves the account from the
 * JWT subject. With 'developer' the app owner's JWT is forwarded, so every
 * signed-in user connects and acts on the app owner's account. Server code
 * that acts for a user in the background (e.g. a cron job) uses
 * `callComposio(env, ..., { asUser })` from 'deepspace/worker' instead.
 */

export const integrations: Record<
  string,
  { billing: 'developer' | 'user'; anonymous?: boolean }
> = {
  google: { billing: 'user' },
  composio: { billing: 'user' },
  // openai: { billing: 'developer', anonymous: true },

  // Film discovery (src/actions/discovery.ts) calls these from the server. They
  // are billed to the app owner (the free-tier credits), so they are never
  // anonymous, and discovery limits itself per person and per day.
  exa: { billing: 'developer' },
  anthropic: { billing: 'developer' },
  wikipedia: { billing: 'developer' },
}

/**
 * Integrations a signed-in browser may call directly, as "name/endpoint".
 *
 * Empty on purpose. The scaffold's `/api/integrations/:name/:endpoint` route
 * forwards any browser call to any integration, billed to the app owner with no
 * limit, so anyone with an account could spend the owner's credits (tests/
 * integration-spend.spec.ts shows a Wikipedia call going through before this
 * list existed). Every paid call in this app is made by a server action with
 * its own limits instead. Add an entry only for a call that is cheap, harmless
 * and rate-limited some other way.
 */
export const browserCallableIntegrations: ReadonlySet<string> = new Set()
