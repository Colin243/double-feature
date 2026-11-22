// One queue per RecordRoom instance. Mood, start, and ballot writes share it.
export class RoundMutationQueue {
  private tail: Promise<void> = Promise.resolve()

  run<T>(mutate: () => Promise<T>): Promise<T> {
    const result = this.tail.then(mutate)
    this.tail = result.then(() => undefined, () => undefined)
    return result
  }
}

export const roundMutationPath = '/internal/round-mutation'

export function isRoundMutation(name: string): name is 'setMood' | 'startRound' | 'submitBallot' {
  return name === 'setMood' || name === 'startRound' || name === 'submitBallot'
}
