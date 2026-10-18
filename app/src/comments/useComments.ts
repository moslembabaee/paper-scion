import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ViewportController } from '../canvas/ViewportController'
import type { SceneStore } from '../scene/store'
import { useScene } from '../scene/useScene'
import { anchorPoint, createMessage, EMPTY_COMMENTS, isUnread, threadsFor, usernameFor } from './model'
import type { CommentAnchor, CommentAuthor, CommentThread } from './types'

function localAuthorId(): string {
  try {
    const saved = localStorage.getItem('paper.comment-author.v1')
    if (saved && /^[a-f0-9-]{36}$/.test(saved)) return saved
    const id = crypto.randomUUID(); localStorage.setItem('paper.comment-author.v1', id); return id
  } catch { return crypto.randomUUID() }
}
function readSeen(key: string): Set<string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
    return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [])
  } catch { return new Set() }
}

export function useComments(projectId: string, store: SceneStore, controller: ViewportController, name: string) {
  const comments = useScene(store, state => state.comments ?? EMPTY_COMMENTS)
  const [authorId] = useState(localAuthorId)
  const author: CommentAuthor = useMemo(() => ({ id: authorId, name, username: usernameFor(name) }), [authorId, name])
  const [open, setOpen] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [draft, setDraft] = useState<CommentAnchor | null>(null)
  const seenKey = `paper.comments.read.v1.${projectId}`
  const [seen, setSeen] = useState(() => readSeen(seenKey))
  const threads = useMemo(() => threadsFor(comments), [comments])
  const unread = useMemo(() => new Set(threads.filter(thread => isUnread(thread, author.id, seen)).map(thread => thread.id)), [threads, author.id, seen])
  const active = activeId ? comments[activeId] : undefined

  const markRead = useCallback((thread: CommentThread) => {
    setSeen(previous => {
      if (Object.keys(thread.messages).every(id => previous.has(id))) return previous
      const next = new Set([...readSeen(seenKey), ...previous, ...Object.keys(thread.messages)])
      try { localStorage.setItem(seenKey, JSON.stringify([...next].slice(-10000))) } catch { /* Reading works in memory when storage is unavailable. */ }
      return next
    })
  }, [seenKey])
  // Remote message arrivals in the visible conversation synchronize private read receipts.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { if (open && active) markRead(active) }, [open, active, markRead])
  useEffect(() => {
    const sync = (event: StorageEvent) => { if (event.key === seenKey) setSeen(readSeen(seenKey)) }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [seenKey])

  const select = useCallback((thread: CommentThread) => {
    setDraft(null); setActiveId(thread.id); setOpen(true); markRead(thread)
    const point = anchorPoint(store.getSnapshot(), thread.anchor), { camera, size } = controller.getSnapshot()
    // Leave room for the floating conversation on the right.
    const available = Math.max(120, size.width - Math.min(344, size.width * .65))
    controller.setCamera({ x: available / 2 - point.x * camera.zoom, y: size.height / 2 - point.y * camera.zoom, zoom: camera.zoom })
  }, [store, controller, markRead])
  function create(body: string) {
    if (!draft) return
    const message = createMessage(author, body), id = crypto.randomUUID()
    const thread: CommentThread = { id, anchor: draft, status: 'open', createdAt: message.createdAt, messages: { [message.id]: message } }
    store.setComments({ ...store.getSnapshot().comments, [id]: thread }, 'Add canvas comment')
    setDraft(null); setActiveId(id); markRead(thread)
  }
  function reply(id: string, body: string) {
    const current = store.getSnapshot().comments, thread = current?.[id]
    if (!thread || thread.status !== 'open') throw new Error('Reopen this thread before replying.')
    const message = createMessage(author, body)
    store.setComments({ ...current, [id]: { ...thread, messages: { ...thread.messages, [message.id]: message } } }, 'Reply to comment')
  }
  function toggleStatus(id: string) {
    const current = store.getSnapshot().comments, thread = current?.[id]
    if (!thread) return
    store.setComments({ ...current, [id]: { ...thread, status: thread.status === 'open' ? 'resolved' : 'open' } }, thread.status === 'open' ? 'Resolve comment' : 'Reopen comment')
  }
  return { open, setOpen, active, activeId, setActiveId, draft, setDraft, author, threads, unread, select, create, reply, toggleStatus, markRead }
}
export type CommentsController = ReturnType<typeof useComments>
