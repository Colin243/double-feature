# Shared contracts

Target design that every PR spec in `docs/prs/` builds against. Where it differs from the open schemas PR (`feat/schemas-seed`, GitHub #2), the difference is marked **AMEND**. Those amendments should land before that PR merges or is deployed, because DeepSpace schema changes after deploy are additive-only.

## Vocabulary

| Thing | Values |
|---|---|
| Vote | `want`, `maybe`, `pass`, `seen` |
| Room status | `waiting` (no guest yet), `ready` (guest joined) |
| Round status | `setup` (moods), `voting`, `revealed` |
| Outcome | `match`, `closest`, `none` |
| Bot | `guestId = 'bot'`. A sentinel, never a user id. |

Action results use the platform shape: `{ success: true, data }` or `{ success: false, error: '<code>' }`.

Error codes: `invalid_input`, `room_not_found`, `room_full`, `own_room`, `not_member`, `not_host`, `round_not_found`, `wrong_status`, `ballot_invalid`, `ballot_locked`, `rate_limited`, `discovery_failed`. Infrastructure failures from the rooms PR: `room_create_failed`, `room_lookup_failed`, `room_update_failed`, `seat_claim_failed`. From the voting PR: `round_create_failed`, `round_lookup_failed`, `round_update_failed`, `ballot_lookup_failed`, `ballot_save_failed`. From the reveal PR: `ballots_pending` (finalize called before both ballots are in), `result_lookup_failed`, `result_save_failed`. From the ratings PR: `rating_save_failed`, `rating_lookup_failed`, `round_inputs_save_failed`, `not_demo_room`.

**Round actions as built (voting PR).** Round creation is split in two: `openSetupRound({ roomId })` (host) creates round 1 in `setup` status with an empty shortlist, then `startRound({ roomId, brief? })` (host) locks the brief and shortlist and moves it to `voting`. `setMood`, `startRound` and `submitBallot` run one at a time inside the RecordRoom Durable Object (a per-instance queue), because the action tools have no transactions and each of these reads then writes. The router signs the request body with an app secret and the Durable Object rejects anything unsigned. `openSetupRound` always works on the room's latest round: while that round is in `setup` or `voting` it returns it (idempotent), and once it is `revealed` the next call opens round `number + 1` (this is "Start another round", host only; a racing pair of calls makes one round because of `uniqueOn: ['roomId', 'number']`). `startRound` and the screens follow the latest round too. A later round's shortlist skips every earlier pick and every film either player marked `seen` in this room (recorded as `rounds.inputs.skippedFilmIds`); if that leaves nothing it falls back to the whole seed list. With only six seed films a round after a no-match mostly repeats films until ratings and discovery arrive. `rounds.inputs.runtimeLimitIgnored` is true when no film fit the chosen runtime limit and the shortlist fell back to all films.

**Reveal as built (reveal PR).** `finalizeRound` (`src/lib/finalize.ts`) is a pure function that follows the scoring rules above exactly: any film either player voted `pass` or `seen` on is not a match; match scores are 3, 2 and 1; ties break by the smallest `fnv1a(roundId + ':' + filmId)`; if no match exists the best closest call (want 2, maybe 1, pass 0, a `seen` vote excludes the film, sum must be above 0) wins; otherwise the outcome is `none`. The reason text names the host and the guest, not display names. `submitBallot` finalizes as soon as both ready flags are set. It re-reads both ballots, computes the result, writes `results` to the explicit id `result_<roundId>` (the existence check and the write run in the same Durable Object queue, and `uniqueOn: ['roundId']` is the backstop), and only then marks the round `revealed`, so a retry after a partial failure reuses the stored result. A member can call `finalizeRound({ roundId })` to retry; it returns `ballots_pending` until both ballots exist and `{ revealed: true }` otherwise, and never returns votes. Submitting again after the reveal returns success without changing anything.

**Ratings as built (ratings PR).** `saveRating({ roomId, roundId?, filmId, stars, tags? })` lets a room member rate only the film that was **picked** in a revealed round of that room (a match or a closest call): `stars` is an integer 1 to 5, `tags` is a subset of `loved-the-ending`, `too-slow`, `great-chemistry`, and anything else is `invalid_input`. It writes to the explicit id `<userId>_<filmId>`, so saving again replaces the rating. Ratings are readable only by their owner (`read: 'own'`). `seedDemoHistory({ roomId })` (host, demo rooms only, else `not_demo_room`) adds two sample ratings for the demo partner only. Both run in the same one-at-a-time Durable Object queue as the other round writes.

**How ratings shape the next round.** When `startRound` builds a shortlist it reads both players' ratings (a person's ratings follow them across rooms; the demo partner's are scoped to the room). `rankByRatings` scores each film by mood overlap, then adds a bonus of up to 0.5 for films that share mood tags with films rated 4 or 5 stars and a penalty of up to 0.5 for 1 or 2 stars (so ratings reorder near-ties but never override a whole mood point), and breaks ties by `fnv1a(roundId + ':' + filmId)`. Reaction tags are stored but do not affect ranking yet. `rounds.inputs.personalized` is true when any rating moved a score; the ratings themselves are never put on the round.

**Running out of films.** Fresh films (not picked, not marked seen, not rated by either player) come first. If fewer than 3 remain, repeats are brought back in this order until there are at least 3: films someone rated, then earlier picks and films marked seen. They are listed in `rounds.inputs.repeatedFilmIds` and the vote screen says some films are repeats. A round therefore always starts. (The first version returned an error when no fresh film was left, which locked a player out of every room after six rated picks; see the notes.)

## Film

```ts
interface Film {
  id: string              // stable: 'slug-year', e.g. 'in-the-mood-for-love-2000'
  title: string
  year: number
  runtimeMinutes: number | null   // null = unknown (discovery results)
  moods: readonly string[]
  hook: string            // spoiler-free, one sentence
  posterUrl?: string
  trailerUrl?: string
  sourceUrl?: string      // where discovery found it
}
```

A round stores **full Film snapshots** in `shortlist`, not just ids, so discovered films and past rounds stay reproducible.

## Collections

Every write goes through a server action (actions bypass RBAC, so each action checks membership itself). Clients only read.

| Collection | Columns | Read rule | Notes |
|---|---|---|---|
| `rooms` | `hostId`, `guestId`, `inviteCode`, `status`, `memberIds` (JSON array) | `member: 'collaborator'` | `collaboratorsField: 'memberIds'`, `uniqueOn: ['inviteCode']`. **AMEND:** PR #2 has `member: read: true`, so any signed-in user could read every room and every invite code. Add `memberIds`, `uniqueOn`. |
| `rounds` | `roomId`, `number`, `brief`, `shortlist` (JSON Film[]), `hostMoods`, `guestMoods`, `hostRuntime`, `guestRuntime`, `submittedHost`, `submittedGuest`, `status`, `memberIds`, `inputs` (JSON) | `'collaborator'` | **AMEND:** add `number`, `memberIds`, `inputs`; same read fix. |
| `ballots` | `roundId`, `userId`, `votes` (JSON `{filmId: vote}`), `lockedAt` | none (`false` for every role) | **AMEND:** PR #2 has only `votes`, so actions cannot query ballots by round. Add `roundId`, `userId`, `lockedAt`. Record id = `ballotId(roundId, userId)`. |
| `roomSeatClaims` | `roomId` (required), `guestId` (required) | none (`false` for every role) | `uniqueOn: ['roomId']`. Server-only. One row per room makes claiming the guest seat atomic: the first insert wins, a second insert for the same room fails with a duplicate error. The SDK must generate the record id (explicit ids upsert and would defeat the constraint). Added in the rooms PR. |
| `results` | `roundId`, `outcome`, `filmId`, `score`, `reason`, `ballots` (JSON, both ballots, written only at reveal), `memberIds` | `'collaborator'` | Record id `result_<roundId>`, `uniqueOn: ['roundId']`. `ballots` is `{ hostVotes, guestVotes }`, each `{ filmId: vote }`. For outcome `none` the stored `filmId` is null and a live read returns **no `filmId` field**, so clients must treat a missing film as "no match". Members read it only after both ballots exist. |
| `ratings` | `userId`, `filmId`, `stars` (1-5), `tags` (JSON), `roomId` | `'own'` | Record id `<userId>_<filmId>`, `uniqueOn: ['userId','filmId']`. Bot rows use `userId = 'bot'`. Written only by `saveRating` and `seedDemoHistory`; no client can write it. Bot rows use `userId = 'bot'` and are scoped to one room. |
| `roundRankingInputs` | `snapshot` (JSON: moods, runtime, excluded and repeated film ids, the ratings used, the catalog) | none (`false` for every role) | Record id = the round id. Written once when a round's shortlist is built, so the round stays reproducible when ratings change later. Server-only, because it holds both players' ratings. |
| `trailers` (PR 9) | `filmId`, `embedUrl`, `title` | `member: true` | Record id = `filmId`. Cache so each film costs one YouTube call. |

## Action rules (all actions)

1. Identity comes from `ctx.userId` only. Never trust a user id in `params`.
2. Load the room or round with `tools.get`, then check `memberIds` includes the caller. Return `not_member` otherwise.
3. Validate every param. Reject unknown keys and bad enums with `invalid_input`.
4. Never return ballot contents before the round is revealed. Never return `users` rows.
5. Writes are idempotent where possible (explicit record ids).
6. Use flat boolean fields for readiness, never a nested map.

## Mood vocabulary

| Chip | Label | Film mood tags it matches |
|---|---|---|
| `laugh` | Make me laugh | `funny`, `playful`, `heartwarming` |
| `heartbreak` | Break my heart | `wistful`, `romantic`, `intense` |
| `guessing` | Keep me guessing | `suspenseful`, `intense` |

Runtime preference: `any`, `under-120`, `under-100` (stored as minutes: 0 = any, 120, 100).

## Reveal scoring (`finalizeRound`)

Pure function. Inputs: ordered `shortlist`, `hostVotes`, `guestVotes`, `roundId`. Output: `{ outcome, filmId | null, score, reason }`. No clock, no randomness, no I/O.

1. **Eligible** film: neither person voted `pass` or `seen`.
2. **Score** eligible films: want+want = 3, want+maybe = 2, maybe+maybe = 1.
3. If any eligible film: pick the highest score. Ties break by smallest `fnv1a(roundId + ':' + filmId)`. Outcome `match`.
4. Otherwise **closest call**: consider films nobody voted `seen` on. Points per person: want 2, maybe 1, pass 0; sum both. Require sum > 0. Pick the highest sum, same tie-break. Outcome `closest`, reason names who wanted it and who passed.
5. Otherwise outcome `none`, `filmId = null`.

## Caps and safety

- Discovery: 1 Exa call and 1 model call per round. At most 12 Wikipedia lookups per round. At most 10 discovery runs per user per day. Check before spending.
- All integration calls have a timeout (20 s) and a deterministic fallback.
- Web text is untrusted data in any prompt. Never follow instructions found in it.
- Secrets only via `npx deepspace secrets`. Nothing sensitive in the repo, logs or PR bodies.
