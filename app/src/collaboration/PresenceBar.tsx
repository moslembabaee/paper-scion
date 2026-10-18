import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { Check, Copy, Radio, RefreshCw, Share2, UserPlus, Users, X } from 'lucide-react'
import type { CollaborationSession, CollaborationSnapshot } from './session'
import { initials } from '../workspace/profile'
import './collaboration.css'

const soloSnapshot: CollaborationSnapshot = { status: 'offline', peers: [], following: null, error: '' }
const subscribeSolo = () => () => {}
const getSoloSnapshot = () => soloSnapshot

interface PresenceBarProps {
  session: CollaborationSession | null
  onActivate: () => void
  room: string
}

export function PresenceBar({ session, onActivate, room }: PresenceBarProps) {
  const state = useSyncExternalStore(
    session?.subscribe ?? subscribeSolo,
    session?.getSnapshot ?? getSoloSnapshot
  )
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState('')
  const host = useRef<HTMLDivElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent) => { if (!host.current?.contains(event.target as Node)) setOpen(false) }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); host.current?.querySelector<HTMLButtonElement>('.presence-trigger')?.focus() } }
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', key) }
  }, [open])

  useEffect(() => { if (copied) { const timer = setTimeout(() => setCopied(false), 2000); return () => clearTimeout(timer) } }, [copied])

  const link = new URL(window.location.href)
  link.hash = new URLSearchParams({ room }).toString()

  const follow = state.peers.find(peer => peer.id === state.following)
  const live = session !== null && state.status === 'live'
  const isUnavailable = session !== null && state.status === 'unavailable'
  const status =
    !session ? 'Solo'
    : live ? 'Live'
    : isUnavailable ? 'Unavailable'
    : state.status === 'offline' ? 'Offline'
    : state.status === 'connecting' ? 'Connecting'
    : 'Reconnecting'

  const handleOpen = () => {
    setOpen(!open)
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link.href)
      setCopied(true)
      setCopyError('')
    } catch {
      setCopyError('Select and copy the invite link above.')
    }
  }

  const handleCopy = () => {
    onActivate()
    return copyLink()
  }

  const handleShare = async () => {
    onActivate()
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'Paper Canvas', url: link.href })
        return
      } catch {
        // Clipboard remains available if native sharing is unavailable or cancelled.
      }
    }
    await copyLink()
  }

  return <div className="presence-bar" ref={host} data-testid="presence-bar">
    <button
      className="presence-trigger"
      aria-label="Canvas collaborators"
      aria-expanded={open}
      aria-controls={open ? panelId : undefined}
      title={session ? `${status} · ${state.peers.length + 1} on this canvas` : 'Invite collaborators · Solo canvas'}
      onClick={handleOpen}
    >
      <span className="presence-signal" data-live={live} data-status={session ? state.status : 'solo'} />
      {state.peers.length ? (
        <span className="presence-avatars">
          {state.peers.slice(0, 3).map(peer => (
            <span
              className="presence-avatar"
              key={peer.id}
              data-status={peer.status}
              style={{ background: peer.color }}
              title={`${peer.name} · ${peer.status}`}
            >
              {initials(peer.name)}
            </span>
          ))}
        </span>
      ) : (
        <Users size={13} />
      )}
      <span className="presence-count">{state.peers.length ? state.peers.length + 1 : (session ? status : 'Invite')}</span>
    </button>
    {isUnavailable && session && (
      <button
        type="button"
        className="presence-retry"
        aria-label="Retry collaboration"
        title="Retry collaboration"
        onClick={() => session.retry()}
      >
        <RefreshCw size={13} />
      </button>
    )}
    <span className="presence-announcement" role="status">
      {session ? `${status}. ${state.peers.length + 1} ${state.peers.length ? 'designers' : 'designer'} on this canvas.` : 'Solo mode. Invite collaborators to design together.'}
    </span>
    {open && <div id={panelId} className="presence-panel" role="region" aria-label="Collaboration" data-testid="presence-panel">
      <div className="presence-heading">
        <span>ON THIS CANVAS</span>
        <span className="presence-connection" data-live={live} data-status={session ? state.status : 'solo'}>{status}</span>
      </div>
      <p className="presence-description">A shared space to think.<br />Invite someone to design alongside you.</p>
      {isUnavailable && session && (
        <div className="presence-unavailable-banner" data-testid="presence-unavailable">
          <p className="presence-error" role="status">{state.error || 'Collaboration service unavailable.'}</p>
          <button type="button" className="presence-retry-btn" aria-label="Retry collaboration" onClick={() => session.retry()}>
            <RefreshCw size={12} />
            <span>Retry</span>
          </button>
        </div>
      )}
      <div className="presence-person">
        <span className="presence-avatar self">You</span>
        <span className="presence-person-info">
          <strong>You</strong>
          <small>{live ? 'Connected to this room' : isUnavailable ? 'Collaboration unavailable' : session ? 'Changes stay on this device until connected' : 'Solo mode · invite someone to collaborate'}</small>
        </span>
        <span className="presence-person-status" data-status={live ? 'active' : 'away'} />
      </div>
      {state.peers.map(peer => <div className="presence-person" key={peer.id} data-testid="presence-peer" data-peer-name={peer.name}>
        <span className="presence-avatar" style={{ background: peer.color }}>{initials(peer.name)}</span>
        <span className="presence-person-info"><strong>{peer.name}</strong><small>{peer.following ? 'Following a collaborator' : peer.status === 'active' ? 'On the canvas' : peer.status === 'idle' ? 'Idle' : 'Away'}</small></span>
        <button className="presence-follow" disabled={peer.status === 'away' || !!peer.following} aria-label={`${state.following === peer.id ? 'Stop following' : 'Follow'} ${peer.name}`} aria-pressed={state.following === peer.id} onClick={() => session?.follow(state.following === peer.id ? null : peer.id)}><Radio size={13} />{state.following === peer.id ? 'Following' : 'Follow'}</button>
        <span className="presence-person-status" data-status={peer.status} />
      </div>)}
      {!state.peers.length && <div className="presence-empty"><span className="presence-empty-cross">+</span><span>Room for another perspective</span></div>}
      <div className="presence-invite">
        <div className="presence-invite-header">
          <label htmlFor="collaboration-link">INVITE LINK</label>
          <div className="presence-invite-actions">
            <button
              type="button"
              className="presence-action-btn"
              aria-label="Share"
              title="Share canvas link"
              onClick={handleShare}
            >
              <Share2 size={11} />
              <span>Share</span>
            </button>
            <button
              type="button"
              className="presence-action-btn"
              aria-label="Invite"
              title="Invite collaborator"
              onClick={handleCopy}
            >
              <UserPlus size={11} />
              <span>Invite</span>
            </button>
          </div>
        </div>
        <div className="presence-invite-field">
          <input id="collaboration-link" aria-label="Canvas invite link" readOnly value={link.href} onFocus={event => event.target.select()} />
          <button type="button" aria-label="Copy invite link" title="Copy invite link" onClick={handleCopy}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
        <small role="status">{copyError || (copied ? 'Link copied' : 'Anyone with this link can join and edit.')}</small>
      </div>
      {state.error && !isUnavailable && <p className="presence-error" role="status">{state.error}</p>}
    </div>}
    {follow && session && <button className="presence-stop" onClick={() => session.follow(null)} aria-label={`Stop following ${follow.name}`}><Radio size={11} /><span>{follow.name}</span><X size={11} /></button>}
  </div>
}
