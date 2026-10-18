import { APP_PROJECT_LIMITS, validateAppProject, parseJsonStrict } from './manifest.ts'
import type { AppProject } from './types.ts'

export class AppAssetValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AppAssetValidationError'
  }
}

export type AppAssetType = 'image' | 'font'

export type ApprovedImageMimeType =
  | 'image/png'
  | 'image/jpeg'
  | 'image/webp'
  | 'image/gif'
  | 'image/svg+xml'

export type ApprovedFontMimeType =
  | 'font/woff'
  | 'font/woff2'
  | 'font/ttf'
  | 'font/otf'

export type ApprovedAssetMimeType = ApprovedImageMimeType | ApprovedFontMimeType

export const APP_ASSET_LIMITS = Object.freeze({
  MAX_ASSET_BYTES: 2 * 1024 * 1024, // 2 MiB per asset
  MAX_TOTAL_ASSETS_BYTES: 10 * 1024 * 1024, // 10 MiB total assets per project
  MAX_ASSETS_COUNT: APP_PROJECT_LIMITS.MAX_ASSET_IDS_COUNT, // 100 assets
  MAX_NAME_LENGTH: 128,
  MAX_ASSET_ID_LENGTH: 64,
})

export interface AppAsset {
  readonly id: string
  readonly appId: string
  readonly name: string
  readonly mimeType: ApprovedAssetMimeType
  readonly type: AppAssetType
  readonly byteSize: number
  readonly sha256: string
  readonly createdAt: string
  readonly metadata?: {
    readonly width?: number
    readonly height?: number
    readonly fontFamily?: string
  }
}

export interface AppAssetExportRecord {
  readonly id: string
  readonly name: string
  readonly mimeType: ApprovedAssetMimeType
  readonly type: AppAssetType
  readonly byteSize: number
  readonly sha256: string
  readonly dataBase64: string
  readonly createdAt: string
}

export interface AppProjectPackage {
  readonly format: 'paper-app-package'
  readonly version: 1
  readonly project: AppProject
  readonly assets: readonly AppAssetExportRecord[]
  readonly exportedAt: string
}

export function generateAssetId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const rand = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  return `ast_${rand}`
}

export function validateAssetId(id: unknown): string {
  if (typeof id !== 'string' || !id.trim()) {
    throw new AppAssetValidationError('Asset ID must be a non-empty string')
  }
  if (id.length > APP_ASSET_LIMITS.MAX_ASSET_ID_LENGTH) {
    throw new AppAssetValidationError(`Asset ID exceeds maximum length of ${APP_ASSET_LIMITS.MAX_ASSET_ID_LENGTH}`)
  }
  if (!/^ast_[a-zA-Z0-9_-]{8,56}$/.test(id)) {
    throw new AppAssetValidationError(`Invalid asset ID format: "${id}"`)
  }
  return id
}

// SVG is a deliberately static subset: no CSS, animation, foreign namespaces,
// processing instructions, entities or resource URLs beyond local fragments.
export function validateSvgContent(svgText: string): void {
  const text = svgText.replace(/<!--[\s\S]*?-->/g, '').trim()
    .replace(/^<\?xml\s+[^?]*\?>\s*/, '')
  const tags = new Set('svg g defs path rect circle ellipse line polyline polygon text tspan title desc linearGradient radialGradient stop clipPath mask pattern symbol use image'.toLowerCase().split(' '))
  if (!/^<svg(?:\s|\/?>)/.test(text) || /<\?|<!|[\\]/.test(text)) {
    throw new AppAssetValidationError('SVG must contain only static SVG content')
  }
  const stack: string[] = []
  let end = 0, roots = 0
  for (const match of text.matchAll(/<([^<>]*)>/g)) {
    if (text.slice(end, match.index).includes('<')) throw new AppAssetValidationError('Malformed SVG')
    end = match.index! + match[0].length
    const closing = match[1].startsWith('/')
    const selfClosing = match[1].endsWith('/')
    const inner = match[1].replace(/^\//, '').replace(/\/$/, '')
    const name = inner.match(/^[a-zA-Z]+/)?.[0] ?? ''
    if (!tags.has(name.toLowerCase())) throw new AppAssetValidationError('SVG contains forbidden active tag')
    if (closing) {
      if (inner !== name || stack.pop() !== name) throw new AppAssetValidationError('Malformed SVG closing tag')
      continue
    }
    if (!stack.length && (++roots > 1 || name !== 'svg')) throw new AppAssetValidationError('SVG requires one root')
    let attributes = inner.slice(name.length)
    while (attributes.trim()) {
      const attr = attributes.match(/^\s+([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*=\s*(["'])([^<>]*?)\2/)
      if (!attr) throw new AppAssetValidationError('Malformed SVG attribute')
      const key = attr[1].toLowerCase(), value = attr[3]
      if (/^on/.test(key) || key === 'style' || key === 'xml:base' ||
          (key.includes(':') && !['xmlns:xlink', 'xlink:href', 'xml:space'].includes(key)) ||
          /&/.test(value) || /(?:url\s*\(|javascript:|vbscript:|data:)/i.test(value) ||
          (['href', 'xlink:href', 'src'].includes(key) && !/^#[a-zA-Z0-9_.-]+$/.test(value)) ||
          (key === 'xmlns' && value !== 'http://www.w3.org/2000/svg') ||
          (key === 'xmlns:xlink' && value !== 'http://www.w3.org/1999/xlink')) {
        throw new AppAssetValidationError('SVG contains active content or external resource')
      }
      attributes = attributes.slice(attr[0].length)
    }
    if (!selfClosing) stack.push(name)
  }
  if (stack.length || roots !== 1 || text.slice(end).trim()) throw new AppAssetValidationError('Malformed SVG document')
}

export function sniffAssetMimeType(data: Uint8Array): { mimeType: ApprovedAssetMimeType; type: AppAssetType } {
  if (!data || data.length < 4) {
    throw new AppAssetValidationError('Asset data too small or empty')
  }

  const b0 = data[0]
  const b1 = data[1]
  const b2 = data[2]
  const b3 = data[3]

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    data.length >= 8 &&
    b0 === 0x89 && b1 === 0x50 && b2 === 0x4E && b3 === 0x47 &&
    data[4] === 0x0D && data[5] === 0x0A && data[6] === 0x1A && data[7] === 0x0A
  ) {
    return { mimeType: 'image/png', type: 'image' }
  }

  // JPEG: FF D8 FF
  if (b0 === 0xFF && b1 === 0xD8 && b2 === 0xFF) {
    return { mimeType: 'image/jpeg', type: 'image' }
  }

  // GIF: GIF87a or GIF89a
  if (
    data.length >= 6 &&
    b0 === 0x47 && b1 === 0x49 && b2 === 0x46 && b3 === 0x38 &&
    (data[4] === 0x37 || data[4] === 0x39) && data[5] === 0x61
  ) {
    return { mimeType: 'image/gif', type: 'image' }
  }

  // WEBP: RIFF ... WEBP
  if (
    data.length >= 12 &&
    b0 === 0x52 && b1 === 0x49 && b2 === 0x46 && b3 === 0x46 && // RIFF
    data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50 // WEBP
  ) {
    return { mimeType: 'image/webp', type: 'image' }
  }

  // WOFF: 'wOFF' (0x77, 0x4F, 0x46, 0x46)
  if (b0 === 0x77 && b1 === 0x4F && b2 === 0x46 && b3 === 0x46) {
    return { mimeType: 'font/woff', type: 'font' }
  }

  // WOFF2: 'wOF2' (0x77, 0x4F, 0x46, 0x32)
  if (b0 === 0x77 && b1 === 0x4F && b2 === 0x46 && b3 === 0x32) {
    return { mimeType: 'font/woff2', type: 'font' }
  }

  // TTF: 0x00 0x01 0x00 0x00 or 'true' (0x74 0x72 0x75 0x65)
  if (
    (b0 === 0x00 && b1 === 0x01 && b2 === 0x00 && b3 === 0x00) ||
    (b0 === 0x74 && b1 === 0x72 && b2 === 0x75 && b3 === 0x65)
  ) {
    return { mimeType: 'font/ttf', type: 'font' }
  }

  // OTF: 'OTTO' (0x4F 0x54 0x54 0x4F)
  if (b0 === 0x4F && b1 === 0x54 && b2 === 0x54 && b3 === 0x4F) {
    return { mimeType: 'font/otf', type: 'font' }
  }

  // SVG: Inspect text representation
  // Check for UTF-8 or BOM
  let start = 0
  if (b0 === 0xEF && b1 === 0xBB && b2 === 0xBF) {
    start = 3
  }
  try {
    const textSample = new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(start))
    const trimmed = textSample.trim()
    if (
      (trimmed.startsWith('<?xml') || trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<svg') || trimmed.startsWith('<!--')) &&
      /<\s*svg\b[^>]*>/i.test(trimmed) &&
      (trimmed.includes('</svg>') || /\/>\s*$/.test(trimmed))
    ) {
      validateSvgContent(trimmed)
      return { mimeType: 'image/svg+xml', type: 'image' }
    }
  } catch (error) {
    if (error instanceof AppAssetValidationError) throw error
  }

  throw new AppAssetValidationError('Unsupported asset format or content signature mismatch')
}

const EXTENSION_MAP: Record<ApprovedAssetMimeType, readonly string[]> = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/gif': ['.gif'],
  'image/webp': ['.webp'],
  'image/svg+xml': ['.svg'],
  'font/woff': ['.woff'],
  'font/woff2': ['.woff2'],
  'font/ttf': ['.ttf'],
  'font/otf': ['.otf'],
}

export function validateAssetName(rawName: unknown, sniffedMimeType: ApprovedAssetMimeType): string {
  if (typeof rawName !== 'string') {
    throw new AppAssetValidationError('Asset name must be a string')
  }
  const trimmed = rawName.trim()
  if (!trimmed) {
    throw new AppAssetValidationError('Asset name cannot be empty or whitespace')
  }
  if (rawName.length > APP_ASSET_LIMITS.MAX_NAME_LENGTH) {
    throw new AppAssetValidationError(
      `Asset name length (${rawName.length}) exceeds maximum limit of ${APP_ASSET_LIMITS.MAX_NAME_LENGTH} characters`
    )
  }
  if (rawName !== trimmed || /[\x00-\x1f\x7f%]/.test(rawName)) {
    throw new AppAssetValidationError('Asset name contains invalid whitespace, control or encoded character')
  }
  if (rawName.includes('/') || rawName.includes('\\')) {
    throw new AppAssetValidationError('Asset name cannot contain path separators or traversal')
  }
  if (rawName === '.' || rawName === '..' || rawName.includes('..')) {
    throw new AppAssetValidationError('Asset name contains invalid path traversal')
  }
  if (/^[a-zA-Z]:/.test(rawName)) {
    throw new AppAssetValidationError('Asset name contains invalid Windows drive prefix')
  }

  const lower = rawName.toLowerCase()
  const allowedExtensions = EXTENSION_MAP[sniffedMimeType] || []
  const hasValidExt = allowedExtensions.some(ext => lower.endsWith(ext))
  if (!hasValidExt) {
    throw new AppAssetValidationError(
      `Asset extension does not match sniffed format (${sniffedMimeType}). Expected one of: ${allowedExtensions.join(', ')}`
    )
  }

  return rawName
}

function validateContainer(bytes: Uint8Array, mime: ApprovedAssetMimeType): void {
  const invalid = () => { throw new AppAssetValidationError('Truncated or invalid image/font container') }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const dimensions = (width: number, height: number) => {
    if (!width || !height || width > 16384 || height > 16384 || width * height > 40_000_000) invalid()
  }
  if (mime === 'image/png') {
    if (bytes.length < 45 || view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452) invalid()
    dimensions(view.getUint32(16), view.getUint32(20))
    let offset = 8, imageData = false, ended = false
    while (offset + 12 <= bytes.length) {
      const length = view.getUint32(offset), kind = view.getUint32(offset + 4)
      if (offset + 12 + length > bytes.length) invalid()
      if (kind === 0x49444154) imageData = true
      offset += length + 12
      if (kind === 0x49454e44) { if (length || offset !== bytes.length) invalid(); ended = true; break }
    }
    if (!imageData || !ended) invalid()
  } else if (mime === 'image/jpeg') {
    if (bytes.length < 12 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) invalid()
    let offset = 2, foundDimensions = false
    while (offset + 4 < bytes.length) {
      if (bytes[offset++] !== 255) invalid()
      while (bytes[offset] === 255) offset++
      const marker = bytes[offset++]
      if (marker === 0xda || marker === 0xd9) break
      const length = view.getUint16(offset)
      if (length < 2 || offset + length > bytes.length) invalid()
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (length < 8) invalid()
        dimensions(view.getUint16(offset + 5), view.getUint16(offset + 3)); foundDimensions = true
      }
      offset += length
    }
    if (!foundDimensions) invalid()
  } else if (mime === 'image/gif') {
    if (bytes.length < 14 || bytes.at(-1) !== 0x3b) invalid()
    dimensions(view.getUint16(6, true), view.getUint16(8, true))
  } else if (mime === 'image/webp') {
    if (bytes.length < 20 || view.getUint32(4, true) !== bytes.length - 8 || !['VP8 ', 'VP8L', 'VP8X'].includes(String.fromCharCode(...bytes.subarray(12, 16)))) invalid()
    const kind = String.fromCharCode(...bytes.subarray(12, 16))
    const length = view.getUint32(16, true)
    if (length > bytes.length - 20) invalid()
    if (kind === 'VP8X') {
      if (length !== 10) invalid()
      const uint24 = (offset: number) => bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
      dimensions(uint24(24) + 1, uint24(27) + 1)
    } else if (kind === 'VP8L') {
      if (length < 5 || bytes[20] !== 0x2f) invalid()
      const packed = view.getUint32(21, true)
      if (packed >>> 29) invalid() // Only lossless version zero is defined.
      dimensions((packed & 0x3fff) + 1, ((packed >>> 14) & 0x3fff) + 1)
    } else {
      if (length < 10 || (bytes[20] & 1) || bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) invalid()
      dimensions(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff)
    }
  } else if (mime === 'font/woff' || mime === 'font/woff2') {
    const woff = mime === 'font/woff'
    if (bytes.length < (woff ? 44 : 48) || view.getUint32(8) !== bytes.length) invalid()
    const count = view.getUint16(12)
    if (!count || count > 256 || view.getUint32(16) > 8 * 1024 * 1024) invalid()
    if (woff) {
      if (44 + count * 20 > bytes.length) invalid()
      for (let i = 0; i < count; i++) {
        const start = 44 + i * 20, offset = view.getUint32(start + 4), length = view.getUint32(start + 8)
        if (offset < 44 + count * 20 || !length || offset + length > bytes.length || length > view.getUint32(start + 12)) invalid()
      }
    } else if (!view.getUint32(20) || view.getUint32(20) > bytes.length - 48) invalid()
  } else if (mime === 'font/ttf' || mime === 'font/otf') {
    if (bytes.length < 12) invalid()
    const count = view.getUint16(4)
    if (!count || count > 256 || 12 + count * 16 > bytes.length) invalid()
    for (let i = 0; i < count; i++) {
      const start = 12 + i * 16, offset = view.getUint32(start + 8), length = view.getUint32(start + 12)
      if (offset < 12 + count * 16 || offset + length > bytes.length) invalid()
    }
  }
}

export function validateAssetBuffer(buffer: Uint8Array, name: string): { mimeType: ApprovedAssetMimeType; type: AppAssetType } {
  if (!buffer || !(buffer instanceof Uint8Array)) {
    throw new AppAssetValidationError('Asset buffer must be a Uint8Array or Buffer')
  }
  if (buffer.length > APP_ASSET_LIMITS.MAX_ASSET_BYTES) {
    throw new AppAssetValidationError(
      `Asset file size (${buffer.length} bytes) exceeds maximum limit of ${APP_ASSET_LIMITS.MAX_ASSET_BYTES} bytes (2 MiB)`
    )
  }

  const { mimeType, type } = sniffAssetMimeType(buffer)
  validateAssetName(name, mimeType)
  validateContainer(buffer, mimeType)
  return { mimeType, type }
}

export function createAssetDataUri(content: Uint8Array, mimeType: ApprovedAssetMimeType): string {
  return `data:${mimeType};base64,${encodeAssetBase64(content)}`
}

export function encodeAssetBase64(content: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < content.length; i += 8192) binary += String.fromCharCode(...content.subarray(i, i + 8192))
  return btoa(binary)
}

export function decodeAssetBase64(value: unknown): Uint8Array {
  if (typeof value !== 'string' || !value.length || value.length > 4 * Math.ceil(APP_ASSET_LIMITS.MAX_ASSET_BYTES / 3)) {
    throw new AppAssetValidationError('Asset content is empty or exceeds the 2 MiB limit')
  }
  if (value.length % 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new AppAssetValidationError('Asset content must be canonical base64')
  }
  const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0))
  if (bytes.length > APP_ASSET_LIMITS.MAX_ASSET_BYTES || encodeAssetBase64(bytes) !== value) throw new AppAssetValidationError('Invalid asset content or size')
  return bytes
}

// Portable synchronous SHA-256 keeps package verification identical in browser and server.
export function assetSha256(bytes: Uint8Array): string {
  const k = new Uint32Array(64), h = new Uint32Array(8)
  let primeCount = 0
  for (let n = 2; primeCount < 64; n++) {
    let prime = true
    for (let d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break }
    if (!prime) continue
    if (primeCount < 8) h[primeCount] = Math.sqrt(n) * 2 ** 32
    k[primeCount++] = Math.cbrt(n) * 2 ** 32
  }
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64)
  padded.set(bytes); padded[bytes.length] = 128
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 4, bytes.length * 8)
  const w = new Uint32Array(64)
  const rotate = (x: number, n: number) => (x >>> n) | (x << (32 - n))
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 64; i++) {
      if (i < 16) w[i] = view.getUint32(offset + i * 4)
      else {
        const a = w[i - 15], b = w[i - 2]
        w[i] = w[i - 16] + (rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3)) + w[i - 7] + (rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10))
      }
    }
    let [a, b, c, d, e, f, g, j] = h
    for (let i = 0; i < 64; i++) {
      const t1 = (j + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + k[i] + w[i]) >>> 0
      const t2 = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0
      j = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0
    }
    ;[a, b, c, d, e, f, g, j].forEach((value, i) => { h[i] += value })
  }
  return Array.from(h, n => n.toString(16).padStart(8, '0')).join('')
}

function extractFontFamily(filename: string): string {
  // Strip extension
  const base = filename.replace(/\.(woff2?|ttf|otf)$/i, '')
  // Replace underscores and hyphens with spaces or clean name
  const name = base.split(/[-_]/)[0] || base
  return name.trim() || 'CustomFont'
}

export function createFontFacesCss(assets: readonly (AppAsset | AppAssetExportRecord)[]): string {
  const fontAssets = assets.filter(a => a.type === 'font')
  if (!fontAssets.length) return ''

  const rules: string[] = []
  for (const font of fontAssets) {
    const family = ((font as AppAsset).metadata?.fontFamily || extractFontFamily(font.name)).replace(/[^a-zA-Z0-9 ]/g, '') || 'CustomFont'
    const format =
      font.mimeType === 'font/woff2' ? 'woff2' :
      font.mimeType === 'font/woff' ? 'woff' :
      font.mimeType === 'font/ttf' ? 'truetype' :
      font.mimeType === 'font/otf' ? 'opentype' : 'woff2'

    const dataBase64 = (font as AppAssetExportRecord).dataBase64
    if (!dataBase64) continue

    rules.push(`@font-face {
  font-family: "${family}";
  src: url("data:${font.mimeType};base64,${dataBase64}") format("${format}");
  font-weight: normal;
  font-style: normal;
  font-display: swap;
}`)
  }

  return rules.join('\n\n')
}

export function exportAppPackage(project: AppProject, assets: readonly AppAssetExportRecord[]): AppProjectPackage {
  const validatedProject = validateAppProject(project)
  return {
    format: 'paper-app-package',
    version: 1,
    project: validatedProject,
    assets: validatePackageAssets(validatedProject, assets),
    exportedAt: new Date().toISOString(),
  }
}

export function serializeAppPackage(pkg: AppProjectPackage): string {
  if (!pkg || pkg.format !== 'paper-app-package' || pkg.version !== 1) {
    throw new AppAssetValidationError('Invalid app project package')
  }
  validateAppProject(pkg.project)
  if (!Array.isArray(pkg.assets)) {
    throw new AppAssetValidationError('Package assets must be an array')
  }
  validatePackageAssets(pkg.project, pkg.assets)
  return JSON.stringify(pkg, null, 2)
}

export function parseAppPackage(source: string): AppProjectPackage {
  if (typeof source !== 'string') {
    throw new AppAssetValidationError('Package source must be a string')
  }
  const raw = parseJsonStrict(source, MAX_PACKAGE_BYTES) as Record<string, unknown>
  if (!raw || typeof raw !== 'object' || raw.format !== 'paper-app-package' || raw.version !== 1) {
    throw new AppAssetValidationError('Invalid package format or version')
  }
  const project = validateAppProject(raw.project)
  if (!Array.isArray(raw.assets)) {
    throw new AppAssetValidationError('Package assets must be an array')
  }
  const assets: AppAssetExportRecord[] = []
  for (const item of raw.assets) {
    if (!item || typeof item !== 'object') throw new AppAssetValidationError('Invalid asset entry')
    const rec = item as Record<string, unknown>
    const id = validateAssetId(rec.id)
    const mimeType = rec.mimeType as ApprovedAssetMimeType
    const name = validateAssetName(rec.name, mimeType)
    const type = rec.type as AppAssetType
    if (type !== 'image' && type !== 'font') throw new AppAssetValidationError('Invalid asset type')
    const dataBase64 = String(rec.dataBase64 || '')
    const buf = decodeAssetBase64(dataBase64)
    const sniffed = validateAssetBuffer(buf, name)
    if (sniffed.mimeType !== mimeType || sniffed.type !== type || rec.byteSize !== buf.length || rec.sha256 !== assetSha256(buf)) {
      throw new AppAssetValidationError('Asset metadata or integrity mismatch')
    }
    assets.push({
      id,
      name,
      mimeType,
      type,
      byteSize: buf.length,
      sha256: String(rec.sha256 || ''),
      dataBase64,
      createdAt: String(rec.createdAt || new Date().toISOString()),
    })
  }

  return {
    format: 'paper-app-package',
    version: 1,
    project,
    assets: validatePackageAssets(project, assets),
    exportedAt: String(raw.exportedAt || new Date().toISOString()),
  }
}

const MAX_PACKAGE_BYTES = APP_PROJECT_LIMITS.MAX_MANIFEST_BYTES + 4 * Math.ceil(APP_ASSET_LIMITS.MAX_TOTAL_ASSETS_BYTES / 3) + 128 * 1024

function validatePackageAssets(project: AppProject, assets: readonly AppAssetExportRecord[]): AppAssetExportRecord[] {
  if (assets.length > APP_ASSET_LIMITS.MAX_ASSETS_COUNT || assets.length !== project.assetIds.length) throw new AppAssetValidationError('Package asset references must match')
  const ids = new Set<string>()
  let total = 0
  for (const asset of assets) {
    validateAssetId(asset.id)
    if (ids.has(asset.id) || !project.assetIds.includes(asset.id)) throw new AppAssetValidationError('Duplicate or unreferenced package asset')
    ids.add(asset.id)
    const bytes = decodeAssetBase64(asset.dataBase64)
    const sniffed = validateAssetBuffer(bytes, asset.name)
    if (sniffed.mimeType !== asset.mimeType || sniffed.type !== asset.type || bytes.length !== asset.byteSize || assetSha256(bytes) !== asset.sha256) throw new AppAssetValidationError('Asset metadata or integrity mismatch')
    total += bytes.length
    if (total > APP_ASSET_LIMITS.MAX_TOTAL_ASSETS_BYTES) throw new AppAssetValidationError('Project asset quota exceeded')
  }
  return [...assets]
}
