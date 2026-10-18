import { useEffect, useRef, useState } from 'react'
import { ExternalLink, Globe, Upload } from 'lucide-react'
import { api } from '../cloud/api'
import type { AppProject, AppPublication } from './types'

export function Publication({ project, accountId, saved, disabled }: {
  project: AppProject; accountId?: string; saved: boolean; disabled: boolean
}) {
  const [release, setRelease] = useState<AppPublication | null>(null)
  const [status, setStatus] = useState<'loading' | 'idle' | 'publishing' | 'unpublishing'>('loading')
  const [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)
  const path = `/apps/${encodeURIComponent(project.id)}/release`
  const busy = status !== 'idle'
  useEffect(() => {
    const controller = new AbortController()
    request.current = controller
    if (saved) {
      void api<AppPublication | null>(path, { signal: controller.signal,
        headers: accountId ? { 'X-Paper-Account': accountId } : undefined,
      }).then(value => { if (!controller.signal.aborted) setRelease(value) })
        .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load publication.') })
        .finally(() => { if (!controller.signal.aborted) setStatus('idle') })
    } else setStatus('idle')
    return () => { controller.abort(); request.current?.abort() }
  }, [path, saved, accountId])

  async function change(method: 'POST' | 'DELETE') {
    if (busy || disabled || !saved) return
    const controller = new AbortController()
    request.current = controller
    setStatus(method === 'POST' ? 'publishing' : 'unpublishing'); setError('')
    try {
      const value = await api<AppPublication | { ok: boolean }>(path, {
        method, body: JSON.stringify({ expectedRevision: project.revision }), signal: controller.signal,
        headers: accountId ? { 'X-Paper-Account': accountId } : undefined, timeoutMs: 25_000,
      })
      if (!controller.signal.aborted) setRelease(method === 'DELETE' ? null : value as AppPublication)
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Publication failed.')
    } finally { if (!controller.signal.aborted) setStatus('idle') }
  }
  return <section className="make-publication" aria-label="Publication" aria-busy={busy}>
    <h2><Globe size={14} />Publish app<span>{release ? 'LIVE' : 'PRIVATE'}</span></h2>
    <p>{release ? `Revision ${release.revision} is public. Your saved edits go live only when you update.` : 'Share a running app with anyone. Publish checks the saved revision on desktop and mobile.'}</p>
    {release ? <a className="make-release-link" href={release.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={12} />Open published app<span>r{release.revision}</span></a> : null}
    <button className="make-button" disabled={!saved || disabled || busy || release?.revision === project.revision} onClick={() => void change('POST')}><Upload size={12} />{status === 'publishing' ? 'Validating release…' : release ? `Update to revision ${project.revision}` : 'Publish saved app'}</button>
    {release ? <button className="make-button make-unpublish" disabled={disabled || busy} onClick={() => void change('DELETE')}>{status === 'unpublishing' ? 'Unpublishing…' : 'Unpublish app'}</button> : null}
    <p role="status" aria-live="polite">{!saved ? 'Save a copy to publish this app.' : status === 'publishing' ? 'Checking the build and browser behavior before going live…' : status === 'unpublishing' ? 'Revoking every published version…' : release ? 'Unpublish revokes every version URL.' : 'A public release is a frozen copy of your saved app.'}</p>
    {error ? <p className="make-asset-error" role="alert">{error}</p> : null}
  </section>
}
