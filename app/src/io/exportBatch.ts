import type { ExportOptions } from './svg.ts'
import { exportAsset, rasterDimensions } from './export.ts'
import { assetFileNames } from './exportTypes.ts'
import type { AssetFormat, ExportScale, ExportTarget } from './exportTypes.ts'
import { fileName } from './project.ts'
import { createZIP, MAX_ARCHIVE_BYTES } from './zip.ts'
import { awaitExportTask } from './exportTask.ts'
import type { ArchiveFile } from './zip.ts'

export interface BatchSettings {
  readonly name: string
  readonly targets: readonly ExportTarget[]
  readonly scales: readonly ExportScale[]
  readonly format: AssetFormat
  readonly background: ExportOptions['background']
  readonly colorSpace: NonNullable<ExportOptions['colorSpace']>
  readonly quality: number
}
export interface ExportProgress { readonly completed: number; readonly total: number; readonly name: string }

export function validateBatch(settings: BatchSettings): void {
  const total = settings.targets.length * settings.scales.length
  if (!total) throw new Error('Choose at least one asset and scale.')
  if (total > 999) throw new Error('Choose fewer than 1,000 assets per batch.')
  if (settings.scales.some(scale => ![1, 2, 3].includes(scale)) || new Set(settings.scales).size !== settings.scales.length) throw new Error('Choose unique 1×, 2×, or 3× scales.')
  if (settings.colorSpace === 'display-p3' && settings.format !== 'png') throw new Error('Display P3 export is available for PNG. Choose sRGB for this format.')
  if (!Number.isFinite(settings.quality) || settings.quality < 0 || settings.quality > 1) throw new Error('Choose a valid WebP quality.')
  if (settings.format !== 'svg') for (const target of settings.targets) for (const scale of settings.scales) rasterDimensions(target.scene, { ...settings, scope: target.scope, scale }, settings.format)
}

/** Process one image at a time, from a single immutable scene revision. */
export async function exportBatch(settings: BatchSettings, signal: AbortSignal, onProgress: (progress: ExportProgress) => void): Promise<ArchiveFile> {
  validateBatch(settings)
  const names = assetFileNames(settings.targets, settings.scales, settings.format)
  const files: ArchiveFile[] = [], manifest: object[] = []
  let bytes = 0
  for (const target of settings.targets) for (const scale of settings.scales) {
    signal.throwIfAborted()
    const name = names[files.length]
    onProgress({ completed: files.length, total: names.length, name })
    const blob = await exportAsset(target.scene, { scope: target.scope, scale, background: settings.background, colorSpace: settings.colorSpace, quality: settings.quality }, settings.format, signal)
    signal.throwIfAborted()
    bytes += blob.size
    if (bytes > MAX_ARCHIVE_BYTES) throw new Error('This batch exceeds 512 MB. Export fewer assets or use a lower scale.')
    files.push({ name, blob })
    manifest.push({ file: name, layer: target.name, scale, width: Math.ceil(target.bounds.width * scale), height: Math.ceil(target.bounds.height * scale), colorSpace: settings.format === 'svg' ? 'native CSS colors' : settings.colorSpace, background: settings.background, ...(settings.format === 'pdf' ? { rendering: 'lossless raster', pageWidth: target.bounds.width * .75, pageHeight: target.bounds.height * .75, pageUnits: 'pt' } : {}) })
    onProgress({ completed: files.length, total: names.length, name })
    // Let the browser paint progress and handle cancellation between assets.
    await awaitExportTask(new Promise<void>(resolve => setTimeout(resolve, 0)), signal)
  }
  if (files.length === 1) return files[0]
  onProgress({ completed: files.length, total: names.length, name: 'Packaging ZIP…' })
  files.push({ name: 'manifest.json', blob: new Blob([JSON.stringify({ application: 'Paper', format: settings.format, assets: manifest }, null, 2)], { type: 'application/json' }) })
  const blob = await createZIP(files, signal)
  signal.throwIfAborted()
  return { name: fileName(`${settings.name}-assets`, 'zip'), blob }
}
