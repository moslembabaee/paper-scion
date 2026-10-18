import { SceneStore } from '../scene/store.ts'
import type { ElementGeometry, ElementStyle, SceneDocument } from '../scene/types.ts'
import { decodeFigmaArchive } from './figmaBinary.ts'
import { MAX_IMPORT_BYTES } from './project.ts'

interface FigmaColor { r?: number; g?: number; b?: number; a?: number }
interface FigmaPaint { type?: string; color?: FigmaColor; opacity?: number; visible?: boolean; image?: { dataBlob?: number }; imageRef?: string }
interface FigmaMatrix { m00?: number; m01?: number; m02?: number; m10?: number; m11?: number; m12?: number }
interface FigmaNode {
  id?: string; guid?: { sessionID: number; localID: number }; type?: string; name?: string
  parentIndex?: { guid: { sessionID: number; localID: number }; position?: string }; children?: FigmaNode[]
  x?: number; y?: number; width?: number; height?: number; rotation?: number; size?: { x?: number; y?: number }
  absoluteBoundingBox?: { x?: number; y?: number; width?: number; height?: number }; relativeTransform?: number[][]; transform?: FigmaMatrix
  visible?: boolean; locked?: boolean; opacity?: number; cornerRadius?: number; clipsContent?: boolean; frameMaskDisabled?: boolean
  fills?: FigmaPaint[]; fillPaints?: FigmaPaint[]; strokes?: FigmaPaint[]; strokePaints?: FigmaPaint[]; strokeWeight?: number; dashPattern?: number[]
  characters?: string; fontSize?: number; fontName?: { family?: string; style?: string }; textData?: { characters?: string; fontMetaData?: { fontWeight?: number }[] }
  textAlignHorizontal?: string; lineHeight?: { value?: number; units?: string }; textTracking?: number
  style?: { fontFamily?: string; fontSize?: number; fontWeight?: number; lineHeightPx?: number; letterSpacing?: number; textAlignHorizontal?: string }
  fillGeometry?: { path?: string; windingRule?: string; commandsBlob?: number }[]
  effects?: { type?: string; visible?: boolean; color?: FigmaColor; offset?: { x?: number; y?: number }; radius?: number }[]
}
export interface ImportedDocument extends SceneDocument { readonly warnings?: readonly string[] }
const finite = (value: unknown, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback
const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value))
const nodeId = (node: FigmaNode) => node.id ?? (node.guid ? `${node.guid.sessionID}:${node.guid.localID}` : crypto.randomUUID())
const rgba = (color: FigmaColor = {}, opacity = 1) => `rgba(${Math.round(clamp(finite(color.r)) * 255)}, ${Math.round(clamp(finite(color.g)) * 255)}, ${Math.round(clamp(finite(color.b)) * 255)}, ${clamp(finite(color.a, 1) * opacity)})`

export function decodePathBlob(bytes: Uint8Array): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), parts: string[] = []
  let offset = 0
  const commands = ['Z', 'M', 'L', 'Q', 'C'], sizes = [0, 2, 2, 4, 6]
  while (offset < bytes.length) {
    const code = bytes[offset++]
    if (code > 4 || offset + sizes[code] * 4 > bytes.length) throw new Error('Invalid Figma vector geometry.')
    const values: number[] = []
    for (let i = 0; i < sizes[code]; i++, offset += 4) {
      const value = view.getFloat32(offset, true)
      if (!Number.isFinite(value)) throw new Error('Invalid Figma vector coordinate.')
      values.push(Number(value.toFixed(4)))
    }
    parts.push(`${commands[code]} ${values.join(' ')}`.trim())
  }
  return parts.join(' ')
}

/** Both plugin/API JSON and native clipboard messages share this scene translation. */
export function importFigmaNodes(value: unknown): ImportedDocument {
  if (!value || typeof value !== 'object') throw new Error('Invalid Figma clipboard data.')
  const data = value as { nodes?: unknown; nodeChanges?: unknown; document?: unknown; blobs?: { bytes?: Uint8Array }[] }
  const input = Array.isArray(value) ? value : data.nodes ?? data.nodeChanges ?? (data.document ? [data.document] : null)
  if (!Array.isArray(input)) throw new Error('Figma clipboard has no editable nodes.')
  const records = new Map<string, { node: FigmaNode; parent: string | null; absolute: boolean }>()
  const flatten = (node: FigmaNode, parent: string | null, depth: number) => {
    if (!node || typeof node !== 'object' || typeof node.type !== 'string') throw new Error('Invalid Figma node.')
    if (depth > 40 || records.size >= 2000) throw new Error('Figma selection is too complex. Copy a smaller selection.')
    const id = nodeId(node), guid = node.parentIndex?.guid
    if (records.has(id)) throw new Error('Figma clipboard has duplicate node IDs.')
    records.set(id, { node, parent: parent ?? (guid ? `${guid.sessionID}:${guid.localID}` : null), absolute: !node.transform && !node.relativeTransform && node.x === undefined && !!node.absoluteBoundingBox })
    if (node.children && !Array.isArray(node.children)) throw new Error('Invalid Figma children.')
    for (const child of node.children ?? []) flatten(child, id, depth + 1)
  }
  for (const node of input) flatten(node as FigmaNode, null, 0)
  const store = new SceneStore(), visited = new Set<string>(), warnings = new Set<string>()
  const paintColor = (paints: FigmaPaint[] | undefined): string | null => {
    const paint = paints?.find(paint => paint.visible !== false)
    if (!paint) return null
    if (paint.type !== 'SOLID' && paint.type !== 'IMAGE') warnings.add('Gradient paints are simplified to solid colors.')
    return paint.color ? rgba(paint.color, clamp(finite(paint.opacity, 1))) : null
  }
  const add = (id: string, parentId: string | null, parentSource: FigmaNode | null, depth: number) => {
    if (visited.has(id) || depth > 40) throw new Error('Figma clipboard contains a hierarchy cycle.')
    visited.add(id)
    const record = records.get(id)!, n = record.node, type = n.type!
    let destination = parentId
    if (!['DOCUMENT', 'CANVAS', 'PAGE'].includes(type)) {
      const matrix = n.transform ?? (n.relativeTransform ? { m00: n.relativeTransform[0]?.[0], m01: n.relativeTransform[0]?.[1], m02: n.relativeTransform[0]?.[2], m10: n.relativeTransform[1]?.[0], m11: n.relativeTransform[1]?.[1], m12: n.relativeTransform[1]?.[2] } : null)
      const box = n.absoluteBoundingBox, width = clamp(finite(n.width ?? n.size?.x ?? box?.width, 120), 1, 16384), height = clamp(finite(n.height ?? n.size?.y ?? box?.height, 120), 1, 16384)
      const sx = matrix ? Math.hypot(finite(matrix.m00, 1), finite(matrix.m10)) : 1, sy = matrix ? Math.hypot(finite(matrix.m01), finite(matrix.m11, 1)) : 1
      const w = width * sx, h = height * sy, rotation = matrix ? Math.atan2(finite(matrix.m10), finite(matrix.m00, 1)) * 180 / Math.PI : finite(n.rotation)
      let x = finite(matrix?.m02 ?? n.x ?? box?.x), y = finite(matrix?.m12 ?? n.y ?? box?.y)
      if (record.absolute && parentSource?.absoluteBoundingBox) { x -= finite(parentSource.absoluteBoundingBox.x); y -= finite(parentSource.absoluteBoundingBox.y) }
      // Figma rotates around the top-left; the scene renderer rotates around center.
      const angle = rotation * Math.PI / 180
      x += Math.cos(angle) * w / 2 - Math.sin(angle) * h / 2 - w / 2
      y += Math.sin(angle) * w / 2 + Math.cos(angle) * h / 2 - h / 2
      const geometry: ElementGeometry = { x, y, width: Math.max(1, w), height: Math.max(1, h), rotation }
      const fills = n.fills ?? n.fillPaints, strokes = n.strokes ?? n.strokePaints, strokeColor = paintColor(strokes), shadow = n.effects?.find(effect => effect.type === 'DROP_SHADOW' && effect.visible !== false)
      const style: ElementStyle = { fill: paintColor(fills), stroke: strokeColor ? { color: strokeColor, width: Math.max(0, finite(n.strokeWeight, 1)), dash: n.dashPattern?.filter(v => Number.isFinite(v) && v >= 0) ?? [] } : null, opacity: clamp(finite(n.opacity, 1)), shadow: shadow ? { color: rgba(shadow.color), x: finite(shadow.offset?.x), y: finite(shadow.offset?.y), blur: Math.max(0, finite(shadow.radius)) } : null }
      const common = { ...geometry, name: n.name?.trim() || 'Figma layer', parentId, visible: n.visible !== false, locked: !!n.locked, style }
      const imagePaint = fills?.find(paint => paint.type === 'IMAGE' && paint.visible !== false)
      let image: string | null = null
      const blob = imagePaint?.image?.dataBlob === undefined ? null : data.blobs?.[imagePaint.image.dataBlob]?.bytes
      if (blob instanceof Uint8Array) {
        const mime = blob[0] === 137 && blob[1] === 80 ? 'png' : blob[0] === 255 && blob[1] === 216 ? 'jpeg' : null
        if (mime) {
          let binary = ''; for (const byte of blob) binary += String.fromCharCode(byte)
          image = `data:image/${mime};base64,${btoa(binary)}`
        }
      }
      if (!image && imagePaint?.imageRef && /^(?:https?:\/\/|data:image\/(?:png|jpeg|webp|gif);base64,)/i.test(imagePaint.imageRef)) image = imagePaint.imageRef
      if (imagePaint && !image) warnings.add('Some Figma images are unavailable. Use embedded image data or paste an SVG export with images.')
      if (type === 'TEXT') {
        const size = Math.max(1, finite(n.fontSize ?? n.style?.fontSize, 16)), align = n.textAlignHorizontal ?? n.style?.textAlignHorizontal
        const height = n.lineHeight?.value, units = n.lineHeight?.units
        const weight = n.style?.fontWeight ?? n.textData?.fontMetaData?.[0]?.fontWeight ?? (/bold/i.test(n.fontName?.style ?? '') ? 700 : /medium/i.test(n.fontName?.style ?? '') ? 500 : 400)
        destination = store.add('text', { ...common, text: n.characters ?? n.textData?.characters ?? '', fontSize: size, fontFamily: n.fontName?.family ?? n.style?.fontFamily ?? 'Inter, sans-serif', fontWeight: clamp(finite(weight, 400), 1, 1000), lineHeight: height ? Math.max(.1, units === 'PERCENT' ? height / 100 : height / size) : n.style?.lineHeightPx ? Math.max(.1, n.style.lineHeightPx / size) : 1.2, letterSpacing: finite(n.textTracking ?? n.style?.letterSpacing), textAlign: align === 'CENTER' ? 'center' : align === 'RIGHT' ? 'right' : 'left' }).id
      } else if (['FRAME', 'GROUP', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'SYMBOL'].includes(type) || n.children?.length) {
        destination = store.add('frame', { ...common, clipContent: type === 'GROUP' ? false : n.clipsContent ?? !n.frameMaskDisabled, cornerRadius: Math.max(0, finite(n.cornerRadius)) }).id
        if (image) store.add('image', { parentId: destination, name: 'Figma image fill', width: common.width, height: common.height, src: image, fit: 'cover', style: { fill: null } })
      } else if (image) destination = store.add('image', { ...common, src: image, alt: common.name, fit: imagePaint?.type === 'IMAGE' ? 'cover' : 'contain', cornerRadius: Math.max(0, finite(n.cornerRadius)) }).id
      else if (type === 'RECTANGLE' || type === 'ROUNDED_RECTANGLE') destination = store.add('rectangle', { ...common, cornerRadius: Math.max(0, finite(n.cornerRadius)) }).id
      else if (type === 'ELLIPSE') destination = store.add('ellipse', common).id
      else if (type === 'LINE') destination = store.add('path', { ...common, d: `M 0 0 L ${width} 0`, viewBox: [0, -1, width, 2], style: { ...style, fill: null, stroke: style.stroke ?? { color: '#080808', width: 1, dash: [] } } }).id
      else {
        const paths = n.fillGeometry?.map(path => path.path ?? (path.commandsBlob !== undefined && data.blobs?.[path.commandsBlob]?.bytes ? decodePathBlob(data.blobs[path.commandsBlob].bytes!) : '')).filter(Boolean)
        if (paths?.length) destination = store.add('path', { ...common, d: paths.join(' '), viewBox: [0, 0, width, height], fillRule: n.fillGeometry?.[0]?.windingRule === 'EVENODD' ? 'evenodd' : 'nonzero' }).id
        else { warnings.add(`Unsupported ${type.toLowerCase()} geometry was skipped. Copy as SVG to preserve it.`); destination = parentId }
      }
    }
    const children = [...records].filter(([, child]) => child.parent === id).sort((a, b) => (a[1].node.parentIndex?.position ?? '').localeCompare(b[1].node.parentIndex?.position ?? ''))
    const parentNode = destination ? store.getSnapshot().elements[destination] : null
    for (const [child] of children) add(child, parentNode?.type === 'frame' ? destination : parentId, n, depth + 1)
  }
  for (const [id, record] of records) if (!record.parent || !records.has(record.parent)) add(id, null, null, 0)
  if (visited.size !== records.size) throw new Error('Figma clipboard contains a hierarchy cycle.')
  if (!store.getSnapshot().rootIds.length) throw new Error('No supported Figma layers found. Use Copy as SVG for this selection.')
  return { ...store.toJSON(), warnings: [...warnings] }
}

export async function importFigmaClipboard(source: string): Promise<ImportedDocument> {
  if (new TextEncoder().encode(source).length > MAX_IMPORT_BYTES) throw new Error('Figma clipboard exceeds 16 MB.')
  const trimmed = source.trim()
  if (/^[[{]/.test(trimmed)) return importFigmaNodes(JSON.parse(trimmed))
  const parsed = new DOMParser().parseFromString(source, 'text/html')
  const buffer = parsed.querySelector('[data-buffer]')?.getAttribute('data-buffer') ?? source
  const payload = buffer.match(/<!--\(figma\)([\s\S]*?)\(\/figma\)-->/)?.[1] ?? buffer
  if (/^[[{]/.test(payload.trim())) return importFigmaNodes(JSON.parse(payload))
  let bytes: Uint8Array
  try { bytes = Uint8Array.from(atob(payload.replace(/\s/g, '')), character => character.charCodeAt(0)) } catch { throw new Error('Invalid Figma clipboard encoding. Copy your selection again.') }
  if (new TextDecoder().decode(bytes.subarray(0, 8)) !== 'fig-kiwi') {
    const text = new TextDecoder().decode(bytes)
    if (/^[[{]/.test(text.trim())) return importFigmaNodes(JSON.parse(text))
  }
  return importFigmaNodes(await decodeFigmaArchive(bytes))
}
