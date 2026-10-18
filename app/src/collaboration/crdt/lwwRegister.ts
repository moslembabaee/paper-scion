import type { Register } from '../types.ts'

/**
 * Last-Write-Wins Register CRDT.
 * Guarantees eventual consistency across distributed replicas using total ordering
 * by Lamport timestamp and actor identifier.
 */
export class LWWRegister<T = unknown> {
  readonly path: readonly string[]
  value: T
  clock: number
  actor: string
  deleted: boolean

  constructor(path: readonly string[], value: T, clock: number, actor: string, deleted = false) {
    this.path = Object.freeze([...path])
    this.value = value
    this.clock = clock
    this.actor = actor
    this.deleted = deleted
  }

  static fromRegister<T = unknown>(register: Register): LWWRegister<T> {
    return new LWWRegister<T>(
      register.path,
      register.value as T,
      register.clock,
      register.actor,
      Boolean(register.deleted)
    )
  }

  toRegister(): Register {
    return {
      path: [...this.path],
      clock: this.clock,
      actor: this.actor,
      value: this.value,
      ...(this.deleted ? { deleted: true } : {}),
    }
  }

  /**
   * Deterministic comparison: higher Lamport clock wins; ties broken lexicographically by actor ID.
   */
  isNewerThan(other: LWWRegister<T> | Register): boolean {
    if (this.clock > other.clock) return true
    if (this.clock < other.clock) return false
    return this.actor > other.actor
  }

  merge(incoming: LWWRegister<T> | Register): boolean {
    if (incoming.clock > this.clock || (incoming.clock === this.clock && incoming.actor > this.actor)) {
      this.value = incoming.value as T
      this.clock = incoming.clock
      this.actor = incoming.actor
      this.deleted = Boolean(incoming.deleted)
      return true
    }
    return false
  }

  clone(): LWWRegister<T> {
    return new LWWRegister<T>(
      this.path,
      structuredClone(this.value),
      this.clock,
      this.actor,
      this.deleted
    )
  }
}
