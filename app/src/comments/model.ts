import type { Point } from '../canvas/types.ts'
import { getWorldMatrix } from '../scene/geometry.ts'
import { measurementHit } from '../scene/measurementGeometry.ts'
import type { SceneSnapshot } from '../scene/types.ts'
import type { CommentAnchor, CommentAuthor, CommentDocument, CommentMessage, CommentThread } from './types.ts'

export const EMPTY_COMMENTS: CommentDocument = Object.freeze({})
export const COMMENT_LIMIT = 4000
const reserved = new Set(['__proto__', 'constructor', 'prototype'])
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const validId = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 120 && !reserved.has(id)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const timestamp = (value: unknown): value is number => finite(value) && value >= 0 && value <= 8.64e15
export const usernameFor = (name: string) => name.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 40) || 'designer'
export const mentionsIn = (body: string): string[] => [...new Set(Array.from(body.matchAll(/(?:^|[^\w@])@([a-z0-9_]{1,40})\b/gi), match => match[1].toLowerCase()))]
export const messagesFor = (thread: CommentThread) => Object.values(thread.messages).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
export const threadsFor = (comments: CommentDocument) => Object.values(comments).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
export const isUnread = (thread: CommentThread, authorId: string, seen: ReadonlySet<string>) => Object.values(thread.messages).some(message => message.author.id !== authorId && !seen.has(message.id))
export const mentionsUser = (thread: CommentThread, username: string) => Object.values(thread.messages).some(message => mentionsIn(message.body).includes(username.toLowerCase()))

export function createMessage(author: CommentAuthor, body: string): CommentMessage {
  const text = body.trim()
  if (!text || text.length > COMMENT_LIMIT) throw new Error('Comments must contain 1–4,000 characters.')
  return { id: crypto.randomUUID(), author, body: text, createdAt: Date.now() }
}

export function anchorAt(state: SceneSnapshot, point: Point): CommentAnchor {
  const nodeId = measurementHit(state, point)
  if (!nodeId) return { nodeId: null, ...point, fallback: { ...point } }
  const node = state.elements[nodeId], [a, b, c, d, e, f] = getWorldMatrix(state, nodeId)
  const det = a * d - b * c, dx = point.x - e, dy = point.y - f
  return { nodeId, x: (d * dx - c * dy) / det / Math.max(Number.EPSILON, node.width), y: (-b * dx + a * dy) / det / Math.max(Number.EPSILON, node.height), fallback: { ...point } }
}

export function anchorPoint(state: SceneSnapshot, anchor: CommentAnchor): Point {
  const node = anchor.nodeId ? state.elements[anchor.nodeId] : undefined
  if (!node) return anchor.fallback
  const [a, b, c, d, e, f] = getWorldMatrix(state, node.id), x = anchor.x * node.width, y = anchor.y * node.height
  return { x: a * x + c * y + e, y: b * x + d * y + f }
}

/** Import and relay validation share the same immutable schema. */
export function validateComments(input: unknown): CommentDocument {
  if (input === undefined) return EMPTY_COMMENTS
  if (!record(input) || Object.keys(input).length > 2000) throw new Error('Invalid comment threads')
  const threads: Record<string, CommentThread> = {}
  for (const [id, thread] of Object.entries(input)) {
    if (!validId(id) || !record(thread) || thread.id !== id || !timestamp(thread.createdAt) || !['open', 'resolved'].includes(thread.status as string)) throw new Error('Invalid comment thread')
    const anchor = thread.anchor
    if (!record(anchor) || !(anchor.nodeId === null || validId(anchor.nodeId)) || !finite(anchor.x) || !finite(anchor.y) || !record(anchor.fallback) || !finite(anchor.fallback.x) || !finite(anchor.fallback.y)) throw new Error('Invalid comment anchor')
    if (!record(thread.messages) || !Object.keys(thread.messages).length || Object.keys(thread.messages).length > 5000) throw new Error('Invalid comment messages')
    const messages: Record<string, CommentMessage> = {}
    for (const [messageId, message] of Object.entries(thread.messages)) {
      if (!validId(messageId) || !record(message) || message.id !== messageId || !timestamp(message.createdAt) || typeof message.body !== 'string' || !message.body.trim() || message.body.length > COMMENT_LIMIT) throw new Error('Invalid comment message')
      const author = message.author
      if (!record(author) || !validId(author.id) || typeof author.name !== 'string' || !author.name.trim() || author.name.length > 80 || typeof author.username !== 'string' || !/^[a-z0-9_]{1,40}$/.test(author.username)) throw new Error('Invalid comment author')
      messages[messageId] = Object.freeze({ id: messageId, createdAt: message.createdAt, body: message.body, author: Object.freeze({ id: author.id, name: author.name, username: author.username }) })
    }
    threads[id] = Object.freeze({ id, createdAt: thread.createdAt, status: thread.status as CommentThread['status'], anchor: Object.freeze({ nodeId: anchor.nodeId as string | null, x: anchor.x, y: anchor.y, fallback: Object.freeze({ x: anchor.fallback.x, y: anchor.fallback.y }) }), messages: Object.freeze(messages) })
  }
  return Object.freeze(threads)
}
