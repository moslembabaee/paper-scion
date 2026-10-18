import { useEffect, useMemo, useState } from 'react'
import { Image, LoaderCircle } from 'lucide-react'
import { exportThumbnail } from './export'
import type { AssetFormat, ExportTarget } from './exportTypes'
import type { ExportOptions } from './svg'

export function ExportPreview({ target, format, background, colorSpace, quality, busy }: {
  target?: ExportTarget
  format: AssetFormat
  background: ExportOptions['background']
  colorSpace: NonNullable<ExportOptions['colorSpace']>
  quality: number
  busy: boolean
}) {
  const scene = target?.scene, scope = target?.scope
  const request = useMemo(() => ({ scene, scope, format, background, colorSpace, quality, busy }), [scene, scope, format, background, colorSpace, quality, busy])
  const [result, setResult] = useState<{ request: typeof request; url: string; error: string } | null>(null)
  const current = result?.request === request ? result : null
  const preview = { url: current?.url ?? '', error: current?.error ?? '', loading: !!target && !busy && !current }
  useEffect(() => {
    const { scene, scope, format, background, colorSpace, quality, busy } = request
    if (!scene || !scope || busy) return
    const controller = new AbortController()
    let url = ''
    const timer = window.setTimeout(() => {
      void exportThumbnail(scene, { scope, scale: 1, background, colorSpace, quality }, format, controller.signal).then(blob => {
        if (controller.signal.aborted) return
        url = URL.createObjectURL(blob)
        setResult({ request, url, error: '' })
      }).catch((error: unknown) => {
        if (!controller.signal.aborted) setResult({ request, url: '', error: error instanceof Error ? error.message : 'Preview unavailable.' })
      })
    }, 180)
    return () => { window.clearTimeout(timer); controller.abort(); if (url) URL.revokeObjectURL(url) }
  }, [request])

  return <div className="asset-preview" aria-busy={preview.loading && !busy}>
    <div className="asset-preview-top"><span><i /> LIVE PREVIEW</span><span>{format.toUpperCase()}</span></div>
    <div className={`asset-preview-stage ${background === 'cream' ? 'with-paper' : ''}`}>
      {target && preview.url && !busy && <img src={preview.url} alt={`Export preview of ${target.name}`} />}
      {(!target || !preview.url || busy) && <div className="asset-preview-placeholder">{preview.loading && !busy ? <LoaderCircle className="export-spinner" size={22} /> : <Image size={24} strokeWidth={1} />}<span>{busy ? 'Preparing your artwork…' : !target ? 'Choose artwork to preview' : preview.loading ? 'Rendering artwork…' : 'Preview unavailable'}</span></div>}
    </div>
    <div className="asset-preview-caption"><span>{target?.name ?? 'No artwork selected'}</span><span>{target ? `${Math.ceil(target.bounds.width)} × ${Math.ceil(target.bounds.height)}` : '—'}</span></div>
    {preview.error && !busy && target && <p className="export-error" role="status">{preview.error}</p>}
    <p className="asset-preview-note">{format === 'pdf' ? 'Lossless raster PDF · page size follows your artboard.' : format === 'svg' ? 'Editable vectors & text · original CSS colors.' : format === 'webp' ? 'Compact pixels · transparency preserved.' : 'Lossless pixels · transparency preserved.'}<br />Shaders use their saved static frame. Preview is capped at 480 px.</p>
  </div>
}
