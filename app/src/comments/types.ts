import type { Point } from '../canvas/types.ts'

export interface CommentAuthor {
  readonly id: string
  readonly name: string
  readonly username: string
}
export interface CommentMessage {
  readonly id: string
  readonly author: CommentAuthor
  readonly body: string
  readonly createdAt: number
}
/** Normalized frame coordinates follow resizing; fallback survives node deletion. */
export interface CommentAnchor {
  readonly nodeId: string | null
  readonly x: number
  readonly y: number
  readonly fallback: Point
}
export interface CommentThread {
  readonly id: string
  readonly anchor: CommentAnchor
  readonly createdAt: number
  readonly status: 'open' | 'resolved'
  readonly messages: Readonly<Record<string, CommentMessage>>
}
export type CommentDocument = Readonly<Record<string, CommentThread>>
export type CommentFilter = 'open' | 'resolved' | 'all' | 'unread' | 'mentions'
