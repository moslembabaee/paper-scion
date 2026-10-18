import type { SceneSnapshot } from './types.ts'

export const HISTORY_LIMIT = 100

export interface HistorySnapshot {
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly undoLabel: string | null
  readonly redoLabel: string | null
  readonly undoCount: number
  readonly redoCount: number
  readonly active: boolean
}

/** Immutable data only; reference equality skips untouched branches. */
export function equalValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && equalValue(left[key], right[key]))
}

/** Carry remote field changes into every local checkpoint, including gesture baselines. */
export function valueRebaser(before: unknown, after: unknown): (value: unknown) => unknown {
  if (equalValue(before, after)) return value => value
  const record = (item: unknown): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item)
  if (!record(before) || !record(after)) return () => after
  const changes = new Map<string, ((value: unknown) => unknown) | null>()
  for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (equalValue(before[name], after[name])) continue
    changes.set(name, Object.hasOwn(after, name) ? valueRebaser(before[name], after[name]) : null)
  }
  return value => {
    if (!record(value)) return after
    const result = { ...value }
    for (const [name, transform] of changes) {
      if (!transform) delete result[name]
      else result[name] = transform(result[name])
    }
    return result
  }
}

function sameDocument(a: SceneSnapshot, b: SceneSnapshot): boolean {
  return equalValue(a.motion, b.motion) && equalValue(a.comments, b.comments) && equalValue(a.prototype, b.prototype) && equalValue(a.styleLibrary, b.styleLibrary) && equalValue(a.tokens, b.tokens) && equalValue(a.elements, b.elements) && equalValue(a.rootIds, b.rootIds) && equalValue(a.backgroundShader, b.backgroundShader)
}

/** Reversible command with shared, frozen scene branches; no serialization per frame. */
class SceneCommand {
  readonly label: string
  private readonly before: SceneSnapshot
  private readonly after: SceneSnapshot

  constructor(label: string, before: SceneSnapshot, after: SceneSnapshot) {
    this.label = label
    this.before = before
    this.after = after
    Object.freeze(this)
  }

  undo(): SceneSnapshot { return this.before }
  redo(): SceneSnapshot { return this.after }
}

/** The combined undo/redo stack retains at most 100 reversible checkpoints. */
export class CommandHistory {
  private past: readonly SceneCommand[] = Object.freeze([])
  private future: readonly SceneCommand[] = Object.freeze([])
  private active = false
  private snapshot!: HistorySnapshot

  constructor() { this.refresh() }

  getSnapshot = (): HistorySnapshot => this.snapshot

  private refresh() {
    this.snapshot = Object.freeze({
      canUndo: !this.active && this.past.length > 0,
      canRedo: !this.active && this.future.length > 0,
      undoLabel: this.past.at(-1)?.label ?? null,
      redoLabel: this.future.at(-1)?.label ?? null,
      undoCount: this.past.length,
      redoCount: this.future.length,
      active: this.active,
    })
  }

  setActive(active: boolean) { this.active = active; this.refresh() }

  record(before: SceneSnapshot, after: SceneSnapshot, label: string): void {
    // Selection and no-op edits must never discard a redo branch.
    if (sameDocument(before, after)) return
    this.past = Object.freeze([...this.past.slice(-(HISTORY_LIMIT - 1)), new SceneCommand(label, before, after)])
    this.future = Object.freeze([])
    this.refresh()
  }

  undo(): SceneSnapshot | null {
    if (!this.snapshot.canUndo) return null
    const command = this.past.at(-1)!
    this.past = Object.freeze(this.past.slice(0, -1))
    this.future = Object.freeze([...this.future, command])
    this.refresh()
    return command.undo()
  }

  redo(): SceneSnapshot | null {
    if (!this.snapshot.canRedo) return null
    const command = this.future.at(-1)!
    this.future = Object.freeze(this.future.slice(0, -1))
    this.past = Object.freeze([...this.past, command])
    this.refresh()
    return command.redo()
  }

  clear(): void {
    this.past = Object.freeze([])
    this.future = Object.freeze([])
    this.refresh()
  }

  rebase(transform: (snapshot: SceneSnapshot) => SceneSnapshot): void {
    const update = (command: SceneCommand) => new SceneCommand(command.label, transform(command.undo()), transform(command.redo()))
    this.past = Object.freeze(this.past.map(update))
    this.future = Object.freeze(this.future.map(update))
    this.refresh()
  }
}
