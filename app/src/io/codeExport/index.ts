import type { SceneSnapshot, SceneElement } from '../../scene/types'
import { getWorldBounds } from '../../scene/geometry'
import { unionBounds } from '../../canvas/math'
import type { Bounds } from '../../canvas/types'
import type {
  CodeExportFormat,
  CodeExportTarget,
  GeneratedCodeBundle,
  ReactExportOptions,
  SvgExportOptions,
  GlslExportOptions,
} from './types'
import { generateReactExport } from './reactGenerator'
import { generateSvgExport } from './svgGenerator'
import { generateGlslPackage } from './glslGenerator'

export * from './types'
export * from './reactGenerator'
export * from './svgGenerator'
export * from './glslGenerator'

/**
 * Discovers and inspects all viable export targets in the current canvas snapshot:
 * - Current Selection (single node or combined multiple nodes)
 * - Artboards (top-level frames)
 * - Attached Shader Surfaces (nodes with active shader paints)
 * - Canvas Background Shader
 * - Entire Canvas
 */
export function resolveExportTargets(state: SceneSnapshot): CodeExportTarget[] {
  const targets: CodeExportTarget[] = []

  // 1. Current selection
  if (state.selection.length > 0) {
    const selectedNodes = state.selection
      .map(id => state.elements[id])
      .filter((n): n is SceneElement => Boolean(n && n.visible))

    if (selectedNodes.length === 1) {
      const node = selectedNodes[0]
      const bounds = getWorldBounds(state, node.id)
      const childCount = node.type === 'frame' ? node.children.length : 0
      targets.push({
        id: `selection-${node.id}`,
        name: node.name || 'Selected Layer',
        type: 'element',
        elementId: node.id,
        node,
        nodes: [node],
        shader: node.style.shader ?? undefined,
        bounds,
        childCount,
        hasShader: Boolean(node.style.shader),
        hasAnimation: node.type === 'text' && Boolean(node.kinetic?.enabled),
      })
    } else if (selectedNodes.length > 1) {
      const boundsList = selectedNodes.map(n => getWorldBounds(state, n.id))
      const combinedBounds = unionBounds(boundsList) ?? { x: 0, y: 0, width: 800, height: 600 }
      targets.push({
        id: 'selection-combined',
        name: `${selectedNodes.length} Selected Layers`,
        type: 'selection',
        nodes: selectedNodes,
        bounds: combinedBounds,
        childCount: selectedNodes.length,
        hasShader: selectedNodes.some(n => Boolean(n.style.shader)),
        hasAnimation: selectedNodes.some(n => n.type === 'text' && Boolean(n.kinetic?.enabled)),
      })
    }
  }

  // 2. Artboards (Top-level frames)
  for (const rootId of state.rootIds) {
    const node = state.elements[rootId]
    if (node && node.visible && node.type === 'frame') {
      // Don't duplicate if already added as single selection
      if (targets.some(t => t.elementId === node.id)) continue
      const bounds = getWorldBounds(state, node.id)
      targets.push({
        id: `artboard-${node.id}`,
        name: node.name || 'Artboard',
        type: 'artboard',
        elementId: node.id,
        node,
        nodes: [node],
        shader: node.style.shader ?? undefined,
        bounds,
        childCount: node.children.length,
        hasShader: Boolean(node.style.shader),
      })
    }
  }

  // 3. Shader Surfaces (any visible layer with a shader attached)
  for (const node of Object.values(state.elements)) {
    if (node && node.visible && node.style.shader) {
      if (targets.some(t => t.shader === node.style.shader)) continue
      targets.push({
        id: `shader-${node.id}`,
        name: `${node.name} (${node.style.shader.kind})`,
        type: 'shader-surface',
        elementId: node.id,
        node,
        shader: node.style.shader,
        bounds: getWorldBounds(state, node.id),
        hasShader: true,
      })
    }
  }

  // 4. Background Shader
  if (state.backgroundShader) {
    targets.push({
      id: 'shader-background',
      name: `Canvas Background (${state.backgroundShader.kind})`,
      type: 'background-shader',
      shader: state.backgroundShader,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      hasShader: true,
    })
  }

  // 5. Whole Canvas
  const allRoots = state.rootIds
    .map(id => state.elements[id])
    .filter((n): n is SceneElement => Boolean(n && n.visible))
  const allBounds = allRoots.map(n => getWorldBounds(state, n.id))
  const canvasBounds: Bounds = (allBounds.length > 0 ? unionBounds(allBounds) : null) ?? {
    x: 0,
    y: 0,
    width: 1200,
    height: 800,
  }

  targets.push({
    id: 'target-canvas',
    name: 'Whole Canvas',
    type: 'canvas',
    nodes: allRoots,
    bounds: canvasBounds,
    childCount: allRoots.length,
    hasShader: Boolean(state.backgroundShader) || allRoots.some(n => Boolean(n.style.shader)),
    hasAnimation: Boolean(state.motion?.tracks?.length),
  })

  return targets
}

/**
 * Universal bundle generator routing to React JSX, Standalone SVG, or GLSL Package.
 */
export function generateCodeExportBundle(
  format: CodeExportFormat,
  state: SceneSnapshot,
  target: CodeExportTarget,
  options: {
    react: ReactExportOptions
    svg: SvgExportOptions
    glsl: GlslExportOptions
  },
): GeneratedCodeBundle {
  switch (format) {
    case 'react':
      return generateReactExport(state, target, options.react)
    case 'svg':
      return generateSvgExport(state, target, options.svg)
    case 'glsl':
      return generateGlslPackage(target).bundle
  }
}
