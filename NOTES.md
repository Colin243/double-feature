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
- **Deployed and re-tested (release #4, Sun Nov 22):** after merging I deployed `main` and ran `tests/rooms.spec.ts` and `tests/voting.spec.ts` against https://double-feature.app.space with a temporary Playwright config (deleted, not committed). All 6 passed. The platform accepted the new `uniqueOn: ['roomId', 'number']` on the already-live `rounds` collection (no warnings or errors in production logs, and rounds were created). Production logs show the matching calls, all HTTP 200: 6 `createRoom`, 9 `joinRoom`, 2 `addDemoPartner`, 2 `openSetupRound`, 1 `setMood`, 2 `startRound`, 3 `submitBallot`. This also exercised the signed Durable Object write path in production (`APP_OWNER_JWT` signing worked). A public `POST /internal/round-mutation` returns 404. The first log query undercounted by a lot. I first put that down to log ingestion lag, but see the release #6 entry: the log fetch is capped at the newest 500 events, which is the more likely cause. The run left test rooms and rounds in the live data.
- **Still not verified:** that a client cannot read `ballots` and that an outsider cannot submit, end to end (planned: ballot-privacy PR). Double-submit and bad-ballot rejection are unit-tested only, not exercised live.
- **Known limits:** only round number 1 exists; votes live in React state until submitted, so a refresh mid-vote loses them; a second submit silently keeps the first ballot.

**Ballot privacy and concurrency tests (PR #5, `test/ballot-privacy`)**
- Built by me (the draft PR was spec-only). `tests/ballot-privacy.spec.ts` plus `tests/helpers/privacy.ts` talk to the app the way a hostile client could: a raw WebSocket `core.subscribe` for reads, a raw `core.put` for writes, and direct action calls with a real session token from `/api/auth/token`. `src/schemas/privacy.test.ts` pins the permission matrix.
- **What is proven (8 e2e tests, run locally and against the deployed app, release #4):**
  1. Host, guest and outsider each subscribe to `ballots`, with the subscription open while both ballots are submitted: zero records and zero live changes, even for a player's own ballot.
  2. An outsider cannot read the room or round; the host and guest can (a control, so an empty result is meaningful).
  3. An outsider's `submitBallot`, `setMood`, `startRound`, `openSetupRound` and `addDemoPartner` all fail, and the room is unchanged.
  4. Only the host can open or start a round; a guest gets `not_host`.
  5. Simultaneous ballots from both players are both accepted and both ready flags land.
  6. Five malformed ballots, a null ballot and an extra-key call are rejected and nothing is recorded; a valid ballot still goes through.
  7. No action response contains `votes` or any film id, including repeat and cross-seat submits.
  8. A client cannot write `ballots`, `rounds`, `rooms` or `roomSeatClaims` directly: every forged write is refused with an explicit error, and the flags, shortlist and seat are unchanged afterwards.
- **Mutation check:** I temporarily set `ballots` to `member: read: true`; the ballot-read test failed (it received the ballot records). Reverted. So the "cannot read" test is not vacuous.
- **Test-writing mistake of mine:** the first run failed 3 tests because a raw socket returns the ready flags as `1`/`0` (stored as numbers), where the app's client shows booleans. Fixed the assertions, not the app.
- **Not covered, on purpose:** the spec's admin read case (no admin test account exists; the platform owner is the only admin, so the permission matrix is checked statically instead). Same user submitting twice with different votes (the stored ballot is not observable from a client; covered by a unit test only). "Exactly one result" under simultaneous submits waits for the reveal PR.
- The deployed run created more test rooms and rounds in the live data and attempted forged writes against production; all were refused and production logs show no warnings or errors.

**Direct HTTP ballot reads (PR #16) and reveal logic (PR #6, `feat/reveal-logic`)**
- **PR #16 (Codex, reviewed by me):** one new end-to-end test through the app's HTTP agent-tools endpoint (`/_deepspace/agent/browser/tools/<name>`), a read surface my WebSocket tests did not cover. Listing `ballots` returns nothing and reading one ballot is denied, for both players, with a control read of the round. I mutation-checked it (making `ballots` readable made it fail), and it passes locally and against the deployed app (release #4).
- **A property worth knowing:** a denied read of one specific ballot (HTTP 422, `READ DENIED`) differs from "not found", because the SDK checks existence before permission. So someone who already knows a round id and a user id can tell whether that player has submitted. Members already see that through the ready flags and an outsider cannot guess the ids, so I judge the risk low and I am not fixing it. The test also pins SDK internals (the 422 and the message text), so an SDK upgrade could break it. Forged writes through the same HTTP tools are not covered yet (follow-up).
- **PR #6 (Codex, reviewed by me):** `finalizeRound` (pure, `src/lib/finalize.ts`), the `results` collection (`uniqueOn: ['roundId']`, member-only reads) and finalizing inside `submitBallot` once both ready flags are set. I read the scoring against `CONTRACTS.md` line by line and it matches: matches score 3/2/1, `pass` or `seen` vetoes, closest-call points 2/1/0 with a `seen` exclusion and a sum above 0, ties by the smallest FNV-1a hash of `roundId:filmId`, so shortlist order never decides.
- **Why concurrent submits are safe:** `submitBallot` and `finalizeRound` run inside the one-at-a-time Durable Object queue, the result id is explicit (`result_<roundId>`), the result is saved before the round is marked `revealed` (a retry after a partial failure reuses the stored result), and `uniqueOn` is the backstop.
- **Verified by running (local):** `tsc` and eslint pass; unit tests for scoring, vetoes, closest calls, `none` and tie-break independence; 8 end-to-end privacy tests including "one ballot publishes no result" and "simultaneous ballots publish exactly one shared result, hidden from an outsider". A throwaway probe against the real local platform (deleted) showed both-pass and one-`seen` give `none`, and an equal-score tie picks the film the hash rule predicts.
- **Review fixes:** the PR description still said "spec only" and there was no notes entry; `CONTRACTS.md` lacked the `finalizeRound` action, the new error codes (`ballots_pending`, `result_lookup_failed`, `result_save_failed`), and the `results.ballots` shape (`{ hostVotes, guestVotes }`). I added those plus a closest-call tie test.
- **Gotcha for the reveal screen:** for outcome `none` the live read has **no `filmId` field** (stored as null), so the UI must treat a missing film as "no match".
- **Not verified:** any screen that shows the result (none exists yet). The reason text says "the host" and "the guest", not display names.
- **Deployed and re-tested (release #5, Sun Nov 22):** I deployed `main` (`650ed54`) and ran `rooms.spec.ts`, `voting.spec.ts` and the full `ballot-privacy.spec.ts` (10 tests, including PR #16's HTTP-read test, "one ballot does not publish a reveal result" and "simultaneous ballots publish exactly one shared result") against https://double-feature.app.space with a temporary Playwright config (deleted, not committed). All 16 passed. Production logs show every action returned HTTP 200 (6 `createRoom`, 7 `joinRoom`, 2 `addDemoPartner`, 7 `openSetupRound`, 1 `setMood`, 6 `startRound`, 14 `submitBallot`, 1 `finalizeRound`), with no warnings or errors. The new `results` collection was accepted on deploy. **A gap in what the logs show:** PR #16's HTTP agent-tools requests do not appear in the production request log (a search for `/_deepspace/agent` found none), so the logs cannot corroborate that test; the test itself received real 200/422 responses from the live URL. The run created more test rooms, rounds and results in the live data.

**Reveal screen (PR #7, `feat/reveal-ui`)**
- Built by me (the draft PR was spec-only). The result shows inside the room screen the moment the round is `revealed`, for both players: a flipping card (`RevealCard`) with the reason written from each player's point of view ("You wanted to watch it and your partner passed."), and the receipts (`Receipts`): both ballots side by side plus "N of M agreed", read only from the `results` row. Outcomes: match, closest call (labelled "Not a perfect match, but the nearest thing."), and no match (host sees "Start another round", the guest waits).
- **Decision:** the screen is a view inside the room page rather than a new route, so both players switch live and a late arrival sees the same card.
- **"Start another round" needed real work:** `openSetupRound` hard-coded round 1. It now follows the room's latest round and opens `number + 1` once that round is revealed; `startRound` and the screens follow the latest round too. A later round skips earlier picks and films either player marked "already seen" (recorded as `inputs.skippedFilmIds`), falling back to the whole seed list if nothing is left. **Limit:** with six seed films a round after a no-match mostly repeats films until ratings and discovery exist.
- **Verified by running (local):** `tsc` and eslint pass; 65 unit tests (new: `tasteMatch`, `personalizeReason`, the next-round actions including a racing pair of opens and the skip rules); end-to-end `tests/reveal.spec.ts` (8 tests): same pick on both screens and it equals the hash-predicted film, closest-call label and per-player wording, no-match host-only button then round two for both, live arrival and late arrival, reduced motion drops the flip class, 375px phone with no sideways scrolling, no vote data in the other player's browser before the reveal (with a positive control that receipts do arrive afterwards), solo demo room. I also looked at screenshots of all three outcomes at desktop and phone width (throwaway test, deleted).
- **Test mistakes of mine, fixed:** (1) my first "no votes before reveal" check flagged the platform's schema-list frame, which names the `votes` column of `ballots` without data; I now skip that one frame type and require at least one other frame so the check is not empty. (2) After this change a demo-partner submit goes straight to the result, so the shared `submit` helper's "Ballot submitted" heading was a timing race (it failed 3 of 3 runs once I looked); it now accepts either screen.
- **Worth knowing:** after both players pass everything the receipts read "6 of 6 agreed", which is accurate (they agreed on every film) but reads oddly beside "No match tonight".
- **Deployed and re-tested (release #6, Sun Nov 22):** after merging I deployed `main` (`530a578`) and ran `rooms`, `voting`, `ballot-privacy` and `reveal` specs against https://double-feature.app.space with a temporary Playwright config (deleted, not committed). **24 of 24 passed.** Then the spec's acceptance item: "both players see the same pick" run **five times in a row** on the deployed URL, 5 of 5 passed (each run also checks the pick equals the hash-predicted film). Production logs show no warnings or errors at warn level.
- **Production logs are not a reliable counter at this volume.** `deepspace logs` returns only the newest 500 events per fetch and every raw WebSocket probe in the privacy tests logs events, so the action tallies came back far too low (about 8 `createRoom` for roughly 30 expected) and changed with the window size. Earlier tallies matched the tests exactly only because traffic was lower. So for this run the evidence is the passing tests plus the warn-level query (which returns almost nothing), not an exact action count. My earlier note blaming ingestion lag for an undercount was probably wrong.
- **Live run as a real signed-in user (Mon Nov 23, browser pane, release #6):** with the user's existing GitHub session I ran the whole flow on https://double-feature.app.space: created a room, added the demo partner, picked "Break my heart" and "Under 2h" (the brief correctly merged the demo partner's fixed moods: "Break my heart, make me laugh, and keep me guessing, under 2 hours"), voted on the four films that fit under two hours (Want, Maybe, Want, Pass via the 1 to 4 keys), reviewed, submitted, and got the reveal. The pick, *In the Mood for Love*, was right by my own scoring (we both said Want, score 3, beating Chungking Express at 2), and "2 of 4 agreed" was right. The layout read well in a phone-width pane. Observations: after a match there was nothing to do next (fixed by the ratings PR), and the demo partner's moods appear in the brief, which could surprise a reviewer. The browser-pane screenshots lagged behind the page after clicks several times, so I confirmed each step from the page's state instead. This left a real room, round and result in the live data under the user's account.
- **Still not verified:** Google sign-in, and the invite resuming automatically after a real sign-in from a clean signed-out browser.

**Ratings and the next round (PR #8, `feat/ratings-next-round`)**
- Implemented by Codex from `docs/prs/pr-7-ratings-next-round.md`; reviewed and fixed by me. After a reveal each player can give the picked film 1 to 5 stars and optional reaction tags (`saveRating`), editable and visible only to its owner. When the next round starts, both players' ratings reorder the shortlist (`rankByRatings`: mood overlap plus a clamped bonus or penalty of up to 0.5 from rated films' mood tags, ties by the same hash as the reveal), and the inputs are snapshotted server-side (`roundRankingInputs`) so a later rating change does not alter an earlier round. Demo rooms get a "Load demo ratings" button that rates two films for the demo partner only. After a match the host now also gets "Start another round" (the dead end I noted in the live run).
- **Problem found in review, confirmed by running, then fixed:** ratings follow a *person* across all rooms, and when no fresh film was left `startRound` returned `no_new_films`. With a six-film catalog, a player who had rated six picks could not start a round in *any* room, even a brand-new one (I played it out: shortlists of 6, 5, 4, then 3, 2, 1 across two rooms, then a new room failed at round 1). A reviewer replaying the demo, or our shared test accounts, would hit it. Fix: fresh films first, and if fewer than 3 remain, bring back repeats (rated films, then earlier picks and films marked seen), record them in `inputs.repeatedFilmIds`, and tell players on the vote screen. A round can always start. Re-ran the same play-through on the real local platform: new rooms now start with a full shortlist and flagged repeats.
- **Tests I added:** unit tests for the fallback tiers (including "rated films come back before earlier picks and seen films" and "never fails after every film is rated") and `tests/ratings.spec.ts` (6 end-to-end tests): each player sees only their own rating over the socket and the HTTP agent tools and an outsider and the partner cannot read it, an edit replaces the rating, bad input and non-picked films are rejected, no client can write ratings, the next round always starts and flags repeats, the rating panel remembers a rating after a reload, demo ratings are demo-only. Mutation check: making `ratings` readable by every member made the privacy test fail (it received 7 records, including others' and the bot's); reverted.
- **Test mistakes of mine, fixed:** my first version passed once and failed on the second run, because three assertions assumed an account had never rated that film and a tag click toggled off a tag saved by an earlier run. Ratings cannot be deleted, so the tests now compare against the state before and only assert things true whatever the account's history. Three passes in a row afterwards. I backed up and restored the local dev database around my probes.
- **Verified by running (local):** `tsc` and eslint pass; the platform schema linter reports nothing for the new collections; unit tests; the six new end-to-end tests three times in a row; the full end-to-end suite.
- **Known limits:** reaction tags are stored but do not affect ranking yet (the model ranking in discovery is meant to use them); a person's ratings exclude films in every room, so on a six-film catalog most second-night rounds will show repeats until discovery adds films; each round's private snapshot copies the whole catalog (fine at six films).
- **Deployed and re-tested (release #7, Mon Nov 23):** I deployed `main` (`cfdb98f`) and ran `rooms`, `voting`, `ballot-privacy`, `reveal` and `ratings` against https://double-feature.app.space with a temporary Playwright config (deleted, not committed). **30 of 30 passed**, and the ratings suite passed again on a second run once the live test accounts already held ratings (6 of 6). The platform accepted the new `ratings` and `roundRankingInputs` collections, and the warn and error level logs were empty. I did not use the production request log to count actions (it returns only the newest 500 events, see the release #6 entry). The run left more test rooms, results and ratings in the live data; ratings cannot be deleted, which is why the tests are written to hold whatever an account already has.

**Film discovery (PR #9, `feat/discovery`)**
- **Decisions (the user's):** stay inside DeepSpace (Exa for the web search, a model, Wikipedia to check), no TMDB; billing to the app owner on the **free plan (500 credits; one credit is a cent)**; discovery is **opt-in** (a checkbox for the host, off by default) so the demo stays deterministic and free unless someone chooses it, and our own six films are always the fallback.
- **What it does:** the host ticks "Find new films with AI search"; one web search for the brief, one model call that proposes films from what the pages say (tuned to the players' liked and disliked films and reaction tags, which finally give the tags a job), then each proposed film is checked on Wikipedia. Verified films go first in the shortlist, ours fill the rest, and the card says "Why this one", "Checked on Wikipedia" and "runtime unverified". Nothing about a person or a room is ever sent to a provider (tested).
- **Cost, measured on real runs:** about **1.5 to 2.1 credits per full run** (the Exa search about 0.9, each Wikipedia lookup about 0.13, the model about 0.4). A repeat of the same brief within 24 hours is served from a shared cache and costs **0.000** (verified). Limits: 5 paid runs per person and 25 per day, retries counted. All the discovery and trailer work together (probes included) has used about **32 of the 500 free credits**.
- **Real runs found five problems my fake tests could not.** Each is now fixed and tested:
  1. **The newer model returned nothing.** `claude-haiku-5-5` spends its whole token budget on hidden reasoning (`output_budget_exhausted`) and the integration has no setting to stop it. Switched to `claude-haiku-4-5`: a clean answer in about 700 tokens for under half a cent. My first real run spent a credit and got nothing.
  2. **The model paired a real title with another film's plot.** It listed *Passengers (2016)*, a Hollywood film, with a Taiwanese romance's description and a made-up "Chinese-language" reason. Wikipedia would have confirmed the film exists. Fix: a proposed title must **appear in the web pages the model was shown**, then pass the Wikipedia check. A test uses the real reply and the real snippets.
  3. **Requiring three verified films threw away good ones after paying for them.** Now any verified film is kept, and every fresh discovered film is guaranteed a place in the shortlist (ranking alone could push it out in favour of six we already had).
  4. **Yield varies.** Measured on realistic briefs: "Break my heart, under 2 hours" gave 5 real films (*Eternal Sunshine*, *Grave of the Fireflies*, *Coco*, *Kodachrome*, *Toy Story 3*), "Make me laugh and keep me guessing" gave 2 (*Game Night*, *Clue*), niche briefs (Chinese-language romance) gave 0 to 2, with our own films filling the rest. I did not tune further; this is the honest range.
  5. **A security hole that predates this PR.** The scaffold's browser route `/api/integrations/<name>/<endpoint>` let **any signed-in user call any paid integration at the owner's expense, with no limit**: a Wikipedia call from a browser returned 200 (the test failed first, then passed). Closed with an empty allowlist (`browserCallableIntegrations`), tested for Wikipedia, Exa, the model, Amazon and YouTube (403 for all), and the catalog listing the api-status page uses still works. **This is live in production until the next deploy.**
- **Architecture note worth explaining:** `discoverFilms` is *not* in the round-mutation queue. That queue is shared by every room (the app has one Durable Object), so a ten-second search inside it would freeze everyone's ballots. A unique `discoveries` row per round, claimed before any spend, stops a second click paying twice.
- **Test-suite lessons:** (1) the shared test accounts accumulate ratings, so an older voting test that expected exactly 2 films failed; fixed the test, and fixed a small product flaw it revealed (a round could end up with one film when ratings and a runtime limit both removed films: repeats now count toward the three-film minimum only if they fit the limit). (2) `liveQuery` collected for a fixed window, so a slow first snapshot looked like an empty result and caused a rare failure; it now waits for the snapshot, which also makes every "cannot read" check stronger. (3) The remaining flake, an "API status page" test, comes from parallel workers rewriting the shared cached sign-in file; not an app bug.
- **Verified by running:** `tsc` and eslint pass; 146 unit tests (the library, the real captured Exa, Wikipedia and model output, the action with a fake platform and a scripted fake of all three services); 54 end-to-end tests, four full runs in a row; three real paid runs plus a real three-brief yield probe against the real services; screenshots of the opt-in screen and a discovered film's card at desktop and phone width.
- **Not verified:** the deployed app (nothing is deployed); whether runtime-unverified films confuse reviewers; quality beyond the briefs I measured. The one paid test is skipped by default (`RUN_PAID_DISCOVERY=1`).

### Mon Nov 23: Rooms and private voting
_(fill in)_

### Tue Nov 24: Reveal and ratings
_(fill in)_

### Wed Nov 25: Discovery and integrations

- Added opt-in live discovery (checkbox "Find new films with AI search"): Exa web search, then `claude-haiku-4-5` proposes titles, each title must appear in the search snippets, then Wikipedia confirms the film (description and year). Verified films join the shortlist with a reason and a Wikipedia link. Limits: 5 per person per day, 25 per day, a 24-hour shared cache. A real run cost about 1.5 to 2.1 credits on the 500-credit free plan. If anything fails, the round uses the curated catalog.
- Found that the scaffold's browser route for integrations let any signed-in user spend the owner's credits. Closed it with an empty browser allowlist, plus a test that expects 403 for each paid integration.

### Thu Nov 26: Polish and submit

- Replaced the scaffold landing copy and metadata. Added Try it solo on the signed-in home page, with recovery in the newly created room if seating the demo partner fails.
- TypeScript, ESLint, and 92 unit tests passed on the polish branch. Playwright discovered the solo entry test, but DeepSpace CLI auth could not write its refreshed token in the sandbox, so the browser test did not run.
- Merged discovery, copy-link invites, Keep or Risk and polish after review (conflicts resolved in a scratch merge first, which matched `main` exactly). Deployed `main` to https://double-feature.app.space.
- Final check: the full Playwright suite against the live URL, 57 passed and 1 skipped (the paid discovery test, off unless `RUN_PAID_DISCOVERY=1`). The same suite passed locally. TypeScript and ESLint clean, 156 unit tests.
- Not done by me: a real paid discovery run on this release, the physical-phone pass, listening to the six pinned trailers, Google sign-in. Portal submission pending.

---

## Trailers on the reveal (PR #10)

Verified the DeepSpace YouTube contract with one search for Chungking Express. The response contains `videos[].snippet.title`, `videos[].id.videoId`, and watch and embed URLs under `videos[].links`. The catalog lists $0.013 per request. The Worker caches successful searches by film, including a confirmed no-match. Both the search and the embed wait for a player to click Watch trailer.

**Review of the trailers PR (#10), and what I changed**
- Codex's design is good: membership and the pick are checked before any spend, answers (including confirmed misses) are cached by film, provider errors stay retryable, lookups run in a per-film queue (not the app-wide queue, so a slow search cannot freeze other rooms), and nothing loads from YouTube until the button is pressed. Its own checks passed (82 unit tests).
- **A real bug, found by running it:** a real lookup returned *The Wedding Banquet | Official Trailer | Bleecker Street* for the 1993 film. Wikipedia confirms Bleecker Street released the **2025 remake** ("a remake of the 1993 film"). The right trailer ("1993 The Wedding Banquet Official Trailer 1 Samuel Goldwyn Films") was in the results but the picker **rejected it because its title starts with the year**, then accepted the undated remake. So there were two faults: year-first titles were rejected, and a title search cannot tell a film from its remake.
- **Fixes:** (1) the picker accepts a year-first title and still rejects a different year; (2) **hand-picked trailers for all six seed films** (`src/lib/trailer-pins.ts`), chosen on 23 Nov from the real YouTube results (right film and year, best-known channel, `embedHtml` present so they can be embedded). The fixed picker, run without any hint on the real results, independently chose the same video as my pin for 5 of 6 films; for *Lust, Caution* it preferred a 2021 reupload to Focus Features' official trailer, which is why that one is pinned. **Nobody has watched these videos here;** the panel shows each video's title and a link, and the trailers need a human look on the deployed site. (3) A visible "Showing: <title>" caption, so a wrong match is noticeable. (4) Daily limits on fresh searches (15 per person, 60 per day): each search costs about 1.3 credits and the platform does not limit paid calls. (5) The trailers collection now records who searched and when, for those limits.
- **Cost, measured:** a search is 1.3 credits ($0.013); video details are 0.65 credits. Looking up and checking the six seed films cost about 12 credits of the 500 free credits. Pinned films cost nothing.
- **Tests added:** 10 unit tests (pins valid and unique, a pin is served free and still checks authorization, the daily limits including "pins and cache hits never count", the real remake case with the real results) and `tests/trailers.spec.ts` (3 end-to-end tests: the member path through the screen with the exact embed address and caption, refusal of outsiders and non-picks before any search, and the trailers collection is unreadable).
- **A flaky privacy test, understood:** `no votes reach the other player's browser before the reveal` failed now and then under parallel runs. I captured the frame: it was a `results` row for a *different* room that the same Guest account belongs to. Tested directly: the platform pushes a member's finished-room results to every browser that member has open (an idle Home page received the result with the votes, after both ballots were in), and a browser belonging to an **outsider received nothing at all** about the room. So it was not a leak: two parallel tests shared an account. The check now looks only at frames about its own round, and a new test, `a browser belonging to someone outside the room receives nothing about it`, pins the outsider result.
- **Not verified:** playback on the deployed site; a real search for an *unpinned* film after the fix (unit-tested against the real results only; the action cannot reach an unpinned film until discovery lands); recall of the strict title matcher beyond the six films.

## Verification checklist (tick only what I checked myself)

- [x] Sign-in works on the live URL (real GitHub sign-in completed by the user in the browser pane; test accounts also sign in fine. Google not tried. Automatic invite resume after the OAuth return is unproven, see the rooms entry.)
- [x] Guest joins by link; outsider cannot read the room (4 Playwright tests against the deployed app, release #3, Sun Nov 22)
- [x] A third person cannot join a full room (same run; also two simultaneous joiners and a guest vs demo partner race, one winner each)
- [x] No account can read another's ballot via API or live subscription (raw WebSocket subscriptions as host, guest and outsider, with the subscription open while ballots were submitted; local and deployed release #4; mutation-checked)
- [x] Readiness updates live on both screens (voting e2e test against the deployed app, release #4)
- [ ] Double submit leaves the first ballot unchanged
- [x] Fake film ID or missing vote is rejected (5 malformed ballots plus null and extra-key calls, deployed release #4; a valid ballot still succeeds afterwards)
- [ ] Solo demo-partner path completes in under a minute
- [x] Reveal tie-break is deterministic and identical on both screens (unit tests, a real-platform probe, and the same-pick test 5 of 5 on the deployed app, release #6; each run equals the hash-predicted film)
- [x] No-match round handled (server gives `none`; the screen shows it and the host can start round two; end-to-end test locally and against the deployed app, release #6)
- [x] Simultaneous submits produce exactly one result (end-to-end test and unit test locally, and the end-to-end test against the deployed app, release #5)
- [x] Rating edit is saved once and changes the next recommendation input (an edit replaces the rating, verified live, release #7; that ratings reorder the next shortlist is covered by unit tests only, not exercised live)
- [x] Already-seen film does not come back while at least 3 fresh films remain; after that it can return as a flagged repeat (unit tests, local; not exercised live)
- [ ] Mobile layout checked on a phone (390px and 375px layouts are covered by automated tests only)
- [ ] No secrets in the repo or logs

## Agent log: things the agent got wrong or I changed
_(Add entries as they happen: what it produced, what was wrong, what I did instead.)_

- **Schemas, first version:** read access for `rooms` and `rounds` used the app-wide `member` role, which would have exposed every invite code to every signed-in user. Caught in review, fixed with `collaboratorsField` and `'collaborator'` reads.
- **Voting PR, unsafe-by-default internal endpoint:** Codex's Durable Object endpoint for serialized round writes trusted a `userId` in the request body. Caught in review and fixed with a signed request body.
- **Voting PR, over-claiming test name:** an e2e test was titled "without exposing votes" but asserted only UI text. Renamed; real privacy tests come with the next PR.
- **Rooms PR, stale paperwork:** Codex's implementation was correct but left the PR description saying "spec only", added no `NOTES.md` entry, and did not document the new `roomSeatClaims` collection or error codes in `CONTRACTS.md`. Fixed in review.
- **Trailers PR, wrong film's trailer:** the picker rejected the correct year-first upload and accepted a remake's trailer for the 1993 *The Wedding Banquet*; and a daily cap on paid searches was missing. Both caught by running it against the real service, fixed in review.
- **Discovery, found only by running it for real:** the first model choice returned nothing (hidden reasoning ate the token budget); the model attached a real film's title to another film's plot (fixed by requiring titles to appear in the web pages); my cap logic let a failed round be retried forever (caught by a unit test); and I had assumed a recommendation needed three verified films, which wasted paid searches. Separately, the scaffold shipped a route that let any signed-in user spend the owner's credits.
- **Docs summary, email sender:** a subagent's summary of the docs said the sender must be `<app-name>@app.space`. The live catalog says it is fixed and `from` is ignored. Trust the CLI output.

## Assessment writeup

- [Live app](https://double-feature.app.space)
- [Source repository](https://github.com/Colin243/double-feature)

**What I built.** Double Feature helps two people pick a movie together. The host shares an invite link, both players choose a mood and runtime limit, and each votes privately. Once both ballots are in, the app reveals a pick and shows where the votes agreed. Ratings help order the next round. If there’s no match, the pair can play Keep or Risk, a tiebreaker where each player nominates a film and locks a private choice. Reviewers can also try the flow solo with a demo partner.

**How I used DeepSpace.** DeepSpace handles sign-in, records, and live updates. When the host opts into discovery, Exa finds candidates, Claude Haiku 4.5 proposes titles from those sources, and Wikipedia checks the titles and years. The curated catalog keeps the round playable if discovery fails. The reveal loads YouTube trailers on request, and six curated films have preselected trailers that require no search. Server-side quotas and a shared discovery cache limit paid calls.

**Main tradeoff.** I kept ballots in a server-only collection and routed submissions through actions that check room membership and serialize writes. That added coordination work, but it gave me a single place to enforce when the reveal happens and ensure simultaneous submissions produce one result. Discovery runs outside the shared round queue so a slow search doesn’t hold up voting in other rooms.

**What the agents did and what I changed.** I used Claude and Codex to draft the data model, actions, UI, and tests. During review, I tightened room permissions to protect invite codes and required signed requests for internal writes. I also corrected a trailer matcher that picked a remake and disabled browser access to paid integration calls. Real discovery runs exposed a model response that returned no candidates and a suggestion with the wrong plot, which led me to require source-backed titles and a separate Wikipedia check.

**What I verified.** The final deployed release recorded 57 passing Playwright tests and one skipped paid-discovery test. Coverage included room joins, three-account ballot privacy, simultaneous voting, reveal outcomes, ratings, trailers, Keep or Risk, and the integration spending check. The same suite passed locally. TypeScript, ESLint, and 156 unit tests also passed. I completed GitHub sign-in by hand and measured discovery costs in earlier live-provider runs.

**What I’d do next.** I’d verify the full flow on a physical phone, spot-check the six pinned trailers, and run paid discovery against the final release. I’d also check Google sign-in and automatic invite resumption after sign-in from a clean browser.
