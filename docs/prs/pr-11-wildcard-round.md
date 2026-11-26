# Keep or Risk

**GitHub PR:** #12

Keep or Risk is available after a no-match reveal. Players each lock a nomination from the eligible shortlist or enter a title and year. Films marked already seen by either player are excluded. Matching nominations win immediately.

When nominations differ, both players see the films and secretly lock Keep or Risk. A lone Risk wins for that player. Matching choices trigger a server coin flip. The winner and both choices are revealed together. A demo partner supplies its nomination and choice automatically.

The server stores one private game per source round, exposes only phase-appropriate data to room members, and saves the winner with the last choice. Repeat requests return the saved winner. The host can still start a fresh round.

The browser test covers two players locking nominations and choices, seeing the same winner, and reloading the result.
