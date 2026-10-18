import { useCallback, useEffect, useRef, useState } from 'react'
import { KeyRound, RefreshCw } from 'lucide-react'
import { api } from '../cloud/api'
import { APP_SECRET_LIMITS, type AppSecretHandle } from './secrets'

export function SecretHandles({ appId, accountId, saved, disabled }: {
  appId: string; accountId?: string; saved: boolean; disabled: boolean
}) {
  const available = saved && !!accountId
  const [handles, setHandles] = useState<AppSecretHandle[]>([])
  const [rotation, setRotation] = useState<AppSecretHandle | null>(null)
  const [busy, setBusy] = useState(available)
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const request = useRef<AbortController | null>(null)
  const path = `/apps/${encodeURIComponent(appId)}/secrets`

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const result = await api<{ secrets: AppSecretHandle[] }>(path, { signal, headers: { 'X-Paper-Account': accountId ?? '' } })
    if (!signal?.aborted) setHandles(result.secrets)
  }, [path, accountId])
  useEffect(() => {
    const controller = new AbortController(); request.current = controller
    if (available) {
      void refresh(controller.signal).catch(() => { if (!controller.signal.aborted) setError('Could not load secret handles. Refresh to retry.') })
        .finally(() => { if (!controller.signal.aborted) setBusy(false) })
    }
    return () => { controller.abort(); request.current?.abort() }
  }, [refresh, available])

  async function change(revoke?: AppSecretHandle) {
    if (!available || disabled || busy) return
    const value = input.current?.value ?? ''
    const bytes = new TextEncoder().encode(value).length
    if (!revoke && (bytes < 32 || bytes > APP_SECRET_LIMITS.MAX_VALUE_BYTES)) {
      setError('Secret must contain 32–4096 UTF-8 bytes.'); return
    }
    if (input.current) input.current.value = ''
    const target = revoke ?? rotation
    const payload = revoke ? { expectedVersion: revoke.version } : target
      ? { value, expectedVersion: target.version } : { capability: 'hmac-sha256', value }
    const controller = new AbortController(); request.current = controller
    setBusy(true); setError('')
    try {
      await api<AppSecretHandle>(path + (target ? `/${encodeURIComponent(target.handle)}` : ''), {
        method: revoke ? 'DELETE' : target ? 'PUT' : 'POST', body: JSON.stringify(payload),
        signal: controller.signal, headers: { 'X-Paper-Account': accountId ?? '' },
      })
      if (!controller.signal.aborted) { setRotation(null); await refresh(controller.signal) }
    } catch {
      if (!controller.signal.aborted) setError('Secret change could not complete. Refresh handles before retrying.')
    } finally { if (!controller.signal.aborted) setBusy(false) }
  }

  return <section className="make-secrets" aria-label="App secret handles" aria-busy={busy}>
    <h2><KeyRound size={14} />Secret handles<span>OWNER</span></h2>
    <p>Encrypted on your server. App code receives a handle and can request an app-scoped signature. Only your saved app preview can use it.</p>
    <div className="make-secret-capability"><span>01</span><div><strong>HMAC-SHA256</strong><small>App signing · no network access</small></div></div>
    <form onSubmit={event => { event.preventDefault(); void change() }} autoComplete="off">
      <fieldset disabled={!available || disabled || busy}>
        <label>{rotation ? 'Replacement secret' : 'New secret'}<input ref={input} type="password" name="app-secret" aria-label={rotation ? 'Replacement secret' : 'New secret'} autoComplete="new-password" required maxLength={4096} placeholder="At least 32 bytes" spellCheck={false} /></label>
        {rotation ? <p>Rotating <code>{rotation.handle}</code> · v{rotation.version}</p> : null}
        <div className="make-secret-actions"><button type="submit" className="make-button">{rotation ? 'Rotate secret' : 'Create handle'}</button>
          {rotation ? <button type="button" className="make-button" onClick={() => { setRotation(null); if (input.current) input.current.value = '' }}>Cancel rotation</button> : null}
        </div>
      </fieldset>
    </form>
    {handles.length ? <ul>{handles.map(handle => <li key={handle.handle}>
      <code>{handle.handle}</code><span>v{handle.version} · {handle.status}</span>
      {handle.status === 'active' ? <div className="make-secret-actions">
        <button className="make-button" disabled={disabled || busy} onClick={() => { setRotation(handle); if (input.current) { input.current.value = ''; input.current.focus() } }}>Rotate</button>
        <button className="make-button" disabled={disabled || busy} onClick={() => void change(handle)}>Revoke handle</button>
      </div> : null}
    </li>)}</ul> : null}
    <p role="status">{!available ? 'Save an app to manage its secrets.' : busy ? 'Updating handles…' : `${handles.filter(handle => handle.status === 'active').length} active · Values cannot be revealed.`}</p>
    {available ? <button className="make-button" disabled={busy || disabled} onClick={() => {
      const controller = new AbortController(); request.current?.abort(); request.current = controller
      setBusy(true); setError(''); setRotation(null)
      if (input.current) input.current.value = ''
      void refresh(controller.signal).catch(() => { if (!controller.signal.aborted) setError('Could not load secret handles.') })
        .finally(() => { if (!controller.signal.aborted) setBusy(false) })
    }}><RefreshCw size={11} />Refresh handles</button> : null}
    {error ? <p role="alert" className="make-asset-error">{error}</p> : null}
  </section>
}
