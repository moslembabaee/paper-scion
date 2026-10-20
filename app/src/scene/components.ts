import { pruneComponentProperties, pruneVariantMatrix, resolveComponentProperties, validPropertyValue, validateComponentProperties, validatePropertyTargets, validateVariantMatrix } from './componentProperties.ts'
import { validateStateMachine } from './stateMachine.ts'
import { EMPTY_LIBRARY, detachEditedSharedStyles, resolveSharedStyles } from '../tokens/library.ts'
import type { ComponentInstance, ComponentLink, ComponentOverrides, ComponentRegistry, ComponentRegistryEntry, ComponentSlotInfo, ElementPatch, ElementType, MasterComponent, OverrideDiffEntry, PropertyOverrideBinding, SceneElement } from './types.ts'
import { freezeElement, validateElement } from './elements.ts'
import { equalValue } from './history.ts'
import { detachEditedBindings, resolveTokenBindings } from '../tokens/model.ts'
import type { DesignToken, SharedStyleKind, StyleLibrary, TokenProperty } from '../tokens/types.ts'

const safeId = (id: unknown): id is string => typeof id === 'string' && !!id && id.length <= 200 && !['__proto__', 'constructor', 'prototype'].includes(id)
const PROPERTY_KEYS = new Set(['name', 'x', 'y', 'width', 'height', 'rotation', 'visible', 'locked', 'sizing', 'cornerRadius', 'clipContent', 'layout', 'd', 'viewBox', 'fillRule', 'nodes', 'text', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textAlign', 'src', 'alt', 'fit', 'fontSource', 'variableAxes', 'openTypeFeatures', 'fontKerning', 'opticalKerning', 'opticalMarginAlignment', 'showOpticalMetrics', 'textOnPath', 'textTransform', 'kinetic', 'themeMode', 'isSlot', 'slotName', 'isSlotChild', 'slotId', 'renderMode', 'renderOutlines', 'outlinePathD'])
const STYLE_KEYS = new Set(['fill', 'stroke', 'opacity', 'shadow', 'shader', 'effects'])
const STROKE_KEYS = new Set(['color', 'width', 'dash'])
const TOKEN_KEYS = new Set(['fill', 'stroke', 'shadow', 'cornerRadius', 'fontSize', 'fontFamily', 'fontWeight', 'lineHeight', 'letterSpacing', 'x', 'y', 'width', 'height'])
const OVERRIDE_KEYS = new Set(['properties', 'style', 'tokenBindings', 'sharedStyleBindings', 'themeMode'])
const frozenLinks = new WeakSet<object>()
function freezeTree<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) freezeTree(child)
  return Object.freeze(value)
}
export function freezeComponent(link: ComponentLink): ComponentLink {
  if (frozenLinks.has(link)) return link
  const frozen = freezeTree(structuredClone(link))
  frozenLinks.add(frozen)
  return frozen
}
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) }
function checkKeys(value: unknown, keys: ReadonlySet<string>): void {
  if (!record(value) || Object.keys(value).some(key => !keys.has(key))) throw new Error('Invalid component overrides')
}
export function validateComponent(link: ComponentLink): void {
  if (!record(link) || !['master', 'instance'].includes(link.kind)) throw new Error('Invalid component link')
  if (link.kind === 'master') {
    if (Object.keys(link).some(key => !['kind', 'properties', 'stateMachine', 'description', 'createdAt', 'updatedAt', 'metadata', 'variantMatrix'].includes(key))) throw new Error('Invalid master component')
    if (link.description !== undefined && (typeof link.description !== 'string' || link.description.length > 1000)) throw new Error('Invalid master component description')
    if (link.createdAt !== undefined && (typeof link.createdAt !== 'number' || !Number.isFinite(link.createdAt))) throw new Error('Invalid master component timestamp')
    if (link.updatedAt !== undefined && (typeof link.updatedAt !== 'number' || !Number.isFinite(link.updatedAt))) throw new Error('Invalid master component timestamp')
    if (link.metadata !== undefined && !record(link.metadata)) throw new Error('Invalid master component metadata')
    if (link.properties !== undefined) validateComponentProperties(link.properties)
    if (link.stateMachine !== undefined) validateStateMachine(link.stateMachine)
    if (link.variantMatrix !== undefined) validateVariantMatrix(link.variantMatrix)
    return
  }
  if (Object.keys(link).some(key => !['kind', 'masterId', 'sourceId', 'instanceId', 'overrides', 'propertyValues', 'activeState'].includes(key)) || ![link.masterId, link.sourceId, link.instanceId].every(id => typeof id === 'string' && id.length > 0 && !['__proto__', 'constructor', 'prototype'].includes(id))) throw new Error('Invalid component reference')
  if (link.activeState !== undefined && (typeof link.activeState !== 'string' || !link.activeState.trim())) throw new Error('Invalid active component state')
  if (link.propertyValues !== undefined && (!record(link.propertyValues) || Object.entries(link.propertyValues).some(([id, value]) => !id || ['__proto__', 'constructor', 'prototype'].includes(id) || !['string', 'boolean', 'number'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value))))) throw new Error('Invalid component property values')
  checkKeys(link.overrides, OVERRIDE_KEYS)
  if (link.overrides.properties !== undefined) checkKeys(link.overrides.properties, PROPERTY_KEYS)
  if (link.overrides.style !== undefined) {
    checkKeys(link.overrides.style, STYLE_KEYS)
    if (link.overrides.style.stroke !== undefined && link.overrides.style.stroke !== null) checkKeys(link.overrides.style.stroke, STROKE_KEYS)
  }
  if (link.overrides.sharedStyleBindings !== undefined && (!record(link.overrides.sharedStyleBindings) || Object.entries(link.overrides.sharedStyleBindings).some(([key, value]) => !['color', 'typography', 'effects'].includes(key) || (value !== null && (typeof value !== 'string' || !value))))) throw new Error('Invalid shared style override')
  if (link.overrides.tokenBindings !== undefined && (!record(link.overrides.tokenBindings) || Object.entries(link.overrides.tokenBindings).some(([key, value]) => !TOKEN_KEYS.has(key) || (value !== null && (typeof value !== 'string' || !value))))) throw new Error('Invalid component token bindings')
}

export function isMasterComponent(node: SceneElement | null | undefined): node is MasterComponent {
  return node?.component?.kind === 'master'
}

export function isComponentInstance(node: SceneElement | null | undefined): node is ComponentInstance {
  return node?.component?.kind === 'instance'
}

export function isInstanceRoot(node: SceneElement | null | undefined): node is ComponentInstance {
  return node?.component?.kind === 'instance' && node.component.instanceId === node.id
}

export function buildComponentRegistry(elements: Readonly<Record<string, SceneElement>>): ComponentRegistry {
  const registry: Record<string, ComponentRegistryEntry> = {}
  const instancesByMaster = new Map<string, string[]>()

  for (const node of Object.values(elements)) {
    if (node.component?.kind === 'instance' && node.component.instanceId === node.id) {
      const list = instancesByMaster.get(node.component.masterId) ?? []
      list.push(node.id)
      instancesByMaster.set(node.component.masterId, list)
    }
  }

  for (const node of Object.values(elements)) {
    if (node.component?.kind === 'master') {
      const link = node.component
      const instanceIds = Object.freeze(instancesByMaster.get(node.id) ?? [])
      registry[node.id] = Object.freeze({
        masterId: node.id,
        name: node.name,
        ...(link.description ? { description: link.description } : {}),
        properties: link.properties ?? Object.freeze([]),
        ...(link.stateMachine ? { stateMachine: link.stateMachine } : {}),
        ...(link.variantMatrix ? { variantMatrix: link.variantMatrix } : {}),
        instanceIds,
        ...(link.createdAt !== undefined ? { createdAt: link.createdAt } : {}),
        ...(link.updatedAt !== undefined ? { updatedAt: link.updatedAt } : {}),
      })
    }
  }

  return Object.freeze(registry)
}

export function validateComponentRegistry(registry: ComponentRegistry, elements?: Readonly<Record<string, SceneElement>>): void {
  if (!record(registry)) throw new Error('Invalid component registry')
  for (const [masterId, entry] of Object.entries(registry)) {
    if (!safeId(masterId) || !record(entry) || entry.masterId !== masterId) throw new Error('Invalid component registry entry')
    if (typeof entry.name !== 'string' || !entry.name.trim()) throw new Error('Invalid component registry entry name')
    if (!Array.isArray(entry.instanceIds) || entry.instanceIds.some(id => !safeId(id))) throw new Error('Invalid registered instance IDs')
    if (entry.properties !== undefined) validateComponentProperties(entry.properties)
    if (entry.stateMachine !== undefined) validateStateMachine(entry.stateMachine)
    if (entry.variantMatrix !== undefined) validateVariantMatrix(entry.variantMatrix)
    if (elements) {
      const master = elements[masterId]
      if (!master || master.component?.kind !== 'master') throw new Error(`Registered master component '${masterId}' does not exist`)
      for (const instanceId of entry.instanceIds) {
        const inst = elements[instanceId]
        if (!inst || inst.component?.kind !== 'instance' || inst.component.instanceId !== instanceId || inst.component.masterId !== masterId) {
          throw new Error(`Invalid registered instance '${instanceId}' for master '${masterId}'`)
        }
      }
    }
  }
}

/** Return a master or instance root for any layer in a component subtree. */
export function componentRoot(elements: Readonly<Record<string, SceneElement>>, id: string): SceneElement | undefined {
  let node: SceneElement | undefined = Object.hasOwn(elements, id) ? elements[id] : undefined
  while (node) {
    if (node.component?.kind === 'instance') return elements[node.component.instanceId]
    if (node.component?.kind === 'master') return node
    node = node.parentId === null ? undefined : elements[node.parentId]
  }
}
export function subtree(elements: Readonly<Record<string, SceneElement>>, id: string): SceneElement[] {
  const result: SceneElement[] = []
  const visit = (nodeId: string) => {
    const node = elements[nodeId]
    if (!node) return
    result.push(node)
    if (node.type === 'frame') node.children.forEach(visit)
  }
  visit(id)
  return result
}

/** Only changed channels become overrides; untouched channels keep inheriting. */
export function recordComponentEdit(node: SceneElement, updated: SceneElement, patch: ElementPatch<ElementType>): SceneElement {
  const link = node.component
  if (link?.kind !== 'instance') return updated
  const properties = { ...link.overrides.properties } as Record<string, unknown>
  const style = { ...link.overrides.style }
  for (const [key, value] of Object.entries(patch)) {
    if (node.id === link.instanceId && ['x', 'y', 'rotation'].includes(key)) continue
    if (key === 'kinetic' && value && node.type === 'text' && updated.type === 'text' && updated.kinetic) {
      const kineticOverrides = { ...(properties.kinetic as Record<string, unknown> ?? {}) }
      const nextKinetic = updated.kinetic as unknown as Record<string, unknown>
      if (!node.kinetic) {
        properties.kinetic = nextKinetic
      } else {
        const baseKinetic = node.kinetic as unknown as Record<string, unknown>
        for (const channel of ['enabled', 'playing', 'amplitude', 'rotation', 'duration', 'stagger', 'phase', 'staggerMode', 'waveShape', 'weightModulation', 'slantModulation', 'scaleModulation', 'horizontalAmplitude', 'widthModulation', 'opticalSizeModulation'] as const) {
          if (!equalValue(baseKinetic[channel], nextKinetic[channel])) {
            kineticOverrides[channel] = nextKinetic[channel]
          }
        }
        properties.kinetic = kineticOverrides
      }
    } else if (key === 'kinetic' && value === null && node.type === 'text') {
      properties.kinetic = null
    } else if (key === 'variableAxes' && value && node.type === 'text' && updated.type === 'text' && updated.variableAxes) {
      const axesOverrides = { ...(properties.variableAxes as Record<string, number> ?? {}) }
      const baseAxes = (node.variableAxes ?? {}) as Record<string, number>
      const nextAxes = updated.variableAxes as Record<string, number>
      for (const [axis, axisVal] of Object.entries(nextAxes)) {
        if (!equalValue(baseAxes[axis], axisVal)) {
          axesOverrides[axis] = axisVal
        }
      }
      properties.variableAxes = axesOverrides
    } else if (key === 'openTypeFeatures' && value && node.type === 'text' && updated.type === 'text' && updated.openTypeFeatures) {
      const featOverrides = { ...(properties.openTypeFeatures as Record<string, boolean> ?? {}) }
      const baseFeat = (node.openTypeFeatures ?? {}) as Record<string, boolean>
      const nextFeat = updated.openTypeFeatures as Record<string, boolean>
      for (const [feat, featVal] of Object.entries(nextFeat)) {
        if (!equalValue(baseFeat[feat], featVal)) {
          featOverrides[feat] = featVal
        }
      }
      properties.openTypeFeatures = featOverrides
    } else if (PROPERTY_KEYS.has(key) && !equalValue(node[key as keyof SceneElement], value)) {
      properties[key] = updated[key as keyof SceneElement]
    }
  }
  // Resizing a hug/fill layer implicitly changes its sizing, too.
  if (!equalValue(node.sizing, updated.sizing)) properties.sizing = updated.sizing
  if (node.type === 'path' && Object.hasOwn(patch, 'd') && !Object.hasOwn(patch, 'nodes')) delete properties.nodes
  if (node.type === 'path' && updated.type === 'path' && Object.hasOwn(patch, 'nodes')) properties.d = updated.d
  for (const [key, value] of Object.entries(patch.style ?? {})) {
    if (equalValue(node.style[key as keyof typeof node.style], value)) continue
    if (key === 'stroke' && value && node.style.stroke) {
      const stroke = { ...style.stroke }
      const nextStroke = updated.style.stroke!
      for (const channel of ['color', 'width', 'dash'] as const) if (!equalValue(node.style.stroke[channel], nextStroke[channel])) Object.assign(stroke, { [channel]: nextStroke[channel] })
      style.stroke = stroke
    } else if (key === 'shader' && value && node.style.shader && updated.style.shader && node.style.shader.kind === updated.style.shader.kind) {
      const existingShaderOverrides = (style.shader ?? {}) as Record<string, unknown>
      const shaderPatch: Record<string, unknown> = { ...existingShaderOverrides, kind: updated.style.shader.kind }
      for (const prop of ['animated', 'speed', 'scale', 'rotation', 'frame', 'offsetX', 'offsetY'] as const) {
        if (!equalValue(node.style.shader[prop], updated.style.shader[prop])) {
          shaderPatch[prop] = updated.style.shader[prop]
        }
      }
      if (updated.style.shader.composite && !equalValue(node.style.shader.composite, updated.style.shader.composite)) {
        shaderPatch.composite = updated.style.shader.composite
      }
      if (updated.style.shader.params && !equalValue(node.style.shader.params, updated.style.shader.params)) {
        const paramOverrides = { ...((existingShaderOverrides.params as Record<string, unknown>) ?? {}) }
        for (const [pKey, pVal] of Object.entries(updated.style.shader.params as Record<string, unknown>)) {
          if (!equalValue((node.style.shader.params as Record<string, unknown>)[pKey], pVal)) {
            paramOverrides[pKey] = pVal
          }
        }
        shaderPatch.params = paramOverrides
      }
      if (updated.style.shader.mesh && !equalValue(node.style.shader.mesh, updated.style.shader.mesh)) {
        const existingMeshOverrides = ((existingShaderOverrides.mesh as Record<string, unknown>) ?? {})
        const meshPatch: Record<string, unknown> = { ...existingMeshOverrides }
        const baseMesh = (node.style.shader.mesh ?? {}) as unknown as Record<string, unknown>
        const nextMesh = updated.style.shader.mesh as unknown as Record<string, unknown>
        for (const [mKey, mVal] of Object.entries(nextMesh)) {
          if (!equalValue(baseMesh[mKey], mVal)) {
            meshPatch[mKey] = mVal
          }
        }
        shaderPatch.mesh = meshPatch
      }
      if (updated.style.shader.postProcessing && !equalValue(node.style.shader.postProcessing, updated.style.shader.postProcessing)) {
        shaderPatch.postProcessing = updated.style.shader.postProcessing
      }
      if (updated.style.shader.pipeline && !equalValue(node.style.shader.pipeline, updated.style.shader.pipeline)) {
        shaderPatch.pipeline = updated.style.shader.pipeline
      }
      style.shader = shaderPatch as unknown as typeof style.shader
    } else Object.assign(style, { [key]: value })
  }
  const tokenBindings = { ...link.overrides.tokenBindings }
  for (const property of Object.keys(tokenBindings) as TokenProperty[]) if (node.tokenBindings?.[property] && !updated.tokenBindings?.[property]) tokenBindings[property] = null
  const sharedStyleBindings = { ...link.overrides.sharedStyleBindings }
  for (const kind of ['color', 'typography', 'effects'] as const) if (node.sharedStyleBindings?.[kind] && !updated.sharedStyleBindings?.[kind]) sharedStyleBindings[kind] = null
  const overrides: ComponentOverrides = { ...link.overrides, properties, style, ...(Object.keys(sharedStyleBindings).length ? { sharedStyleBindings } : {}), ...(Object.keys(tokenBindings).length ? { tokenBindings } : {}) }
  return { ...updated, component: { ...link, overrides } }
}

/** A binding override affects one channel; other bindings still follow the master. */
export function recordComponentTokenEdit(node: SceneElement, updated: SceneElement, property: TokenProperty, tokenId: string | null): SceneElement {
  if (node.component?.kind !== 'instance') return updated
  const link = node.component
  const properties = { ...link.overrides.properties } as Record<string, unknown>
  const style = { ...link.overrides.style }
  // A local stroke binding also keeps the stroke enabled if the master removes it.
  if (property === 'stroke' && tokenId !== null && !Object.hasOwn(style, 'stroke')) style.stroke = {}
  if (tokenId === null) {
    if (property === 'fill') style.fill = node.style.fill
    else if (property === 'shadow') style.shadow = node.style.shadow
    else if (property === 'stroke') style.stroke = { ...style.stroke, color: node.style.stroke!.color }
    else properties[property] = node[property as keyof SceneElement]
  }
  if (!equalValue(node.sizing, updated.sizing)) properties.sizing = updated.sizing
  const sharedStyleBindings = { ...link.overrides.sharedStyleBindings }
  for (const kind of ['color', 'typography', 'effects'] as const) if (node.sharedStyleBindings?.[kind] && !updated.sharedStyleBindings?.[kind]) sharedStyleBindings[kind] = null
  return { ...updated, component: { ...link, overrides: { ...link.overrides, properties, style, ...(Object.keys(sharedStyleBindings).length ? { sharedStyleBindings } : {}), tokenBindings: { ...link.overrides.tokenBindings, [property]: tokenId } } } }
}

export function applyComponentOverrides(source: SceneElement, link: Extract<ComponentLink, { kind: 'instance' }>, tokens: readonly DesignToken[], library: StyleLibrary = EMPTY_LIBRARY): SceneElement {
  const { properties = {}, style = {} } = link.overrides
  // A partial stroke can survive a master removing its stroke, too.
  const stroke = Object.hasOwn(style, 'stroke') ? style.stroke === null ? null : { color: '#080808', width: 1, dash: [], ...source.style.stroke, ...style.stroke } : source.style.stroke
  const shader = Object.hasOwn(style, 'shader')
    ? (style.shader === null ? null : (source.style.shader && style.shader && (style.shader as any).kind === source.style.shader.kind
        ? {
            ...source.style.shader,
            ...style.shader,
            params: { ...source.style.shader.params, ...((style.shader as any).params ?? {}) },
            ...(source.style.shader.mesh || (style.shader as any).mesh ? { mesh: { ...source.style.shader.mesh, ...((style.shader as any).mesh ?? {}) } } : {}),
            ...(source.style.shader.composite || (style.shader as any).composite ? { composite: { ...source.style.shader.composite, ...((style.shader as any).composite ?? {}) } } : {}),
            ...(source.style.shader.postProcessing || (style.shader as any).postProcessing ? { postProcessing: { ...source.style.shader.postProcessing, ...((style.shader as any).postProcessing ?? {}) } } : {}),
            ...(source.style.shader.pipeline || (style.shader as any).pipeline ? { pipeline: { ...source.style.shader.pipeline, ...((style.shader as any).pipeline ?? {}) } } : {}),
          }
        : style.shader))
    : source.style.shader
  const tokenBindings = { ...detachEditedBindings(source.tokenBindings, { ...properties, style }, source) }
  // An explicit stroke color remains local even when the master happens to match it.
  if (style.stroke === null || (style.stroke && Object.hasOwn(style.stroke, 'color'))) delete tokenBindings.stroke
  for (const [property, id] of Object.entries(link.overrides.tokenBindings ?? {})) {
    if (id === null) delete tokenBindings[property as TokenProperty]
    else tokenBindings[property as TokenProperty] = id
  }
  const sharedStyleBindings = { ...detachEditedSharedStyles(source.sharedStyleBindings, { ...properties, style }) }
  for (const [kind, id] of Object.entries(link.overrides.sharedStyleBindings ?? {})) {
    if (id === null) delete sharedStyleBindings[kind as SharedStyleKind]
    else sharedStyleBindings[kind as SharedStyleKind] = id
  }
  if (sharedStyleBindings.effects) delete tokenBindings.shadow
  if (sharedStyleBindings.color) delete tokenBindings.fill
  if (sharedStyleBindings.typography) for (const key of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing'] as const) delete tokenBindings[key]

  const propRecord = (properties ?? {}) as Record<string, unknown>
  let kinetic = source.type === 'text' ? source.kinetic : undefined
  if (source.type === 'text' && Object.hasOwn(propRecord, 'kinetic')) {
    const overrideKinetic = propRecord.kinetic as any
    if (overrideKinetic === null || overrideKinetic === undefined) {
      kinetic = undefined
    } else if (source.kinetic && overrideKinetic) {
      kinetic = { ...source.kinetic, ...overrideKinetic }
    } else {
      kinetic = overrideKinetic
    }
  }

  let variableAxes = source.type === 'text' ? source.variableAxes : undefined
  if (source.type === 'text' && Object.hasOwn(propRecord, 'variableAxes')) {
    variableAxes = propRecord.variableAxes ? { ...source.variableAxes, ...(propRecord.variableAxes as any) } : undefined
  }
  let openTypeFeatures = source.type === 'text' ? source.openTypeFeatures : undefined
  if (source.type === 'text' && Object.hasOwn(propRecord, 'openTypeFeatures')) {
    openTypeFeatures = propRecord.openTypeFeatures ? { ...source.openTypeFeatures, ...(propRecord.openTypeFeatures as any) } : undefined
  }
  let textOnPath = source.type === 'text' ? source.textOnPath : undefined
  if (source.type === 'text' && Object.hasOwn(propRecord, 'textOnPath')) {
    textOnPath = propRecord.textOnPath ? { ...source.textOnPath, ...(propRecord.textOnPath as any) } : undefined
  }

  const node = {
    ...source,
    ...(source.sharedStyleBindings || Object.keys(sharedStyleBindings).length ? { sharedStyleBindings } : {}),
    ...properties,
    ...(source.type === 'text' && (Object.hasOwn(propRecord, 'kinetic') || source.kinetic) ? { kinetic } : {}) as any,
    ...(source.type === 'text' && (Object.hasOwn(propRecord, 'variableAxes') || source.variableAxes) ? { variableAxes } : {}) as any,
    ...(source.type === 'text' && (Object.hasOwn(propRecord, 'openTypeFeatures') || source.openTypeFeatures) ? { openTypeFeatures } : {}) as any,
    ...(source.type === 'text' && (Object.hasOwn(propRecord, 'textOnPath') || source.textOnPath) ? { textOnPath } : {}) as any,
    component: link,
    tokenBindings,
    style: { ...source.style, ...style, stroke, ...(Object.hasOwn(style, 'shader') || source.style.shader ? { shader } : {}) }
  } as SceneElement
  if (!source.tokenBindings && !Object.keys(tokenBindings).length) delete (node as { tokenBindings?: unknown }).tokenBindings
  if (node.type === 'path' && Object.hasOwn(properties, 'd') && !Object.hasOwn(properties, 'nodes')) delete (node as { nodes?: unknown }).nodes
  return resolveTokenBindings(resolveSharedStyles(node, library, tokens), tokens)
}

/** Reconcile materialized instance trees, preserving IDs, overrides and unchanged references. */
export function synchronizeComponents(input: Readonly<Record<string, SceneElement>>, tokens: readonly DesignToken[], previous?: Readonly<Record<string, SceneElement>>, library: StyleLibrary = EMPTY_LIBRARY): Readonly<Record<string, SceneElement>> {
  // Prune definitions when a master layer is deleted or moved out of its subtree.
  for (const master of Object.values(input)) {
    if (master.component?.kind === 'master') {
      const link = master.component
      const subtreeIds = new Set(subtree(input, master.id).map(node => node.id))
      let nextMaster = master
      if (link.properties?.length) {
        const properties = pruneComponentProperties(link.properties, subtreeIds)
        if (!equalValue(properties, link.properties)) {
          nextMaster = { ...nextMaster, component: { ...link, properties } }
        }
      }
      if (link.variantMatrix) {
        const matrix = pruneVariantMatrix(link.variantMatrix, subtreeIds)
        if (!equalValue(matrix, link.variantMatrix)) {
          nextMaster = { ...nextMaster, component: { ...link, variantMatrix: matrix } }
        }
      }
      if (nextMaster !== master) {
        input = { ...input, [master.id]: freezeElement(nextMaster) }
      }
    }
  }
  const roots = Object.values(input).filter(node => node.component?.kind === 'instance' && node.component.instanceId === node.id)
  if (!roots.length) return input
  let elements = input
  const sourceTrees = new Map<string, SceneElement[]>()
  const put = (node: SceneElement) => {
    if (equalValue(elements[node.id], node)) return
    if (elements === input) elements = { ...input }
    ;(elements as Record<string, SceneElement>)[node.id] = freezeElement(node)
  }
  const drop = (id: string) => {
    if (elements === input) elements = { ...input }
    delete (elements as Record<string, SceneElement>)[id]
  }
  for (const root of roots) {
    const link = root.component as Extract<ComponentLink, { kind: 'instance' }>
    const master = input[link.masterId]
    const existing = subtree(input, root.id)
    if (!master || master.component?.kind !== 'master') {
      // Deleting a master retains all instances' current appearance as ordinary layers.
      for (const node of existing) { const { component, ...detached } = node; void component; put(detached) }
      continue
    }
    let sources = sourceTrees.get(master.id)
    if (!sources) { sources = subtree(input, master.id); sourceTrees.set(master.id, sources) }
    if (previous && existing.length === sources.length && sources.every(source => source === previous[source.id]) && existing.every(node => node === previous[node.id])) continue
    const definitions = master.component.properties ?? []
    const variantDims = master.component.variantMatrix?.dimensions ?? []
    const propertyValues = Object.fromEntries(
      Object.entries(link.propertyValues ?? {}).filter(([id, value]) => {
        const prop = definitions.find(property => property.id === id || property.name.toLowerCase() === id.toLowerCase())
        if (prop) return validPropertyValue(prop, value)
        const dim = variantDims.find(d => d.id === id || d.name.toLowerCase() === id.toLowerCase())
        if (dim) return typeof value === 'string' && dim.values.includes(value)
        return false
      })
    )
    const oldBySource = new Map(existing.map(node => [node.component?.kind === 'instance' ? node.component.sourceId : '', node]))
    const ids = new Map(sources.map(source => [source.id, source.id === master.id ? root.id : oldBySource.get(source.id)?.id ?? crypto.randomUUID()]))

    // Collect slot children preserved inside instance slot frames
    const slotChildrenBySource = new Map<string, SceneElement[]>()
    for (const node of existing) {
      if (node.id === root.id) continue
      const comp = node.component
      const isDirectSource = comp?.kind === 'instance' && sources.some(s => s.id === comp.sourceId)
      if (!isDirectSource && node.parentId) {
        const parentNode = existing.find(n => n.id === node.parentId)
        const sourceParentId = parentNode?.component?.kind === 'instance' ? parentNode.component.sourceId : undefined
        const sourceParent = sourceParentId ? sources.find(s => s.id === sourceParentId) : undefined
        const isSlotContainer = Boolean(
          (sourceParent && ((sourceParent as any).isSlot || (sourceParent as any).slotName)) ||
          (parentNode && ((parentNode as any).isSlot || (parentNode as any).slotName)) ||
          node.isSlotChild
        )
        if (isSlotContainer && sourceParentId) {
          const list = slotChildrenBySource.get(sourceParentId) ?? []
          list.push(node)
          slotChildrenBySource.set(sourceParentId, list)
        }
      }
    }

    for (const source of sources) {
      const old = oldBySource.get(source.id)
      const id = ids.get(source.id)!
      let component: Extract<ComponentLink, { kind: 'instance' }> = old?.component?.kind === 'instance' ? old.component : { kind: 'instance', masterId: master.id, instanceId: root.id, sourceId: source.id, overrides: {} }
      if (source.id === master.id) {
        const { activeState: _discarded, ...rest } = component
        component = {
          ...rest,
          propertyValues,
          ...(link.activeState !== undefined ? { activeState: link.activeState } : {}),
        }
      }
      const configured = resolveComponentProperties(source, definitions, propertyValues, tokens, library, link.activeState, master.component.variantMatrix)
      let childIds = source.type === 'frame' ? source.children.map(child => ids.get(child)!).filter(Boolean) : []
      if (source.type === 'frame') {
        const customSlotChildren = slotChildrenBySource.get(source.id) ?? []
        for (const slotChild of customSlotChildren) {
          childIds.push(slotChild.id)
          const updatedSlotChild = { ...slotChild, parentId: id, isSlotChild: true }
          validateElement(updatedSlotChild)
          put(updatedSlotChild)
        }
      }
      let node = applyComponentOverrides(configured, component, tokens, library)
      node = { ...node, id, parentId: source.id === master.id ? root.parentId : ids.get(source.parentId!)!, zIndex: source.id === master.id ? root.zIndex : source.zIndex,
        ...(source.id === master.id ? { x: root.x, y: root.y, rotation: root.rotation } : {}),
        ...(source.type === 'frame' ? { children: childIds } : {}),
      } as SceneElement
      validateElement(node)
      put(node)
    }
    const retained = new Set([
      ...ids.values(),
      ...Array.from(slotChildrenBySource.values()).flat().map(n => n.id),
    ])
    for (const old of existing) if (!retained.has(old.id)) drop(old.id)
  }
  return elements
}

/** Cross-reference validation runs after hierarchy validation, before accepting a project. */
export function validateComponentGraph(elements: Readonly<Record<string, SceneElement>>, tokens: readonly DesignToken[], library: StyleLibrary = EMPTY_LIBRARY): void {
  for (const node of Object.values(elements)) {
    const link = node.component
    if (link?.kind === 'master') {
      if (node.parentId && componentRoot(elements, node.parentId)) throw new Error('Nested components are not supported')
      validatePropertyTargets(node, elements, link.properties ?? [], tokens, library)
      continue
    }
    if (link?.kind === 'instance') {
      const root = elements[link.instanceId], master = elements[link.masterId], source = elements[link.sourceId]
      if (!root || root.component?.kind !== 'instance' || root.component.instanceId !== root.id || root.component.sourceId !== link.masterId || root.component.masterId !== link.masterId || master?.component?.kind !== 'master' || !source || source.type !== node.type || componentRoot(elements, source.id)?.id !== master.id) throw new Error('Missing or incompatible component source')
      if (node.id === root.id) {
        if (node.parentId && componentRoot(elements, node.parentId)) throw new Error('Nested components are not supported')
      } else {
        const parent = node.parentId ? elements[node.parentId] : undefined
        if (parent?.component?.kind !== 'instance' || parent.component.instanceId !== root.id || parent.component.sourceId !== source.parentId) throw new Error('Invalid instance hierarchy')
      }
      const definitions = master.component.properties ?? []
      const variantDims = master.component.variantMatrix?.dimensions ?? []
      if (node.id !== root.id && link.propertyValues !== undefined) throw new Error('Property values belong to the instance root')
      for (const [id, value] of Object.entries(root.component.propertyValues ?? {})) {
        const property = definitions.find(property => property.id === id || property.name.toLowerCase() === id.toLowerCase())
        const variantDim = variantDims.find(d => d.id === id || d.name.toLowerCase() === id.toLowerCase())
        if (!property && !variantDim) throw new Error('Unknown or incompatible component property value')
        if (property && !validPropertyValue(property, value)) throw new Error('Unknown or incompatible component property value')
        if (variantDim && (typeof value !== 'string' || !variantDim.values.includes(value))) throw new Error('Unknown or incompatible component property value')
      }
      const configured = resolveComponentProperties(source, definitions, root.component.propertyValues ?? {}, tokens, library, root.component.activeState, master.component.variantMatrix)
      const resolved = applyComponentOverrides(configured, link, tokens, library)
      for (const key of Object.keys(link.overrides.properties ?? {})) if (!(key in source) && key !== 'sizing' && !(source.type === 'frame' && key === 'layout') && !(source.type === 'path' && key === 'nodes') && !['isSlot', 'slotName', 'isSlotChild', 'slotId'].includes(key) && !(source.type === 'text' && ['kinetic', 'variableAxes', 'openTypeFeatures', 'fontKerning', 'opticalKerning', 'opticalMarginAlignment', 'showOpticalMetrics', 'textOnPath', 'textTransform', 'renderMode', 'renderOutlines', 'outlinePathD'].includes(key))) throw new Error('Unsupported component override')
      validateElement(resolved)
    } else if (node.parentId && componentRoot(elements, node.parentId)?.component?.kind === 'instance') {
      const parent = elements[node.parentId]
      const sourceParent = parent?.component?.kind === 'instance' ? elements[parent.component.sourceId] : undefined
      const isSlot = Boolean((parent && ((parent as any).isSlot || (parent as any).slotName)) || (sourceParent && ((sourceParent as any).isSlot || (sourceParent as any).slotName)) || node.isSlotChild)
      if (!isSlot) {
        throw new Error('Unlinked instance child')
      }
    }
  }
  for (const root of Object.values(elements).filter(node => node.component?.kind === 'instance' && node.component.instanceId === node.id)) {
    const link = root.component as Extract<ComponentLink, { kind: 'instance' }>
    const sourceIds = subtree(elements, link.masterId).map(node => node.id)
    const instanceIds = subtree(elements, root.id)
      .filter(node => !node.isSlotChild)
      .map(node => node.component?.kind === 'instance' ? node.component.sourceId : '')
    if (sourceIds.length !== instanceIds.length || new Set(instanceIds).size !== instanceIds.length || sourceIds.some(id => !instanceIds.includes(id))) throw new Error('Incomplete component instance')
  }
}

/** Compute localized scene graph property override diffs between instance and resolved master/variant */
export function getComponentOverrideDiff(
  instance: SceneElement,
  master: SceneElement,
  _tokens: readonly DesignToken[] = [],
  _library: StyleLibrary = EMPTY_LIBRARY,
  allElements?: Readonly<Record<string, SceneElement>>
): readonly OverrideDiffEntry[] {
  if (instance.component?.kind !== 'instance' || master.component?.kind !== 'master') return []
  const diffs: OverrideDiffEntry[] = []
  const { overrides, propertyValues } = instance.component
  const { properties = {}, style = {}, tokenBindings = {}, sharedStyleBindings = {} } = overrides

  const sourceLayer = (allElements && allElements[instance.component.sourceId]) ?? master
  for (const [key, val] of Object.entries(properties)) {
    const origVal = (sourceLayer as any)[key]
    const mStr = origVal !== undefined ? (typeof origVal === 'object' && origVal !== null ? JSON.stringify(origVal) : String(origVal)) : 'default'
    const oStr = typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val)
    diffs.push({
      layerId: instance.id,
      layerName: instance.name,
      channel: `properties.${key}`,
      label: key[0].toUpperCase() + key.slice(1),
      masterValue: mStr,
      overrideValue: oStr,
    })
  }

  for (const [key, val] of Object.entries(style)) {
    const origVal = (sourceLayer.style as any)?.[key]
    let mStr = origVal !== undefined ? (typeof origVal === 'object' ? JSON.stringify(origVal) : String(origVal)) : 'none'
    let oStr = typeof val === 'object' ? JSON.stringify(val) : String(val)
    if (key === 'stroke' && val) {
      oStr = (val as any).color ?? 'stroke'
      mStr = sourceLayer.style.stroke?.color ?? 'none'
    }
    diffs.push({
      layerId: instance.id,
      layerName: instance.name,
      channel: `style.${key}`,
      label: key[0].toUpperCase() + key.slice(1),
      masterValue: mStr,
      overrideValue: oStr,
    })
  }

  for (const [key, val] of Object.entries(tokenBindings)) {
    diffs.push({
      layerId: instance.id,
      layerName: instance.name,
      channel: `tokenBindings.${key}`,
      label: `Token: ${key}`,
      masterValue: sourceLayer.tokenBindings?.[key as TokenProperty] ?? 'none',
      overrideValue: val ?? 'detached',
    })
  }

  for (const [key, val] of Object.entries(sharedStyleBindings)) {
    diffs.push({
      layerId: instance.id,
      layerName: instance.name,
      channel: `sharedStyleBindings.${key}`,
      label: `Style: ${key}`,
      masterValue: sourceLayer.sharedStyleBindings?.[key as SharedStyleKind] ?? 'none',
      overrideValue: val ?? 'detached',
    })
  }

  if (propertyValues && instance.id === instance.component.instanceId) {
    for (const [propId, val] of Object.entries(propertyValues)) {
      const prop = master.component?.properties?.find(p => p.id === propId || p.name === propId || p.name.toLowerCase() === propId.toLowerCase())
      const dim = master.component?.variantMatrix?.dimensions.find(d => d.id === propId || d.name === propId || d.name.toLowerCase() === propId.toLowerCase())
      const label = prop ? prop.name : (dim ? dim.name : propId)
      const defaultVal = prop ? String(prop.defaultValue) : (dim ? dim.defaultValue : 'default')
      diffs.push({
        layerId: instance.id,
        layerName: instance.name,
        channel: `propertyValues.${propId}`,
        label: `${label} (Variant)`,
        masterValue: defaultVal,
        overrideValue: String(val),
      })
    }
  }

  return Object.freeze(diffs)
}

/** Compute strongly typed property override bindings with status flags for inspector matrix */
export function getComponentOverrideBindings(
  instance: SceneElement,
  master: SceneElement,
  tokens: readonly DesignToken[] = [],
  library: StyleLibrary = EMPTY_LIBRARY,
  allElements?: Readonly<Record<string, SceneElement>>
): readonly PropertyOverrideBinding[] {
  if (instance.component?.kind !== 'instance' || master.component?.kind !== 'master') return []
  const diffs = getComponentOverrideDiff(instance, master, tokens, library, allElements)
  const bindings: PropertyOverrideBinding[] = []

  const { overrides } = instance.component
  const { tokenBindings = {}, sharedStyleBindings = {} } = overrides

  for (const diff of diffs) {
    const channelParts = diff.channel.split('.')
    const sec = channelParts[0]
    const propKey = channelParts.slice(1).join('.')
    const tokenBindingId = sec === 'tokenBindings' ? diff.overrideValue : (tokenBindings as any)?.[propKey] ?? null
    const sharedStyleBindingId = sec === 'sharedStyleBindings' ? diff.overrideValue : (sharedStyleBindings as any)?.[propKey] ?? null
    const isSlot = diff.channel.includes('slot') || Boolean(allElements?.[diff.layerId]?.isSlot)

    bindings.push({
      id: `${diff.layerId}:${diff.channel}`,
      layerId: diff.layerId,
      layerName: diff.layerName,
      channel: diff.channel,
      label: diff.label,
      masterValue: diff.masterValue,
      overrideValue: diff.overrideValue,
      isBound: Boolean(tokenBindingId || sharedStyleBindingId || diff.channel.startsWith('propertyValues.')),
      isSlot,
      tokenBindingId,
      sharedStyleBindingId,
    })
  }

  return Object.freeze(bindings)
}

/** Extract all designated and preserved nested slot containers in a master component hierarchy */
export function getComponentSlots(
  master: SceneElement,
  allElements: Readonly<Record<string, SceneElement>>
): readonly ComponentSlotInfo[] {
  if (master.component?.kind !== 'master') return []
  const layers = subtree(allElements, master.id)
  const slots: ComponentSlotInfo[] = []

  // Check frames marked with isSlot or slotName
  for (const layer of layers) {
    if (layer.type === 'frame' && (layer.isSlot || layer.slotName)) {
      slots.push({
        id: layer.id,
        name: layer.slotName ?? layer.name,
        frameId: layer.id,
        frameName: layer.name,
        childCount: layer.children.length,
        childIds: layer.children,
        isPreserved: true,
      })
    }
  }

  // Check properties with kind: 'slot'
  if (master.component.properties) {
    for (const prop of master.component.properties) {
      if (prop.kind === 'slot') {
        const targetFrame = layers.find(l => l.id === prop.sourceId)
        if (targetFrame && targetFrame.type === 'frame' && !slots.some(s => s.frameId === targetFrame.id)) {
          slots.push({
            id: prop.id,
            name: prop.slotName ?? prop.name,
            frameId: targetFrame.id,
            frameName: targetFrame.name,
            childCount: targetFrame.children.length,
            childIds: targetFrame.children,
            isPreserved: true,
          })
        }
      }
    }
  }

  return Object.freeze(slots)
}

