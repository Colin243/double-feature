export interface Film {
  id: string
  title: string
  year: number
  runtimeMinutes: number
  moods: readonly string[]
  hook: string
}

export const seedFilms: readonly Film[] = [
  {
    id: 'in-the-mood-for-love-2000',
    title: 'In the Mood for Love',
    year: 2000,
    runtimeMinutes: 98,
    moods: ['romantic', 'wistful'],
    hook: 'Two neighbors in 1960s Hong Kong grow close over a suspicion they share.',
  },
  {
    id: 'chungking-express-1994',
    title: 'Chungking Express',
    year: 1994,
    runtimeMinutes: 102,
    moods: ['playful', 'romantic'],
    hook: 'Two lovelorn cops stumble into unexpected encounters in late-night Hong Kong.',
  },
  {
    id: 'happy-together-1997',
    title: 'Happy Together',
    year: 1997,
    runtimeMinutes: 96,
    moods: ['intense', 'wistful'],
    hook: 'A couple from Hong Kong tries to start over in Buenos Aires.',
  },
  {
    id: 'the-wedding-banquet-1993',
    title: 'The Wedding Banquet',
    year: 1993,
    runtimeMinutes: 106,
    moods: ['funny', 'heartwarming'],
    hook: 'A marriage of convenience gets complicated when the groom’s parents arrive to celebrate.',
  },
  {
    id: 'eat-drink-man-woman-1994',
    title: 'Eat Drink Man Woman',
    year: 1994,
    runtimeMinutes: 124,
    moods: ['funny', 'heartwarming'],
    hook: 'A Taipei chef and his three daughters bring their secrets to Sunday dinner.',
  },
  {
    id: 'lust-caution-2007',
    title: 'Lust, Caution',
    year: 2007,
    runtimeMinutes: 155,
    moods: ['intense', 'suspenseful'],
    hook: 'A young resistance recruit takes on a dangerous undercover role in wartime Shanghai.',
  },
]
