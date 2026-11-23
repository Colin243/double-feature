/** Serialize cache misses for the same film without delaying other films. */
export class TrailerLookupQueue {
  private readonly pending = new Map<string, Promise<void>>()

  run<T>(filmId: string, lookup: () => Promise<T>): Promise<T> {
    const result = (this.pending.get(filmId) ?? Promise.resolve()).then(lookup)
    const tail: Promise<void> = result.then(clear, clear)
    this.pending.set(filmId, tail)
    const pending = this.pending

    function clear() {
      if (pending.get(filmId) === tail) pending.delete(filmId)
    }

    return result
  }
}
