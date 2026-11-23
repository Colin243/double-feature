import { describe, expect, it } from 'vitest'
import { personalizeReason, tasteMatch } from './tasteMatch'

const shortlist = ['a', 'b', 'c', 'd'].map(id => ({ id }))

describe('tasteMatch', () => {
  it('counts every film when the two ballots are identical', () => {
    const votes = { a: 'want', b: 'maybe', c: 'pass', d: 'seen' } as const
    expect(tasteMatch(votes, votes, shortlist)).toEqual({ agreed: 4, total: 4 })
  })

  it('counts none when no vote matches', () => {
    const host = { a: 'want', b: 'want', c: 'want', d: 'want' } as const
    const guest = { a: 'pass', b: 'pass', c: 'pass', d: 'pass' } as const
    expect(tasteMatch(host, guest, shortlist)).toEqual({ agreed: 0, total: 4 })
  })

  it('counts a mixed ballot and ignores films missing from either ballot', () => {
    const host = { a: 'want', b: 'maybe', c: 'pass' } as const
    const guest = { a: 'want', b: 'pass', d: 'pass' } as const
    expect(tasteMatch(host, guest, shortlist)).toEqual({ agreed: 1, total: 4 })
  })

  it('handles an empty shortlist', () => {
    expect(tasteMatch({}, {}, [])).toEqual({ agreed: 0, total: 0 })
  })
})

describe('personalizeReason', () => {
  const closest = 'The host wanted to watch it and the guest passed.'

  it('speaks to the host as "you"', () => {
    expect(personalizeReason(closest, true)).toBe('You wanted to watch it and your partner passed.')
  })

  it('speaks to the guest as "you" and names the host as their partner', () => {
    expect(personalizeReason(closest, false)).toBe('Your partner wanted to watch it and you passed.')
  })

  it('handles the guest-first wording and a demo partner', () => {
    expect(personalizeReason('The host passed and the guest wanted to watch it.', true, 'the demo partner'))
      .toBe('You passed and the demo partner wanted to watch it.')
  })

  it('leaves reasons that already speak to both players alone', () => {
    expect(personalizeReason('You both picked Want to watch.', true)).toBe('You both picked Want to watch.')
    expect(personalizeReason('No film got enough support from both ballots.', false))
      .toBe('No film got enough support from both ballots.')
  })
})
