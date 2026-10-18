import type { SceneSnapshot, TextElement } from '../scene/types.ts'
import { exportBounds, exportRoots, sceneToSVG } from './svg.ts'
import { resolveTextPathD } from '../scene/typography.ts'
import type { ExportAssets, ExportOptions } from './svg.ts'
import { sanitizeSVG } from './import.ts'
import type { AssetFormat } from './exportTypes.ts'
import { createPDF } from './pdf.ts'
import { awaitExportTask } from './exportTask.ts'

export const MAX_EXPORT_PIXELS = 64_000_000
export const MAX_EXPORT_DIMENSION = 16384

export function rasterDimensions(state: SceneSnapshot, options: ExportOptions, format: AssetFormat = 'png'): { width: number; height: number } {
  if (![1, 2, 3, 4].includes(options.scale)) throw new Error('Choose a valid export scale.')
  const bounds = exportBounds(state, options.scope)
  if (!bounds) throw new Error('There are no visible layers to export.')
  const width = Math.ceil(bounds.width * options.scale), height = Math.ceil(bounds.height * options.scale)
  const maxPixels = format === 'pdf' ? 16_000_000 : MAX_EXPORT_PIXELS
  if (width < 1 || height < 1 || !Number.isFinite(width * height) || width > MAX_EXPORT_DIMENSION || height > MAX_EXPORT_DIMENSION || width * height > maxPixels) throw new Error(`This ${format.toUpperCase()} is too large. Choose a lower scale or export a smaller selection (maximum ${maxPixels / 1_000_000} megapixels / 16,384 px per side).`)
  return { width, height }
}
export const pngDimensions = rasterDimensions

const blobURL = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result))
  reader.onerror = () => reject(new Error('Could not read an image asset.'))
  reader.readAsDataURL(blob)
})

export async function embedImage(src: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted()
  if (/^data:image\/(png|jpeg|webp|gif);/i.test(src)) return src
  const url = new URL(src, document.baseURI)
  if (!['http:', 'https:', 'data:', 'blob:'].includes(url.protocol)) throw new Error('Unsupported image URL.')
  let response: Response
  try { response = await fetch(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000), credentials: url.origin === location.origin ? 'same-origin' : 'omit' }) }
  catch {
    signal?.throwIfAborted()
    throw new Error('An image could not be embedded. Check its URL and CORS permissions.')
  }
  if (!response.ok) throw new Error('An image asset could not be loaded.')
  const blob = await awaitExportTask(response.blob(), signal)
  if (blob.type.includes('svg') || url.pathname.endsWith('.svg')) {
    const svg = sanitizeSVG(await awaitExportTask(blob.text(), signal))
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.source)}`
  }
  if (!/^image\/(png|jpeg|webp|gif)$/.test(blob.type)) throw new Error('The image must be PNG, JPEG, WebP, GIF, or SVG.')
  return awaitExportTask(blobURL(blob), signal)
}

async function prepareAssets(state: SceneSnapshot, options: ExportOptions, captureScale: number = options.scale, signal?: AbortSignal): Promise<ExportAssets> {
  signal?.throwIfAborted()
  await awaitExportTask(document.fonts.ready, signal)
  signal?.throwIfAborted()
  const images = new Map<string, string>(), shaders = new Map<string, string>()
  const textOutlines = new Map<string, string>()
  const visited: string[] = []
  const visit = (id: string) => { const node = state.elements[id]; if (!node.visible) return; visited.push(id); if (node.type === 'frame') node.children.forEach(visit) }
  exportRoots(state, options.scope).forEach(visit)
  // Deduplicate image URLs and limit concurrent fetches to avoid resource spikes.
  const imageCache = new Map<string, string>()
  const shaderNodes = visited.filter(id => state.elements[id].style.shader)
  const background = options.scope === 'canvas' ? state.backgroundShader : null
  const capture = shaderNodes.length || background ? (await import('./captureShader')).captureShader : null
  if (background && capture) {
    const bounds = exportBounds(state, options.scope)
    if (bounds) {
      if (bounds.width * bounds.height * captureScale ** 2 > MAX_EXPORT_PIXELS || Math.max(bounds.width, bounds.height) * captureScale > MAX_EXPORT_DIMENSION) throw new Error('The canvas shader is too large to export at this scale.')
      shaders.set('paper:background', await capture(background, bounds.width, bounds.height, captureScale, signal))
    }
  }
  for (const id of visited) {
    signal?.throwIfAborted()
    const node = state.elements[id]
    if (node.type === 'text' && node.kinetic?.enabled && node.fontSource) {
      const [{ loadOutlineFont, shapeText }, { placeGlyphs, glyphOutlines }] = await Promise.all([import('../scene/fontEngine'), import('../scene/kineticGeometry')])
      const font = await awaitExportTask(loadOutlineFont(node.fontSource), signal)
      textOutlines.set(id, glyphOutlines(placeGlyphs(node, shapeText(font, node), font.unitsPerEm, resolveTextPathD(node, state.elements)), node.kinetic))
    }
    if (node.type === 'image') {
      let source = imageCache.get(node.src)
      if (!source) { source = await embedImage(node.src, signal); imageCache.set(node.src, source) }
      images.set(id, source)
    }
    if (node.style.shader && capture) {
      if (node.width * node.height * captureScale ** 2 > MAX_EXPORT_PIXELS || Math.max(node.width, node.height) * captureScale > MAX_EXPORT_DIMENSION) throw new Error('A shader layer is too large to export at this scale.')
      shaders.set(id, await capture(node.style.shader, node.width, node.height, captureScale, signal))
    }
  }
  const context = document.createElement('canvas').getContext('2d')
  const measureText = context ? (text: string, node: TextElement) => {
    context.font = `${node.fontWeight} ${node.fontSize}px ${node.fontFamily}`
    return context.measureText(text).width
  } : undefined
  const textBaseline = context ? (node: TextElement) => {
    context.font = `${node.fontWeight} ${node.fontSize}px ${node.fontFamily}`
    const metrics = context.measureText('Mg')
    const ascent = metrics.fontBoundingBoxAscent ?? node.fontSize * .9
    const descent = metrics.fontBoundingBoxDescent ?? node.fontSize * .2
    return ascent + (node.fontSize * node.lineHeight - ascent - descent) / 2
  } : undefined
  return { images, shaders, measureText, textBaseline, textOutlines }
}

export async function exportSVG(state: SceneSnapshot, options: ExportOptions, signal?: AbortSignal): Promise<Blob> {
  const assets = await prepareAssets(state, options, options.scale, signal)
  signal?.throwIfAborted()
  return new Blob([sceneToSVG(state, options, assets)], { type: 'image/svg+xml;charset=utf-8' })
}

export function supportsDisplayP3(): boolean {
  const context = document.createElement('canvas').getContext('2d', { colorSpace: 'display-p3' })
  return context?.getContextAttributes().colorSpace === 'display-p3'
}

async function renderCanvas(state: SceneSnapshot, options: ExportOptions, format: AssetFormat, preview: boolean, signal?: AbortSignal): Promise<HTMLCanvasElement> {
  const bounds = exportBounds(state, options.scope)
  if (!bounds) throw new Error('There are no visible layers to export.')
  const ratio = preview ? Math.min(1, 480 / Math.max(bounds.width, bounds.height)) : options.scale
  const { width, height } = preview ? { width: Math.max(1, Math.ceil(bounds.width * ratio)), height: Math.max(1, Math.ceil(bounds.height * ratio)) } : rasterDimensions(state, options, format)
  // Size the SVG source too, so image.decode() never allocates an artboard-sized preview bitmap.
  const svg = new Blob([sceneToSVG(state, { ...options, scale: 1 }, await prepareAssets(state, options, ratio, signal), { width, height })], { type: 'image/svg+xml;charset=utf-8' })
  signal?.throwIfAborted()
  const url = URL.createObjectURL(svg)
  try {
    const image = new Image()
    image.src = url
    await awaitExportTask(image.decode(), signal)
    signal?.throwIfAborted()
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const colorSpace = format === 'png' ? options.colorSpace ?? 'srgb' : 'srgb'
    const context = canvas.getContext('2d', { colorSpace })
    if (!context) throw new Error('Your browser could not create an export canvas.')
    if (colorSpace === 'display-p3' && context.getContextAttributes().colorSpace !== 'display-p3') throw new Error('Display P3 is unavailable in this browser. Choose sRGB.')
    context.drawImage(image, 0, 0, width, height)
    return canvas
  } finally { URL.revokeObjectURL(url) }
}

async function encodeCanvas(canvas: HTMLCanvasElement, format: 'png' | 'webp', quality = .92): Promise<Blob> {
  const mime = `image/${format}`
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error(`${format.toUpperCase()} encoding failed. Try a lower scale.`)), mime, quality))
  if (blob.type !== mime) throw new Error(`This browser cannot encode ${format.toUpperCase()}. Choose PNG instead.`)
  return blob
}

export async function exportAsset(state: SceneSnapshot, options: ExportOptions, format: AssetFormat, signal?: AbortSignal): Promise<Blob> {
  if (format === 'svg') return exportSVG(state, options, signal)
  const canvas = await renderCanvas(state, options, format, false, signal)
  try {
    signal?.throwIfAborted()
    if (format === 'pdf') {
      const bounds = exportBounds(state, options.scope)!
      const rgba = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height, { colorSpace: 'srgb' }).data
      return await createPDF({ width: canvas.width, height: canvas.height, pageWidth: bounds.width, pageHeight: bounds.height, rgba }, signal)
    }
    const blob = await awaitExportTask(encodeCanvas(canvas, format, options.quality), signal)
    signal?.throwIfAborted()
    return blob
  } finally { canvas.width = 0; canvas.height = 0 }
}

export const exportPNG = (state: SceneSnapshot, options: ExportOptions) => exportAsset(state, options, 'png')
export const exportWebP = (state: SceneSnapshot, options: ExportOptions) => exportAsset(state, options, 'webp')
export const exportPDF = (state: SceneSnapshot, options: ExportOptions) => exportAsset(state, options, 'pdf')
export {
  drawSvgPathToCanvas2D,
  renderCompoundToCanvas2D,
  renderCompoundMaskToCanvas2D,
  renderSceneToCanvas2D,
} from './canvas2dExport.ts'

/** Preview resolution is bounded independently of the chosen output scale. */
export async function exportThumbnail(state: SceneSnapshot, options: ExportOptions, format: AssetFormat, signal: AbortSignal): Promise<Blob> {
  const canvas = await renderCanvas(state, options, format, true, signal)
  try {
    signal.throwIfAborted()
    return await awaitExportTask(encodeCanvas(canvas, format === 'webp' ? 'webp' : 'png', options.quality), signal)
  } finally { canvas.width = 0; canvas.height = 0 }
}
