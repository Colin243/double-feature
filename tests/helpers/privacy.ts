import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'

// The app's record scope is `app:<DEEPSPACE_APP_ID>`. The id is not a secret;
// it is committed in wrangler.toml.
const appId = /DEEPSPACE_APP_ID\s*=\s*"([^"]+)"/.exec(
  readFileSync(fileURLToPath(new URL('../../wrangler.toml', import.meta.url)), 'utf8'),
)?.[1]
if (!appId) throw new Error('Could not read DEEPSPACE_APP_ID from wrangler.toml')
export const scope = `app:${appId}`

/** The caller's session token, the same way the app's own client gets it. */
export async function authToken(page: Page): Promise<string> {
  const token = await page.evaluate(async () => {
    const response = await fetch('/api/auth/token', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    })
    const body = await response.json().catch(() => ({})) as { token?: string }
    return body.token ?? ''
  })
  if (!token) throw new Error('Could not get a session token. Is the page signed in?')
  return token
}

export type ActionResult = { success: boolean; error?: string; data?: Record<string, unknown> }

/** POST a server action as the signed-in user. Returns the HTTP status and parsed body. */
export async function callAction(
  page: Page, token: string, name: string, params: Record<string, unknown>,
): Promise<{ status: number; body: ActionResult; raw: string }> {
  return page.evaluate(async ({ name, params, token }) => {
    const response = await fetch(`/api/actions/${name}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    const raw = await response.text()
    let body: ActionResult = { success: false, error: 'unparseable' }
    try { body = JSON.parse(raw) } catch { /* keep the fallback */ }
    return { status: response.status, body, raw }
  }, { name, params, token })
}

export type LiveQuery = {
  records: { recordId: string; data: Record<string, unknown> }[]
  changes: unknown[]
  errors: unknown[]
}

/**
 * Subscribe to a collection the way the app's useQuery does (a raw WebSocket
 * message) and report everything delivered during the window. This is what a
 * malicious client could do, so an empty result is real evidence only when a
 * control subscription for a collection the user may read returns rows.
 */
export async function liveQuery(
  page: Page, token: string, collection: string, windowMs = 2000,
): Promise<LiveQuery> {
  return page.evaluate(({ scope, token, collection, windowMs }) => new Promise<LiveQuery>(resolve => {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${location.host}/ws/${scope}?token=${encodeURIComponent(token)}`)
    const subscriptionId = `probe-${Math.random().toString(36).slice(2)}`
    const out: LiveQuery = { records: [], changes: [], errors: [] }
    ws.onopen = () => ws.send(JSON.stringify({
      type: 'core.subscribe', payload: { subscriptionId, query: { collection } },
    }))
    ws.onmessage = event => {
      let message: { type?: string; payload?: Record<string, unknown> }
      try { message = JSON.parse(String(event.data)) } catch { return }
      const payload = message.payload ?? {}
      if (message.type === 'core.query_result' && payload.subscriptionId === subscriptionId) {
        out.records.push(...((payload.records as LiveQuery['records']) ?? []))
      } else if (message.type === 'core.record_change' && payload.collection === collection) {
        out.changes.push(payload)
      } else if (message.type === 'core.error') {
        out.errors.push(payload)
      }
    }
    ws.onerror = () => out.errors.push({ error: 'socket error' })
    setTimeout(() => { ws.close(); resolve(out) }, windowMs)
  }), { scope, token, collection, windowMs })
}

/** Try to write a record straight from the client, bypassing the app's actions. */
export async function clientWrite(
  page: Page, token: string, collection: string, recordId: string, data: Record<string, unknown>,
): Promise<{ accepted: boolean; error?: string }> {
  return page.evaluate(({ scope, token, collection, recordId, data }) => new Promise<{ accepted: boolean; error?: string }>(resolve => {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const ws = new WebSocket(`${protocol}//${location.host}/ws/${scope}?token=${encodeURIComponent(token)}`)
    const requestId = `probe-${Math.random().toString(36).slice(2)}`
    const done = (result: { accepted: boolean; error?: string }) => { ws.close(); resolve(result) }
    ws.onopen = () => ws.send(JSON.stringify({
      type: 'core.put', payload: { collection, recordId, data, requestId },
    }))
    ws.onmessage = event => {
      let message: { type?: string; payload?: Record<string, unknown> }
      try { message = JSON.parse(String(event.data)) } catch { return }
      const payload = message.payload ?? {}
      if (message.type === 'records.ack' && payload.requestId === requestId) {
        done({ accepted: payload.success === true, error: payload.error as string | undefined })
      } else if (message.type === 'core.error') {
        done({ accepted: false, error: String(payload.error ?? 'core.error') })
      }
    }
    ws.onerror = () => done({ accepted: false, error: 'socket error' })
    setTimeout(() => done({ accepted: false, error: 'no ack (treated as rejected)' }), 4000)
  }), { scope, token, collection, recordId, data })
}

/** Call one of the app's HTTP agent tools as the signed-in user (they run with that user's permissions). */
export async function agentTool(
  page: Page, token: string, name: string, input: Record<string, unknown> = {},
): Promise<{ status: number; body: { ok?: boolean; code?: string; error?: string; result?: { data?: Record<string, unknown> } } }> {
  const response = await page.request.post(`/_deepspace/agent/browser/tools/${name}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { input },
  })
  return { status: response.status(), body: await response.json() }
}

/** The signed-in user's id, as the platform reports it. */
export async function userIdOf(page: Page, token: string): Promise<string> {
  const { status, body } = await agentTool(page, token, 'user_current')
  const id = (body.result?.data?.user as { id?: string } | undefined)?.id
  if (status !== 200 || !id) throw new Error('Could not read the current user id')
  return id
}
