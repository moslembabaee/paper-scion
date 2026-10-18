import { GRID_SIZE } from '../canvas/math.ts'
import { createProject } from '../io/project.ts'
import type { PaperProject } from '../io/project.ts'
import { sceneToSVG } from '../io/svg.ts'
import { getWorldMatrix } from '../scene/geometry.ts'
import { selectionRoots } from '../scene/selectionGeometry.ts'
import { SceneStore } from '../scene/store.ts'
import type { ElementInput, ElementPatch, SceneElement, SceneSnapshot } from '../scene/types.ts'
import { createShader, validateShader } from '../shaders/catalog.ts'
import { createMeshMaterial } from '../shaders/mesh.ts'
import type { ShaderKind, ShaderPaint } from '../shaders/types.ts'
import type { TokenInput } from '../tokens/types.ts'
import { patchSchema, validateSchema } from './schema.ts'

export { selectionContext, searchLayers } from './context.ts'
export { executeTransaction, IdempotencyCache, validateTransaction } from './transaction.ts'
export type { ApplyChangesResult, ApplyChangesOperation, CompactChangeSummary, ActionResult } from './transaction.ts'

export type ToolArguments = Record<string, unknown>

export function projectStore(project: PaperProject): SceneStore {
  const store = new SceneStore()
  store.load(project.scene)
  store.clearHistory()
  return store
}

function requireNode(store: SceneStore, id: string): SceneElement {
  const elements = store.getSnapshot().elements
  if (!Object.hasOwn(elements, id)) throw new Error(`Unknown element: ${id}`)
  return elements[id]
}

/** Parent-first, back-to-front ordering; frames include every descendant. */
export function collectElements(state: SceneSnapshot, ids = state.rootIds): SceneElement[] {
  const wanted = new Set<string>()
  const include = (id: string) => {
    if (!Object.hasOwn(state.elements, id)) throw new Error(`Unknown element: ${id}`)
    if (wanted.has(id)) return
    wanted.add(id)
    const node = state.elements[id]
    if (node.type === 'frame') node.children.forEach(include)
  }
  ids.forEach(include)
  const ordered: SceneElement[] = []
  const visit = (id: string) => {
    const node = state.elements[id]
    if (wanted.has(id)) ordered.push(node)
    if (node.type === 'frame') node.children.forEach(visit)
  }
  state.rootIds.forEach(visit)
  return ordered
}

export function readCanvas(project: PaperProject, ids?: readonly string[]) {
  const store = projectStore(project)
  return { name: project.name, version: project.version, viewport: project.viewport, grid: project.grid, gridSize: GRID_SIZE, rootIds: project.scene.rootIds, tokens: store.getSnapshot().tokens, styleLibrary: store.getSnapshot().styleLibrary, backgroundShader: project.scene.backgroundShader ?? null, elements: collectElements(store.getSnapshot(), ids) }
}

export function basicInfo(project: PaperProject, selection: readonly string[] = []) {
  const elements = Object.values(project.scene.elements)
  return { name: project.name, fileName: project.name, version: project.version, nodeCount: elements.length, gridSize: GRID_SIZE, selection,
    artboards: elements.filter(node => node.type === 'frame' && node.parentId === null).map(({ id, name, width, height }) => ({ id, name, width, height })) }
}

export function mutateCanvas(project: PaperProject, name: string, args: ToolArguments): { project: PaperProject; element?: SceneElement; token?: ReturnType<SceneStore['addToken']> } {
  const store = projectStore(project)
  if (name === 'create_token') {
    const { id, name: tokenName, type, value } = args
    const token = store.addToken({ ...(id ? { id } : {}), name: tokenName, type, value } as TokenInput)
    return { project: { ...project, scene: store.toJSON() }, token }
  }
  let element: SceneElement
  if (name === 'create_frame' || name === 'add_shader_shape') {
    const input = Object.fromEntries(Object.entries(args).filter(([key]) => ['id', 'name', 'parentId', 'x', 'y', 'width', 'height', 'rotation', 'visible', 'locked', 'style', 'cornerRadius', 'clipContent', 'sizing', 'layout'].includes(key)))
    if (name === 'create_frame') {
      const frame = input as ElementInput<'frame'>
      element = store.add('frame', { ...frame, style: { fill: '#edebe1', ...frame.style } })
    } else {
      const kind = args.shader_kind as ShaderKind
      const defaults = createShader(kind)
      let shader = { ...defaults, ...(args.motion as object | undefined), params: { ...defaults.params, ...(args.params as object | undefined) } } as ShaderPaint
      if (shader.kind === 'mesh-gradient' && Array.isArray(shader.params.colors) && shader.params.colors.length >= 2 && shader.params.colors.length <= 10) {
        shader = { ...shader, mesh: createMeshMaterial(shader.params.colors.length) }
      }
      validateShader(shader)
      const shape = (args.shape ?? 'rectangle') as 'rectangle' | 'ellipse'
      if (shape === 'ellipse' && args.cornerRadius !== undefined) throw new Error('Ellipses do not have a cornerRadius')
      const shapeInput = input as ElementInput<'rectangle'>
      element = store.add(shape, { ...shapeInput, name: shapeInput.name ?? `${kind} ${shape}`, style: { ...shapeInput.style, shader } })
    }
  } else if (name === 'update_element') {
    const id = args.element_id as string
    const node = requireNode(store, id)
    const patch = args.patch as Record<string, unknown>
    validateSchema(patch, patchSchema(node.type), 'patch')
    // Work in a disposable store so a failed structural edit never reaches disk.
    store.batch(() => {
      if (patch.locked === false) store.setLocked(id, false)
      if (Object.hasOwn(args, 'parentId')) store.reparent(id, args.parentId as string | null, args.index as number | undefined)
      else if (args.index !== undefined) store.reorder(id, args.index as number)
      const content = Object.fromEntries(Object.entries(patch).filter(([key]) => key !== 'locked' && key !== 'visible'))
      if (Object.keys(content).length) store.update(id, node.type, content as ElementPatch<typeof node.type>)
      if (typeof patch.visible === 'boolean') store.setVisible(id, patch.visible)
      if (patch.locked === true) store.setLocked(id, true)
    }, 'Edit element from agent')
    element = requireNode(store, id)
  } else throw new Error(`Unknown mutation: ${name}`)
  return { project: { ...project, scene: store.toJSON() }, element }
}

export function exportCanvas(project: PaperProject, args: ToolArguments): { mimeType: string; content: string; elementIds: readonly string[] } {
  const store = projectStore(project)
  const state = store.getSnapshot()
  const ids = args.element_ids as readonly string[] | undefined
  const nodes = collectElements(state, ids)
  const selected = new Set(selectionRoots(state, ids ? [...new Set(ids)] : state.rootIds))
  const roots = nodes.filter(node => selected.has(node.id)).map(node => node.id)
  if (!roots.length) throw new Error('The canvas has no elements to export')
  if (args.format === 'svg') {
    const snapshots = args.shader_snapshots as Record<string, string> | undefined
    const content = sceneToSVG({ ...state, selection: roots }, { scope: ids ? 'selection' : 'canvas', scale: 1, background: (args.background ?? 'transparent') as 'transparent' | 'cream' }, { images: new Map(), shaders: new Map(Object.entries(snapshots ?? {})) })
    return { mimeType: 'image/svg+xml', content, elementIds: roots }
  }
  const elements = Object.fromEntries(nodes.map(node => [node.id, node]))
  roots.forEach((id, index) => {
    const node = state.elements[id]
    const [a, b, c, d, e, f] = getWorldMatrix(state, id)
    let opacity = node.style.opacity
    let parent = node.parentId
    while (parent !== null) { opacity *= state.elements[parent].style.opacity; parent = state.elements[parent].parentId }
    const tokenBindings = { ...node.tokenBindings }
    delete tokenBindings.x; delete tokenBindings.y
    elements[id] = { ...node, ...(node.tokenBindings ? { tokenBindings } : {}), parentId: null, zIndex: index, x: a * node.width / 2 + c * node.height / 2 + e - node.width / 2, y: b * node.width / 2 + d * node.height / 2 + f - node.height / 2, rotation: Math.atan2(b, a) * 180 / Math.PI, visible: store.isVisible(id), style: { ...node.style, opacity } } as SceneElement
  })
  const exported = new SceneStore()
  exported.load({ version: 1, tokens: state.tokens, styleLibrary: state.styleLibrary, elements, rootIds: roots, backgroundShader: ids ? null : state.backgroundShader })
  const result = createProject(exported, `${project.name}${ids ? ' selection' : ''}`.slice(0, 200), project.viewport, project.grid)
  return { mimeType: 'application/json', content: JSON.stringify(result, null, 2), elementIds: roots }
}
