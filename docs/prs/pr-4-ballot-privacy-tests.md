# PR 4: Ballot privacy and concurrency tests

**Branch:** `test/ballot-privacy` · **Depends on:** PR 3 · **Estimate:** 2 h · **Day:** Mon Nov 23

Contracts: [CONTRACTS.md](./CONTRACTS.md)

## Goal
Prove, with real accounts, that ballots are private and that the room and round permissions hold. This is the evidence for the writeup's main tradeoff.

## Before writing tests
Read `tests/collab.spec.ts`, `tests/helpers/` and `npx deepspace test run --help`. Work out how the existing two-user helpers create accounts and whether a third user is supported. Record what you learn in `NOTES.md`. If three accounts are not supported in automation, run the third-account checks by hand and log them.

## Files
- `tests/privacy.spec.ts`
- helpers added under `tests/helpers/` if needed

## Cases
| # | Case | Expected |
|---|---|---|
| 1 | Host and guest query `ballots` directly | Empty result for both, including their own |
| 2 | Same, through a live subscription | No records delivered |
| 3 | Admin account queries `ballots` | Empty (`read: false` for admin too) |
| 4 | Outsider queries `rooms` and `rounds` | Empty |
| 5 | Outsider calls `submitBallot`, `startRound`, `setMood` | `not_member` or `not_host` |
| 6 | Guest calls `startRound` | `not_host` |
| 7 | Guest and host submit at the same moment | Both ballots saved, both flags true, nothing lost |
| 8 | Same user submits twice with different votes | First ballot kept |
| 9 | Ballot with missing film, extra key, bad vote | `ballot_invalid` |
| 10 | Any action response during voting | Contains no `votes` field |

Case 7 matters because both actions update the same round row. Because readiness uses two separate flat fields, neither write can clobber the other. If the test ever fails, do not paper over it. Log it.

## How to run
`npm test` for the quick set, then repeat the privacy cases manually against the deployed URL with three real accounts. A passing local run is not enough for the privacy claim.

## Acceptance
- [ ] Cases 1-10 pass locally
- [ ] Cases 1, 2, 4, 5 and 7 confirmed by hand on the deployed URL
- [ ] Results recorded in `NOTES.md` verification checklist

## Not in this PR
New features. If a test fails, fix it in a separate commit on the relevant earlier PR branch or a follow-up, and log it in the agent-mistakes section.
