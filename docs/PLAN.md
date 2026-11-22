# Double Feature: Plan to Thursday

Deadline: **Thu Nov 26, 2026, 11:59 PM ET.** Target submission: Thursday afternoon.

The task rewards a sensible scope, a working core path on the deployed app, technical depth, understandable code built on platform primitives, protected secrets, and an honest writeup. Originality and polish are not scored. So the order of priority is:

1. Working, verified core loop on the deployed URL
2. Platform primitives used correctly (RBAC, server actions, `uniqueOn`, real-time records, integration proxy, `deepspace secrets`)
3. Code I can explain and modify in the live session
4. The writeup
5. Everything fun

## Workflow

- `main` is the base. **Every PR gets its own branch off `main`**, named in the table below. `main` always stays deployable.
- Merge to `main`, then deploy from `main`: `git checkout main && git pull && npx deepspace deploy`. GitHub is the app's permanent source, so a deploy ships the checkout as it is. Never run `deepspace push`.
- Each PR description follows `.github/pull_request_template.md`: what changed, what the agent did, what I verified myself, risks. These sections become the writeup.
- Each PR adds a short entry to `NOTES.md`.
- If a command says `not_authenticated`, run `npx deepspace auth login` (tokens expire after about 15 minutes).
- Tests: `npm test` runs `deepspace test run`. Run it before opening each PR.
- Never commit secrets. Use `npx deepspace secrets set NAME=value`. Check `git diff --cached` before every commit.

## Movie data decision

Nothing in the DeepSpace catalog provides movie metadata. This section is from general knowledge, so **verify the terms before relying on any of it.**

| Option | Gives | Catch |
|---|---|---|
| IMDb | Official API is paid and enterprise-style. Free datasets have titles, years, runtimes, genres, ratings. | No posters or plot hooks, huge files, personal and non-commercial licence. |
| TMDB | Search, posters, runtime, genres, overview, where-to-watch. | Free API key and a visible attribution line. |
| OMDb | Lookup by title or IMDb ID with poster, runtime, plot, rating. | Free key with a daily request cap. |
| Unofficial IMDb scrapers | Same data | Break often, may violate terms. **Don't use.** |

**Monday (seed films): hand-write them.** 6-8 films in `src/lib/films.ts`, no API. This keeps the demo deterministic, with no key, no network failure and no rate limit. The writeup says the seed set exists so reviewers get a stable demo. If I want real data, a one-off local script can pull those few films from TMDB or OMDb and write the result into the file. Nothing gets installed in the app, and the key stays out of the repo. Verify every runtime and year by hand.

**Wednesday (discovery): decide at 9 a.m., default is option 1.**

1. **Inside DeepSpace (default).** Exa finds candidates, Wikipedia gives year and summary, YouTube gives trailers. No new secrets and it fits the rubric's preference for platform primitives. Cost: runtime filtering is best-effort. Unknown runtime is shown as "runtime unverified", not silently dropped. Dedupe by normalized title plus year.
2. **Add TMDB (stretch PR 10).** Call it from a server action with the key in `deepspace secrets`. Gives reliable runtime, posters and stable IDs, so the runtime filter and already-seen exclusion are trustworthy. Cost: one more thing to explain and secure, and it's an outside API where the task prefers platform integrations. Only do this if PRs 1-9 are finished and verified. If used, show the required TMDB attribution line.

Whichever is chosen, record it in `NOTES.md` and the writeup, including why the other was left out.

Suggested seed films (verify each runtime and year; include some over 2 hours to exercise the runtime filter): In the Mood for Love, Chungking Express, Happy Together, The Wedding Banquet, Eat Drink Man Woman, Crouching Tiger Hidden Dragon, Better Days, Lust Caution.

## PR list

Hour estimates are rough. Each PR is small enough to review and explain in the live session.

### Sunday Nov 22

**PR 0: `docs/pr-plan`** (this PR) ~1h
- Adds `docs/PLAN.md`, the PR template, the movie-data decision in `NOTES.md`.
- Check: sign in on the live URL yourself.

### Monday Nov 23: rooms and private voting

**PR 1: `feat/schemas-seed`** ~2h
- `src/schemas/rooms.ts`, `rounds.ts`, `ballots.ts`, imported in `src/schemas.ts`. Ballots: `read: false` for every role. Flat readiness fields. Additive-only, so settle names now.
- `src/lib/films.ts` with the hand-written seed set.
- Check: deploy; confirm an action can read `ballots` while a client query cannot. This answers the `read: false` open question.

**PR 2: `feat/rooms-invite`** ~3h
- Actions `createRoom`, `joinRoom`, `addDemoPartner`. Each checks membership itself.
- Home page (create or paste a code), `/join/<code>` route, return-after-sign-in.
- Check: guest joins by link; full room is rejected; host cannot join own room.

**PR 3: `feat/private-voting`** ~4h
- Mood chips and a plain brief builder (union of chips, shorter runtime limit).
- `startRound` (host only, locks shortlist), `submitBallot` (membership, status, complete valid ballot, explicit ID, no overwrite, bot ballot, flat flag, returns `{success}` only).
- Voting UI: one card, four buttons, progress, live partner-ready, `Confirmed` writes, phone-first.
- Check: solo demo path reaches "both submitted" in under a minute.

**PR 4: `test/ballot-privacy`** ~2h
- Three-account tests: host, guest, outsider. Nobody reads another ballot via API or subscription. Double submit keeps the first. Bad film ID or missing vote is rejected.
- Check: all green on `npm test` and verified by hand against the deployed URL.

### Tuesday Nov 24: reveal and ratings

**PR 5: `feat/reveal-logic`** ~3h
- `finalizeRound` as a **pure function** in `src/lib/`, with unit tests. Veto on Pass or Already seen; score Want+Want 3, Want+Maybe 2, Maybe+Maybe 1; seeded-shuffle tie-break keyed on round ID; no-match returns the closest call.
- `results` collection with `uniqueOn: ['roundId']`, written to explicit ID `result_<roundId>`. Racing finalizers write identical data.
- Tests: each scoring case, tie, no-match, same-input-same-output.

**PR 6: `feat/reveal-ui`** ~3h
- Reveal screen on both clients, plain-language reason, closest-call label, ballot "receipts" and taste-match score after the reveal.
- Simultaneous-submit test against the deployed app.
- Check: both screens show the same winner every time.

**PR 7: `feat/ratings-next-round`** ~3h
- `ratings` collection (`read: 'own'`), one editable rating per member per film, optional reaction tags.
- Already-seen and rated films excluded from the next shortlist. Start another night from the same room, with seeded starter ratings so personalization shows on first run.
- Check: edit a rating, start a new round, confirm the shortlist input changes.

### Wednesday Nov 25: integrations

**PR 8: `feat/discovery`** ~5h
- Decide the movie-data option at 9 a.m. (default: Exa + Wikipedia inside DeepSpace).
- Exa search from the brief; Wikipedia for year and summary; dedupe; filter by seen, rated and runtime (unknown stays visible, labelled).
- `anthropic/chat-completion` ranks survivors using the brief plus recent high and low ratings with tags. Server validates returned IDs, enforces a timeout, caps list length.
- Snapshot the inputs and shortlist on the round at start. Later rating edits only affect the next round.
- Fallback: if Exa or the model fails, use the seed set ranked by past ratings. Manual title entry stays.
- Treat web text as untrusted data in the prompt. Cap paid calls per round and per user (the platform does not rate-limit these).
- Check: force the model call to fail and still get a shortlist; an Already-seen film never reappears.

**PR 9: `feat/trailers`** ~2h
- `youtube/search-videos` for a trailer embed on the reveal card. This is the leading third integration.
- Check: reveal works with no trailer found.

**PR 10: `feat/email-invite`** ~1.5h (optional) or **`feat/tmdb-enrichment`** (stretch, only if the Wednesday decision was option 2)
- `email/send` invite link. The sender is fixed to the platform address and `from` is ignored; use `reply_to`. Send one real test email.
- Copy-link stays the default.

### Thursday Nov 26: polish and submit

**PR 11: `feat/stretch-games`** ~2h (only if the core is verified live)
- Wildcard two-card rematch after a no-match, or predict-your-partner. Pick one.

**PR 12: `chore/polish-writeup`** ~4h
- Mobile layout on a real phone, keyboard use, focus states, labels, empty, loading and error states, reduced-motion fallback on the reveal.
- Remove placeholder pages and starter copy. Make sure no secrets are in the repo.
- Writeup assembled from `NOTES.md` and PR descriptions. Submit the live URL, repository and writeup in the portal by mid-afternoon.

## Test matrix (all against the deployed URL)

| Area | Case |
|---|---|
| Auth | Sign-in works on the live URL |
| Rooms | Guest joins by link; outsider can't read room; full room rejected |
| Privacy | No account reads another ballot (API and subscription) |
| Voting | Double submit keeps first; missing or fake vote rejected |
| Reveal | Scoring cases; tie deterministic; no-match handled; simultaneous submit gives one result |
| Ratings | Edit saves once; changes next shortlist input |
| Exclusion | Already-seen film never reappears |
| Fallback | Model or Exa failure still produces a shortlist |
| Demo | Solo path with demo partner under a minute |
| Mobile | Whole flow on a phone |
| Secrets | None in repo, logs or PRs |

## Cut line

If time runs short, drop in this order: PR 11, PR 10, PR 9, the TMDB option, ratings tags, receipts. **Never cut:** private ballots, the concurrency-safe reveal, the demo partner, a working deployed URL, the writeup.

## Writeup outline

1. **What I built:** two-person movie-night app with private ballots and a server-decided reveal.
2. **Integrations used and why:** Exa (candidates with sources), Anthropic (ranking), YouTube (trailers), and email if built. For each left out (TMDB, image generation, others), one line on why.
3. **Main tradeoff:** ballots are server-only, so voting goes through actions instead of live queries. Cost: more server code. Benefit: a real privacy guarantee.
4. **What the agent did:** drafted the plan, schemas, actions and UI; wrote the first version of tests.
5. **What I verified myself:** the three-account privacy test, the simultaneous-submit test, the deployed solo demo, the mobile run, and anything I corrected (list from the agent-mistakes log).
6. **Unfinished and next:** what is left and what I'd do.

## Risks

| Risk | Mitigation |
|---|---|
| `read: false` blocks something unexpected | PR 1 tests it first |
| Docs summaries were second-hand and one was wrong | Verify behavior with real accounts; log each correction |
| Need second and third test accounts | Line up extra Google or GitHub accounts before Monday |
| Token expires mid-session | `npx deepspace auth login` |
| Wednesday overload | Cut order above; PR 8 has a fallback so it cannot block Thursday |
| Running out of time Thursday | Writeup draft starts Wednesday night; submit by mid-afternoon |
