import { SceneStore } from '../scene/store.ts'
import type { SceneDocument } from '../scene/types.ts'
import type { Camera } from '../canvas/types.ts'

export const PROJECT_STORAGE_KEY = 'paper.project.v1'
export const MAX_IMPORT_BYTES = 16 * 1024 * 1024

export interface PaperProject {
  readonly format: 'paper'
  readonly version: 1
  readonly name: string
  readonly scene: SceneDocument
  readonly viewport: Camera
  readonly grid: boolean
}

export function createProject(store: SceneStore, name: string, viewport: Camera, grid: boolean): PaperProject {
  return { format: 'paper', version: 1, name: name.trim() || 'Untitled', scene: store.toJSON(), viewport: { ...viewport }, grid }
}

export function serializeProject(project: PaperProject): string {
  return JSON.stringify(project, null, 2)
}

/** Validate in a separate store, so a failed file never replaces the open document. */
export function parseProject(source: string): PaperProject {
  if (new TextEncoder().encode(source).length > MAX_IMPORT_BYTES) throw new Error('Project files must be smaller than 16 MB.')
  let value: unknown
  try { value = JSON.parse(source) } catch { throw new Error('This file is not valid JSON.') }
  if (!value || typeof value !== 'object') throw new Error('This is not a Paper project.')
  const record = value as Record<string, unknown>
  const legacy = !Object.hasOwn(record, 'format') && Object.hasOwn(record, 'elements')
  if (!legacy && (record.format !== 'paper' || record.version !== 1)) throw new Error('Unsupported Paper project version.')
  const name = legacy ? 'Untitled' : record.name
  const viewport = legacy ? { x: 0, y: 0, zoom: 1 } : record.viewport as Camera | undefined
  if (typeof name !== 'string' || !name.trim() || name.length > 200 || !viewport || ![viewport.x, viewport.y, viewport.zoom].every(Number.isFinite) || viewport.zoom < .1 || viewport.zoom > 32 || (!legacy && typeof record.grid !== 'boolean')) throw new Error('Invalid project settings.')
  const store = new SceneStore()
  try { store.load((legacy ? record : record.scene) as SceneDocument) } catch { throw new Error('The project contains an invalid scene or layer hierarchy.') }
  return createProject(store, name, viewport, legacy ? true : record.grid as boolean)
}

export function fileName(name: string, extension: string): string {
  const safe = [...name].map(char => char.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(char) ? '-' : char).join('')
  return `${safe.trim().slice(0, 120) || 'Untitled'}.${extension}`
}

export function downloadFile(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  // Browsers may consume downloads asynchronously.
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
