import type { ComponentOverrides, ComponentProperty, ComponentPropertyValue, ComponentVariantMatrix, SceneElement, VariantDimension, VariantMatrixCombination } from './types.ts'
import type { DesignToken, StyleLibrary } from '../tokens/types.ts'
import { applyComponentOverrides, subtree, validateComponent } from './components.ts'
import { validateElement } from './elements.ts'
import { validateStateMachine } from './stateMachine.ts'

const safeId = (id: unknown): id is string => typeof id === 'string' && !!id && id.length <= 200 && !['__proto__', 'constructor', 'prototype'].includes(id)
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

export function validateVariantMatrix(matrix: ComponentVariantMatrix): void {
  if (!matrix || typeof matrix !== 'object' || Array.isArray(matrix)) throw new Error('Invalid variant matrix')
  if (!Array.isArray(matrix.dimensions) || !Array.isArray(matrix.combinations)) throw new Error('Invalid variant matrix structure')
  const dimIds = new Set<string>()
  const dimNames = new Set<string>()
  for (const dim of matrix.dimensions) {
    if (!dim || !safeId(dim.id) || typeof dim.name !== 'string' || !dim.name.trim() || dimIds.has(dim.id) || dimNames.has(dim.name.trim().toLowerCase())) {
      throw new Error('Dimension IDs and names must be unique')
    }
    dimIds.add(dim.id)
    dimNames.add(dim.name.trim().toLowerCase())
    if (!Array.isArray(dim.values) || !dim.values.length) throw new Error('Dimension must have at least one value')
    const valSet = new Set<string>()
    for (const val of dim.values) {
      if (typeof val !== 'string' || !val.trim() || valSet.has(val.trim())) throw new Error('Dimension values must be unique and non-empty')
      valSet.add(val.trim())
    }
    if (!valSet.has(dim.defaultValue)) throw new Error('Default value must be one of the dimension values')
  }
  for (const comb of matrix.combinations) {
    if (!comb || !safeId(comb.id) || !isRecord(comb.dimensions) || !isRecord(comb.layers)) {
      throw new Error('Invalid variant matrix combination')
    }
    for (const [layerId, overrides] of Object.entries(comb.layers)) {
      if (!safeId(layerId)) throw new Error('Invalid layer ID in variant matrix combination')
      validateComponent({ kind: 'instance', masterId: layerId, sourceId: layerId, instanceId: layerId, overrides: overrides as ComponentOverrides })
    }
  }
}

export function pruneVariantMatrix(matrix: ComponentVariantMatrix, sources: ReadonlySet<string>): ComponentVariantMatrix {
  return {
    ...matrix,
    combinations: matrix.combinations.map(comb => ({
      ...comb,
      layers: Object.fromEntries(Object.entries(comb.layers).filter(([id]) => sources.has(id))),
    })),
  }
}

export function createVariantPresetDimensions(preset: 'size' | 'state' | 'theme' | 'full-matrix'): { dimensions: VariantDimension[]; combinations?: VariantMatrixCombination[] } {
  if (preset === 'size') {
    return {
      dimensions: [
        { id: crypto.randomUUID(), name: 'Size', values: ['sm', 'md', 'lg'], defaultValue: 'md' },
      ],
    }
  }
  if (preset === 'state') {
    return {
      dimensions: [
        { id: crypto.randomUUID(), name: 'State', values: ['default', 'hover', 'pressed', 'active', 'disabled'], defaultValue: 'default' },
      ],
    }
  }
  if (preset === 'theme') {
    return {
      dimensions: [
        { id: crypto.randomUUID(), name: 'Theme', values: ['paper', 'dark', 'accent', 'contrast'], defaultValue: 'paper' },
      ],
    }
  }
  return {
    dimensions: [
      { id: crypto.randomUUID(), name: 'Size', values: ['sm', 'md', 'lg'], defaultValue: 'md' },
      { id: crypto.randomUUID(), name: 'State', values: ['default', 'hover', 'active'], defaultValue: 'default' },
      { id: crypto.randomUUID(), name: 'Theme', values: ['paper', 'dark', 'accent'], defaultValue: 'paper' },
    ],
  }
}

export function getEffectiveVariantDimensions(master: SceneElement): readonly VariantDimension[] {
  if (master.component?.kind !== 'master') return []
  const dimensions: VariantDimension[] = []
  const seenNames = new Set<string>()

  if (master.component.variantMatrix?.dimensions) {
    for (const dim of master.component.variantMatrix.dimensions) {
      dimensions.push(dim)
      seenNames.add(dim.name.toLowerCase())
    }
  }

  if (master.component.properties) {
    for (const prop of master.component.properties) {
      if (prop.kind === 'variant' && !seenNames.has(prop.name.toLowerCase())) {
        dimensions.push({
          id: prop.id,
          name: prop.name,
          values: prop.options.map(o => o.value),
          defaultValue: prop.defaultValue,
        })
        seenNames.add(prop.name.toLowerCase())
      }
    }
  }

  return Object.freeze(dimensions)
}

export function validateComponentProperties(properties: readonly ComponentProperty[]): void {
  if (!Array.isArray(properties) || properties.length > 100) throw new Error('Invalid component properties')
  const ids = new Set<string>(), names = new Set<string>()
  for (const property of properties) {
    if (!property || !safeId(property.id) || typeof property.name !== 'string' || !property.name.trim() || property.name.length > 100 || ids.has(property.id) || names.has(property.name.trim().toLowerCase())) throw new Error('Component property names must be unique')
    ids.add(property.id); names.add(property.name.trim().toLowerCase())
    if (property.kind === 'variant') {
      if (!Array.isArray(property.options) || !property.options.length || property.options.length > 100) throw new Error('A variant needs at least one option')
      const values = new Set<string>()
      for (const option of property.options) {
        if (!option || typeof option.value !== 'string' || !option.value.trim() || option.value.length > 100 || values.has(option.value) || !isRecord(option.layers)) throw new Error('Invalid variant option')
        values.add(option.value)
        for (const [id, overrides] of Object.entries(option.layers)) {
          if (!safeId(id)) throw new Error('Invalid variant layer')
          validateComponent({ kind: 'instance', masterId: id, sourceId: id, instanceId: id, overrides: overrides as ComponentOverrides })
        }
      }
      if (!values.has(property.defaultValue)) throw new Error('Choose a valid default variant')
      if (property.stateMachine !== undefined) {
        validateStateMachine(property.stateMachine, Array.from(values))
      }
    } else if (property.kind === 'boolean') {
      if (!safeId(property.sourceId) || typeof property.defaultValue !== 'boolean') throw new Error('Invalid component property')
      if (property.targetProperty && !['visible', 'kinetic.enabled', 'clipContent', 'shader.animated', 'locked'].includes(property.targetProperty)) throw new Error('Invalid boolean target property')
    } else if (property.kind === 'text') {
      if (!safeId(property.sourceId) || typeof property.defaultValue !== 'string') throw new Error('Invalid component property')
      if (property.targetProperty && !['text', 'fontFamily', 'src', 'alt', 'textTransform'].includes(property.targetProperty)) throw new Error('Invalid text target property')
    } else if (property.kind === 'color') {
      if (!safeId(property.sourceId) || typeof property.defaultValue !== 'string') throw new Error('Invalid component property')
      if (property.targetProperty && !['fill', 'stroke', 'shader', 'shader.colorFront', 'shader.colorMid', 'shader.colorBack', 'shadow'].includes(property.targetProperty)) throw new Error('Invalid color target property')
    } else if (property.kind === 'number') {
      if (!safeId(property.sourceId) || typeof property.defaultValue !== 'number' || !Number.isFinite(property.defaultValue)) throw new Error('Invalid component property')
    } else if (property.kind === 'kinetic') {
      if (!safeId(property.sourceId) || !property.targetProperty) throw new Error('Invalid component property')
      const validTargets = ['enabled', 'amplitude', 'rotation', 'duration', 'stagger', 'waveShape', 'staggerMode', 'weightModulation', 'slantModulation', 'scaleModulation', 'playing', 'phase', 'horizontalAmplitude', 'widthModulation', 'opticalSizeModulation']
      if (!validTargets.includes(property.targetProperty)) throw new Error('Invalid kinetic target property')
    } else if (property.kind === 'shader') {
      if (!safeId(property.sourceId) || !property.targetProperty) throw new Error('Invalid component property')
      const validTargets = ['speed', 'scale', 'rotation', 'frequency', 'octaves', 'turbulence', 'displacement', 'viewMode', 'blendMode', 'lacunarity', 'persistence', 'normalPerturbation', 'grainOverlay', 'chromaticAberration', 'warpModulation', 'fluidAdvection', 'fluidViscosity', 'noiseType']
      if (!validTargets.includes(property.targetProperty)) throw new Error('Invalid shader target property')
    } else if (property.kind === 'slot') {
      if (!safeId(property.sourceId)) throw new Error('Invalid component property')
    } else {
      throw new Error('Invalid component property')
    }
  }
}

export function validPropertyValue(property: ComponentProperty, value: ComponentPropertyValue): boolean {
  if (property.kind === 'boolean') {
    return typeof value === 'boolean'
  }
  if (property.kind === 'slot') {
    return typeof value === 'string' || typeof value === 'boolean'
  }
  if (property.kind === 'variant') {
    return typeof value === 'string' && (
      property.options.some(option => option.value === value) ||
      Boolean(property.stateMachine?.states.includes(value))
    )
  }
  if (property.kind === 'text' || property.kind === 'color') {
    return typeof value === 'string'
  }
  if (property.kind === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return false
    if (property.min !== undefined && value < property.min) return false
    if (property.max !== undefined && value > property.max) return false
    return true
  }
  if (property.kind === 'kinetic') {
    if (property.targetProperty === 'enabled' || property.targetProperty === 'playing') return typeof value === 'boolean'
    if (property.targetProperty === 'waveShape') return typeof value === 'string' && ['triangle', 'sine', 'bounce', 'spring'].includes(value)
    if (property.targetProperty === 'staggerMode') return typeof value === 'string' && ['cascade', 'wave', 'center-out', 'random', 'elastic'].includes(value)
    return typeof value === 'number' && Number.isFinite(value)
  }
  if (property.kind === 'shader') {
    if (property.targetProperty === 'blendMode' || property.targetProperty === 'viewMode' || property.targetProperty === 'noiseType') return typeof value === 'string'
    return typeof value === 'number' && Number.isFinite(value)
  }
  return false
}

/** Apply a single property value directly to an element without mutating component metadata. */
export function applyPropertyValueToElement(
  source: SceneElement,
  property: ComponentProperty,
  value: ComponentPropertyValue
): SceneElement {
  let updated = { ...source }
  if (property.kind === 'variant') {
    const option = property.options.find(opt => opt.value === value)
    if (option && option.layers[source.id]) {
      const overrides = option.layers[source.id]
      if (overrides.properties) {
        for (const [k, v] of Object.entries(overrides.properties)) {
          if (k === 'kinetic' && updated.type === 'text') {
            updated = { ...updated, kinetic: { ...(updated.kinetic ?? {}), ...(v as Record<string, unknown>) } as any }
          } else {
            (updated as any)[k] = v
          }
        }
      }
      if (overrides.style) {
        updated = {
          ...updated,
          style: {
            ...updated.style,
            ...overrides.style,
            ...(overrides.style.stroke ? { stroke: { ...(updated.style.stroke ?? { color: '#080808', width: 1, dash: [] }), ...overrides.style.stroke } } : {}),
            ...(overrides.style.shader ? { shader: { ...(updated.style.shader ?? {}), ...overrides.style.shader } } : {}),
          } as any,
        }
      }
    }
    return updated
  }
  if (property.kind === 'text') {
    const textVal = String(value)
    if (property.targetProperty === 'fontFamily' && updated.type === 'text') {
      updated = { ...updated, fontFamily: textVal }
    } else if (property.targetProperty === 'src' && updated.type === 'image') {
      updated = { ...updated, src: textVal }
    } else if (property.targetProperty === 'alt' && updated.type === 'image') {
      updated = { ...updated, alt: textVal }
    } else if (property.targetProperty === 'textTransform' && updated.type === 'text') {
      updated = { ...updated, textTransform: textVal as any }
    } else if (updated.type === 'text') {
      updated = { ...updated, text: textVal }
    }
  } else if (property.kind === 'boolean') {
    const boolVal = Boolean(value)
    if (property.targetProperty === 'clipContent' && updated.type === 'frame') {
      updated = { ...updated, clipContent: boolVal }
    } else if (property.targetProperty === 'kinetic.enabled' && updated.type === 'text') {
      const current = updated.kinetic ?? { enabled: true, playing: true, amplitude: 16, rotation: 0, duration: 800, stagger: 40, phase: 0 }
      updated = { ...updated, kinetic: { ...current, enabled: boolVal } }
    } else if (property.targetProperty === 'shader.animated' && updated.style.shader) {
      updated = { ...updated, style: { ...updated.style, shader: { ...updated.style.shader, animated: boolVal } } }
    } else if (property.targetProperty === 'locked') {
      updated = { ...updated, locked: boolVal }
    } else {
      updated = { ...updated, visible: boolVal }
    }
  } else if (property.kind === 'color') {
    const colorVal = String(value)
    if (property.targetProperty === 'stroke') {
      updated = { ...updated, style: { ...updated.style, stroke: { color: colorVal, width: updated.style.stroke?.width ?? 1, dash: updated.style.stroke?.dash ?? [] } } }
    } else if (property.targetProperty === 'shadow') {
      updated = { ...updated, style: { ...updated.style, shadow: { color: colorVal, x: updated.style.shadow?.x ?? 0, y: updated.style.shadow?.y ?? 4, blur: updated.style.shadow?.blur ?? 8 } } }
    } else if (property.targetProperty && (property.targetProperty.startsWith('shader.') || ['colorFront', 'colorMid', 'colorBack'].includes(property.targetProperty))) {
      if (updated.style.shader) {
        const paramKey = property.targetProperty.replace('shader.', '')
        updated = { ...updated, style: { ...updated.style, shader: { ...updated.style.shader, params: { ...updated.style.shader.params, [paramKey]: colorVal } as any } } }
      }
    } else if (property.targetProperty === 'shader') {
      if (updated.style.shader) {
        updated = { ...updated, style: { ...updated.style, shader: { ...updated.style.shader, params: { ...updated.style.shader.params, color: colorVal, tint: colorVal } as any } } }
      }
    } else {
      updated = { ...updated, style: { ...updated.style, fill: colorVal } }
    }
  } else if (property.kind === 'number') {
    const numVal = Number(value)
    if (Number.isFinite(numVal)) {
      const target = property.targetProperty ?? 'opacity'
      if (target === 'opacity') {
        updated = { ...updated, style: { ...updated.style, opacity: numVal } }
      } else if (target === 'cornerRadius' && 'cornerRadius' in updated) {
        updated = { ...updated, cornerRadius: numVal }
      } else if (target === 'width') {
        updated = { ...updated, width: numVal }
      } else if (target === 'height') {
        updated = { ...updated, height: numVal }
      } else if (target === 'rotation') {
        updated = { ...updated, rotation: numVal }
      } else if (target === 'strokeWidth') {
        updated = { ...updated, style: { ...updated.style, stroke: { color: updated.style.stroke?.color ?? '#080808', width: numVal, dash: updated.style.stroke?.dash ?? [] } } }
      } else if (target === 'fontSize' && updated.type === 'text') {
        updated = { ...updated, fontSize: numVal }
      } else if (target === 'fontWeight' && updated.type === 'text') {
        updated = { ...updated, fontWeight: numVal }
      } else if (target === 'letterSpacing' && updated.type === 'text') {
        updated = { ...updated, letterSpacing: numVal }
      } else if (target === 'lineHeight' && updated.type === 'text') {
        updated = { ...updated, lineHeight: numVal }
      } else if (target === 'layout.gap' && updated.type === 'frame' && updated.layout) {
        updated = { ...updated, layout: { ...updated.layout, gap: numVal } }
      } else if (target.startsWith('kinetic.') && updated.type === 'text') {
        const kProp = target.replace('kinetic.', '')
        const currentKinetic = updated.kinetic ?? { enabled: true, playing: true, amplitude: 16, rotation: 0, duration: 800, stagger: 40, phase: 0, staggerMode: 'cascade', waveShape: 'sine' }
        updated = { ...updated, kinetic: { ...currentKinetic, [kProp]: numVal } }
      } else if (target.startsWith('shader.') && updated.style.shader) {
        const sProp = target.replace('shader.', '')
        if (['speed', 'scale', 'rotation'].includes(sProp)) {
          updated = { ...updated, style: { ...updated.style, shader: { ...updated.style.shader, [sProp]: numVal } } }
        } else if (updated.style.shader.mesh && sProp in updated.style.shader.mesh) {
          updated = { ...updated, style: { ...updated.style, shader: { ...updated.style.shader, mesh: { ...updated.style.shader.mesh, [sProp]: numVal } } } }
        } else if (updated.style.shader.params) {
          updated = { ...updated, style: { ...updated.style, shader: { ...updated.style.shader, params: { ...updated.style.shader.params, [sProp]: numVal } as any } } }
        }
      }
    }
  } else if (property.kind === 'kinetic' && updated.type === 'text') {
    const currentKinetic = updated.kinetic ?? {
      enabled: true,
      playing: true,
      amplitude: 16,
      rotation: 0,
      duration: 800,
      stagger: 40,
      phase: 0,
      staggerMode: 'cascade',
      waveShape: 'sine',
    }
    updated = { ...updated, kinetic: { ...currentKinetic, [property.targetProperty]: value } }
  } else if (property.kind === 'shader' && updated.style.shader) {
    const prop = property.targetProperty
    const existingShader = updated.style.shader
    if (['speed', 'scale', 'rotation'].includes(prop)) {
      updated = { ...updated, style: { ...updated.style, shader: { ...existingShader, [prop]: typeof value === 'number' ? value : Number(value) } } }
    } else if (prop === 'blendMode') {
      updated = { ...updated, style: { ...updated.style, shader: { ...existingShader, composite: { blendMode: value as any, opacity: existingShader.composite?.opacity ?? 1 } } } }
    } else {
      const meshKeys = new Set(['frequency', 'turbulence', 'chromaticAberration', 'lacunarity', 'octaves', 'normalPerturbation', 'grainDisplacement', 'grainOverlay', 'fluidAdvection', 'fluidViscosity', 'distortionMode', 'warpModulation', 'noiseType', 'viewMode'])
      let nextMesh = existingShader.mesh
      if (nextMesh && (prop in nextMesh || meshKeys.has(prop))) {
        nextMesh = { ...nextMesh, [prop]: value }
      }
      let nextParams = existingShader.params
      if (existingShader.params && (prop in existingShader.params || !nextMesh || !meshKeys.has(prop))) {
        nextParams = { ...existingShader.params, [prop]: value } as any
      }
      updated = { ...updated, style: { ...updated.style, shader: { ...existingShader, params: nextParams, ...(nextMesh ? { mesh: nextMesh } : {}) } as any } }
    }
  } else if (property.kind === 'slot') {
    if (updated.type === 'frame') {
      updated = { ...updated, isSlot: true, ...(property.slotName ? { slotName: property.slotName } : {}) }
    }
  }
  return updated
}

/** Variants compose first; slots then win over variants, and local layer edits win last. */
export function resolveComponentProperties(
  source: SceneElement,
  properties: readonly ComponentProperty[],
  values: Readonly<Record<string, ComponentPropertyValue>>,
  tokens: readonly DesignToken[],
  library: StyleLibrary,
  activeState?: string,
  variantMatrix?: ComponentVariantMatrix
): SceneElement {
  let next = source
  const apply = (overrides: ComponentOverrides) => {
    next = applyComponentOverrides(next, { kind: 'instance', masterId: source.id, sourceId: source.id, instanceId: source.id, overrides }, tokens, library)
  }
  for (const property of properties) {
    if (property.kind !== 'variant') continue
    let value = values[property.id] ?? property.defaultValue
    if (activeState && (property.options.some(option => option.value === activeState) || property.stateMachine?.states.includes(activeState))) {
      value = activeState
    }
    const overrides = property.options.find(option => option.value === value)?.layers[source.id]
    if (overrides) apply(overrides)
  }

  // Compound multi-dimensional variant matrix combination resolution
  if (variantMatrix && variantMatrix.combinations.length > 0) {
    const activeDimensionValues: Record<string, string> = {}
    for (const dim of variantMatrix.dimensions) {
      const matchingProp = properties.find(p => p.id === dim.id || p.name.trim().toLowerCase() === dim.name.trim().toLowerCase())
      let val: string | undefined = undefined
      if (matchingProp && Object.hasOwn(values, matchingProp.id)) {
        val = String(values[matchingProp.id])
      } else if (Object.hasOwn(values, dim.id)) {
        val = String(values[dim.id])
      } else if (Object.hasOwn(values, dim.name)) {
        val = String(values[dim.name])
      }
      if (!val && dim.name.toLowerCase() === 'state' && activeState) {
        val = activeState
      }
      const resolvedVal = val ?? dim.defaultValue
      activeDimensionValues[dim.name] = resolvedVal
      activeDimensionValues[dim.id] = resolvedVal
      activeDimensionValues[dim.name.toLowerCase()] = resolvedVal
    }

    const matchingCombinations: { comb: VariantMatrixCombination; score: number }[] = []

    for (const comb of variantMatrix.combinations) {
      const combDims = Object.entries(comb.dimensions)
      if (combDims.length === 0) continue
      let matches = 0
      let failed = false
      for (const [dimKey, dimVal] of combDims) {
        const currentVal = activeDimensionValues[dimKey] ?? activeDimensionValues[dimKey.toLowerCase()]
        if (currentVal === dimVal) {
          matches++
        } else {
          failed = true
          break
        }
      }
      if (!failed && matches > 0) {
        matchingCombinations.push({ comb, score: matches })
      }
    }

    matchingCombinations.sort((a, b) => a.score - b.score)
    for (const { comb } of matchingCombinations) {
      if (comb.layers[source.id]) {
        apply(comb.layers[source.id])
      }
    }
  }

  for (const property of properties) {
    if (property.kind === 'variant' || property.sourceId !== source.id) continue
    const value = values[property.id] ?? property.defaultValue
    next = applyPropertyValueToElement(next, property, value)
  }
  return next
}

/** Validate every option, including ones that no instance has selected yet. */
export function validatePropertyTargets(master: SceneElement, elements: Readonly<Record<string, SceneElement>>, properties: readonly ComponentProperty[], tokens: readonly DesignToken[], library: StyleLibrary): void {
  validateComponentProperties(properties)
  const sources = new Map(subtree(elements, master.id).map(node => [node.id, node]))
  for (const property of properties) {
    if (property.kind !== 'variant') {
      const source = sources.get(property.sourceId)
      if (!source) throw new Error('Choose a compatible layer inside this master')
      if (property.kind === 'text' && source.type !== 'text' && property.targetProperty !== 'src' && property.targetProperty !== 'alt') throw new Error('Choose a text layer for a text slot')
      if (property.kind === 'text' && (property.targetProperty === 'src' || property.targetProperty === 'alt') && source.type !== 'image') throw new Error('Choose an image layer for an image slot')
      if (property.kind === 'kinetic' && source.type !== 'text') throw new Error('Choose a text layer for kinetic typography')
      if (property.kind === 'shader' && !source.style.shader) throw new Error('Choose a layer with a shader for shader properties')
      if (property.kind === 'slot' && source.type !== 'frame') throw new Error('Choose a frame layer for a nested slot')
    } else for (const option of property.options) for (const [id, overrides] of Object.entries(option.layers)) {
      const source = sources.get(id)
      if (!source) throw new Error('Variant layer is outside this master')
      for (const key of Object.keys(overrides.properties ?? {})) {
        if (!(key in source) && key !== 'sizing' && !(source.type === 'frame' && key === 'layout') && !(source.type === 'path' && key === 'nodes') && !(source.type === 'text' && ['kinetic', 'variableAxes', 'openTypeFeatures', 'fontKerning', 'opticalKerning', 'opticalMarginAlignment', 'showOpticalMetrics', 'textOnPath', 'textTransform', 'renderMode', 'renderOutlines', 'outlinePathD'].includes(key))) {
          throw new Error('Unsupported variant override')
        }
      }
      validateElement(applyComponentOverrides(source, { kind: 'instance', masterId: master.id, sourceId: id, instanceId: master.id, overrides }, tokens, library))
    }
  }
}

/** Structural edits release slots for deleted layers and discard orphaned variant patches. */
export function pruneComponentProperties(properties: readonly ComponentProperty[], sources: ReadonlySet<string>): readonly ComponentProperty[] {
  if (properties.every(property => property.kind === 'variant' ? property.options.every(option => Object.keys(option.layers).every(id => sources.has(id))) : sources.has(property.sourceId))) return properties
  return properties.flatMap<ComponentProperty>(property => {
    if (property.kind !== 'variant') return sources.has(property.sourceId) ? [property] : []
    return [{ ...property, options: property.options.map(option => ({ ...option, layers: Object.fromEntries(Object.entries(option.layers).filter(([id]) => sources.has(id))) })) }]
  })
}

/** Deleting a resource freezes its current appearance in every saved variant. */
export function releaseComponentResources(master: SceneElement, elements: Readonly<Record<string, SceneElement>>, tokens: readonly DesignToken[], library: StyleLibrary, removed: ReadonlySet<string>, resource: 'tokens' | 'styles'): SceneElement {
  if (master.component?.kind !== 'master' || !master.component.properties?.length) return master
  let changed = false
  const properties = master.component.properties.map(property => property.kind !== 'variant' ? property : { ...property, options: property.options.map(option => ({ ...option, layers: Object.fromEntries(Object.entries(option.layers).map(([id, overrides]) => {
    const hasToken = Object.values(overrides.tokenBindings ?? {}).some(id => id && removed.has(id)) || overrides.style?.effects?.some(effect => effect.type !== 'layer-blur' && effect.colorTokenId && removed.has(effect.colorTokenId))
    const hasStyle = Object.values(overrides.sharedStyleBindings ?? {}).some(id => id && removed.has(id))
    if (!(resource === 'tokens' ? hasToken : hasStyle)) return [id, overrides]
    changed = true
    const resolved = applyComponentOverrides(elements[id], { kind: 'instance', masterId: master.id, sourceId: id, instanceId: master.id, overrides }, tokens, library)
    const style = { ...overrides.style }, props = { ...overrides.properties }, tokenBindings = { ...overrides.tokenBindings }, sharedStyleBindings = { ...overrides.sharedStyleBindings }
    if (resource === 'tokens') {
      for (const [key, tokenId] of Object.entries(tokenBindings)) if (tokenId && removed.has(tokenId)) {
        Object.assign(tokenBindings, { [key]: null })
        if (key === 'fill') style.fill = resolved.style.fill
        else if (key === 'stroke') style.stroke = resolved.style.stroke
        else if (key === 'shadow') style.shadow = resolved.style.shadow
        else Object.assign(props, { [key]: resolved[key as keyof SceneElement] })
      }
      if (style.effects) style.effects = style.effects.map(effect => {
        if (effect.type === 'layer-blur' || !effect.colorTokenId || !removed.has(effect.colorTokenId)) return effect
        const { colorTokenId, ...literal } = effect
        return { ...literal, color: tokens.find(token => token.id === colorTokenId)!.value as string }
      })
    } else for (const [kind, styleId] of Object.entries(sharedStyleBindings)) if (styleId && removed.has(styleId)) {
      Object.assign(sharedStyleBindings, { [kind]: null })
      if (kind === 'color') style.fill = resolved.style.fill
      if (kind === 'effects') { style.effects = resolved.style.effects; style.shadow = resolved.style.shadow }
      if (kind === 'typography' && resolved.type === 'text') Object.assign(props, { fontFamily: resolved.fontFamily, fontSize: resolved.fontSize, fontWeight: resolved.fontWeight, lineHeight: resolved.lineHeight, letterSpacing: resolved.letterSpacing, textAlign: resolved.textAlign })
    }
    return [id, { ...overrides, properties: props, style, tokenBindings, sharedStyleBindings }]
  })) })) })
  return changed ? { ...master, component: { ...master.component, properties } } : master
}
