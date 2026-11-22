# Double Feature: Build Notes

Running log for the DeepSpace build exercise. Deadline: Thu Nov 26, 2026, 11:59 PM ET.
The final writeup is drawn from this file, so keep entries honest and specific.

**Writeup must cover:** what I built, which DeepSpace integrations I used, the main tradeoff, what the agent did, what I verified myself.

---

## Project summary

Double Feature is a two-person movie-night app. Two people join one room, set a shared mood, vote privately on a shortlist, and see the same winning film revealed on both screens. They rate it afterwards, and those ratings shape the next shortlist.

## Scope

**Core (must work on the deployed app)**
1. Create a room and join by invite link (plus a demo-partner button for solo reviewers).
2. Shared mood setup that produces an editable brief.
3. Private voting: Want to watch / Maybe / Pass / Already seen.
4. Server-decided reveal, identical on both screens.
5. 1-5 star rating, used to shape the next shortlist.

**Stretch (only after the core is verified live)**
- Discovery with Exa + model ranking from mood and past ratings
- Emailed invite link
- Two-card wildcard round after a no-match
- Predict-your-partner mini game

**Deliberately out of scope (explain in writeup)**
- More than two people per room, multiple concurrent rounds per room
- Streaming availability, accounts beyond OAuth sign-in

## Key decisions

| Decision | Choice | Why |
|---|---|---|
| Source control | GitHub is the Git authority for the DeepSpace app | The task requires a repo, and DeepSpace locks the choice on the first source-producing action. Never run `deepspace push`. |
| Ballot privacy | `ballots` collection is `read: false` for all roles; only server actions touch it | Actions bypass RBAC, so each action checks room membership itself. |
| Finalize race | `finalizeRound` is a pure function of the two ballots, written to explicit ID `result_<roundId>` with `uniqueOn: ['roundId']` | No transaction API is documented, so racing writers must produce identical data. |
| Readiness flags | Flat fields `submittedHost` / `submittedGuest`, not a nested map | Concurrent updates merge field by field; a nested object could be clobbered. |
| Solo review | Server-side demo-partner bot (`guestId = 'bot'`), not a user account | Guest sign-in isn't available and public signup is closed. |
| Tie-break | Seeded shuffle keyed on round ID | Shortlist order would let the model's #1 pick win every tie. |

## Open questions
- [ ] Is there a DeepSpace catalog integration for movie metadata (poster, runtime, ID)? Check `npx deepspace integrations list`. If not, either call TMDB from an action with the key in `deepspace secrets`, or skip posters.
- [ ] Which third integration, if any, earns its place? The task says no minimum, but the bar box says three. Candidates: Exa, hosted model, Resend.
- [ ] Does `read: false` on a collection still allow actions to read it? Test early.
- [ ] Does the OAuth flow return a guest to the join page after sign-in?

---

## Daily log

Format for each day: **Built**, **Agent did**, **I verified / changed**, **Surprises and bugs**, **Next**.

### Sun Nov 22: Setup
**Built**
- Project folder and GitHub repo created.
- Plan agreed (see Scope and Key decisions).

**Agent did**
- Read the DeepSpace docs, skill repo and org examples and summarized permissions, server actions, real-time sync, integrations and deploy behavior.
- Proposed the plan and data model above.
- Created this file and the repo.

**I verified / changed**
- Pending: the docs summaries were second-hand. I still need to confirm permission and action behavior myself with real accounts.

**Surprises and bugs**
- None yet.

**Next**
- Scaffold with `npm create deepspace@latest`, sign in with `npx deepspace auth login`, deploy an empty shell, confirm sign-in on the live URL.

### Mon Nov 23: Rooms and private voting
_(fill in)_

### Tue Nov 24: Reveal and ratings
_(fill in)_

### Wed Nov 25: Discovery and integrations
_(fill in)_

### Thu Nov 26: Polish and submit
_(fill in)_

---

## Verification checklist (tick only what I checked myself)

- [ ] Sign-in works on the live URL
- [ ] Guest joins by link; outsider cannot read the room
- [ ] A third person cannot join a full room
- [ ] No account can read another's ballot via API or live subscription
- [ ] Readiness updates live on both screens
- [ ] Double submit leaves the first ballot unchanged
- [ ] Fake film ID or missing vote is rejected
- [ ] Solo demo-partner path completes in under a minute
- [ ] Reveal tie-break is deterministic and identical on both screens
- [ ] No-match round handled
- [ ] Simultaneous submits produce exactly one result
- [ ] Rating edit is saved once and changes the next recommendation input
- [ ] Already-seen film never reappears
- [ ] Mobile layout checked on a phone
- [ ] No secrets in the repo or logs

## Agent log: things the agent got wrong or I changed
_(Add entries as they happen: what it produced, what was wrong, what I did instead.)_

## Writeup draft
_(Start assembling on Thursday morning from the sections above.)_
