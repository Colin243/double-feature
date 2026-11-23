# PR 7: Ratings and the next round

**Branch:** `feat/ratings-next-round` · **Depends on:** PR 6 · **Estimate:** 3 h · **Day:** Tue Nov 24

Contracts: [CONTRACTS.md](./CONTRACTS.md)

## Goal
Each person can rate the film they watched. The next round avoids films either person has seen or rated, and ratings shape the order.

## Files
- `src/schemas/ratings.ts`, registered in `src/schemas.ts`
- `src/lib/exclusions.ts`: `excludedFilmIds`
- `src/lib/ranking.ts`: `rankByRatings` (deterministic, no model)
- `src/actions/index.ts`: `saveRating`, `startRound` (extended), `seedDemoHistory`
- `src/components/StarRating.tsx`, `ReactionTags.tsx`
- `tests/ratings.spec.ts`, `src/lib/exclusions.test.ts`, `src/lib/ranking.test.ts`

## Actions

**`saveRating({ roomId, filmId, stars, tags })`**
Member check. `stars` integer 1-5. `tags` subset of: `loved-the-ending`, `too-slow`, `great-chemistry`. Writes to the explicit id `<userId>_<filmId>` (upsert, so editing replaces), with `roomId`. Returns `{ saved: true }`.

**`startRound` (extension)**
1. Gather excluded ids for the room: films with a `seen` vote from either person in any earlier round (read earlier ballots server-side), plus films either person has rated.
2. Remove them from the candidate list before ranking.
3. Order the remainder with `rankByRatings` using both people's past ratings and tags (see below), with mood overlap as the base score.
4. Snapshot the inputs into `rounds.inputs` (exclusions, ratings used, mood chips) so the round is reproducible.

**`seedDemoHistory({ roomId })`** (host only, only when the partner is the bot)
Writes a few starter ratings for `userId = 'bot'` only, never for a real user. Gives personalization something to act on during a solo demo. Label it clearly as demo data in the UI.

## `rankByRatings` (deterministic)
Base score = mood overlap. Add a small bonus for films whose mood tags overlap tags of films either person rated 4-5, subtract for overlap with films rated 1-2. Break ties by the same `fnv1a` rule as the reveal. No randomness, so it is testable.

## UI
- After the reveal: stars (1-5) and optional reaction tags, one tap each, editable.
- A line on the next round's card explaining a personalized pick: "Because you rated Chungking Express highly" (built from the stored inputs, not generated).

## Tests
- Editing a rating overwrites, and exactly one row exists for that user and film.
- A film marked `seen` by one person never appears in the next round for that room.
- A rated film does not reappear.
- Changing a rating changes `rounds.inputs` and can change the order of the next shortlist.
- If exclusions leave fewer than 3 films, the round still starts with what remains and the UI says so.
- Rating a film outside the room's history is rejected (`invalid_input`).

## Acceptance
- [ ] Verified by hand with two accounts on the deployed URL: rate, start a new round, confirm the change
- [ ] Demo history clearly marked and never written for a real account
- [ ] `rounds.inputs` records exactly what the shortlist was built from

## Not in this PR
Live discovery (PR 8).

## As built
- Actions `saveRating` and `seedDemoHistory` (`src/actions/ratings.ts`), the `ratings` collection (`read: 'own'`) and a server-only `roundRankingInputs` collection that snapshots what each shortlist was built from. `rankByRatings` (`src/lib/ranking.ts`) is deterministic. The reveal screen has a "Your rating" panel (`FilmRating`), and the host gets "Start another round" after a match too.
- **Differs from the plan above:** only the film that was *picked* in a finished round can be rated. A rated film is left out of later shortlists for that person in every room, but if fewer than 3 fresh films remain, repeats come back (rated films first, then earlier picks and films marked seen) and are flagged on the round and on the vote screen. The first version failed with `no_new_films` instead; that was changed in review. Reaction tags are stored, not used in ranking.
- **Tests:** unit tests for ranking, `saveRating`, the snapshot lock, the demo ratings and the fallback tiers; `tests/ratings.spec.ts` (6 end-to-end tests: ratings private to their owner over socket and HTTP tools with a mutation check, edits replace, input validation and "only the pick", no client writes, the next round always starts and flags repeats, the rating panel and demo ratings). The end-to-end tests only assert things that hold however many ratings an account already has, because ratings cannot be deleted.
