import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { ArrowLeft, Check, CheckCheck, ChevronLeft, ChevronRight, Crosshair, MessageSquare, Plus, RotateCcw, Search, X } from 'lucide-react'
import type { CollaborationSession } from '../collaboration/session'
import type { Presence } from '../collaboration/types'
import type { SceneStore } from '../scene/store'
import { useScene } from '../scene/useScene'
import { initials } from '../workspace/profile'
import { CommentComposer } from './CommentComposer'
import { anchorPoint, mentionsUser, messagesFor, usernameFor } from './model'
import type { CommentAuthor, CommentFilter, CommentThread } from './types'
import type { CommentsController } from './useComments'

const EMPTY_PEERS: readonly Presence[] = []
const noSubscribe = () => () => {}
const noPeers = () => EMPTY_PEERS
const dateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
function CommentBody({ body }: { body: string }) {
  return <>{body.split(/((?:^|[^\w@])@[a-z0-9_]{1,40}\b)/gi).map((part, index) => {
    const mention = part.match(/^([^\w@]?)(@[a-z0-9_]+)$/i)
    return mention ? <span key={index}>{mention[1]}<span className="comment-mention">{mention[2]}</span></span> : part
  })}</>
}

export function CommentsSidebar({ comments, store, session, placing, onNew, onCancel, onClose }: { comments: CommentsController; store: SceneStore; session: CollaborationSession | null; placing: boolean; onNew: () => void; onCancel: () => void; onClose: () => void }) {
  const [filter, setFilter] = useState<CommentFilter>('open')
  const [search, setSearch] = useState('')
  const elements = useScene(store, state => state.elements)
  const peers = useSyncExternalStore(session?.subscribe ?? noSubscribe, session ? () => session.getSnapshot().peers : noPeers)
  const { threads, active, draft, author, unread } = comments
  const users = useMemo(() => {
    const authors = new Map<string, CommentAuthor>([[author.username, author]])
    for (const thread of threads) for (const message of Object.values(thread.messages)) authors.set(message.author.username, message.author)
    for (const peer of peers) authors.set(usernameFor(peer.name), { id: peer.id, name: peer.name, username: usernameFor(peer.name) })
    return [...authors.values()]
  }, [author, threads, peers])
  const filtered = threads.filter(thread => {
    if (filter === 'open' || filter === 'resolved') { if (thread.status !== filter) return false }
    if (filter === 'unread' && !unread.has(thread.id)) return false
    if (filter === 'mentions' && !mentionsUser(thread, author.username)) return false
    const query = search.trim().toLowerCase()
    return !query || Object.values(thread.messages).some(message => `${message.body} ${message.author.name} @${message.author.username}`.toLowerCase().includes(query))
  })
  const index = filtered.findIndex(thread => thread.id === active?.id)
  const feed = useRef<HTMLDivElement>(null)
  const messageCount = active ? Object.keys(active.messages).length : 0
  useEffect(() => { if (feed.current) feed.current.scrollTop = feed.current.scrollHeight }, [active?.id, messageCount])
  const labelFor = (thread: CommentThread) => thread.anchor.nodeId ? elements[thread.anchor.nodeId]?.name ?? 'Removed layer · saved location' : 'Canvas location'
  const draftLabel = draft?.nodeId ? elements[draft.nodeId]?.name ?? 'Canvas location' : 'Canvas location'
  function navigate(direction: number) {
    if (!filtered.length) return
    const next = index < 0 ? (direction > 0 ? 0 : filtered.length - 1) : (index + direction + filtered.length) % filtered.length
    onCancel(); comments.select(filtered[next])
  }
  return <aside id="paper-comments" className="comments-sidebar viewport-ui" aria-label="Canvas comments" data-testid="comments-sidebar" data-placing={placing}>
    <div className="comments-heading"><MessageSquare size={15} /><h2>Comments</h2><span className="comments-count">{threads.filter(thread => thread.status === 'open').length}</span><button className="quiet-button" aria-label="Close comments" onClick={onClose}><X size={15} /></button></div>
    <div className="comments-controls"><label className="comments-filter"><span className="sr-only">Filter comments</span><select aria-label="Filter comments" value={filter} onChange={event => setFilter(event.target.value as CommentFilter)}><option value="open">Open threads</option><option value="resolved">Resolved</option><option value="all">All threads</option><option value="unread">Unread ({unread.size})</option><option value="mentions">Mentions of you</option></select></label><button className={`comments-new ${placing ? 'active' : ''}`} aria-label="Place a comment" title="Place a comment (C)" aria-pressed={placing} onClick={placing ? onCancel : onNew}><Plus size={14} />New</button></div>
    <label className="comments-search"><Search size={13} /><input aria-label="Search comments" placeholder="Search conversations…" value={search} onChange={event => setSearch(event.target.value)} />{search && <button className="quiet-button" aria-label="Clear comment search" onClick={() => setSearch('')}><X size={12} /></button>}</label>
    <div className={`comments-list ${active || draft ? 'has-conversation' : ''}`}>
      {filtered.map(thread => {
        const messages = messagesFor(thread), first = messages[0], number = threads.findIndex(item => item.id === thread.id) + 1
        return <button key={thread.id} className="comment-row" data-testid="comment-row" data-active={thread.id === active?.id} onClick={() => { onCancel(); comments.select(thread) }} aria-label={`Open comment ${number}: ${first.body}`}>
          <span className="comment-row-number">{thread.status === 'resolved' ? <Check size={12} /> : number}</span><span className="comment-row-content"><span className="comment-row-meta"><strong>{first.author.name}</strong>{unread.has(thread.id) && <i className="comment-unread-dot" aria-label="Unread" />}<small>{messages.length > 1 ? `${messages.length - 1} ${messages.length === 2 ? 'reply' : 'replies'}` : 'Thread'}</small></span><span className="comment-row-preview"><CommentBody body={first.body} /></span><span className="comment-row-anchor"><Crosshair size={10} />{labelFor(thread)}</span></span>
        </button>
      })}
      {!filtered.length && <div className="comments-empty"><MessageSquare size={22} strokeWidth={1.2} /><strong>{threads.length ? 'No matching conversations' : 'A place for perspective'}</strong><p>{threads.length ? 'Try another filter or search.' : 'Pin a thought to the canvas. Keep the conversation close to the work.'}</p>{!threads.length && !draft && <button className="comment-text-button" onClick={onNew}>Place your first comment <Plus size={12} /></button>}</div>}
    </div>
    {placing && <div className="comment-placement-hint" role="status"><Crosshair size={16} /><div><strong>Choose a point on the canvas</strong><span>Layers keep their pins as they move.</span></div><button className="quiet-button" aria-label="Cancel comment placement" onClick={onCancel}><X size={13} /></button></div>}
    {draft && <section className="comment-conversation" aria-label="New comment"><div className="comment-conversation-heading"><Crosshair size={13} /><strong>{draftLabel}</strong><span>NEW THREAD</span></div><CommentComposer key={`${draft.nodeId}:${draft.x}:${draft.y}`} label="Write a comment" users={users} onSubmit={comments.create} onCancel={() => comments.setDraft(null)} /></section>}
    {active && !draft && <section className="comment-conversation" aria-label="Comment thread" data-testid="comment-thread"><div className="comment-conversation-heading"><button className="quiet-button" aria-label="Back to comment list" onClick={() => comments.setActiveId(null)}><ArrowLeft size={13} /></button><strong>Thread {threads.findIndex(thread => thread.id === active.id) + 1}</strong><button className="comment-status-button" data-resolved={active.status === 'resolved'} aria-label={active.status === 'open' ? 'Resolve thread' : 'Reopen thread'} onClick={() => comments.toggleStatus(active.id)}>{active.status === 'open' ? <Check size={13} /> : <RotateCcw size={12} />}{active.status === 'open' ? 'Resolve' : 'Reopen'}</button></div>
      <button className="comment-location" onClick={() => comments.select(active)} title="Go to pin"><Crosshair size={11} /><span>{labelFor(active)}</span><small>{(() => { const point = anchorPoint(store.getSnapshot(), active.anchor); return `${Math.round(point.x)}, ${Math.round(point.y)}` })()}</small></button>
      <div className="comment-messages" ref={feed}>{messagesFor(active).map(message => <article className="comment-message" key={message.id}><span className="comment-avatar">{initials(message.author.name)}</span><div><div className="comment-message-meta"><strong>{message.author.name}</strong><time dateTime={new Date(message.createdAt).toISOString()}>{dateFormat.format(message.createdAt)}</time></div><p><CommentBody body={message.body} /></p></div></article>)}</div>
      {active.status === 'resolved' ? <div className="comment-resolved-note"><CheckCheck size={14} /><span>Resolved. Reopen to continue the conversation.</span></div> : <CommentComposer key={active.id} label="Write a reply" users={users} onSubmit={body => comments.reply(active.id, body)} />}
    </section>}
    <div className="comments-navigation"><span>{filtered.length} {filtered.length === 1 ? 'thread' : 'threads'}{index >= 0 ? ` · ${index + 1} of ${filtered.length}` : ''}</span><button className="quiet-button" aria-label="Mark all comments read" title="Mark all read" disabled={!unread.size} onClick={() => threads.forEach(comments.markRead)}><CheckCheck size={14} /></button><button className="quiet-button" aria-label="Previous comment" disabled={!filtered.length} onClick={() => navigate(-1)}><ChevronLeft size={15} /></button><button className="quiet-button" aria-label="Next comment" disabled={!filtered.length} onClick={() => navigate(1)}><ChevronRight size={15} /></button></div>
  </aside>
}
