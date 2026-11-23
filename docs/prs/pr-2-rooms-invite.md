# PR 2: Rooms and invites

**Branch:** `feat/rooms-invite` · **Depends on:** merged schemas PR (#2) · **Estimate:** 3 h · **Day:** Mon Nov 23

Contracts: [CONTRACTS.md](./CONTRACTS.md)

## Goal
A signed-in host creates a room and shares a link. A second signed-in person joins by link. A solo reviewer can add a demo partner instead.

## Files
- `src/actions/index.ts`: add `createRoom`, `joinRoom`, `addDemoPartner`
- `src/lib/rooms.ts`: pure helpers (`generateInviteCode`, `validateCode`)
- `src/pages/(app)/home.tsx`: create room button, paste-a-code field
- `src/pages/(app)/join/[code].tsx`: join route
- `src/pages/(app)/room/[roomId].tsx`: room shell (host, guest, status, copy-link). Mood setup comes in PR 3.
- `tests/rooms.spec.ts`

## Action contracts

**`createRoom()`** (no params)
1. Caller is signed in (platform enforces).
2. Create room with `hostId = ctx.userId`, `guestId = ''`, `status = 'waiting'`, `memberIds = [hostId]`, `inviteCode = generateInviteCode()` (8 chars from an unambiguous alphabet, e.g. no `0 O 1 I`).
3. If the create fails on `uniqueOn` (code collision), retry up to 3 times.
4. Return `{ roomId, inviteCode }`.

**`joinRoom({ code })`**
1. Validate `code` is a string of the expected length and alphabet. Else `invalid_input`.
2. Query rooms where `inviteCode = code`. None: `room_not_found`.
3. `hostId === ctx.userId`: `own_room`. Already in `memberIds`: return success (idempotent, same room).
4. `guestId` already set: `room_full`.
5. Update `guestId`, `status = 'ready'`, `memberIds = [hostId, guestId]`.
6. Return `{ roomId }`.

**`addDemoPartner({ roomId })`**
1. Caller must be the host (`not_host`), room must be `waiting` (`room_full` otherwise).
2. Set `guestId = 'bot'`, `status = 'ready'`. `memberIds` stays `[hostId]` (the bot is not a user).

Both actions first insert a server-only `roomSeatClaims` row with `uniqueOn: ['roomId']`. The SDK generates the record ID because explicit IDs upsert. The winning claimant applies the room update. A repeat by that claimant can finish an interrupted update. Other claimants receive `room_full`.

## UI
- Home: "Create a room" and "Join with a code". Signed-out visitors see sign-in first.
- `/join/<code>`: if signed out, send through sign-in and return to the same URL. Show clear states: joining, invalid link, room full, you are the host.
- Room shell: copy-link button, who has joined, "Play with a demo partner" for the host while waiting.
- Buttons disabled until `useMutations().ready`. Use `*Confirmed` calls where navigation depends on success.

## Tests
- Host creates a room; code is unique and well-formed.
- Guest joins by code; room becomes `ready`; both appear in `memberIds`.
- Third user gets `room_full`; host joining own room gets `own_room`; bad code gets `room_not_found` or `invalid_input`.
- Outsider cannot read the room (client query returns nothing).
- Repeat join by the same guest is a no-op success.
- Concurrent guest-vs-guest and guest-vs-bot attempts produce one winner, including when the winning room update needs a retry.
- Demo partner: host only; sets `guestId = 'bot'`.

## Acceptance
- [ ] All cases above pass with real accounts on the deployed URL
- [ ] Outsider cannot read any room or round
- [ ] Sign-in returns the guest to the join page
- [ ] No invite code appears in logs

## Not in this PR
Moods, voting, rounds, email invites.

## Log in NOTES.md
What you observed about the simultaneous-join race, and how `'collaborator'` read behaved.
