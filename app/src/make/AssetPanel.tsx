import { useEffect, useRef, useState } from 'react'
import { Download, ImagePlus, Trash2, Type } from 'lucide-react'
import { api } from '../cloud/api'
import { APP_ASSET_LIMITS, encodeAssetBase64, type AppAsset, type AppProjectPackage } from './assets'
import type { AppProject } from './types'

export function AssetPanel({ project, accountId, saved, disabled, onChange }: {
  project: AppProject; accountId?: string; saved: boolean; disabled: boolean
  onChange: (previous: AppProject, updated: AppProject) => void
}) {
  const [assets, setAssets] = useState<AppAsset[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const generation = useRef(0)
  const headers = accountId ? { 'X-Paper-Account': accountId } : undefined
  useEffect(() => {
    const controller = new AbortController()
    const current = ++generation.current
    setAssets([]); setError(''); setBusy(false); setNotice('')
    if (saved) void api<{ assets: AppAsset[] }>(`/apps/${encodeURIComponent(project.id)}/assets`, { headers: accountId ? { 'X-Paper-Account': accountId } : undefined, signal: controller.signal })
      .then(result => { if (generation.current === current) setAssets(result.assets) })
      .catch(error => { if (!controller.signal.aborted && generation.current === current) setError(error.message) })
    return () => { controller.abort() }
  }, [project.id, project.revision, accountId, saved])
  async function upload(file: File) {
    const current = generation.current
    setBusy(true); setError(''); setNotice('')
    try {
      if (file.size > APP_ASSET_LIMITS.MAX_ASSET_BYTES) throw new Error('Choose a file smaller than 2 MiB.')
      const content = encodeAssetBase64(new Uint8Array(await file.arrayBuffer()))
      const result = await api<{ asset: AppAsset; project: AppProject }>(`/apps/${encodeURIComponent(project.id)}/assets`, {
        method: 'POST', headers, body: JSON.stringify({ name: file.name, content, expectedRevision: project.revision }),
      })
      if (current === generation.current) onChange(project, result.project)
    } catch (error) { if (current === generation.current) setError(error instanceof Error ? error.message : 'Upload failed') }
    finally { if (current === generation.current) setBusy(false) }
  }
  async function detach(asset: AppAsset) {
    const current = generation.current
    setBusy(true); setError('')
    try {
      const result = await api<{ project: AppProject }>(`/apps/${encodeURIComponent(project.id)}/assets/${asset.id}`, {
        method: 'DELETE', headers, body: JSON.stringify({ expectedRevision: project.revision }),
      })
      if (current === generation.current) onChange(project, result.project)
    } catch (error) { if (current === generation.current) setError(error instanceof Error ? error.message : 'Could not remove asset') }
    finally { if (current === generation.current) setBusy(false) }
  }
  async function download() {
    const current = generation.current
    setBusy(true); setError('')
    try {
      const pkg = await api<AppProjectPackage>(`/apps/${encodeURIComponent(project.id)}/export`, { headers })
      if (current !== generation.current) return
      const url = URL.createObjectURL(new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url; link.download = `${project.name.replace(/[^a-zA-Z0-9_-]/g, '-') || 'app'}.paper-app.json`
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) { if (current === generation.current) setError(error instanceof Error ? error.message : 'Export failed') }
    finally { if (current === generation.current) setBusy(false) }
  }
  return <section className="make-assets" aria-label="Project assets" aria-busy={busy}>
    <h2><ImagePlus size={14} />Assets<span>{assets.length.toString().padStart(2, '0')}</span></h2>
    <p className="make-asset-help">{saved ? 'Private to this app. Images and fonts travel with your export.' : 'Save a copy to attach images and fonts.'}</p>
    <input ref={input} type="file" className="make-sr-only" aria-label="Upload image or font" accept=".png,.jpg,.jpeg,.gif,.webp,.svg,.woff,.woff2,.ttf,.otf" disabled={!saved || busy || disabled}
      onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void upload(file) }} />
    <div className="make-asset-actions"><button className="make-button" disabled={!saved || busy || disabled} onClick={() => input.current?.click()}><ImagePlus size={12} />{busy ? 'Working…' : 'Attach asset'}</button>
      <button className="make-button" aria-label="Export app with assets" disabled={!saved || busy || disabled} onClick={() => { void download() }}><Download size={12} />Export</button></div>
    <p className="make-asset-limit">2 MiB / file · 10 MiB / app · 100 assets</p>
    {assets.map(asset => <article className="make-asset" key={asset.id}>
      {asset.type === 'image' ? <img src={`/api/apps/${encodeURIComponent(project.id)}/assets/${asset.id}`} alt="" loading="lazy" /> : <span className="make-font-icon"><Type size={18} /></span>}
      <div><strong title={asset.name}>{asset.name}</strong><span>{Math.max(1, Math.ceil(asset.byteSize / 1024))} KiB · {asset.type}</span>
        <button className="make-asset-reference" title="Copy reference for your app source" onClick={() => {
          void navigator.clipboard.writeText(`paper-asset:${asset.id}`).then(() => setNotice('Asset reference copied.')).catch(() => setError('Could not copy. Select the reference below.'))
        }}>paper-asset:{asset.id}</button></div>
      <button className="make-button make-asset-remove" aria-label={`Remove ${asset.name}`} disabled={busy || disabled} onClick={() => { void detach(asset) }}><Trash2 size={12} /></button>
    </article>)}
    {notice ? <p className="make-asset-help" role="status">{notice}</p> : null}
    {error ? <p className="make-asset-error" role="alert">{error}</p> : null}
  </section>
}
