import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownToLine, Check, CheckCheck, Download, Frame, Layers, Package, X } from 'lucide-react'
import type { SceneStore } from '../scene/store'
import { useScene } from '../scene/useScene'
import { Dialog } from '../workspace/Dialog'
import { ExportPreview } from './ExportPreview'
import { supportsDisplayP3 } from './export'
import { exportBatch, validateBatch } from './exportBatch'
import type { BatchSettings, ExportProgress } from './exportBatch'
import { ASSET_FORMATS, exportTargets, SCALE_PRESETS } from './exportTypes'
import type { AssetFormat, ExportScale, ExportScope } from './exportTypes'
import { downloadFile } from './project'
import type { ExportOptions } from './svg'

const formatLabels: Record<AssetFormat, string> = { svg: 'Editable vector', png: 'Lossless image', webp: 'Compact image', pdf: 'Portable document' }

export function ExportPanel({ store, name, onSave, onMessage, onClose, initialScope }: {
  store: SceneStore
  name: string
  onSave: () => void
  onMessage: (message: string) => void
  onClose: () => void
  initialScope?: ExportScope
}) {
  const state = useScene(store, snapshot => snapshot)
  const [format, setFormat] = useState<AssetFormat>('png')
  const [scope, setScope] = useState<ExportScope>(initialScope ?? (state.selection.length > 1 ? 'layers' : state.selection.length ? 'selection' : 'artboards'))
  const [scales, setScales] = useState<ExportScale[]>([2])
  const [background, setBackground] = useState<ExportOptions['background']>('transparent')
  const [colorSpace, setColorSpace] = useState<'srgb' | 'display-p3'>('srgb')
  const [quality, setQuality] = useState(.92)
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set())
  const [focused, setFocused] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [p3Supported] = useState(supportsDisplayP3)
  const operation = useRef<AbortController | null>(null)
  useEffect(() => () => { operation.current?.abort() }, [])
  const targets = useMemo(() => exportTargets(state, scope, name), [state, scope, name])
  const included = useMemo(() => targets.filter(target => !excluded.has(target.id)), [targets, excluded])
  const previewTarget = targets.find(target => target.id === focused) ?? included[0] ?? targets[0]
  const effectiveColor = format === 'png' ? colorSpace : 'srgb'
  const settings = useMemo<BatchSettings>(() => ({ name, targets: included, scales, format, background, colorSpace: effectiveColor, quality }), [name, included, scales, format, background, effectiveColor, quality])
  const validation = useMemo(() => {
    try { validateBatch(settings); return '' }
    catch (error) { return error instanceof Error ? error.message : 'Invalid export settings.' }
  }, [settings])
  const total = included.length * scales.length
  const batch = total > 1
  const dimensions = previewTarget ? `${Math.ceil(previewTarget.bounds.width * (scales[0] ?? 1)).toLocaleString()} × ${Math.ceil(previewTarget.bounds.height * (scales[0] ?? 1)).toLocaleString()} px` : 'No visible artwork'

  function changeScope(value: ExportScope) { setScope(value); setExcluded(new Set()); setFocused(''); setError('') }
  function toggleScale(value: ExportScale) {
    setScales(current => current.includes(value) ? current.filter(scale => scale !== value) : [...current, value].sort())
    setError('')
  }
  function toggleTarget(id: string) {
    setExcluded(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next })
    setError('')
  }
  async function runExport() {
    if (operation.current || validation) return
    const controller = new AbortController()
    operation.current = controller
    setBusy(true); setError(''); setProgress(null)
    try {
      const result = await exportBatch(settings, controller.signal, setProgress)
      controller.signal.throwIfAborted()
      downloadFile(result.blob, result.name)
      onMessage(`${total} ${total === 1 ? 'asset' : 'assets'} exported${batch ? ' in a ZIP archive' : ` as ${format.toUpperCase()}`}.`)
      onClose()
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Export failed. Please try again.')
    } finally { operation.current = null; setBusy(false); setProgress(null) }
  }

  return <Dialog className="export-dialog asset-export-dialog" labelledBy="export-title" onClose={onClose} busy={busy}>
    <div className="export-heading"><div><span className="export-eyebrow">PAPER / EXPORT STUDIO</span><h2 id="export-title">Ready for the outside.</h2><p>Your artwork, at every resolution.</p></div><button className="quiet-button" aria-label="Close export" disabled={busy} onClick={onClose}><X size={18} /></button></div>
    <div className="asset-export-body">
      <div className="asset-export-settings">
        <div className="export-section-label"><span>01</span> FORMAT</div>
        <div className="export-formats" role="group" aria-label="Export format">{ASSET_FORMATS.map(value => <button key={value} className={format === value ? 'selected' : ''} disabled={busy} aria-pressed={format === value} onClick={() => { setFormat(value); setError('') }}><span className="export-format-title">{value.toUpperCase()}{format === value && <Check size={12} />}</span><span>{formatLabels[value]}</span></button>)}</div>
        <div className="export-fields">
          <div className="export-section-label"><span>02</span> OUTPUT</div>
          <label className="export-field"><span>Include</span><select aria-label="Export scope" value={scope} disabled={busy} onChange={event => changeScope(event.target.value as ExportScope)}><option value="artboards">Artboards · separate files</option><option value="selection" disabled={!state.selection.length}>Selection · combined</option><option value="layers" disabled={!state.selection.length}>Selected layers · separate files</option><option value="canvas">Whole canvas</option></select></label>
          <div className="export-field"><span>Scale presets</span><div className="export-scales" role="group" aria-label="Export scales">{SCALE_PRESETS.map(value => <button key={value} disabled={busy} aria-pressed={scales.includes(value)} onClick={() => toggleScale(value)}>{value}×{scales.includes(value) && <Check size={11} />}</button>)}</div></div>
          <label className="export-field"><span>Background</span><select aria-label="Export background" value={background} disabled={busy} onChange={event => { setBackground(event.target.value as ExportOptions['background']); setError('') }}><option value="transparent">Transparent</option><option value="cream">Paper cream · #edebe1</option></select></label>
          <label className="export-field"><span>Color space</span><select aria-label="Export color space" value={format === 'svg' ? 'source' : effectiveColor} disabled={busy || format !== 'png'} onChange={event => { setColorSpace(event.target.value as 'srgb' | 'display-p3'); setError('') }}>{format === 'svg' ? <option value="source">Original CSS colors</option> : <><option value="srgb">sRGB · universal</option>{format === 'png' && <option value="display-p3" disabled={!p3Supported}>Display P3{!p3Supported ? ' · unavailable' : ' · wide gamut'}</option>}</>}</select></label>
          {format === 'webp' && <label className="export-field export-quality"><span>Image quality</span><input aria-label="WebP quality" type="range" min="10" max="100" step="1" value={Math.round(quality * 100)} disabled={busy} onChange={event => setQuality(Number(event.target.value) / 100)} /><output>{Math.round(quality * 100)}%</output></label>}
          <div className="export-dimensions"><span className="export-swatch" /><span>{dimensions}</span><span>{scales.length > 1 ? `${scales.length} SIZES` : `${scales[0] ?? '—'}×`}</span></div>
          <p className="export-note">{format === 'png' ? 'sRGB works everywhere. Display P3 keeps wide-gamut paints on compatible displays.' : format === 'svg' ? 'Scale sets the document size. Paths and text remain editable.' : format === 'pdf' ? 'Scale controls image detail. Page dimensions stay at the original artwork size.' : 'sRGB output for consistent color across browsers and devices.'}</p>
        </div>
      </div>
      <div className="asset-export-artwork">
        <ExportPreview target={previewTarget} format={format} background={background} colorSpace={effectiveColor} quality={quality} busy={busy} />
        <div className="export-target-heading"><span>{scope === 'artboards' ? <Frame size={13} /> : <Layers size={13} />}</span> ARTWORK <span>{included.length}/{targets.length}</span>{targets.length > 1 && <button disabled={busy} onClick={() => setExcluded(included.length === targets.length ? new Set(targets.map(target => target.id)) : new Set())} aria-label={included.length === targets.length ? 'Deselect all artwork' : 'Select all artwork'}><CheckCheck size={13} />{included.length === targets.length ? 'Clear' : 'All'}</button>}</div>
        <div className="export-target-list" aria-label="Artwork to export">{targets.length ? targets.map(target => <div key={target.id} className={`export-target ${previewTarget?.id === target.id ? 'previewing' : ''}`}><input type="checkbox" aria-label={`Include ${target.name}`} checked={!excluded.has(target.id)} disabled={busy} onChange={() => toggleTarget(target.id)} /><button disabled={busy} aria-label={`Preview ${target.name}`} aria-pressed={previewTarget?.id === target.id} onClick={() => setFocused(target.id)}><span>{target.name}</span><small>{Math.ceil(target.bounds.width)} × {Math.ceil(target.bounds.height)}</small></button></div>) : <p className="export-empty">{scope === 'artboards' ? 'Add a top-level frame to export an artboard, or choose Whole canvas.' : 'Select visible layers on the canvas to export them.'}</p>}</div>
      </div>
    </div>
    {(error || validation) && <p className="export-error export-panel-error" role={error ? 'alert' : 'status'}>{error || validation}</p>}
    {busy && <div className="export-progress" role="status" aria-live="polite"><span>{progress?.name ?? 'Preparing artwork…'}</span><span>{progress?.completed ?? 0} / {total}</span><progress value={progress?.completed ?? 0} max={total} aria-label="Export progress" /></div>}
    <div className="export-footer"><div className="export-package-note">{batch ? <Package size={16} /> : <ArrowDownToLine size={16} />}<div><strong>{total} {total === 1 ? 'asset' : 'assets'}{batch ? ' · ZIP archive' : ` · ${format.toUpperCase()}`}</strong><span>{batch ? 'Named files + export manifest' : 'Made here. Goes anywhere.'}</span></div></div><div className="export-footer-actions">{busy ? <button className="export-save-project" onClick={() => operation.current?.abort()}>Cancel export</button> : <button className="export-save-project" onClick={onSave}>Save project JSON</button>}<button className="export-submit" disabled={busy || !!validation} onClick={() => void runExport()}><Download size={14} />{busy ? 'Exporting…' : batch ? 'Export ZIP' : `Export ${format.toUpperCase()}`}</button></div></div>
  </Dialog>
}
