# PR 10: Email invite (or TMDB enrichment)

**Branch:** `feat/email-invite` (or `feat/tmdb-enrichment`) · **Depends on:** PR 2 (email) or PR 8 (TMDB) · **Estimate:** 1.5 h (email) · **Day:** Wed Nov 25

Contracts: [CONTRACTS.md](./CONTRACTS.md)

This PR is optional. Pick **one** variant. The default is 10a. Build 10b only if everything through PR 9 is verified and you chose the TMDB option in PR 8's decision.

## 10a: Email invite

### Goal
The host can email the invite link. Copy-link stays the default and must work without email.

### Before coding
```
npx deepspace integrations info email/send
```
The sender is fixed to the platform address and any `from` is ignored. Send one real test email to yourself before writing UI, and log the result in `NOTES.md` (this corrects an earlier docs summary).

### `sendInvite({ roomId, email })`
1. Host only (`not_host`). Room must be `waiting` (`room_full` otherwise).
2. Validate `email` as a single plain address. Reject lists, names with angle brackets, or anything with newlines (`invalid_input`).
3. Cap at 3 invites per room (count in a small field on the room or a counter row). Over the cap: `rate_limited`.
4. Call `email/send` with a short subject, a plain-text and simple HTML body containing the invite link and the host's display name only. **Do not include the host's email address anywhere.** No `reply_to`.
5. Return `{ sent: true }`. Do not echo the address back in logs.

### Tests
- Valid address sends once; invalid and multi-address inputs are rejected.
- Fourth invite is refused.
- Non-host is refused.
- UI works with email forced to fail (copy-link still available).

### Acceptance
- [ ] One real email received and the link in it joins the room
- [ ] No personal address appears in the repo, logs or PR body

## 10b: TMDB enrichment (stretch)

### Goal
Reliable runtime, poster and stable id for discovered films, so the runtime filter and already-seen exclusion are trustworthy.

### Rules
- Verify TMDB's current terms and attribution requirement before building.
- API key only via `npx deepspace secrets set TMDB_API_KEY=...`, read from `env` inside an action. Never in the repo, logs or client.
- One lookup per candidate, after dedupe, inside the PR 8 cap. On any failure keep the candidate unenriched.
- Show the required attribution line wherever TMDB data appears.
- Explain in the writeup why an outside API was added when the task prefers platform integrations.

### Tests
- Enrichment fills runtime and poster; failure leaves the candidate intact.
- Runtime filter now excludes a known over-limit film.
- Key is absent from the client bundle (search the build output).

### Acceptance
- [ ] Attribution visible
- [ ] Secret verified absent from repo and bundle
