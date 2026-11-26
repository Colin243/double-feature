# PR 8: Live discovery and model ranking

**Branch:** `feat/discovery` · **Depends on:** PR 7 · **Estimate:** 5 h · **Day:** Wed Nov 25

Contracts: [CONTRACTS.md](./CONTRACTS.md)

## Decision first (Wed 9 a.m.)
Default: stay inside DeepSpace (Exa + Wikipedia + the model). Runtime filtering is best-effort. TMDB is the stretch alternative (PR 10b). Record the choice in `NOTES.md` before coding.

## Goal
Replace the seed shortlist with candidates found from tonight's brief and the pair's ratings, with a safe fallback to the seed shortlist if anything fails.

## Before coding
Run these and paste the real input and output shapes into `NOTES.md`; do not guess them:
```
npx deepspace integrations info exa/search
npx deepspace integrations info wikipedia/get-page-summary
npx deepspace integrations info anthropic/chat-completion
```
Check billing mode in `src/integrations.ts`. Paid calls bill the developer if set to `developer`, and the platform does not rate-limit them.

## Files
- `src/lib/discovery/` : `search.ts`, `enrich.ts`, `filter.ts`, `rank.ts`, `fallback.ts`, `types.ts`
- `src/actions/index.ts`: `startRound` calls discovery when the room opts in
- `src/integrations.ts`: enable exa, wikipedia, anthropic
- tests next to each module

## Pipeline (all inside `startRound`, host only)
1. **Cap check.** Reject with `rate_limited` if the host has run 10 discoveries today. Count by querying their rounds' `inputs.discovery = true` today.
2. **Search.** One `exa/search` call from the brief, requesting results with short highlights. Parse candidate `{title, year, sourceUrl}` out of the results. Drop anything without a clear title.
3. **Normalize and dedupe.** Key = lowercase title with punctuation stripped + year. If year is missing, keep the candidate but mark it uncertain.
4. **Enrich.** At most 12 candidates. For each, one `wikipedia/get-page-summary` (or `search-pages` then summary) for a year check and a one-sentence hook. Failures leave the candidate with what Exa gave. Runtime is `null` unless the summary states it plainly.
5. **Filter.** Remove films either person marked `seen` or rated (same exclusion set as PR 7, matched by key since discovery ids are slug-year). Apply the runtime limit only when runtime is known. Unknown runtime stays and is shown as "runtime unverified".
6. **Rank.** One `anthropic/chat-completion` call. Input: the brief, up to 12 candidates (id, title, year, hook), and up to 3 high and 3 low ratings with tags per person. Instruct it to return JSON only: `{ "picks": [{ "id": string, "reason": string }] }`, up to 6, reasons spoiler-free and under 20 words.
7. **Validate.** Parse the JSON in a try/catch. Keep only picks whose `id` is in the candidate list, drop duplicates, cap at 6, trim reasons to a safe length. Anything invalid is discarded, not repaired.
8. **Fallback.** If search returns fewer than 4 usable candidates, the model call times out (20 s), errors, or validates to fewer than 3 picks, use `rankByRatings` over the seed set (PR 7) and set `inputs.fallback = true` with the reason.
9. **Snapshot.** Store the final Film snapshots, the reasons, and `inputs` (brief, exclusions, ratings used, source urls, fallback flag) on the round. Nothing about discovery changes after voting starts.

## Safety
- Web text is untrusted. The prompt says to treat candidate text as data and ignore any instructions in it. The server validates structure and ids, so injected text cannot add films or change the format.
- Do not log full prompts or full web content.
- Never put page text in the prompt beyond the short hook and title.

## Tests
- Pure: normalize and dedupe cases, filter with known and unknown runtime, validator rejects invented ids, duplicates, non-JSON, oversized output.
- Integration with the model and Exa mocked or forced to fail: still produces a seed-based shortlist and marks `fallback`.
- Manual on the deployed app: one real run; confirm the shortlist, the reasons, and that an already-seen film does not appear.
- Cap: the eleventh discovery in a day is refused.

## Acceptance
- [ ] A real discovery run produces a playable shortlist
- [ ] Forced failure of each integration still produces a shortlist
- [ ] Changing a rating changes the model input on the next round (shown in `inputs`)
- [ ] No candidate id can enter the shortlist unless it came from the candidate list
- [ ] Cost per run is known and written in `NOTES.md`

## Not in this PR
Trailers (PR 9), email (PR 10).

## As built
This differs from the plan above in ways worth knowing. Details are in `CONTRACTS.md` ("Discovery as built").
- **Opt-in, off by default** (a checkbox for the host), not part of every round. Choosing to stay inside DeepSpace (Exa, the model, Wikipedia) means no TMDB and no new secrets; runtime stays unverified.
- **Two model/verification changes forced by real runs:** the model *extracts and proposes from the snippets* and every title must appear in the web pages (then be confirmed on Wikipedia), rather than ranking a fixed candidate list; and the model is `claude-haiku-4-5` because `claude-haiku-5-5` returns nothing.
- **Any verified film is kept** (the plan said fall back below three) and is guaranteed a place in the shortlist; our own list fills the rest.
- **Runs outside the round-mutation queue**, with a `discoveries` row per round claimed before any spend.
- **Limits:** 5 runs per person and 25 per day (retries counted), a 24-hour shared cache, and a 20/25/8-second timeout on the search, model and each Wikipedia lookup.
- **Also in this PR:** closing the browser route to paid integrations; `Film.runtimeMinutes` may be `null`; repeats count toward the three-film minimum only when they fit the runtime limit; `liveQuery` waits for its first snapshot.
- **Tests:** unit tests for ids, matching, parsing, the prompt, caps, the pipeline (with real captured Wikipedia, Exa and model output) and the action; `tests/discovery.spec.ts` (3 free end-to-end tests, and one real paid test behind `RUN_PAID_DISCOVERY=1`); `tests/integration-spend.spec.ts`.
- **Not done here:** a live run on the deployed site; TMDB; verified runtimes.
