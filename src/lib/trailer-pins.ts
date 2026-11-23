import type { Trailer } from './trailer'

/**
 * Hand-picked trailers for the six films we ship, so they never cost a search
 * and never get the wrong film. A title search cannot tell a film from its
 * remake: it once returned the 2025 remake's trailer for the 1993 *The Wedding
 * Banquet*. Each was chosen on 23 Nov 2026 from the real YouTube results for
 * "<title> <year> official trailer": the right film and year, the best-known
 * channel on offer, and `embedHtml` present in the video details (so it can be
 * embedded). Nobody has watched them here; the panel shows each video's title,
 * and the "Watch on YouTube" link goes to the same video.
 *
 * Films found by discovery are not in this list and fall back to a search.
 */
export const pinnedTrailers: Readonly<Record<string, Trailer>> = {
  // Block 2 Distribution (4K restoration), published 2020-12-18, 1.2M views.
  'chungking-express-1994': { videoId: 'OPCug9jyG9k', title: 'CHUNGKING EXPRESS 4K | Official Trailer (English)' },
  // MUBI, 20th anniversary restoration, published 2021-03-19, 1.85M views.
  'in-the-mood-for-love-2000': { videoId: 'm8GuedsQnWQ', title: 'IN THE MOOD FOR LOVE | Official Trailer | 20th Anniversary Restoration' },
  // Block 2 Distribution (4K restoration), published 2020-12-09.
  'happy-together-1997': { videoId: '5VPvFaAWX9U', title: 'HAPPY TOGETHER 4K | Official Trailer (English)' },
  // The Samuel Goldwyn Films trailer for the 1993 film. The channel is small (about 3,000 views), but it
  // is the only English trailer for the original; the top search hit was the 2025 remake's trailer.
  'the-wedding-banquet-1993': { videoId: 'FZf75jjmDO0', title: '1993 The Wedding Banquet Official Trailer 1 Samuel Goldwyn Films' },
  // Rotten Tomatoes Classic Trailers, 373K views.
  'eat-drink-man-woman-1994': { videoId: 'l7pKpO8NErU', title: 'Eat Drink Man Woman Official Trailer #1 - Sihung Lung Movie (1994) HD' },
  // Focus Features, published 2007-07-23, 3.4M views.
  'lust-caution-2007': { videoId: 'CizN-DvGhrc', title: '"Lust, Caution" Trailer' },
}
