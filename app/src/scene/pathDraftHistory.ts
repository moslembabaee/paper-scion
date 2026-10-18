import { equalValue, HISTORY_LIMIT } from './history.ts'
import { copyContours } from './pathGeometry.ts'
import type { PathContour, PathNodes } from './pathGeometry.ts'

/** Pen drafts have their own history until committed as one scene command. */
export class PathDraftHistory {
  private past: PathContour[][] = []
  private future: PathContour[][] = []
  get canUndo() { return this.past.length > 0 }
  get canRedo() { return this.future.length > 0 }

  record(before: readonly PathNodes[], after: readonly PathNodes[]) {
    if (equalValue(before, after)) return
    this.past.push(copyContours(before))
    if (this.past.length > HISTORY_LIMIT) this.past.shift()
    this.future = []
  }
  undo(current: readonly PathNodes[]): PathContour[] | null {
    const previous = this.past.pop()
    if (!previous) return null
    this.future.push(copyContours(current))
    return copyContours(previous)
  }
  redo(current: readonly PathNodes[]): PathContour[] | null {
    const next = this.future.pop()
    if (!next) return null
    this.past.push(copyContours(current))
    return copyContours(next)
  }
}
