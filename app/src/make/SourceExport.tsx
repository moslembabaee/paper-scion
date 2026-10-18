import { useEffect, useRef, useState } from 'react'
import { Download, PackageCheck } from 'lucide-react'
import { api } from '../cloud/api'
import type { AppProject } from './types'

export function SourceExport({ project, accountId, saved, disabled }: {
  project: AppProject; accountId?: string; saved: boolean; disabled: boolean
}) {
  const [status, setStatus] = useState<'idle' | 'checking' | 'downloading' | 'done'>('idle')
  const [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => { request.current?.abort() }, [])
  useEffect(() => { if (disabled) request.current?.abort() }, [disabled])
  const busy = status === 'checking' || status === 'downloading'

  async function download() {
    if (busy || disabled || !saved) return
    const controller = new AbortController()
    request.current = controller
    const headers = accountId ? { 'X-Paper-Account': accountId } : undefined
    const path = `/apps/${encodeURIComponent(project.id)}`
    setError(''); setStatus('checking')
    try {
      const approval = await api<{ ok: boolean; revision: number }>(`${path}/export/approve`, {
        method: 'POST', headers, body: JSON.stringify({ expectedRevision: project.revision }), signal: controller.signal, timeoutMs: 25_000,
      })
      if (!approval.ok || approval.revision !== project.revision) throw new Error('Export approval did not match this revision.')
      controller.signal.throwIfAborted()
      setStatus('downloading')
      const response = await fetch(`/api${path}/export.zip?revision=${project.revision}`, {
        credentials: 'same-origin', headers: { 'X-Paper-Client': 'web', ...headers }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]),
      })
      if (!response.ok) {
        const value = await response.json().catch(() => ({}))
        throw new Error(value.error ?? 'Could not download source ZIP.')
      }
      if (!response.headers.get('content-type')?.includes('application/zip')) throw new Error('Source export is unavailable on this host.')
      const blob = await response.blob()
      controller.signal.throwIfAborted()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url; link.download = `${project.id}-r${project.revision}.zip`
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
      setStatus('done')
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Source export failed.')
      setStatus('idle')
    } finally { if (request.current === controller) request.current = null }
  }
  return <section className="make-source-export" aria-label="Runnable source" aria-busy={busy}>
    <h2><PackageCheck size={14} />Runnable source<span>ZIP</span></h2>
    <p>{saved ? `Download saved revision ${project.revision} with its source, local assets and build tools. Save source edits before exporting.` : 'Save a copy to download a runnable app.'}</p>
    <button className="make-button" disabled={!saved || disabled || busy} onClick={() => { void download() }}><Download size={12} />{busy ? 'Preparing source…' : 'Download source ZIP'}</button>
    <p role="status" aria-live="polite">{status === 'checking' ? 'Checking the saved app on desktop and mobile…' : status === 'downloading' ? 'Packaging your approved revision…' : status === 'done' ? `Revision ${project.revision} downloaded. Unzip, then follow README.md to build and start.` : 'Includes a locked package manifest · Builds locally'}</p>
    {error ? <p className="make-asset-error" role="alert">{error}</p> : null}
  </section>
}
