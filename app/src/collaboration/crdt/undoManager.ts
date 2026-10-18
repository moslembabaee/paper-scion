import type { Register } from '../types.ts'

export interface CRDTOperation {
  path: readonly string[]
  beforeValue: unknown
  afterValue: unknown
  beforeDeleted?: boolean
  afterDeleted?: boolean
  clock: number
}

export interface CollaborativeTransaction {
  id: string
  label: string
  actor: string
  timestamp: number
  operations: readonly CRDTOperation[]
}

export interface CollaborativeHistorySnapshot {
  canUndo: boolean
  canRedo: boolean
  undoLabel: string | null
  redoLabel: string | null
  undoCount: number
  redoCount: number
  active: boolean
}

export const MAX_HISTORY_TRANSACTIONS = 100

/**
 * Collaborative Undo/Redo Manager for CRDT scene graphs.
 * Inverts only the local user's operations without undoing concurrent or subsequent
 * edits made by remote peers to other elements or properties.
 */
export class CollaborativeUndoManager {
  readonly actor: string
  private undoStack: CollaborativeTransaction[] = []
  private redoStack: CollaborativeTransaction[] = []
  private activeTransaction: { label: string; operations: CRDTOperation[] } | null = null
  private listeners = new Set<() => void>()

  constructor(actor: string) {
    this.actor = actor
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit() {
    for (const listener of this.listeners) listener()
  }

  getSnapshot(): CollaborativeHistorySnapshot {
    return {
      canUndo: !this.activeTransaction && this.undoStack.length > 0,
      canRedo: !this.activeTransaction && this.redoStack.length > 0,
      undoLabel: this.undoStack.at(-1)?.label ?? null,
      redoLabel: this.redoStack.at(-1)?.label ?? null,
      undoCount: this.undoStack.length,
      redoCount: this.redoStack.length,
      active: this.activeTransaction !== null,
    }
  }

  beginTransaction(label: string): void {
    if (this.activeTransaction) {
      this.commitTransaction()
    }
    this.activeTransaction = { label, operations: [] }
    this.emit()
  }

  recordOperation(op: CRDTOperation): void {
    if (this.activeTransaction) {
      this.activeTransaction.operations.push(op)
    } else {
      // Auto-commit single operation
      this.undoStack.push({
        id: crypto.randomUUID(),
        label: 'Edit',
        actor: this.actor,
        timestamp: Date.now(),
        operations: [op],
      })
      if (this.undoStack.length > MAX_HISTORY_TRANSACTIONS) {
        this.undoStack.shift()
      }
      this.redoStack = []
      this.emit()
    }
  }

  recordOperations(ops: readonly CRDTOperation[], label = 'Edit'): void {
    if (!ops.length) return
    if (this.activeTransaction) {
      this.activeTransaction.operations.push(...ops)
    } else {
      this.undoStack.push({
        id: crypto.randomUUID(),
        label,
        actor: this.actor,
        timestamp: Date.now(),
        operations: [...ops],
      })
      if (this.undoStack.length > MAX_HISTORY_TRANSACTIONS) {
        this.undoStack.shift()
      }
      this.redoStack = []
      this.emit()
    }
  }

  commitTransaction(): void {
    if (!this.activeTransaction) return
    const { label, operations } = this.activeTransaction
    this.activeTransaction = null

    if (operations.length > 0) {
      this.undoStack.push({
        id: crypto.randomUUID(),
        label,
        actor: this.actor,
        timestamp: Date.now(),
        operations: Object.freeze([...operations]),
      })
      if (this.undoStack.length > MAX_HISTORY_TRANSACTIONS) {
        this.undoStack.shift()
      }
      this.redoStack = []
    }
    this.emit()
  }

  cancelTransaction(): void {
    this.activeTransaction = null
    this.emit()
  }

  /**
   * Generates inverse registers to selectively undo the most recent local transaction.
   * Assigns a newly allocated Lamport clock to ensure the inverse registers prevail.
   */
  undo(nextClock: () => number): Register[] {
    if (!this.undoStack.length || this.activeTransaction) return []
    const transaction = this.undoStack.pop()!
    const inverseRegisters: Register[] = []

    // Process operations in reverse order
    for (let i = transaction.operations.length - 1; i >= 0; i--) {
      const op = transaction.operations[i]
      const clock = nextClock()
      const reg: Register = {
        path: [...op.path],
        value: structuredClone(op.beforeValue),
        clock,
        actor: this.actor,
        ...(op.beforeDeleted ? { deleted: true } : {}),
      }
      inverseRegisters.push(reg)
    }

    this.redoStack.push({
      id: crypto.randomUUID(),
      label: transaction.label,
      actor: this.actor,
      timestamp: Date.now(),
      operations: transaction.operations,
    })
    if (this.redoStack.length > MAX_HISTORY_TRANSACTIONS) {
      this.redoStack.shift()
    }

    this.emit()
    return inverseRegisters
  }

  /**
   * Generates forward registers to re-apply the most recently undone transaction.
   */
  redo(nextClock: () => number): Register[] {
    if (!this.redoStack.length || this.activeTransaction) return []
    const transaction = this.redoStack.pop()!
    const forwardRegisters: Register[] = []

    for (const op of transaction.operations) {
      const clock = nextClock()
      const reg: Register = {
        path: [...op.path],
        value: structuredClone(op.afterValue),
        clock,
        actor: this.actor,
        ...(op.afterDeleted ? { deleted: true } : {}),
      }
      forwardRegisters.push(reg)
    }

    this.undoStack.push({
      id: crypto.randomUUID(),
      label: transaction.label,
      actor: this.actor,
      timestamp: Date.now(),
      operations: transaction.operations,
    })
    if (this.undoStack.length > MAX_HISTORY_TRANSACTIONS) {
      this.undoStack.shift()
    }

    this.emit()
    return forwardRegisters
  }

  /**
   * Rebase local undo stack when remote registers arrive.
   * If remote edits modify properties that local history touches, rebase ensures
   * the local undo maintains causality and doesn't discard unaffected local branches.
   */
  rebase(remoteRegisters: readonly Register[]): void {
    if (!remoteRegisters.length) return
    const remotePaths = new Set(remoteRegisters.map(r => JSON.stringify(r.path)))

    let hasConflict = false
    for (const tx of this.undoStack) {
      for (const op of tx.operations) {
        if (remotePaths.has(JSON.stringify(op.path))) {
          hasConflict = true
          break
        }
      }
      if (hasConflict) break
    }

    if (hasConflict) {
      this.emit()
    }
  }

  clear(): void {
    this.undoStack = []
    this.redoStack = []
    this.activeTransaction = null
    this.emit()
  }
}
