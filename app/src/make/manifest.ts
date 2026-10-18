import type {
  AppAnnotation,
  AppProject,
  AppProjectInput,
  AppProjectLimits,
  AppPreviewConfig,
  AppPreviewStatus,
  AppReleaseMetadata,
  AppSceneReference,
  AppSourceFile,
} from './types.ts'

export const APP_PROJECT_LIMITS: AppProjectLimits = Object.freeze({
  MAX_FILE_BYTES: 512 * 1024, // 512 KB per file
  MAX_TOTAL_FILES_BYTES: 2 * 1024 * 1024, // 2 MB total source files
  MAX_FILES_COUNT: 100, // max 100 files
  MAX_ASSET_IDS_COUNT: 100, // max 100 assets
  MAX_NAME_LENGTH: 200, // max 200 chars for project name
  MAX_PATH_LENGTH: 256, // max 256 chars for path
  MAX_MANIFEST_BYTES: 4 * 1024 * 1024, // 4 MB raw JSON manifest limit
})

export class AppProjectValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AppProjectValidationError'
  }
}

export const DEFAULT_STARTER_APP = `import React from 'react'

export default function App() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#080808] text-[#edebe1]">
      <div className="p-8 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Paper App</h1>
        <p className="mt-2 text-sm text-[#888888]">Crafted with Paper Make</p>
      </div>
    </div>
  )
}
`

export function generateAppProjectId(): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14)
  return `app_${rand}`
}

// Validate descriptors before reading values so validation never executes accessors.
export function checkForbiddenKeys(value: unknown, seen = new WeakSet<object>(), depth = 0): void {
  if (!value || typeof value !== 'object') return
  if (depth > 16 || seen.has(value)) fail('Cyclic or excessively deep manifest object')
  seen.add(value)
  const proto = Object.getPrototypeOf(value)
  const array = Array.isArray(value)
  if (array ? proto !== Array.prototype : proto !== null && proto !== Object.prototype) {
    fail('Object has forbidden or polluted prototype')
  }
  const keys = Reflect.ownKeys(value)
  if (keys.length > 1024) fail('Object key count exceeds limit')
  if (array && (value.length > 1023 || keys.length !== value.length + 1)) fail('Array must be dense and bounded')
  for (const key of keys) {
    if (typeof key !== 'string') fail('Symbol keys are forbidden')
    if (array && key !== 'length' && !/^(0|[1-9][0-9]*)$/.test(key)) fail('Unknown array field')
    if (['__proto__', 'constructor', 'prototype'].includes(key)) fail(`Forbidden prototype key "${key}"`)
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!
    if (!('value' in descriptor) || (!descriptor.enumerable && !(Array.isArray(value) && key === 'length'))) {
      fail('Manifest requires enumerable data properties; accessors are forbidden')
    }
    checkForbiddenKeys(descriptor.value, seen, depth + 1)
  }
  seen.delete(value)
}

function fail(message: string): never { throw new AppProjectValidationError(message) }

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`)
  return value as Record<string, unknown>
}

function fields(value: Record<string, unknown>, allowed: readonly string[], required: readonly string[] = []): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`Unknown field "${key}"`)
  for (const key of required) if (!Object.hasOwn(value, key)) fail(`Missing required field "${key}"`)
}

function string(value: unknown, label: string, limit = 128, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value.trim())) fail(`${label} must be a non-empty string`)
  if (value.length > limit) fail(`${label} length exceeds limit of ${limit}`)
  return value
}

function optionalString(value: unknown, label: string, limit = 16384): string | undefined {
  return value === undefined ? undefined : string(value, label, limit, true)
}

function revision(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) fail(`${label} must be a positive safe integer`)
  return value
}

function timestamp(value: unknown, label: string): string {
  const text = string(value, label, 24)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(text) ||
      !Number.isFinite(Date.parse(text)) || new Date(text).toISOString() !== text) fail(`${label} must be a UTC ISO timestamp`)
  return text
}

function payloadLimit(text: string, maxBytes = APP_PROJECT_LIMITS.MAX_MANIFEST_BYTES): void {
  if (text.length > maxBytes || new TextEncoder().encode(text).length > maxBytes) {
    fail('Manifest payload size exceeds limit; must be smaller than or equal to MAX_MANIFEST_BYTES')
  }
}

export function normalizeAndValidatePath(rawPath: unknown): string {
  if (typeof rawPath !== 'string') {
    throw new AppProjectValidationError('File path must be a string')
  }
  const trimmed = rawPath.trim()
  if (!trimmed) {
    throw new AppProjectValidationError('File path cannot be empty or whitespace')
  }
  if (rawPath.length > APP_PROJECT_LIMITS.MAX_PATH_LENGTH) {
    throw new AppProjectValidationError(
      `File path length (${rawPath.length}) exceeds maximum limit of ${APP_PROJECT_LIMITS.MAX_PATH_LENGTH} characters`
    )
  }
  if (rawPath !== trimmed || /[\x00-\x1f\x7f%]/.test(rawPath)) fail('Invalid whitespace, control or encoded character in path')
  if (rawPath.includes('\\')) {
    throw new AppProjectValidationError('File path contains invalid backslash or path traversal')
  }
  if (rawPath.startsWith('/')) {
    throw new AppProjectValidationError('File path cannot be absolute')
  }
  if (/^[a-zA-Z]:/.test(rawPath)) {
    throw new AppProjectValidationError('File path contains invalid Windows drive prefix')
  }
  if (rawPath.includes('//')) {
    throw new AppProjectValidationError('File path contains invalid consecutive slashes')
  }
  if (rawPath === '.' || rawPath === '..') {
    throw new AppProjectValidationError('Invalid path traversal')
  }

  let cleaned = rawPath
  if (cleaned.startsWith('./')) {
    cleaned = cleaned.slice(2)
  }
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    throw new AppProjectValidationError('Invalid path traversal')
  }

  const segments = cleaned.split('/')
  for (const seg of segments) {
    if (seg !== seg.trim() || seg.endsWith('.') || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(seg)) fail('Invalid or reserved path segment')
    if (!seg || seg === '.' || seg === '..') {
      throw new AppProjectValidationError('Invalid path traversal or empty directory segment')
    }
    if (seg === '__proto__' || seg === 'constructor' || seg === 'prototype') {
      throw new AppProjectValidationError(`Forbidden prototype key in path: "${seg}"`)
    }
    if (/[<>:"|?*]/.test(seg)) {
      throw new AppProjectValidationError(`Invalid character in path segment: "${seg}"`)
    }
  }

  return cleaned
}

export function parseJsonStrict(text: string, maxBytes = APP_PROJECT_LIMITS.MAX_MANIFEST_BYTES): unknown {
  payloadLimit(text, maxBytes)
  let depth = 0
  let i = 0
  const len = text.length

  function skipWhitespace(): void {
    while (i < len) {
      const ch = text.charCodeAt(i)
      if (ch === 32 || ch === 9 || ch === 10 || ch === 13) {
        i++
      } else {
        break
      }
    }
  }

  function parseValue(): unknown {
    skipWhitespace()
    if (i >= len) throw new AppProjectValidationError('Unexpected end of JSON input')
    const ch = text[i]
    if (ch === '{' || ch === '[') {
      if (++depth > 16) fail('JSON nesting depth exceeds limit')
      const result = ch === '{' ? parseObject() : parseArray()
      depth--
      return result
    }
    if (ch === '"') return parseString()
    if (ch === 't' && text.startsWith('true', i)) {
      i += 4
      return true
    }
    if (ch === 'f' && text.startsWith('false', i)) {
      i += 5
      return false
    }
    if (ch === 'n' && text.startsWith('null', i)) {
      i += 4
      return null
    }
    if (ch === '-' || (ch >= '0' && ch <= '9')) return parseNumber()
    throw new AppProjectValidationError(`Unexpected character '${ch}' at position ${i} in JSON`)
  }

  function parseString(): string {
    if (text[i] !== '"') throw new AppProjectValidationError(`Expected '"' at position ${i}`)
    i++
    let result = ''
    let start = i
    while (i < len) {
      const ch = text[i]
      if (ch === '"') {
        result += text.slice(start, i)
        i++
        return result
      }
      if (ch === '\\') {
        result += text.slice(start, i)
        i++
        if (i >= len) throw new AppProjectValidationError('Unterminated string escape in JSON')
        const esc = text[i]
        i++
        if (esc === '"') result += '"'
        else if (esc === '\\') result += '\\'
        else if (esc === '/') result += '/'
        else if (esc === 'b') result += '\b'
        else if (esc === 'f') result += '\f'
        else if (esc === 'n') result += '\n'
        else if (esc === 'r') result += '\r'
        else if (esc === 't') result += '\t'
        else if (esc === 'u') {
          if (i + 4 > len) throw new AppProjectValidationError('Invalid Unicode escape in JSON')
          const hex = text.slice(i, i + 4)
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
            throw new AppProjectValidationError(`Invalid Unicode escape '\\u${hex}' in JSON`)
          }
          result += String.fromCharCode(parseInt(hex, 16))
          i += 4
        } else {
          throw new AppProjectValidationError(`Invalid escape sequence '\\${esc}' in JSON`)
        }
        start = i
      } else if (text.charCodeAt(i) < 32) {
        throw new AppProjectValidationError(`Unescaped control character in JSON string at position ${i}`)
      } else {
        i++
      }
    }
    throw new AppProjectValidationError('Unterminated string in JSON')
  }

  function parseNumber(): number {
    const start = i
    if (text[i] === '-') i++
    if (i >= len) throw new AppProjectValidationError('Invalid number in JSON')
    if (text[i] === '0') {
      i++
    } else if (text[i] >= '1' && text[i] <= '9') {
      while (i < len && text[i] >= '0' && text[i] <= '9') i++
    } else {
      throw new AppProjectValidationError(`Invalid number in JSON at position ${start}`)
    }
    if (i < len && text[i] === '.') {
      i++
      if (i >= len || text[i] < '0' || text[i] > '9') {
        throw new AppProjectValidationError(`Invalid fractional number in JSON at position ${start}`)
      }
      while (i < len && text[i] >= '0' && text[i] <= '9') i++
    }
    if (i < len && (text[i] === 'e' || text[i] === 'E')) {
      i++
      if (i < len && (text[i] === '+' || text[i] === '-')) i++
      if (i >= len || text[i] < '0' || text[i] > '9') {
        throw new AppProjectValidationError(`Invalid exponent in JSON at position ${start}`)
      }
      while (i < len && text[i] >= '0' && text[i] <= '9') i++
    }
    const numStr = text.slice(start, i)
    const num = Number(numStr)
    if (!Number.isFinite(num)) throw new AppProjectValidationError(`Invalid number value '${numStr}' in JSON`)
    return num
  }

  function parseArray(): unknown[] {
    i++ // skip '['
    skipWhitespace()
    const arr: unknown[] = []
    if (i < len && text[i] === ']') {
      i++
      return arr
    }
    while (i < len) {
      arr.push(parseValue())
      skipWhitespace()
      if (i >= len) throw new AppProjectValidationError('Unterminated array in JSON')
      if (text[i] === ']') {
        i++
        return arr
      }
      if (text[i] === ',') {
        i++
      } else {
        throw new AppProjectValidationError(`Expected ',' or ']' in JSON array at position ${i}`)
      }
    }
    throw new AppProjectValidationError('Unterminated array in JSON')
  }

  function parseObject(): Record<string, unknown> {
    i++ // skip '{'
    skipWhitespace()
    const obj: Record<string, unknown> = {}
    const seen = new Set<string>()
    if (i < len && text[i] === '}') {
      i++
      return obj
    }
    while (i < len) {
      skipWhitespace()
      if (i >= len || text[i] !== '"') {
        throw new AppProjectValidationError(`Expected string key in JSON object at position ${i}`)
      }
      const key = parseString()
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        throw new AppProjectValidationError(`Forbidden prototype key "${key}" detected in JSON payload`)
      }
      if (seen.has(key)) {
        throw new AppProjectValidationError(`Duplicate key "${key}" detected in JSON payload`)
      }
      seen.add(key)
      skipWhitespace()
      if (i >= len || text[i] !== ':') {
        throw new AppProjectValidationError(`Expected ':' after key "${key}" in JSON object at position ${i}`)
      }
      i++ // skip ':'
      obj[key] = parseValue()
      skipWhitespace()
      if (i >= len) throw new AppProjectValidationError('Unterminated object in JSON')
      if (text[i] === '}') {
        i++
        return obj
      }
      if (text[i] === ',') {
        i++
      } else {
        throw new AppProjectValidationError(`Expected ',' or '}' in JSON object at position ${i}`)
      }
    }
    throw new AppProjectValidationError('Unterminated object in JSON')
  }

  skipWhitespace()
  const result = parseValue()
  skipWhitespace()
  if (i < len) {
    throw new AppProjectValidationError(`Unexpected trailing characters after JSON at position ${i}`)
  }
  return result
}

const PROJECT_FIELDS = ['format', 'version', 'id', 'name', 'description', 'revision', 'sceneReference', 'files', 'assetIds', 'release', 'preview', 'annotations', 'createdAt', 'updatedAt'] as const
const INPUT_FIELDS = PROJECT_FIELDS.filter(key => key !== 'format' && key !== 'version')
const SCENE_FIELDS = ['projectId', 'sceneId', 'revision', 'frameId', 'snapshotAt']
const RELEASE_FIELDS = ['status', 'channel', 'notes', 'publishedAt', 'url']
const PREVIEW_FIELDS = ['status', 'entryPoint', 'error']

export function validateAppProject(data: unknown): AppProject {
  checkForbiddenKeys(data)
  const raw = record(data, 'AppProject')
  if (raw.format !== 'paper-app') fail("Unsupported format: not a paper app")
  if (raw.version !== 1) fail('Unsupported app project version')
  fields(raw, PROJECT_FIELDS, PROJECT_FIELDS.filter(key => key !== 'description' && key !== 'annotations'))
  const id = string(raw.id, 'Project ID')
  const name = string(raw.name, 'Project name', APP_PROJECT_LIMITS.MAX_NAME_LENGTH).trim()
  const description = optionalString(raw.description, 'Project description')
  const projectRevision = revision(raw.revision, 'Project revision')
  const createdAt = timestamp(raw.createdAt, 'createdAt')
  const updatedAt = timestamp(raw.updatedAt, 'updatedAt')

  let sceneReference: AppSceneReference | null = null
  if (raw.sceneReference !== null) {
    const sr = record(raw.sceneReference, 'sceneReference')
    fields(sr, SCENE_FIELDS)
    sceneReference = {
      ...(sr.projectId !== undefined ? { projectId: string(sr.projectId, 'sceneReference.projectId') } : {}),
      ...(sr.sceneId !== undefined ? { sceneId: string(sr.sceneId, 'sceneReference.sceneId') } : {}),
      ...(sr.frameId !== undefined ? { frameId: string(sr.frameId, 'sceneReference.frameId') } : {}),
      ...(sr.revision !== undefined ? { revision: typeof sr.revision === 'string' ? string(sr.revision, 'sceneReference.revision') : revision(sr.revision, 'sceneReference.revision') } : {}),
      ...(sr.snapshotAt !== undefined ? { snapshotAt: timestamp(sr.snapshotAt, 'sceneReference.snapshotAt') } : {}),
    }
  }

  const fileEntries = Object.entries(record(raw.files, 'files'))
  if (fileEntries.length > APP_PROJECT_LIMITS.MAX_FILES_COUNT) fail('Too many files: file count exceeds limit')
  const files: Record<string, AppSourceFile> = {}
  let totalBytes = 0
  for (const [key, value] of fileEntries) {
    const path = normalizeAndValidatePath(key)
    const file = record(value, `File ${key}`)
    fields(file, ['path', 'content'], ['path', 'content'])
    if (path !== normalizeAndValidatePath(file.path)) fail('File key does not match file path')
    if (Object.hasOwn(files, path)) fail(`Duplicate file path "${path}"`)
    if (typeof file.content !== 'string') fail('File content must be a string')
    if (file.content.length > APP_PROJECT_LIMITS.MAX_FILE_BYTES) fail('File size exceeds limit')
    const bytes = new TextEncoder().encode(file.content).length
    if (bytes > APP_PROJECT_LIMITS.MAX_FILE_BYTES) fail('File size exceeds limit')
    totalBytes += bytes
    if (totalBytes > APP_PROJECT_LIMITS.MAX_TOTAL_FILES_BYTES) fail('Total files size exceeds limit')
    files[path] = { path, content: file.content }
  }

  if (!Array.isArray(raw.assetIds)) fail('assetIds must be an array')
  if (raw.assetIds.length > APP_PROJECT_LIMITS.MAX_ASSET_IDS_COUNT) fail('Too many assets: asset count exceeds limit')
  const assetIds = Array.from(raw.assetIds, value => string(value, 'Asset ID'))
  if (new Set(assetIds).size !== assetIds.length) fail('Duplicate asset IDs')

  const rel = record(raw.release, 'release')
  fields(rel, RELEASE_FIELDS, ['status'])
  if (!(['draft', 'published', 'archived'] as unknown[]).includes(rel.status)) fail('Invalid release status')
  for (const key of ['channel', 'notes', 'url']) optionalString(rel[key], `release.${key}`, key === 'notes' ? 16384 : 2048)
  if (rel.publishedAt !== undefined) timestamp(rel.publishedAt, 'release.publishedAt')
  if (rel.url !== undefined) {
    let url: URL
    try { url = new URL(rel.url as string) } catch { fail('Invalid release URL') }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) fail('Invalid release URL protocol or credentials')
  }
  const release: AppReleaseMetadata = {
    status: rel.status as AppReleaseMetadata['status'],
    ...(rel.channel !== undefined ? { channel: rel.channel as string } : {}),
    ...(rel.notes !== undefined ? { notes: rel.notes as string } : {}),
    ...(rel.publishedAt !== undefined ? { publishedAt: rel.publishedAt as string } : {}),
    ...(rel.url !== undefined ? { url: rel.url as string } : {}),
  }

  const prv = record(raw.preview, 'preview')
  fields(prv, PREVIEW_FIELDS, ['status', 'entryPoint'])
  if (!(['idle', 'building', 'ready', 'error'] as unknown[]).includes(prv.status)) fail('Invalid preview status')
  const entryPoint = normalizeAndValidatePath(prv.entryPoint)
  const error = optionalString(prv.error, 'preview.error')
  const preview: AppPreviewConfig = { status: prv.status as AppPreviewStatus, entryPoint, ...(error !== undefined ? { error } : {}) }

  let annotations: AppAnnotation[] | undefined = undefined
  if (raw.annotations !== undefined) {
    if (!Array.isArray(raw.annotations)) fail('annotations must be an array')
    if (raw.annotations.length > 200) fail('annotations count exceeds limit of 200')
    const annotationIds = new Set<string>()
    annotations = raw.annotations.map((item, idx) => {
      const ann = record(item, `annotation[${idx}]`)
      fields(ann, ['id', 'elementId', 'tagName', 'text', 'selector', 'layerId', 'previewText', 'createdAt', 'updatedAt'], ['id', 'elementId', 'tagName', 'text', 'createdAt'])
      const annotationId = string(ann.id, `annotation[${idx}].id`, 64)
      if (annotationIds.has(annotationId)) fail('Duplicate annotation ID')
      annotationIds.add(annotationId)
      if (typeof ann.elementId !== 'string' || !/^[a-zA-Z0-9_~.:-]+$/.test(ann.elementId) ||
        typeof ann.tagName !== 'string' || !/^[a-zA-Z0-9-]+$/.test(ann.tagName)) fail('Invalid annotation target')
      if (ann.selector !== undefined && (typeof ann.selector !== 'string' || /[<]/.test(ann.selector))) fail('Invalid annotation selector')
      if (ann.previewText !== undefined && (typeof ann.previewText !== 'string' || /[<>]/.test(ann.previewText))) fail('Invalid annotation preview text')
      if (ann.layerId !== undefined && (typeof ann.layerId !== 'string' || !/^[a-zA-Z0-9_~.:-]+$/.test(ann.layerId))) fail('Invalid annotation layer ID')
      return {
        id: annotationId,
        elementId: string(ann.elementId, `annotation[${idx}].elementId`, 128),
        tagName: string(ann.tagName, `annotation[${idx}].tagName`, 32),
        text: string(ann.text, `annotation[${idx}].text`, 2048),
        ...(ann.selector !== undefined ? { selector: string(ann.selector, `annotation[${idx}].selector`, 256) } : {}),
        ...(ann.layerId !== undefined ? { layerId: string(ann.layerId, `annotation[${idx}].layerId`, 64) } : {}),
        ...(ann.previewText !== undefined ? { previewText: string(ann.previewText, `annotation[${idx}].previewText`, 128, true) } : {}),
        createdAt: timestamp(ann.createdAt, `annotation[${idx}].createdAt`),
        ...(ann.updatedAt !== undefined ? { updatedAt: timestamp(ann.updatedAt, `annotation[${idx}].updatedAt`) } : {}),
      }
    })
  }

  const result: AppProject = {
    format: 'paper-app', version: 1, id, name, ...(description !== undefined ? { description } : {}),
    revision: projectRevision, sceneReference, files, assetIds, release, preview,
    ...(annotations !== undefined ? { annotations } : {}),
    createdAt, updatedAt,
  }
  // Include JSON escaping and formatting overhead, so every valid project can round-trip.
  payloadLimit(JSON.stringify(result, null, 2))
  return result
}

// Only factories/migrations supply defaults. The persisted v1 schema is always complete.
export function createAppProject(input: AppProjectInput = {}): AppProject {
  checkForbiddenKeys(input)
  const raw = record(input, 'AppProject input')
  fields(raw, INPUT_FIELDS)
  const now = new Date().toISOString()
  const files: Record<string, AppSourceFile> = {}
  const inputFiles = raw.files === undefined ? { 'src/App.tsx': DEFAULT_STARTER_APP } : raw.files
  const entries = Array.isArray(inputFiles)
    ? inputFiles.map(value => { const file = record(value, 'File'); return [file.path, file] as const })
    : Object.entries(record(inputFiles, 'files'))
  if (entries.length > APP_PROJECT_LIMITS.MAX_FILES_COUNT) fail('Too many files: file count exceeds limit')
  for (const [key, value] of entries) {
    const path = normalizeAndValidatePath(key)
    if (Object.hasOwn(files, path)) fail(`Duplicate file path "${path}"`)
    if (typeof value === 'string') files[path] = { path, content: value }
    else {
      const file = record(value, 'File')
      fields(file, ['path', 'content'], ['path', 'content'])
      if (normalizeAndValidatePath(file.path) !== path) fail('File key does not match file path')
      if (typeof file.content !== 'string') fail('File content must be a string')
      files[path] = { path, content: file.content }
    }
  }
  const release = raw.release === undefined ? {} : record(raw.release, 'release')
  const preview = raw.preview === undefined ? {} : record(raw.preview, 'preview')
  return validateAppProject({
    ...raw,
    format: 'paper-app', version: 1,
    id: raw.id === undefined ? generateAppProjectId() : raw.id,
    name: raw.name === undefined ? 'Untitled App' : raw.name,
    revision: raw.revision === undefined ? 1 : raw.revision,
    sceneReference: raw.sceneReference === undefined ? null : raw.sceneReference,
    files,
    assetIds: raw.assetIds === undefined ? [] : raw.assetIds,
    release: { status: 'draft', ...release },
    preview: { status: 'idle', entryPoint: 'src/App.tsx', ...preview },
    ...(raw.annotations !== undefined ? { annotations: raw.annotations } : {}),
    createdAt: raw.createdAt === undefined ? now : raw.createdAt,
    updatedAt: raw.updatedAt === undefined ? now : raw.updatedAt,
  })
}

export function parseAppProject(source: string): AppProject {
  if (typeof source !== 'string') fail('Manifest source must be a string')
  return validateAppProject(parseJsonStrict(source))
}

export function serializeAppProject(project: AppProject): string {
  return JSON.stringify(validateAppProject(project), null, 2)
}

function normalizeLegacyFilePath(rawPath: unknown): string {
  const path = normalizeAndValidatePath(rawPath)
  const rootFiles = ['package.json', 'tsconfig.json', 'README.md', 'index.html']
  return !path.includes('/') && !rootFiles.includes(path) ? `src/${path}` : path
}

/** v0/unversioned app drafts used string maps or file arrays and flat scene IDs. */
export function migrateAppProject(legacyData: unknown): AppProject {
  checkForbiddenKeys(legacyData)
  const raw = record(legacyData, 'Invalid legacy project')
  if (raw.format === 'paper-app' && raw.version === 1) return validateAppProject(raw)
  if ((raw.format !== undefined && raw.format !== 'paper-app') || (raw.version !== undefined && raw.version !== 0)) {
    fail('Unsupported legacy app format or version')
  }
  fields(raw, [...PROJECT_FIELDS, 'sceneId', 'projectId', 'frameId', 'sceneRevision'])
  const { format: _format, version: _version, sceneId, projectId, frameId, sceneRevision, ...input } = raw
  const files: Record<string, AppSourceFile> = {}
  if (raw.files !== undefined) {
    const entries = Array.isArray(raw.files)
      ? raw.files.map(value => { const file = record(value, 'Legacy file'); return [file.path, file] as const })
      : Object.entries(record(raw.files, 'Legacy files'))
    if (entries.length > APP_PROJECT_LIMITS.MAX_FILES_COUNT) fail('Too many files: file count exceeds limit')
    for (const [key, value] of entries) {
      const path = normalizeLegacyFilePath(key)
      if (Object.hasOwn(files, path)) fail(`Duplicate file path in migration: "${path}"`)
      if (typeof value === 'string') files[path] = { path, content: value }
      else {
        const file = record(value, 'Legacy file')
        fields(file, ['path', 'content'], ['path', 'content'])
        if (normalizeLegacyFilePath(file.path) !== path) fail('Legacy file key does not match path')
        if (typeof file.content !== 'string') fail('Legacy file content must be a string')
        files[path] = { path, content: file.content }
      }
    }
    input.files = files
  }
  const flatScene = [sceneId, projectId, frameId, sceneRevision].some(value => value !== undefined)
  if (flatScene) {
    if (raw.sceneReference !== undefined) fail('Ambiguous legacy scene reference')
    input.sceneReference = {
      ...(projectId !== undefined ? { projectId } : {}), ...(sceneId !== undefined ? { sceneId } : {}),
      ...(frameId !== undefined ? { frameId } : {}), ...(sceneRevision !== undefined ? { revision: sceneRevision } : {}),
    }
  }
  if (raw.preview !== undefined) {
    const preview = record(raw.preview, 'Legacy preview')
    input.preview = { ...preview, ...(preview.entryPoint !== undefined ? { entryPoint: normalizeLegacyFilePath(preview.entryPoint) } : {}) }
  }
  return createAppProject(input as AppProjectInput)
}
