import { useEffect, useRef, useState } from 'react'
import { Users, ArrowLeft, RefreshCw, Save } from 'lucide-react'
import { api, ApiError } from '../cloud/api'
import type { AppProject } from './types'
import type { AppPermissions, SharedApp, SharedAppSummary } from './sharing'
import type { CompilePreviewAssets, CompileResult } from './compiler'
import { PreviewFrame } from './PreviewFrame'

export function Sharing({ project, accountId, saved, disabled }: {
  project: AppProject; accountId?: string; saved: boolean; disabled: boolean
}) {
  const [permissions, setPermissions] = useState<AppPermissions>({ role: 'owner', grants: [] })
  const [target, setTarget] = useState('')
  const [role, setRole] = useState<'viewer' | 'editor'>('viewer')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)
  const path = `/apps/${encodeURIComponent(project.id)}/permissions`
  useEffect(() => {
    const controller = new AbortController()
    request.current = controller
    if (saved) {
      setBusy(true)
      void api<AppPermissions>(path, { signal: controller.signal, headers: { 'X-Paper-Account': accountId ?? '' } })
        .then(value => { if (!controller.signal.aborted) setPermissions(value) })
        .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load sharing') })
        .finally(() => { if (!controller.signal.aborted) setBusy(false) })
    }
    return () => { controller.abort(); request.current?.abort() }
  }, [path, accountId, saved])

  async function change(account: string, method: 'PUT' | 'DELETE', nextRole = role, shareRevision: number | null = project.revision) {
    if (!saved || disabled || busy) return
    const controller = new AbortController(); request.current = controller
    setBusy(true); setError('')
    try {
      const value = await api<AppPermissions>(path, { method, signal: controller.signal,
        headers: { 'X-Paper-Account': accountId ?? '' },
        body: JSON.stringify({ accountId: account.trim(), ...(method === 'PUT' ? {
          role: nextRole, ...(shareRevision !== null ? { revision: shareRevision } : {}),
        } : {}) }),
      })
      if (!controller.signal.aborted) { setPermissions(value); setTarget('') }
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not update access') }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }

  return <section className="make-sharing" aria-label="Project sharing" aria-busy={busy}>
    <h2><Users size={14} />Share for review<span>OWNER</span></h2>
    <p>Invite a Paper account to revision {project.revision}. Future drafts stay private until you share them. Changing roles keeps the shared revision. Releases are managed separately.</p>
    <label>Your Paper account ID<input aria-label="Your Paper account ID" value={accountId ?? ''} readOnly onFocus={event => event.currentTarget.select()} /></label>
    <form onSubmit={event => { event.preventDefault(); void change(target, 'PUT') }}>
      <fieldset disabled={!saved || disabled || busy}>
        <label>Paper account ID<input aria-label="Reviewer Paper account ID" value={target} onChange={event => setTarget(event.target.value)} placeholder="Paste an existing account ID" required maxLength={160} /></label>
        <div className="make-sharing-row"><label className="make-sr-only" htmlFor="make-share-role">Reviewer role</label>
          <select id="make-share-role" value={role} onChange={event => setRole(event.target.value as typeof role)}><option value="viewer">Viewer · read only</option><option value="editor">Editor · edit shared source</option></select>
          <button className="make-button" disabled={!target.trim()} type="submit">Grant access</button>
        </div>
      </fieldset>
    </form>
    {permissions.grants.length ? <ul className="make-sharing-list">{permissions.grants.map(grant => <li key={grant.accountId}>
      <code title={grant.accountId}>{grant.accountId}</code><span>{grant.role} · r{grant.revision}</span>
      <div className="make-sharing-row">
        <select aria-label={`Role for ${grant.accountId}`} disabled={disabled || busy} value={grant.role} onChange={event => void change(grant.accountId, 'PUT', event.target.value as typeof role, null)}><option value="viewer">Viewer</option><option value="editor">Editor</option></select>
        <button className="make-button" disabled={disabled || busy || grant.revision === project.revision} onClick={() => void change(grant.accountId, 'PUT', grant.role)}>Share r{project.revision}</button>
        <button className="make-button" disabled={disabled || busy} onClick={() => void change(grant.accountId, 'DELETE')}>Revoke</button>
      </div>
    </li>)}</ul> : null}
    <p role="status">{!saved ? 'Save a copy to invite reviewers.' : busy ? 'Updating access…' : permissions.grants.length ? 'Access is limited to the shared revision and its assets.' : 'Only you can access this project.'}</p>
    {error ? <p role="alert" className="make-asset-error">{error}</p> : null}
  </section>
}

export function SharedProjectReview({ item, accountId, onClose }: { item: SharedAppSummary; accountId?: string; onClose: () => void }) {
  const [shared, setShared] = useState<SharedApp | null>(null)
  const [assets, setAssets] = useState<CompilePreviewAssets | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [file, setFile] = useState('')
  const [source, setSource] = useState('')
  const controller = useRef<AbortController | null>(null)
  const current = useRef<SharedApp | null>(null)
  const saving = useRef(false)
  const path = `/shared-apps/${encodeURIComponent(item.ownerId)}/${encodeURIComponent(item.id)}`
  const headers = { 'X-Paper-Account': accountId ?? '' }

  function clear() { current.current = null; setShared(null); setAssets(null); setSource(''); setFile('') }
  async function load() {
    if (saving.current) return
    controller.current?.abort()
    const request = new AbortController(); controller.current = request
    setBusy(true)
    try {
      const value = await api<SharedApp>(path, { headers, signal: request.signal })
      if (request.signal.aborted) return
      if (current.current?.project.revision !== value.project.revision || current.current.role !== value.role) {
        // Drop the previous revision before preparing the next preview.
        setAssets(null)
        setShared(value)
        const first = Object.keys(value.project.files)[0] ?? ''
        setFile(first); setSource(value.project.files[first]?.content ?? '')
        const compiled = await api<CompileResult>(`${path}/compile`, { method: 'POST', headers, signal: request.signal })
        if (request.signal.aborted) return
        if (!compiled.success || !compiled.assets) throw new Error('The shared revision could not compile.')
        current.current = value
        setAssets(compiled.assets)
      }
      setError('')
    } catch (cause) {
      if (!request.signal.aborted) {
        clear()
        setError(cause instanceof ApiError && (cause.status === 404 || cause.status === 403) ? 'Access is no longer available. Ask the owner to share this project.' : cause instanceof Error ? cause.message : 'Could not load shared app')
      }
    } finally { if (!request.signal.aborted) setBusy(false) }
  }
  useEffect(() => {
    void load()
    const timer = window.setInterval(() => { if (!document.hidden) void load() }, 10_000)
    const focus = () => { void load() }
    window.addEventListener('focus', focus)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', focus); controller.current?.abort() }
    // Identity and project changes remount this component; closures use refs for the current grant.
  }, [path, accountId])

  async function save() {
    if (!shared || shared.role !== 'editor' || busy) return
    controller.current?.abort()
    const request = new AbortController(); controller.current = request
    saving.current = true
    setBusy(true); setError('')
    try {
      await api<SharedApp>(path, { method: 'PUT', headers, signal: request.signal, body: JSON.stringify({
        project: { ...shared.project, files: { ...shared.project.files, [file]: { path: file, content: source } } }, expectedRevision: shared.project.revision,
      }) })
      saving.current = false
      if (!request.signal.aborted) await load()
    } catch (cause) {
      if (!request.signal.aborted) {
        if (cause instanceof ApiError && (cause.status === 403 || cause.status === 404)) clear()
        setError(cause instanceof Error ? cause.message : 'Could not save source')
      }
    } finally { saving.current = false; if (!request.signal.aborted) setBusy(false) }
  }
  return <div className="make-workspace make-review" data-testid="make-shared-review">
    <header className="make-header"><button className="make-button" onClick={onClose}><ArrowLeft size={14} />My apps</button>
      <div className="make-brand"><Users size={16} /><span>{shared?.project.name ?? 'Shared project'}</span></div>
      <span className="make-review-role">{shared ? `${shared.role} · revision ${shared.project.revision}` : 'Checking access'}</span>
      <button className="make-button" disabled={busy} onClick={() => void load()}><RefreshCw size={13} />Refresh access</button>
    </header>
    {error ? <p role="alert" className="make-notice">{error}</p> : null}
    {shared ? <div className="make-layout">
      <aside className="make-sidebar" aria-label="Shared source">
        <div className="make-project-meta"><span className="make-eyebrow">SHARED WITH YOU</span><h1>{shared.project.name}</h1><p>{shared.role === 'viewer' ? 'Read-only review. Explore the source and interact with the preview.' : 'Edit the shared source. Saving requires the owner’s latest revision.'}</p></div>
        <label className="make-review-file">Source file<select aria-label="Shared source file" value={file} onChange={event => { setFile(event.target.value); setSource(shared.project.files[event.target.value].content) }}>{Object.keys(shared.project.files).map(path => <option key={path}>{path}</option>)}</select></label>
        <textarea className="make-review-source" aria-label="Shared source code" value={source} readOnly={shared.role === 'viewer'} disabled={busy} spellCheck={false} onChange={event => setSource(event.target.value)} />
        {shared.role === 'editor' ? <button className="make-button" disabled={busy || source === shared.project.files[file]?.content} onClick={() => void save()}><Save size={13} />Save shared source</button> : <p className="make-notice">Viewer · editing is disabled</p>}
      </aside>
      <main className="make-stage" aria-label="Shared preview"><div className="make-preview-canvas">{assets ? <PreviewFrame assets={assets} sessionKey={shared.project.revision} /> : <p role="status">{busy ? 'Preparing shared preview…' : 'Preview unavailable'}</p>}</div></main>
    </div> : busy ? <p className="make-notice" role="status">Checking project access…</p> : null}
  </div>
}
