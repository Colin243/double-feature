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

## Open questions
- [x] Is there a catalog integration for movie metadata? No. See findings above.
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

**Next**
- Register the app (`npx deepspace app init --json`), commit the minted app id, deploy an empty shell, confirm sign-in on the live URL.

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

- [ ] Sign-in works on the live URL
- [ ] Guest joins by link; outsider cannot read the room
- [ ] A third person cannot join a full room
- [ ] No account can read another's ballot via API or live subscription
- [ ] Readiness updates live on both screens
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

## Writeup draft
_(Start assembling on Thursday morning from the sections above.)_
