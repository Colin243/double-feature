# PR 11: Wildcard rematch

**Branch:** `feat/wildcard-round` · **Depends on:** PR 6 · **Estimate:** 2 h · **Day:** Thu Nov 26

Contracts: [CONTRACTS.md](./CONTRACTS.md)

Stretch. Only start this when the core loop (PRs 2 through 7) is verified on the deployed app. If you would rather build "predict your partner" instead, replace this spec and say so in `NOTES.md`. Do not build both.

## Goal
After a `none` outcome, each person nominates one film and the pair votes on those two as a quick second round.

## Files
- `src/actions/index.ts`: `nominateWildcard`, `startWildcardRound`
- `src/lib/wildcard.ts`: `buildWildcardShortlist`
- `src/pages/(app)/room/[roomId]/wildcard.tsx`
- tests

## Behaviour
- Available only when the latest round's result is `none` and no wildcard round exists for it.
- **`nominateWildcard({ roundId, filmId | manualTitle })`**: member check. A nomination is either a film from the previous shortlist (not marked `seen` by either person) or a manual title and year entered by the nominator. Stores a Film snapshot on a small field of the round, one per person (flat fields `hostWildcard`, `guestWildcard`; additive columns).
- **`startWildcardRound({ roundId })`**: host only, once both nominations exist (or the host skips the partner's with the bot's pick if partnered with the demo bot). Creates a new round with a two-film shortlist and the same voting and reveal rules. Ties and scoring use `finalizeRound` unchanged.
- If the wildcard round also ends `none`, say so and offer "Start a fresh round". No second wildcard.

## Tests
- Wildcard offered only after `none`.
- Two nominations produce a two-film shortlist; duplicate nominations are collapsed.
- Manual title is validated and length-capped.
- Wildcard round reuses `finalizeRound` and reveals identically on both screens.

## Acceptance
- [ ] Forced no-match leads to a working wildcard round on the deployed app
- [ ] Core flow unaffected when wildcard is never used

## Not in this PR
A second wildcard, more than two nominees.
