import type { Bounds } from '../canvas/types.ts'
import type { PaperProject } from '../io/project.ts'
import { getWorldBounds } from '../scene/geometry.ts'
import type { AutoLayout, ElementSizing, ElementType, SceneDocument, SceneElement } from '../scene/types.ts'
import { resolveTokens } from '../tokens/library.ts'
import type { DesignToken, SharedStyle, SharedStyleBindings, TokenBindings } from '../tokens/types.ts'
import type { ToolArguments } from './operations.ts'

/** The cap covers the complete structured result, including transport metadata. */
export const CONTEXT_MAX_BYTES = 32768
const encoder = new TextEncoder()
const bytes = (value: unknown) => encoder.encode(JSON.stringify(value)).length
const NAME_LIMIT = 160
const TEXT_LIMIT = 256
const MAX_ELEMENTS = 50
const MAX_ANCESTORS = 40
const MAX_SIBLINGS = 30
const MAX_LINKS = 50
const MAX_PATH = 20

export interface ReadIdentity {
  projectId: string
  revision: string
  file?: string
  live?: boolean
  project_id?: string
}
export interface ComponentSummary {
  id: string
  name: string
  kind: 'master' | 'instance'
  masterId?: string
  sourceId?: string
  instanceId?: string
  propertyCount?: number
}
export interface CompactElementSummary {
  id: string
  name: string
  type: ElementType
  parentId: string | null
  x: number
  y: number
  width: number
  height: number
  rotation: number
  zIndex: number
  visible: boolean
  locked: boolean
  effectiveVisible: boolean
  effectiveLocked: boolean
  effectiveBounds: Bounds
  truncated: boolean
  style: { fill: string | null; opacity: number; stroke: { color: string; width: number } | null; shaderKind: string | null; effectCount: number }
  tokenBindings?: TokenBindings
  sharedStyleBindings?: SharedStyleBindings
  component?: ComponentSummary
  sizing?: ElementSizing
  childCount?: number
  cornerRadius?: number
  clipContent?: boolean
  layout?: AutoLayout | null
  text?: string
  fontFamily?: string
  fontSize?: number
  fontWeight?: number
  lineHeight?: number
  letterSpacing?: number
  textAlign?: string
  alt?: string
  fit?: string
  fillRule?: string
}
interface LinkedToken {
  id: string; name: string; type: DesignToken['type']; value: string | number; resolvedValue: string | number; aliasId?: string; truncated: boolean
}
interface LinkedStyle { id: string; name: string; kind: SharedStyle['kind']; tokenIds: string[] }
interface SearchResult {
  id: string; name: string; type: ElementType; parentId: string | null
  parentPath: string[]; ancestorIds: string[]; pathTruncated: boolean; nameTruncated: boolean
  visible: boolean; locked: boolean; bounds: Bounds
  text?: string; textTruncated?: boolean; shaderKind?: string
}

function requireNode(scene: SceneDocument, id: string): SceneElement {
  if (!Object.hasOwn(scene.elements, id)) throw new Error(`Unknown element: ${id}`)
  return scene.elements[id]
}
function requireFrame(scene: SceneDocument, id: string): Extract<SceneElement, { type: 'frame' }> {
  const node = requireNode(scene, id)
  if (node.type !== 'frame') throw new Error(`Search scope/parent must be a frame: ${id}`)
  return node
}

/** Iterative document paint order; never sorts by random IDs or user selection order. */
function* walk(scene: SceneDocument, roots: readonly string[] = scene.rootIds): Generator<SceneElement> {
  const stack = [...roots].reverse()
  while (stack.length) {
    const node = requireNode(scene, stack.pop()!)
    yield node
    if (node.type === 'frame') for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i])
  }
}
function parents(scene: SceneDocument, node: SceneElement): SceneElement[] {
  const result: SceneElement[] = []
  let id = node.parentId
  while (id !== null) { const parent = requireNode(scene, id); result.push(parent); id = parent.parentId }
  return result.reverse()
}
function compareOrder(scene: SceneDocument, a: SceneElement, b: SceneElement): number {
  const ap = [...parents(scene, a), a], bp = [...parents(scene, b), b]
  for (let i = 0; i < Math.min(ap.length, bp.length); i++) {
    if (ap[i].id !== bp[i].id) return ap[i].zIndex - bp[i].zIndex
  }
  return ap.length - bp.length
}
function componentSummary(node: SceneElement): ComponentSummary | undefined {
  const link = node.component
  if (!link) return undefined
  const base = { id: node.id, name: node.name.slice(0, NAME_LIMIT), kind: link.kind }
  return link.kind === 'master' ? { ...base, propertyCount: link.properties?.length ?? 0 }
    : { ...base, masterId: link.masterId, sourceId: link.sourceId, instanceId: link.instanceId }
}

export function summarizeElement(scene: SceneDocument, node: SceneElement): CompactElementSummary {
  let truncated = false
  const clip = (value: string, limit = NAME_LIMIT) => { if (value.length > limit) truncated = true; return value.slice(0, limit) }
  const chain = parents(scene, node)
  const summary: CompactElementSummary = {
    id: node.id, name: clip(node.name), type: node.type, parentId: node.parentId,
    x: node.x, y: node.y, width: node.width, height: node.height, rotation: node.rotation, zIndex: node.zIndex,
    visible: node.visible, locked: node.locked,
    effectiveVisible: node.visible && chain.every(parent => parent.visible), effectiveLocked: node.locked || chain.some(parent => parent.locked),
    effectiveBounds: getWorldBounds(scene, node.id), truncated: false,
    style: { fill: node.style.fill === null ? null : clip(node.style.fill), opacity: node.style.opacity,
      stroke: node.style.stroke ? { color: clip(node.style.stroke.color), width: node.style.stroke.width } : null,
      shaderKind: node.style.shader?.kind ?? null, effectCount: node.style.effects?.length ?? 0 },
    ...(node.tokenBindings ? { tokenBindings: node.tokenBindings } : {}),
    ...(node.sharedStyleBindings ? { sharedStyleBindings: node.sharedStyleBindings } : {}),
    ...(node.component ? { component: componentSummary(node) } : {}),
    ...(node.sizing ? { sizing: node.sizing } : {}),
  }
  if (node.type === 'frame') Object.assign(summary, { cornerRadius: node.cornerRadius, clipContent: node.clipContent, childCount: node.children.length, layout: node.layout ?? null })
  if (node.type === 'text') Object.assign(summary, { text: clip(node.text, TEXT_LIMIT), fontFamily: clip(node.fontFamily), fontSize: node.fontSize, fontWeight: node.fontWeight, lineHeight: node.lineHeight, letterSpacing: node.letterSpacing, textAlign: node.textAlign })
  if (node.type === 'rectangle' || node.type === 'image') summary.cornerRadius = node.cornerRadius
  if (node.type === 'image') Object.assign(summary, { alt: clip(node.alt), fit: node.fit })
  if (node.type === 'path') summary.fillRule = node.fillRule
  summary.truncated = truncated || (node.component !== undefined && node.name.length > NAME_LIMIT)
  return summary
}

/** Append within budget, reserving space for final counters and the search cursor. */
function append<T>(result: object, target: T[], value: T): boolean {
  target.push(value)
  if (bytes(result) <= CONTEXT_MAX_BYTES - 512) return true
  target.pop()
  return false
}
function ensureBudget(result: object) {
  if (bytes(result) > CONTEXT_MAX_BYTES) throw new Error('Layer identity or project metadata exceeds the 32 KiB context payload limit')
}
function union(a: Bounds | null, b: Bounds): Bounds {
  if (!a) return b
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y)
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y }
}

export function selectionContext(project: PaperProject, requestedIds: readonly string[], identity: ReadIdentity) {
  const scene = project.scene
  // Validate every ID before applying caps. A stale ID is never silently an empty selection.
  const selected = [...new Set(requestedIds)].map(id => requireNode(scene, id)).sort((a, b) => compareOrder(scene, a, b))
  const selectedIds = new Set(selected.map(node => node.id))
  const result = {
    ...identity, empty: selected.length === 0, selectionCount: selected.length,
    elements: [] as CompactElementSummary[], ancestors: [] as CompactElementSummary[], siblings: [] as CompactElementSummary[],
    effectiveBounds: selected.reduce<Bounds | null>((bounds, node) => union(bounds, getWorldBounds(scene, node.id)), null),
    linkedTokens: [] as LinkedToken[], sharedStyles: [] as LinkedStyle[], components: [] as ComponentSummary[],
    truncated: false, omitted: { elements: 0, ancestors: 0, siblings: 0, linkedTokens: 0, sharedStyles: 0, components: 0 },
  }
  const ancestorNodes = new Map<string, SceneElement>()
  for (const node of selected) for (const ancestor of parents(scene, node)) if (!selectedIds.has(ancestor.id)) ancestorNodes.set(ancestor.id, ancestor)
  const siblingNodes = new Map<string, SceneElement>()
  for (const node of selected) {
    const list = node.parentId === null ? scene.rootIds : requireFrame(scene, node.parentId).children
    const index = node.zIndex
    for (let i = Math.max(0, index - 5); i < Math.min(list.length, index + 6); i++) {
      const id = list[i]
      if (!selectedIds.has(id) && !ancestorNodes.has(id)) siblingNodes.set(id, requireNode(scene, id))
    }
  }
  const emitted: SceneElement[] = []
  const addNodes = (nodes: SceneElement[], key: 'elements' | 'ancestors' | 'siblings', limit: number) => {
    for (const node of nodes) {
      if (result[key].length >= limit) { result.omitted[key]++; continue }
      const summary = summarizeElement(scene, node)
      if (!append(result, result[key], summary)) { result.omitted[key]++; continue }
      result.truncated ||= summary.truncated
      emitted.push(node)
    }
  }
  addNodes(selected, 'elements', MAX_ELEMENTS)
  addNodes([...ancestorNodes.values()].sort((a, b) => compareOrder(scene, a, b)), 'ancestors', MAX_ANCESTORS)
  addNodes([...siblingNodes.values()].sort((a, b) => compareOrder(scene, a, b)), 'siblings', MAX_SIBLINGS)

  const tokenIds = new Set<string>(), styleIds = new Set<string>(), componentIds = new Set<string>()
  for (const node of emitted) {
    for (const id of Object.values(node.tokenBindings ?? {})) tokenIds.add(id)
    for (const effect of node.style.effects ?? []) if (effect.type !== 'layer-blur' && effect.colorTokenId) tokenIds.add(effect.colorTokenId)
    for (const id of Object.values(node.sharedStyleBindings ?? {})) styleIds.add(id)
    if (node.component) { componentIds.add(node.id); if (node.component.kind === 'instance') componentIds.add(node.component.masterId) }
  }
  const styles = (scene.styleLibrary?.styles ?? []).filter(style => styleIds.has(style.id)).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  for (const style of styles) {
    const dependencies = style.kind === 'color' ? (style.tokenId ? [style.tokenId] : [])
      : style.kind === 'typography' ? Object.values(style.value.tokenBindings ?? {})
      : style.value.flatMap(effect => effect.type !== 'layer-blur' && effect.colorTokenId ? [effect.colorTokenId] : [])
    dependencies.forEach(id => tokenIds.add(id))
    const summary: LinkedStyle = { id: style.id, name: style.name, kind: style.kind, tokenIds: [...new Set(dependencies)].sort() }
    if (result.sharedStyles.length >= MAX_LINKS || !append(result, result.sharedStyles, summary)) result.omitted.sharedStyles++
  }
  const tokens = new Map((scene.tokens ?? []).map(token => [token.id, token]))
  for (const id of tokenIds) {
    let token = tokens.get(id)
    while (token?.aliasId && !tokenIds.has(token.aliasId)) { tokenIds.add(token.aliasId); token = tokens.get(token.aliasId) }
  }
  const resolved = new Map(resolveTokens(scene.tokens ?? [], scene.styleLibrary?.activeThemeId ?? null).map(token => [token.id, token.value]))
  for (const id of [...tokenIds].sort()) {
    const token = tokens.get(id)
    if (!token) continue
    const value = resolved.get(id)!
    const summary: LinkedToken = { id, name: token.name, type: token.type, value: typeof token.value === 'string' ? token.value.slice(0, TEXT_LIMIT) : token.value,
      resolvedValue: typeof value === 'string' ? value.slice(0, TEXT_LIMIT) : value,
      ...(token.aliasId ? { aliasId: token.aliasId } : {}), truncated: typeof token.value === 'string' && token.value.length > TEXT_LIMIT || typeof value === 'string' && value.length > TEXT_LIMIT }
    if (result.linkedTokens.length >= MAX_LINKS || !append(result, result.linkedTokens, summary)) result.omitted.linkedTokens++
    else result.truncated ||= summary.truncated
  }
  for (const id of [...componentIds].sort()) {
    const summary = componentSummary(requireNode(scene, id))
    if (!summary) continue
    if (result.components.length >= MAX_LINKS || !append(result, result.components, summary)) result.omitted.components++
  }
  result.truncated ||= Object.values(result.omitted).some(count => count > 0)
  ensureBudget(result)
  return result
}

/** Portable fingerprint, not an authentication token; account isolation stays in the backend. */
function fingerprint(value: string): string {
  let a = 2166136261, b = 3339675911
  for (let i = 0; i < value.length; i++) { a = Math.imul(a ^ value.charCodeAt(i), 16777619); b = Math.imul(b ^ value.charCodeAt(i), 2246822519) }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0')
}

export function searchLayers(project: PaperProject, args: ToolArguments, identity: ReadIdentity) {
  const scene = project.scene
  const query = (args.query as string | undefined ?? '').trim().toLowerCase()
  const type = args.type as ElementType | undefined
  const types = args.types === undefined ? undefined : [...new Set(args.types as ElementType[])].sort()
  const parentId = args.parentId !== undefined ? args.parentId as string | null : args.parent_id as string | null | undefined
  const scopeId = args.scope_id as string | undefined ?? args.scopeId as string | undefined
  if (args.parentId !== undefined && args.parent_id !== undefined && args.parentId !== args.parent_id) throw new Error('Conflicting parentId and parent_id filters')
  if (args.scopeId !== undefined && args.scope_id !== undefined && args.scopeId !== args.scope_id) throw new Error('Conflicting scopeId and scope_id filters')
  if (parentId !== undefined && parentId !== null) requireFrame(scene, parentId)
  const scope = scopeId === undefined ? undefined : requireFrame(scene, scopeId)
  const limit = args.limit as number | undefined ?? 20
  const filters = JSON.stringify({ query, type, types, parentId, scopeId, visible: args.visible, locked: args.locked, limit })
  const binding = fingerprint(JSON.stringify([identity.projectId, identity.revision, filters]))
  const cursorFor = (offset: number) => `p1.${binding}.${offset}.${fingerprint(`${binding}:${offset}`)}`
  let offset = 0
  if (args.cursor !== undefined) {
    const cursor = args.cursor as string
    // Fingerprints are 16 hex characters (two independent 32-bit accumulators).
    const parsed = /^p1\.([a-f0-9]{16})\.([1-9]\d*)\.([a-f0-9]{16})$/.exec(cursor)
    offset = parsed ? Number(parsed[2]) : NaN
    if (!Number.isSafeInteger(offset) || cursor !== cursorFor(offset)) throw new Error('Invalid or stale search cursor: restart search with the same project and filters at the latest revision')
  }
  const result = { ...identity, results: [] as SearchResult[], total: 0, offset, limit, hasMore: false, nextCursor: null as string | null, truncated: false }
  // Keep only one bounded page; neither full matching nodes nor per-node paths are retained.
  let pageFull = false
  for (const node of walk(scene, scope?.type === 'frame' ? scope.children : scene.rootIds)) {
    if (parentId !== undefined && node.parentId !== parentId || type && node.type !== type || types && !types.includes(node.type)) continue
    if (args.visible !== undefined && node.visible !== args.visible || args.locked !== undefined && node.locked !== args.locked) continue
    if (query && !node.name.toLowerCase().includes(query) && !node.type.includes(query) && !(node.type === 'text' && node.text.toLowerCase().includes(query))) continue
    const index = result.total++
    if (index < offset || pageFull) continue
    if (result.results.length >= limit) { pageFull = true; continue }
    const chain = parents(scene, node)
    const path = chain.slice(-MAX_PATH)
    const summary: SearchResult = {
      id: node.id, name: node.name.slice(0, NAME_LIMIT), type: node.type, parentId: node.parentId,
      parentPath: path.map(parent => parent.name.slice(0, NAME_LIMIT)), ancestorIds: path.map(parent => parent.id),
      pathTruncated: chain.length > MAX_PATH || path.some(parent => parent.name.length > NAME_LIMIT), nameTruncated: node.name.length > NAME_LIMIT,
      visible: node.visible, locked: node.locked, bounds: { x: node.x, y: node.y, width: node.width, height: node.height },
      ...(node.type === 'text' ? { text: node.text.slice(0, 120), textTruncated: node.text.length > 120 } : {}),
      ...(node.style.shader ? { shaderKind: node.style.shader.kind } : {}),
    }
    if (!append(result, result.results, summary)) {
      if (!result.results.length) throw new Error('Layer identity exceeds the 32 KiB context payload limit')
      pageFull = true; result.truncated = true; continue
    }
    result.truncated ||= summary.pathTruncated || summary.nameTruncated || summary.textTruncated === true
  }
  if (args.cursor !== undefined && offset >= result.total) throw new Error('Invalid search cursor offset; restart search')
  const next = offset + result.results.length
  result.hasMore = next < result.total
  result.nextCursor = result.hasMore ? cursorFor(next) : null
  ensureBudget(result)
  return result
}
