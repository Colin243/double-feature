# PR 5: Reveal logic

**Branch:** `feat/reveal-logic` · **Depends on:** PR 3 · **Estimate:** 3 h · **Day:** Tue Nov 24

Contracts: [CONTRACTS.md](./CONTRACTS.md). The scoring rules there are the spec.

## Goal
When both ballots exist, the server computes one result, stores it once, and both clients can read it. This is the piece you will explain in the live session.

## Files
- `src/lib/finalize.ts`: `finalizeRound` (pure) and `fnv1a`
- `src/lib/finalize.test.ts`
- `src/schemas/results.ts`, registered in `src/schemas.ts`
- `src/actions/index.ts`: extend `submitBallot` to call finalize, add `finalizeRound` action for retries

## `finalizeRound` (pure)
```ts
finalizeRound({ shortlist, hostVotes, guestVotes, roundId }): {
  outcome: 'match' | 'closest' | 'none'
  filmId: string | null
  score: number
  reason: string
}
```
Follow CONTRACTS exactly: eligibility, scores 3/2/1, tie-break by smallest `fnv1a(roundId + ':' + filmId)`, closest-call rule, `none` when nothing qualifies. `reason` is plain language ("You both picked Want to watch", "Sam wanted it, you passed").

## Why two racing finalizers are safe
- The function is pure, so every caller computes identical output from identical ballots.
- The result is written to the explicit id `result_<roundId>` with `uniqueOn: ['roundId']`, so a second write cannot create a duplicate row.
- Both submission and explicit retry run through the same RecordRoom mutation queue. Two writes remain separate. If status fails after result creation, the next call reuses the saved result.

## Action flow (inside `submitBallot`, after both flags are true)
1. Re-read both ballots with `tools.get` by id.
2. If either is missing, return (not both in yet).
3. Compute the result and write `results` with `ballots` included (receipts), `memberIds`, `outcome`, `filmId`, `score`, `reason`.
4. Set round `status = 'revealed'`.
5. On retry, use the existing deterministic result ID and finish the round status update.

`finalizeRound` as an action does the same from step 1, for a manual retry if a client ever finds both flags true with no result.

## Tests (unit, no accounts needed)
| Case | Expected |
|---|---|
| want+want vs want+maybe | want+want wins |
| want+maybe vs maybe+maybe | want+maybe wins |
| Equal scores | Same winner on every run; winner changes only if `roundId` changes |
| One `pass` on the best film | That film skipped |
| One `seen` on a film | Skipped, including in closest-call |
| Everything vetoed, one want+pass | `closest`, reason names who passed |
| Everything `seen` or pass+pass | `none` |
| Shortlist order changed | Winner unchanged for a tie (order must not decide) |
| Empty shortlist | `none` without throwing |

Integration: both submit at the same moment on the deployed app, then exactly one `results` row exists and both read the same `filmId`.

## Acceptance
- [ ] All unit cases pass
- [ ] Simultaneous submit gives exactly one result row
- [ ] Result is unreadable before both ballots exist, readable by members after
- [ ] You can explain each rule and the tie-break without looking

## Not in this PR
Reveal UI (PR 6), ratings (PR 7).
