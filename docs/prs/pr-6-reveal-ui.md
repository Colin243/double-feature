# PR 6: Reveal screen

**Branch:** `feat/reveal-ui` · **Depends on:** PR 5 · **Estimate:** 3 h · **Day:** Tue Nov 24

Contracts: [CONTRACTS.md](./CONTRACTS.md)

## Goal
Both screens show the same result the moment it exists, with a clear reason, and each person can see both ballots afterwards.

## Files
- `src/pages/(app)/room/[roomId]/reveal.tsx`
- `src/components/RevealCard.tsx`, `Receipts.tsx`, `WaitingForPartner.tsx`
- `src/lib/tasteMatch.ts` + test
- `src/styles.css` additions (flip animation with `prefers-reduced-motion` fallback)
- `tests/reveal.spec.ts`

## Behaviour
- Subscribe to the round and its `results` row. When `results` appears, both clients navigate to the reveal view. A late client that loads the page after the reveal sees the same card.
- **Outcome `match`:** flip the winning card, show the reason, runtime and hook.
- **Outcome `closest`:** label it plainly as a compromise ("Not a perfect match, but the nearest thing") and show who wanted or passed.
- **Outcome `none`:** say there was no match; show "Start another round" for the host.
- **Receipts:** a table of each film with both people's votes, shown only after reveal, plus a taste-match score (`tasteMatch(hostVotes, guestVotes)` = share of films where votes are equal, as "4 of 6 agreed").
- Waiting state while the partner has not submitted: "Waiting for Sam" with no information about their votes.
- The host's "Start another round" creates round `number + 1` (shortlist logic comes from PR 7 and PR 8; until then reuse the seed ranking minus already-picked films).

## Design constraints
- One short animation (card flip, about 600 ms). With `prefers-reduced-motion`, show the card without motion.
- Phone-first; the card and receipts must fit a 375 px wide screen without horizontal scrolling.
- Never read ballots from a client query. Receipts come from `results.ballots` only.

## Tests
- Both clients show the same film id for the same round.
- `tasteMatch` unit cases (all agree, none agree, mixed).
- A client that joins late sees the result without waiting.
- No-match round shows the correct state and the host-only button.
- Reduced-motion path renders without animation classes.

## Acceptance
- [ ] Same winner on both screens, five runs in a row, on the deployed URL
- [ ] Closest-call label appears for a forced closest case
- [ ] Layout checked at 375 px
- [ ] No ballot is visible before the reveal in any network response

## Not in this PR
Ratings and trailers.

## As built
Where this differs from the plan above:
- **No separate route.** The reveal is a view inside the room screen (`RoomRound` switches to `RoundReveal` when the round's status becomes `revealed`), so both players move to it live, and a player who opens the room later lands on the same card. There is no `reveal.tsx` page.
- **Components:** `RevealCard`, `Receipts`, `RoundReveal`; no `WaitingForPartner` (the existing "Ballot submitted" screen already waits without showing anything). Styles are in `room-round.css`, not `styles.css`.
- **Pure helpers:** `src/lib/tasteMatch.ts` (`tasteMatch`, `personalizeReason`, which turns "The host ... the guest ..." into "You ... your partner ..." for each viewer) with unit tests; `use-reduced-motion.ts`.
- **Start another round** is the existing `openSetupRound` action, now following the room's latest round, so `number` is no longer fixed at 1. A later round skips earlier picks and films marked seen. See CONTRACTS.
- **Tests:** `tests/reveal.spec.ts` (same pick for both players with the hash-predicted film, closest-call label and personalised reasons, no-match with the host-only button and round two, live arrival and late arrival, reduced motion, 375px no sideways scroll, no votes in the other player's browser frames before the reveal, solo demo room) and `src/actions/next-round.test.ts`.
- **Not done here:** the "five runs in a row on the deployed URL" acceptance item (not deployed yet).
