import { computeHmacHex, timingSafeEqualStrings } from 'deepspace/worker'

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
export const roundMutationSignatureHeader = 'x-round-mutation-signature'

export function isRoundMutation(name: string): name is 'setMood' | 'startRound' | 'submitBallot' | 'finalizeRound' | 'saveRating' | 'seedDemoHistory' {
  return name === 'setMood' || name === 'startRound' || name === 'submitBallot' || name === 'finalizeRound' || name === 'saveRating' || name === 'seedDemoHistory'
}

// The Durable Object acts as whichever userId the request body names, so the
// action router signs the body with an app secret and the DO verifies it.
export function signRoundMutation(secret: string, body: string): Promise<string> {
  return computeHmacHex(secret, body)
}

export async function hasValidRoundMutationSignature(
  secret: string,
  body: string,
  signature: string,
): Promise<boolean> {
  if (!secret || !signature) return false
  return timingSafeEqualStrings(signature, await computeHmacHex(secret, body))
}
