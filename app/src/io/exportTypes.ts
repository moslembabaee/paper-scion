import type { Bounds } from '../canvas/types.ts'
import type { SceneSnapshot } from '../scene/types.ts'
import { fileName } from './project.ts'
import { exportBounds, exportRoots } from './svg.ts'

export type AssetFormat = 'svg' | 'png' | 'webp' | 'pdf'
export type ExportScope = 'selection' | 'artboards' | 'layers' | 'canvas'
export type ExportScale = 1 | 2 | 3
export const SCALE_PRESETS: readonly ExportScale[] = [1, 2, 3]
export const ASSET_FORMATS: readonly AssetFormat[] = ['svg', 'png', 'webp', 'pdf']

export interface ExportTarget {
  readonly id: string
  readonly name: string
  readonly bounds: Bounds
  readonly scene: SceneSnapshot
  readonly scope: 'selection' | 'canvas'
}

/** Isolated snapshots never alter editor selection or history. */
export function exportTargets(state: SceneSnapshot, scope: ExportScope, name: string): ExportTarget[] {
  if (scope === 'canvas' || scope === 'selection') {
    const bounds = exportBounds(state, scope)
    return bounds ? [{ id: `paper:${scope}`, name: scope === 'selection' ? state.selection.length === 1 ? state.elements[state.selection[0]].name : `${name} selection` : name, bounds, scene: state, scope }] : []
  }
  const roots = scope === 'artboards'
    ? exportRoots(state, 'canvas').filter(id => state.elements[id].type === 'frame')
    : exportRoots(state, 'selection')
  return roots.flatMap(id => {
    const scene = { ...state, selection: [id] }
    const bounds = exportBounds(scene, 'selection')
    return bounds ? [{ id, name: state.elements[id].name, bounds, scene, scope: 'selection' as const }] : []
  })
}

/** Stable filenames, including duplicate names and case-insensitive filesystems. */
export function assetFileNames(targets: readonly ExportTarget[], scales: readonly ExportScale[], format: AssetFormat): string[] {
  const used = new Set<string>()
  return targets.flatMap(target => scales.map(scale => {
    const stem = fileName(target.name, '').slice(0, -1)
    let suffix = 1
    let result = `${stem}@${scale}x.${format}`
    while (used.has(result.toLowerCase())) result = `${stem}-${++suffix}@${scale}x.${format}`
    used.add(result.toLowerCase())
    return result
  }))
}
