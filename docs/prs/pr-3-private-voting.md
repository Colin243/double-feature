# PR 3: Moods, rounds and private voting

**Branch:** `feat/private-voting` · **Depends on:** PR 2 · **Estimate:** 4 h · **Day:** Mon Nov 23

Contracts: [CONTRACTS.md](./CONTRACTS.md)

## Goal
Both people set a mood, the host starts a round, both vote on the locked shortlist, and neither can see the other's ballot. Readiness is live.

## Files
- `src/lib/moods.ts`: chip vocabulary, `buildBrief`, `rankSeedFilms`
- `src/lib/ballot.ts`: `validateBallot(votes, shortlist)`
- `src/actions/index.ts`: add `setMood`, `startRound`, `submitBallot`
- `src/pages/(app)/room/[roomId].tsx`: mood step
- `src/pages/(app)/room/[roomId]/vote.tsx`: voting UI
- `src/components/FilmCard.tsx`, `VoteButtons.tsx`
- `tests/voting.spec.ts`, `src/lib/moods.test.ts`, `src/lib/ballot.test.ts`

## Pure helpers
- `buildBrief(hostMoods, guestMoods, hostRuntime, guestRuntime)`: union of chips, shorter non-zero runtime limit, then a plain sentence like "Make me laugh and break my heart, under 2 hours". Deterministic. The host can edit the text before the round starts.
- `rankSeedFilms(seedFilms, moods, maxRuntime)`: drop films over the runtime limit, score by overlap with the chips' film mood tags, order by score then seed order. If the filter removes everything, return the full seed set. Returns up to 6 Film snapshots.
- `validateBallot(votes, shortlist)`: every shortlist film id present exactly once, no unknown keys, every value in `want|maybe|pass|seen`.

## Action contracts

The handlers need a setup round before either player can call `setMood`. Add a host-only setup action that opens or resumes the first round for a ready room. Then have `startRound` lock that same round with the shortlist and brief so it retains both players’ preferences.

The first submission must win even if two requests arrive at the same time. The RecordRoom queue serializes the ballot lookup and write. The installed SDK upserts when given an explicit record ID, so only a confirmed missing ballot allows a write. A retry should repair the submitter’s readiness flag if the ballot was saved but the flag update failed.

**`setMood({ roundId, moods, runtime })`**
Member check. Round must be `setup`. Writes `hostMoods`/`hostRuntime` or the guest equivalents depending on the caller. Chips must be in the vocabulary. `invalid_input` otherwise.

**`startRound({ roomId, brief? })`**
Host only. Room must be `ready`. Locks the existing setup round by saving `status = 'voting'`, the ranked shortlist, and the edited or generated brief in one update. Repeated Start calls return the same round ID. The RecordRoom serializes Save and Start so a save ordered before Start contributes to the snapshot, and a save ordered after Start is rejected.

**`submitBallot({ roundId, votes })`**
1. Member check against the round's `memberIds` (the bot is not in it, so the human passes).
2. Round `status === 'voting'` else `wrong_status`.
3. `validateBallot` else `ballot_invalid`.
4. Read the ballot at `ballotId(roundId, userId)`. If it exists, preserve it and continue to the readiness update so a retry can repair a partial submission.
5. Write the ballot with `roundId`, `userId`, `votes`, `lockedAt = Date.now()`.
6. Set the caller's flat flag (`submittedHost` or `submittedGuest`).
7. If the room's `guestId === 'bot'`, also write the bot ballot from the seeded profile and set the bot's flag.
8. Return `{ submitted: true }` only. Never return `votes`.

Finalizing is PR 5. This PR stops at "both submitted".

## Bot profile
A fixed function `botVotes(shortlist)`: deterministic from the film id (for example by the hash of the id), tuned so a six-film shortlist usually contains one clear overlap and one disagreement. Document the rule in a comment so you can explain it.

## UI
- One card at a time: title, year, runtime, hook, mood tags. Four large buttons. "3 of 6". Back and forward within the card stack until submit.
- A review step before submit showing your own votes.
- Live "Sam is ready" indicator from the round's flat flags.
- Phone-first, keyboard shortcuts (1-4) on desktop, visible focus states.

## Tests
- Pure: `buildBrief` cases, `rankSeedFilms` with runtime filter and empty-result fallback, `validateBallot` accepts a full ballot and rejects missing, extra and invalid values.
- Integration: outsider cannot submit (`not_member`); submitting twice keeps the first ballot; flags flip independently; solo path with the demo partner reaches "both submitted" in under a minute.
- **Privacy (also covered in PR 4):** a client query for `ballots` returns nothing for every account.

## Acceptance
- [ ] Solo demo path works on the deployed URL
- [ ] Readiness updates live on both screens
- [ ] No response from any action contains ballot votes
- [ ] Round shortlist and brief are unchanged after start

## Not in this PR
Reveal, ratings, discovery.
