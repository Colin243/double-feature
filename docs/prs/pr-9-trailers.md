# PR 9: Trailers on the reveal

**Branch:** `feat/trailers` · **Depends on:** PR 6 · **Estimate:** 2 h · **Day:** Wed Nov 25

Contracts: [CONTRACTS.md](./CONTRACTS.md)

## Goal
The reveal card plays an embedded trailer. This is the leading third integration, chosen because it improves the reveal more than email would.

## Before coding
```
npx deepspace integrations info youtube/search-videos
```
Record the real response shape (embed link field, title) in `NOTES.md`. `youtube/search-videos` costs about $0.013 per call, so cache.

## Files
- `src/schemas/trailers.ts`, registered in `src/schemas.ts`
- `src/lib/trailer.ts`: `trailerQuery(film)`, `pickEmbed(results, film)`
- `src/actions/index.ts`: `getTrailer`
- `src/components/TrailerEmbed.tsx`
- tests

## `getTrailer({ roundId, filmId })`
1. Member check against the round's `memberIds`. The film must be in the round's shortlist (prevents using the action as a free search box).
2. Read `trailers/<filmId>`. If present, return it.
3. Otherwise call `youtube/search-videos` with `"<title> <year> official trailer"`.
4. `pickEmbed`: prefer a result whose title contains the film title and "trailer"; reject results that do not match. If none match, store a negative cache entry (`embedUrl = ''`) so the film is not searched again.
5. Write `trailers/<filmId>` and return `{ embedUrl, title }` or `{ embedUrl: null }`.

## UI
- Show a poster-less card with a "Watch trailer" button. Load the embed only when clicked (no autoplay, no third-party load until then).
- If no trailer, hide the button. The reveal must work unchanged.
- Include a link to the YouTube result for attribution.

## Tests
- `trailerQuery` and `pickEmbed` pure cases (match, no match, ambiguous).
- Second call for the same film does not call the integration (check the cache hit).
- A film not in the shortlist is refused.
- Reveal renders with no trailer found.

## Acceptance
- [ ] Trailer plays on the deployed reveal for at least two seed films
- [ ] Cache hit confirmed in a second run
- [ ] Reveal works with YouTube forced to fail

## Not in this PR
Poster images.

## As built
- **Differs from the plan above:** the action is `getTrailer({ roundId, filmId })` returning `{ trailer: { videoId, title } | null }` (not an `embedUrl`), the embed is `youtube-nocookie.com`, and lookups for one film are serialized by a per-film queue (`src/server/trailer-queue.ts`) so a slow search never delays other films or rooms.
- **Added in review:** hand-picked trailers for the six films we ship (`src/lib/trailer-pins.ts`), a visible "Showing: <video title>" caption, daily limits on fresh searches, a fix for upload titles that start with the year, and end-to-end tests (`tests/trailers.spec.ts`). See `NOTES.md` for why: the first version returned the 2025 remake's trailer for the 1993 *The Wedding Banquet*.
- **Acceptance:** "plays on the deployed reveal for at least two seed films" and "reveal works with YouTube forced to fail" are not done here (nothing is deployed yet); the pinned path was exercised end to end locally.
