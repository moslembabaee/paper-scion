import type { Point, Size } from '../canvas/types.ts'
export type { CRDTOperation, CollaborativeTransaction, CollaborativeHistorySnapshot } from './crdt/undoManager.ts'

export const COLLAB_PATH = '/__paper_collaboration'
export const PRESENCE_COLORS = ['#81adec', '#c4a2e8', '#e9aa83', '#86bca3', '#df96ac', '#bdb178'] as const
export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'offline' | 'unavailable'

export interface Presence {
  id: string
  name: string
  color: string
  status: 'active' | 'idle' | 'away'
  cursor: Point | null
  selection: readonly string[]
  viewport: { center: Point; zoom: number; size: Size }
  following: string | null
  pointerDown?: boolean
  activity?: string
  chat?: string | null
  chatTimestamp?: number
  avatar?: string
  cursorTimestamp?: number
}

/** A Lamport timestamp plus actor ID gives every register a total order. */
export interface Register {
  path: string[]
  clock: number
  actor: string
  value: unknown
  deleted?: boolean
}

export interface RoomState { registers: Register[]; peers: Presence[] }
