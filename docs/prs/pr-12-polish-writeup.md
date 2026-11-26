# PR 12: Polish, final verification and writeup

**Branch:** `chore/polish-writeup` · **Depends on:** all earlier PRs that landed · **Estimate:** 4 h · **Day:** Thu Nov 26

Contracts: [CONTRACTS.md](./CONTRACTS.md)

## Goal
Make the deployed app solid on its important path, finish the writeup, and submit by mid-afternoon (deadline 11:59 p.m. ET).

## Polish (only what the core path needs)
- Remove the scaffold placeholder text and unused pages.
- States for every screen: loading, empty, error, waiting for partner, invalid link, room full.
- Mobile at 375 px for the whole flow, checked on a real phone.
- Keyboard use on voting and reveal, visible focus, labels on every button, sufficient contrast.
- Reduced-motion fallback on the reveal.
- Page titles and a plain home page that explains the app in one sentence and offers "Try it solo".

## Final verification (by hand, on the deployed URL)
Tick only what you did yourself. Copy results into `NOTES.md`.
- [ ] Sign-in with a fresh account
- [ ] Create, join, set mood, vote, reveal, rate, start another round
- [ ] Solo path with the demo partner under a minute
- [ ] Ballot privacy re-checked with three accounts
- [ ] Simultaneous submit gives one result
- [ ] No-match path and closest-call path
- [ ] Discovery run, and a forced-failure fallback
- [ ] Trailer plays (if PR 9 landed)
- [ ] Phone check
- [ ] Secrets scan: `git log -p | grep` for keys, `.dev.vars` ignored, no keys in the built client bundle
- [ ] A rollback rehearsal: `npx deepspace releases`, know the id to roll back to

## Writeup (portal field)
Assemble from `NOTES.md` and the PR descriptions. Keep it short and honest.
1. **What I built.** Two-person movie night: private ballots, server-decided reveal, ratings that shape the next round.
2. **Integrations used and why.** YouTube supplies trailers on demand. If discovery is deployed, describe the actual providers and fallback from PR #9. Copy-link invites do not use email.
3. **Main tradeoff.** Ballots are server-only so privacy is enforced by the platform, at the cost of routing every vote through an action instead of a live query. Name the second tradeoff: seed set plus fallback over a model-only shortlist, so the demo is reliable.
4. **What the agent did.** Drafted the plan, schemas, actions, UI and tests.
5. **What I verified myself.** The three-account privacy check, the simultaneous submit, the solo demo, the phone check, and the list of things I corrected from `NOTES.md`'s agent-mistakes section.
6. **Unfinished and next.** Anything cut, and what you would do with another week.

## Submission
- Live URL: `https://double-feature.app.space`
- Repository: `https://github.com/Colin243/double-feature`
- Paste the writeup. Submit mid-afternoon, not at 11 p.m.

## Verification recorded for this branch

- [x] Landing copy and preview description updated
- [x] Signed-in solo entry uses the existing demo-partner action
- [x] TypeScript, ESLint, and 92 unit tests passed
- [ ] Run the new solo browser test. The sandbox blocked DeepSpace from saving its refreshed token.
- [ ] Verify the final release on a real phone and complete the portal submission.

The writeup draft and previously reported live verification are in [NOTES.md](../../NOTES.md).

## Acceptance
- [ ] Checklist above ticked honestly
- [ ] `main` deployed from a clean checkout and the live URL matches
- [ ] Writeup submitted and a screenshot of the confirmation saved
