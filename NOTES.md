# Double Feature: Build Notes

Running log for the DeepSpace build exercise. Deadline: Thu Nov 26, 2026, 11:59 PM ET.
The final writeup is drawn from this file, so keep entries honest and specific.

**Writeup must cover:** what I built, which DeepSpace integrations I used, the main tradeoff, what the agent did, what I verified myself.

---

## Project summary

Double Feature is a two-person movie-night app. Two people join one room, set a shared mood, vote privately on a shortlist, and see the same winning film revealed on both screens. They rate it afterwards, and those ratings shape the next shortlist.

## Scope

**Core (must work on the deployed app)**
1. Create a room and join by invite link (plus a demo-partner button for solo reviewers).
2. Shared mood setup that produces an editable brief.
3. Private voting: Want to watch / Maybe / Pass / Already seen.
4. Server-decided reveal, identical on both screens.
5. 1-5 star rating, used to shape the next shortlist.

**Stretch (only after the core is verified live)**
- Discovery with Exa + model ranking from mood and past ratings
- Emailed invite link
- Two-card wildcard round after a no-match
- Predict-your-partner mini game

**Deliberately out of scope (explain in writeup)**
- More than two people per room, multiple concurrent rounds per room
- Streaming availability, accounts beyond OAuth sign-in

## Key decisions

| Decision | Choice | Why |
|---|---|---|
| Source control | GitHub is the Git authority for the DeepSpace app | The task requires a repo, and DeepSpace locks the choice on the first source-producing action. Never run `deepspace push`. |
| Ballot privacy | `ballots` collection is `read: false` for all roles; only server actions touch it | Actions bypass RBAC, so each action checks room membership itself. |
| Finalize race | `finalizeRound` is a pure function of the two ballots, written to explicit ID `result_<roundId>` with `uniqueOn: ['roundId']` | No transaction API is documented, so racing writers must produce identical data. |
| Readiness flags | Flat fields `submittedHost` / `submittedGuest`, not a nested map | Concurrent updates merge field by field; a nested object could be clobbered. |
| Solo review | Server-side demo-partner bot (`guestId = 'bot'`), not a user account | Guest sign-in isn't available and public signup is closed. |
| Tie-break | Seeded shuffle keyed on round ID | Shortlist order would let the model's #1 pick win every tie. |

## Integration catalog findings (checked with `npx deepspace integrations list`, Sun Nov 22)

No movie-metadata integration exists (no TMDB/IMDb/OMDb). Relevant catalog entries:

| Integration | Endpoint(s) | Use in Double Feature |
|---|---|---|
| `exa` | `search`, `contents`, `answer` | Find candidate films from the brief, with source links |
| `anthropic` (also `openai`) | `chat-completion` | Rank candidates from the brief and past ratings; spoiler-free reasons |
| `youtube` | `search-videos` (returns embed + thumbnail links) | Trailer on the reveal card. Also a poster/thumbnail source. |
| `wikipedia` | `search-pages`, `get-page-summary` | Possible free metadata: year, summary |
| `email` | `send` | Emailed invite link |
| `gemini` / `openai` / `fal` | `generate-image` | Poster art fallback (probably not worth it) |

Notes:
- The `email/send` sender is fixed to `DeepSpace Apps <notifications@updates.app.space>` and any `from` value is ignored; use `reply_to`. **This contradicts the docs summary I was given earlier** (sender must be `<app-name>@app.space`). Trust the CLI listing, and re-check by sending one real test email.
- Third integration candidate: **YouTube trailers** adds more to the reveal than email does. Email stays as a small optional item. Decide on Wednesday.
- Movie metadata plan: skip a raw TMDB call. Use Exa + Wikipedia for facts, YouTube for visuals. Runtime filtering is the weak spot, since neither gives structured runtime reliably. Fall back to the seeded films' runtime data.

## Scaffold findings (Sun Nov 22)

- `npm create deepspace@latest .` scaffolded into this repo (starter template, DeepSpace 0.44.2). The repo's first commit and `origin` (GitHub) were already in place.
- AGENTS.md says source authority latches **from the checkout's remote at the app's first release, permanently**. With a GitHub `origin` the deploy ships the current checkout, including dirty files, and records no commit lineage. So: keep `origin` pointed at GitHub, commit and push before first deploy, and never run `deepspace push`.
- `wrangler.toml` has `DEEPSPACE_APP_ID = "__APP_ID__"` until `npx deepspace app init --json` runs. That id must be committed after it's minted.
- Layout: schemas in `src/schemas.ts` and `src/schemas/`, actions in `src/actions/index.ts`, integrations and billing in `src/integrations.ts`, pages in `src/pages/`, worker in `worker.ts`.
- Test command: `npm test` runs `deepspace test run`.

## Movie data decision

No catalog integration provides movie metadata. Options from general knowledge (verify terms before relying on them): IMDb (paid API, datasets lack posters and hooks, non-commercial licence), TMDB (free key, attribution required, has runtime, posters, where-to-watch), OMDb (free key, daily cap), unofficial IMDb scrapers (don't use).

- **Seed films (Monday):** hand-written in `src/lib/films.ts`. No API, so the demo is deterministic. One-off local script allowed if I want real data; the key stays out of the repo.
- **Discovery (Wednesday):** decide at 9 a.m. Default is Exa + Wikipedia + YouTube, all inside DeepSpace, with runtime filtering best-effort. TMDB through a server action with `deepspace secrets` is a stretch PR only if everything else is done.
- Full details and the PR-by-PR schedule are in `docs/PLAN.md`.

## Open questions
- [x] Is there a catalog integration for movie metadata? No. See findings above.
- [ ] TMDB or stay inside DeepSpace for discovery? Decide Wednesday 9 a.m. (default: stay inside).
- [ ] Which third integration earns its place? Leading candidate: YouTube trailers. The task says no minimum, but the bar box says three.
- [ ] Does `read: false` on a collection still allow actions to read it? Test early.
- [ ] Does the OAuth flow return a guest to the join page after sign-in?

---

## Daily log

Format for each day: **Built**, **Agent did**, **I verified / changed**, **Surprises and bugs**, **Next**.

### Sun Nov 22: Setup
**Built**
- Project folder, public GitHub repo, DeepSpace scaffold committed.
- Plan agreed (see Scope and Key decisions).

**Agent did**
- Read the DeepSpace docs, skill repo and org examples and summarized permissions, server actions, real-time sync, integrations and deploy behavior.
- Proposed the plan and data model above.
- Created this file, the repo and the scaffold. Queried the integration and feature catalogs.

**I verified / changed**
- I signed in to DeepSpace myself (browser OAuth).
- The integration catalog and the CLI output are first-hand. The docs summaries are second-hand and still need confirming with real accounts.
- One docs-summary claim was already wrong (email sender, see above).

**Surprises and bugs**
- Docs summary said the Resend sender must be `<app-name>@app.space`; the live catalog says the sender is fixed and `from` is ignored.
- No movie-metadata integration exists, so my earlier TMDB suggestion is dropped.

**Deployed (Sun Nov 22)**
- `npx deepspace app init --json` registered the app: `app_01M826EAJRSXZ2HE6ANS6RSN2K`. Committed the id in `wrangler.toml` before deploying.
- `npx deepspace deploy` succeeded. Live at https://double-feature.app.space (HTTP 200, edge and data plane confirmed).
- `deepspace app source` now reports `provider: github, repository: colin243/double-feature`. The first release latched GitHub as the source permanently, as planned.
- Release #1 is recorded, with rollback available.
- Still unchecked: sign-in on the live URL. I haven't done this myself yet.
- Observation: the CLI login token expires after about 15 minutes, so long gaps need another `npx deepspace auth login`.

**Next**
- Check sign-in on the live URL in a browser. Then the Monday work: schemas, `joinRoom`, `submitBallot`, three-account privacy test.

**Schemas and seed films (PR #2, `feat/schemas-seed`)**
- Registered the `rooms`, `rounds` and `ballots` collections. Readiness uses two flat boolean fields. Ballots deny client access for every role and have a deterministic record id helper (`ballotId`).
- Added six hand-written seed films with stable `slug-year` ids. Runtimes span 96-155 minutes. I have not independently verified the runtimes (I recall 157 for *Lust, Caution*; sources vary).
- **Review fixes:** the first version let any signed-in user read every room, round and invite code (`member: read: true` is the app-wide role). Changed `rooms` and `rounds` to `read: 'collaborator'` with a `memberIds` column declared as `collaboratorsField`, per the permissions docs. Added `uniqueOn: ['inviteCode']`. Added `roundId`, `userId`, `lockedAt` to `ballots` so actions can query by round. Added `number`, `memberIds`, `inputs` to `rounds` (schemas are additive-only after deploy, so these go in before the first deploy of them).
- `npx tsc --noEmit` and eslint pass. **Not yet verified:** that `'collaborator'` read actually blocks an outsider, and that an action can read `ballots` while a client query cannot. Both need real accounts on the deployed app.

**Rooms and invites (PR #3, `feat/rooms-invite`)**
- Implemented by Codex from the spec in `docs/prs/pr-2-rooms-invite.md`; I reviewed it and applied the small fixes below. Actions `createRoom`, `joinRoom`, `addDemoPartner`; pages for home, `/join/<code>` and the room; unit tests in `src/actions/rooms.test.ts`; end-to-end tests in `tests/rooms.spec.ts`.
- **Design change from my spec:** I specified "re-read after write" to handle two simultaneous joiners. Codex replaced it with a server-only `roomSeatClaims` collection with `uniqueOn: ['roomId']`, so the seat claim itself is atomic. That is better than what I wrote.
- **Verified by running:** `tsc` and eslint pass; 9 unit tests pass; 4 end-to-end tests pass with the Guest, DF Host and DF Outsider test accounts (host creates, guest joins, outsider cannot read the room, third joiner gets `room_full`, two guests race for one seat, guest vs demo partner race, invite resume after sign-in). I repeated the two race tests 3 more times and they passed each time. This answers the earlier open question: `read: 'collaborator'` does block an outsider (locally).
- **Not verified at merge time:** everything above ran against the local dev server. The "resume invite after sign-in" test fakes the return by copying cookies from another session; the real GitHub or Google round trip landing on `/home` is untested.
- **Deployed and re-tested (release #3):** after merging, I deployed `main` and ran the same 4 `tests/rooms.spec.ts` tests against https://double-feature.app.space with a temporary Playwright config (the built-in runner only starts a local server; the temp config was deleted, not committed). All 4 passed. Production logs show the matching calls (4 `createRoom`, 8 `joinRoom`, 1 `addDemoPartner`), so the run did hit production, and no warnings or errors were logged. The run created test rooms in the live data using the three DeepSpace test accounts.
- **Real GitHub sign-in on the live site (checked in the browser pane, Sun Nov 22):** I opened `/join/<code>` signed out, clicked Sign in (the page saved the pending invite in session storage), and the user completed GitHub sign-in by hand. Afterwards the session was signed in, the saved invite was consumed, and the join page plus the `joinRoom` server action ran as the signed-in user (a made-up code correctly returned "room could not be found"). The page's referrer was github.com. **Not conclusively shown:** that the OAuth return redirected to `/join/<code>` on its own, because the final URL held a different code than the one I saved (the user appears to have entered a code by hand afterwards). Treat the automatic resume as likely but unproven; re-test from a clean signed-out state if it matters for the writeup.
- **Known tradeoffs:** if a guest wins the seat claim and the room update then fails, no one else can take the seat (and the host cannot add a demo partner) until that same guest retries. There is no cap on rooms per user and rooms never expire. Both left as is for v1.
- **Review fix applied:** `createRoom` now recognizes an invite-code collision by the `Duplicate:` prefix and the `inviteCode=` field instead of the exact error sentence.

**Moods, rounds and private voting (PR #4, `feat/private-voting`)**
- Implemented by Codex from `docs/prs/pr-3-private-voting.md`; reviewed and hardened by me. Actions `openSetupRound`, `setMood`, `startRound`, `submitBallot`; the `RoomRound` component (mood setup, one-card-at-a-time voting, review, live readiness); mood and ballot helpers; unit and end-to-end tests.
- **Design decision I would not have made on my own:** Codex serializes `setMood`, `startRound` and `submitBallot` in a queue inside the RecordRoom Durable Object, because those actions read then write and the platform has no transaction primitive. That is the main reason ballots cannot be lost or overwritten under races.
- **Review fixes applied:**
  1. The branch carried the pre-squash rooms commits and conflicted with `main` in six files. I merged `main` in (no force-push, to keep Codex's history) and kept `main`'s rooms code.
  2. The Durable Object's internal endpoint trusted the `userId` in its request body, guarded only by a hostname check. The action router now HMAC-signs the body with an app secret and the Durable Object rejects anything unsigned or forged (tests: valid, missing, wrong, reused-for-another-user, empty secret).
  3. `rankSeedFilms` silently falls back to every film when none fit the runtime limit. `startRound` now records `inputs.runtimeLimitIgnored` and the vote screen says so. **With the current six films and the limits 100/120 minutes this cannot trigger yet** (two films run under 100 minutes), so it is covered by a mocked unit test only.
  4. Replaced the `'Record not found'` string literal with the SDK's `RECORD_NOT_FOUND` constant.
  5. Renamed the phone e2e test, which claimed "without exposing votes" but only checked the UI. Ballot privacy itself is for the next PR.
- **Verified by running:** `tsc` and eslint pass; 38 unit tests pass; 6 end-to-end tests pass locally (voting with two accounts, phone-sized demo room, plus the rooms tests), including the voting flow through the signed Durable Object path.
- **Deployed and re-tested (release #4, Sun Nov 22):** after merging I deployed `main` and ran `tests/rooms.spec.ts` and `tests/voting.spec.ts` against https://double-feature.app.space with a temporary Playwright config (deleted, not committed). All 6 passed. The platform accepted the new `uniqueOn: ['roomId', 'number']` on the already-live `rounds` collection (no warnings or errors in production logs, and rounds were created). Production logs show the matching calls, all HTTP 200: 6 `createRoom`, 9 `joinRoom`, 2 `addDemoPartner`, 2 `openSetupRound`, 1 `setMood`, 2 `startRound`, 3 `submitBallot`. This also exercised the signed Durable Object write path in production (`APP_OWNER_JWT` signing worked). A public `POST /internal/round-mutation` returns 404. The first log query undercounted by a lot; log ingestion lagged by under a minute. The run left test rooms and rounds in the live data.
- **Still not verified:** that a client cannot read `ballots` and that an outsider cannot submit, end to end (planned: ballot-privacy PR). Double-submit and bad-ballot rejection are unit-tested only, not exercised live.
- **Known limits:** only round number 1 exists; votes live in React state until submitted, so a refresh mid-vote loses them; a second submit silently keeps the first ballot.

### Mon Nov 23: Rooms and private voting
_(fill in)_

### Tue Nov 24: Reveal and ratings
_(fill in)_

### Wed Nov 25: Discovery and integrations
_(fill in)_

### Thu Nov 26: Polish and submit
_(fill in)_

---

## Verification checklist (tick only what I checked myself)

- [x] Sign-in works on the live URL (real GitHub sign-in completed by the user in the browser pane; test accounts also sign in fine. Google not tried. Automatic invite resume after the OAuth return is unproven, see the rooms entry.)
- [x] Guest joins by link; outsider cannot read the room (4 Playwright tests against the deployed app, release #3, Sun Nov 22)
- [x] A third person cannot join a full room (same run; also two simultaneous joiners and a guest vs demo partner race, one winner each)
- [ ] No account can read another's ballot via API or live subscription
- [x] Readiness updates live on both screens (voting e2e test against the deployed app, release #4)
- [ ] Double submit leaves the first ballot unchanged
- [ ] Fake film ID or missing vote is rejected
- [ ] Solo demo-partner path completes in under a minute
- [ ] Reveal tie-break is deterministic and identical on both screens
- [ ] No-match round handled
- [ ] Simultaneous submits produce exactly one result
- [ ] Rating edit is saved once and changes the next recommendation input
- [ ] Already-seen film never reappears
- [ ] Mobile layout checked on a phone
- [ ] No secrets in the repo or logs

## Agent log: things the agent got wrong or I changed
_(Add entries as they happen: what it produced, what was wrong, what I did instead.)_

- **Schemas, first version:** read access for `rooms` and `rounds` used the app-wide `member` role, which would have exposed every invite code to every signed-in user. Caught in review, fixed with `collaboratorsField` and `'collaborator'` reads.
- **Voting PR, unsafe-by-default internal endpoint:** Codex's Durable Object endpoint for serialized round writes trusted a `userId` in the request body. Caught in review and fixed with a signed request body.
- **Voting PR, over-claiming test name:** an e2e test was titled "without exposing votes" but asserted only UI text. Renamed; real privacy tests come with the next PR.
- **Rooms PR, stale paperwork:** Codex's implementation was correct but left the PR description saying "spec only", added no `NOTES.md` entry, and did not document the new `roomSeatClaims` collection or error codes in `CONTRACTS.md`. Fixed in review.
- **Docs summary, email sender:** a subagent's summary of the docs said the sender must be `<app-name>@app.space`. The live catalog says it is fixed and `from` is ignored. Trust the CLI output.

## Writeup draft
_(Start assembling on Thursday morning from the sections above.)_
