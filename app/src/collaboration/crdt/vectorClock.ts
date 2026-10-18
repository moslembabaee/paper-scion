/**
 * Vector Clock implementation for tracking causal dependencies across distributed actors.
 * A vector clock V assigns each actor a logical sequence counter.
 */
export class VectorClock {
  private clock: Map<string, number>

  constructor(initial?: Readonly<Record<string, number>> | Map<string, number>) {
    this.clock = new Map()
    if (initial) {
      if (initial instanceof Map) {
        for (const [actor, count] of initial.entries()) {
          if (Number.isSafeInteger(count) && count >= 0) {
            this.clock.set(actor, count)
          }
        }
      } else {
        for (const [actor, count] of Object.entries(initial)) {
          if (Number.isSafeInteger(count) && count >= 0) {
            this.clock.set(actor, count)
          }
        }
      }
    }
  }

  get(actor: string): number {
    return this.clock.get(actor) ?? 0
  }

  set(actor: string, count: number): this {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error(`Invalid clock value: ${count}`)
    }
    this.clock.set(actor, count)
    return this
  }

  tick(actor: string): number {
    const next = (this.clock.get(actor) ?? 0) + 1
    this.clock.set(actor, next)
    return next
  }

  merge(other: VectorClock | Readonly<Record<string, number>>): this {
    const entries = other instanceof VectorClock ? other.clock.entries() : Object.entries(other)
    for (const [actor, count] of entries) {
      const current = this.clock.get(actor) ?? 0
      this.clock.set(actor, Math.max(current, count))
    }
    return this
  }

  clone(): VectorClock {
    return new VectorClock(this.clock)
  }

  toJSON(): Record<string, number> {
    const result: Record<string, number> = {}
    for (const [actor, count] of this.clock.entries()) {
      result[actor] = count
    }
    return result
  }

  /**
   * Compares two vector clocks:
   * - 'equal': identical across all keys
   * - 'before': this causally precedes other (this <= other and exists <)
   * - 'after': this causally succeeds other (this >= other and exists >)
   * - 'concurrent': neither dominates the other (concurrent conflicting edits)
   */
  compare(other: VectorClock): 'equal' | 'before' | 'after' | 'concurrent' {
    const allActors = new Set([...this.clock.keys(), ...other.clock.keys()])
    let hasLess = false
    let hasGreater = false

    for (const actor of allActors) {
      const a = this.get(actor)
      const b = other.get(actor)
      if (a < b) hasLess = true
      if (a > b) hasGreater = true
      if (hasLess && hasGreater) return 'concurrent'
    }

    if (hasLess && !hasGreater) return 'before'
    if (hasGreater && !hasLess) return 'after'
    return 'equal'
  }

  isConcurrent(other: VectorClock): boolean {
    return this.compare(other) === 'concurrent'
  }
}
