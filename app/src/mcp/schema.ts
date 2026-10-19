import { TOKEN_META } from '../tokens/model.ts'
import { motionControls, shaderCatalog, shaderKinds } from '../shaders/catalog.ts'
import type { ShaderControl } from '../shaders/types.ts'
import { grainBlendModes, meshDistortionModes, meshInterpolationModes, noiseGenerators, shaderBlendModes } from '../shaders/types.ts'
import { modulatorWaveforms, pipelinePassTypes } from '../shaders/pipeline/types.ts'
import { audioSignals } from '../shaders/audio/types.ts'
import { postProcessDefinitions, MAX_POST_PROCESS_PASSES } from '../canvas/postprocessing/model.ts'

/** The small JSON Schema vocabulary used by Paper's agent-facing contract. */
export interface JsonSchema {
  readonly type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null'
  readonly description?: string
  readonly properties?: Readonly<Record<string, JsonSchema>>
  readonly required?: readonly string[]
  readonly additionalProperties?: boolean | JsonSchema
  readonly items?: JsonSchema
  readonly anyOf?: readonly JsonSchema[]
  readonly enum?: readonly unknown[]
  readonly minimum?: number
  readonly exclusiveMinimum?: number
  readonly maximum?: number
  readonly minLength?: number
  readonly maxLength?: number
  readonly minItems?: number
  readonly maxItems?: number
  readonly pattern?: string
}

const str = (description?: string): JsonSchema => ({ type: 'string', minLength: 1, description })
const num: JsonSchema = { type: 'number' }
const positive: JsonSchema = { type: 'number', exclusiveMinimum: 0 }
const nonnegative: JsonSchema = { type: 'number', minimum: 0 }
const flag: JsonSchema = { type: 'boolean' }
const nullable = (schema: JsonSchema): JsonSchema => ({ anyOf: [schema, { type: 'null' }] })
const object = (properties: Record<string, JsonSchema>, required: readonly string[] = []): JsonSchema => ({ type: 'object', properties, required, additionalProperties: false })
const list = (items: JsonSchema): JsonSchema => ({ type: 'array', items })

function controlSchema(control: ShaderControl): JsonSchema {
  if (control.type === 'number') return { type: control.integer ? 'integer' : 'number', minimum: control.min, maximum: control.max }
  if (control.type === 'select') return { type: 'string', enum: control.options }
  const color: JsonSchema = { type: 'string', pattern: '^#[\\da-fA-F]{6}([\\da-fA-F]{2})?$' }
  if (control.type === 'color') return color
  if (control.type === 'palette') return { ...list(color), minItems: 2, maxItems: control.max }
  return str('Image URL or data URI. Relative paths are resolved by the Paper editor.')
}

const motionProperties: Record<string, JsonSchema> = {
  animated: flag,
  ...Object.fromEntries(motionControls.map(control => [control.key, controlSchema(control)])),
}
const unitInterval: JsonSchema = { type: 'number', minimum: 0, maximum: 1 }
const meshProperties = {
  anchors: { ...list(object({ x: unitInterval, y: unitInterval, radius: { type: 'number', minimum: .1, maximum: 2 }, alpha: unitInterval, tx: num, ty: num, tension: { type: 'number', minimum: 0, maximum: 5 } }, ['x', 'y', 'radius'])), minItems: 2, maxItems: 10 },
  turbulence: unitInterval,
  frequency: { type: 'number', minimum: 1, maximum: 12 } as JsonSchema,
  chromaticAberration: unitInterval,
  grainBlend: { type: 'string', enum: grainBlendModes } as JsonSchema,
  interpolation: { type: 'string', enum: meshInterpolationModes } as JsonSchema,
  warpModulation: unitInterval,
  noiseType: { type: 'string', enum: noiseGenerators } as JsonSchema,
  lacunarity: { type: 'number', minimum: 1, maximum: 5 } as JsonSchema,
  octaves: { type: 'integer', minimum: 1, maximum: 6 } as JsonSchema,
  normalPerturbation: unitInterval,
  grainDisplacement: unitInterval,
  fluidAdvection: unitInterval,
  fluidViscosity: unitInterval,
  distortionMode: { type: 'string', enum: meshDistortionModes } as JsonSchema,
  grid: { type: 'object', additionalProperties: true } as JsonSchema,
  viewMode: { type: 'string', enum: ['shaded', 'normal-map', 'displacement'] } as JsonSchema,
}
const pipelinePassProperties = {
  id: str(),
  type: { type: 'string' as const, enum: pipelinePassTypes } as JsonSchema,
  name: str(),
  enabled: flag,
  blendMode: { type: 'string' as const, enum: shaderBlendModes } as JsonSchema,
  opacity: unitInterval,
  params: { type: 'object' as const, additionalProperties: true } as JsonSchema,
}
const pipelineModulatorProperties = {
  source: { type: 'string' as const, enum: ['lfo', ...audioSignals] } as JsonSchema,
  id: str(),
  name: str(),
  targetPassId: str(),
  targetParam: str(),
  waveform: { type: 'string' as const, enum: modulatorWaveforms } as JsonSchema,
  frequency: { type: 'number' as const, minimum: 0.001, maximum: 20 } as JsonSchema,
  amplitude: unitInterval,
  offset: num,
  enabled: flag,
}
const pipelineProperties = {
  version: { type: 'integer' as const, enum: [1] } as JsonSchema,
  name: str(),
  preset: str(),
  passes: list(object(pipelinePassProperties, ['id', 'type', 'name', 'enabled', 'blendMode', 'opacity', 'params'])),
  modulators: list(object(pipelineModulatorProperties, ['id', 'name', 'targetPassId', 'targetParam', 'waveform', 'frequency', 'amplitude', 'offset', 'enabled'])),
}
const gradientStop = object({ id: str(), offset: unitInterval, color: str(), opacity: { type: 'number', minimum: 0, maximum: 1 } }, ['id', 'offset', 'color'])
const gradientProperties = {
  type: { type: 'string' as const, enum: ['linear', 'radial', 'angular'] } as JsonSchema,
  stops: list(gradientStop),
  angle: num,
  origin: object({ x: num, y: num }, ['x', 'y']),
  focalLength: num,
  spread: num,
  dither: num,
  smoothness: num,
  linkToShader: flag,
  enabled: flag,
}
export const shaderSchema: JsonSchema = {
  anyOf: shaderKinds.map(kind => {
    const params = Object.fromEntries(shaderCatalog[kind].controls.map(control => [control.key, controlSchema(control)]))
    return object({
      kind: { type: 'string', enum: [kind] },
      params: object(params, Object.keys(params)),
      composite: object({ blendMode: { type: 'string', enum: shaderBlendModes }, opacity: { type: 'number', minimum: 0, maximum: 1 } }, ['blendMode', 'opacity']),
      postProcessing: object({
        version: { type: 'integer', enum: [1] }, enabled: flag, preset: str(),
        passes: { type: 'array', maxItems: MAX_POST_PROCESS_PASSES, items: { anyOf: Object.entries(postProcessDefinitions).map(([type, definition]) => {
          const params = Object.fromEntries(Object.entries(definition.controls).map(([key, control]): [string, JsonSchema] => [key,
            control.kind === 'number' ? { type: 'number', minimum: control.min, maximum: control.max }
              : control.kind === 'boolean' ? flag
              : control.kind === 'select' ? { type: 'string', enum: [...control.options] }
              : { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' }]))
          return object({ id: str(), type: { type: 'string', enum: [type] }, name: str(), enabled: flag, opacity: { type: 'number', minimum: 0, maximum: 1 }, blendMode: { type: 'string', enum: ['normal', 'screen', 'multiply', 'overlay'] }, params: object(params, Object.keys(params)) }, ['id', 'type', 'name', 'enabled', 'opacity', 'blendMode', 'params'])
        }) } },
      }, ['version', 'enabled', 'preset', 'passes']),
      ...(kind === 'mesh-gradient' ? { mesh: object(meshProperties, ['anchors', 'turbulence', 'frequency', 'chromaticAberration', 'grainBlend']) } : {}),
      ...(kind === 'multi-pass' ? { pipeline: object(pipelineProperties, Object.keys(pipelineProperties)) } : {}),
      ...(kind === 'multi-stop-gradient' ? { gradient: object(gradientProperties, ['type', 'stops', 'angle', 'origin']) } : {}),
      ...motionProperties,
    }, ['kind', 'params', ...Object.keys(motionProperties)])
  }),
}
const stroke = object({ color: str(), width: nonnegative, dash: list(nonnegative) }, ['color', 'width', 'dash'])
const shadow = object({ color: str(), x: num, y: num, blur: nonnegative }, ['color', 'x', 'y', 'blur'])
const effectBlur: JsonSchema = { type: 'number', minimum: 0, maximum: 500 }
const effectOffset: JsonSchema = { type: 'number', minimum: -10000, maximum: 10000 }
export const effectSchema: JsonSchema = { anyOf: [
  object({ id: str(), enabled: flag, type: { type: 'string', enum: ['layer-blur'] }, blur: effectBlur }, ['id', 'enabled', 'type', 'blur']),
  object({ id: str(), enabled: flag, type: { type: 'string', enum: ['drop-shadow', 'inner-shadow'] }, color: str(), colorTokenId: str(), x: effectOffset, y: effectOffset, spread: effectOffset, blur: effectBlur }, ['id', 'enabled', 'type', 'color', 'x', 'y', 'spread', 'blur']),
] }
const effects: JsonSchema = { ...list(effectSchema), maxItems: 32 }
const styleProperties = { fill: nullable({ type: 'string' }), opacity: { type: 'number', minimum: 0, maximum: 1 } as JsonSchema, stroke: nullable(stroke), shadow: nullable(shadow), shader: nullable(shaderSchema), effects }
const style = object(styleProperties)
const geometry = { x: num, y: num, width: positive, height: positive, rotation: num }
const sizingRule: JsonSchema = { type: 'string', enum: ['fixed', 'hug', 'fill'] }
const sizing = object({ width: sizingRule, height: sizingRule, flexGrow: positive, minWidth: nonnegative, maxWidth: { type: 'number', minimum: .01 }, minHeight: nonnegative, maxHeight: { type: 'number', minimum: .01 } }, ['width', 'height'])
const layout = nullable(object({
  direction: { type: 'string', enum: ['horizontal', 'vertical'] }, gap: nonnegative,
  wrap: { type: 'string', enum: ['nowrap', 'wrap', 'wrap-reverse'] },
  alignContent: { type: 'string', enum: ['start', 'center', 'end', 'space-between', 'stretch'] },
  padding: object({ top: nonnegative, right: nonnegative, bottom: nonnegative, left: nonnegative }, ['top', 'right', 'bottom', 'left']),
  justify: { type: 'string', enum: ['start', 'center', 'end', 'space-between'] }, align: { type: 'string', enum: ['start', 'center', 'end'] },
}, ['direction', 'gap', 'padding', 'justify', 'align']))
const identity = { id: str(), name: str(), parentId: nullable(str()), zIndex: { type: 'integer', minimum: 0 } as JsonSchema, visible: flag, locked: flag }
const specific: Record<string, Record<string, JsonSchema>> = {
  frame: { children: list(str()), clipContent: flag, cornerRadius: nonnegative, layout },
  rectangle: { cornerRadius: nonnegative },
  ellipse: {},
  path: { d: { type: 'string' }, viewBox: { ...list(num), minItems: 4, maxItems: 4 }, fillRule: { type: 'string', enum: ['nonzero', 'evenodd'] } },
  text: { text: { type: 'string' }, fontFamily: str(), fontSize: positive, fontWeight: { type: 'number', minimum: 1, maximum: 1000 }, lineHeight: positive, letterSpacing: num, textAlign: { type: 'string', enum: ['left', 'center', 'right'] } },
  image: { src: { type: 'string' }, alt: { type: 'string' }, fit: { type: 'string', enum: ['cover', 'contain', 'fill'] }, cornerRadius: nonnegative },
}
const tokenProperties = ['fill', 'stroke', 'shadow', 'cornerRadius', 'fontSize', 'fontFamily', 'fontWeight', 'lineHeight', 'letterSpacing', 'x', 'y', 'width', 'height'] as const
const tokenBindings = object(Object.fromEntries(tokenProperties.map(property => [property, str()])))
const sharedStyleBindings = object({ color: str(), typography: str(), effects: str() })
function tokenValueSchema(type: string): JsonSchema {
  return type === 'color' || type === 'fontFamily' ? str() : type === 'letterSpacing' ? num : type === 'fontWeight' ? { type: 'number', minimum: 1, maximum: 1000 } : type === 'radius' || type === 'spacing' || type === 'elevation' ? nonnegative : positive
}
export const tokenSchema: JsonSchema = {
  anyOf: Object.keys(TOKEN_META).map(type => object({
    id: str(), name: { ...str(), pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$', maxLength: 100 }, type: { type: 'string', enum: [type] },
    value: tokenValueSchema(type), aliasId: str(), palette: { type: 'string', maxLength: 100 },
    themeValues: { type: 'object', additionalProperties: tokenValueSchema(type) },
  }, ['id', 'name', 'type', 'value'])),
}
const typographyKeys = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing']
const typography = object({ ...specific.text, tokenBindings: object(Object.fromEntries(typographyKeys.map(key => [key, str()]))) }, [...typographyKeys, 'textAlign'])
// Text content belongs to the layer, never to a typography preset.
const typographyProperties = { ...typography.properties }
delete typographyProperties.text
export const sharedStyleSchema: JsonSchema = { anyOf: [
  object({ id: str(), name: { ...str(), maxLength: 100 }, kind: { type: 'string', enum: ['color'] }, value: str(), tokenId: str() }, ['id', 'name', 'kind', 'value']),
  object({ id: str(), name: { ...str(), maxLength: 100 }, kind: { type: 'string', enum: ['typography'] }, value: { ...typography, properties: typographyProperties } }, ['id', 'name', 'kind', 'value']),
  object({ id: str(), name: { ...str(), maxLength: 100 }, kind: { type: 'string', enum: ['effects'] }, value: effects }, ['id', 'name', 'kind', 'value']),
] }
export const styleLibrarySchema: JsonSchema = object({
  themes: list(object({ id: { ...str(), pattern: '^[a-zA-Z0-9_-]{1,200}$' }, name: { ...str(), maxLength: 100 } }, ['id', 'name'])),
  activeThemeId: nullable(str()), styles: list(sharedStyleSchema),
}, ['themes', 'activeThemeId', 'styles'])
const overrideFields: Record<string, JsonSchema> = { name: str(), ...geometry, visible: flag, locked: flag, sizing, ...Object.assign({}, ...Object.values(specific)), nodes: list({ type: 'object', additionalProperties: true }) }
delete overrideFields.children
const componentOverridesSchema = object({
  properties: object(overrideFields),
  style: object({ ...styleProperties, stroke: nullable(object({ color: str(), width: nonnegative, dash: list(nonnegative) })) }),
  tokenBindings: object(Object.fromEntries(tokenProperties.map(property => [property, nullable(str())]))),
  sharedStyleBindings: object({ color: nullable(str()), typography: nullable(str()), effects: nullable(str()) }),
})
const propertyIdentity = { id: { ...str(), maxLength: 200 }, name: { ...str(), maxLength: 100 } }
const springSchema = object({
  stiffness: num,
  damping: num,
  mass: num,
}, ['stiffness', 'damping', 'mass'])

const componentStateTransitionSchema = object({
  id: str(),
  fromState: str(),
  trigger: { type: 'string', enum: ['on-click', 'on-hover', 'while-pressed', 'on-pointerdown', 'on-pointerup', 'on-hover-end', 'after-delay'] },
  targetState: str(),
  spring: springSchema,
  delay: positive,
}, ['id', 'fromState', 'trigger', 'targetState', 'spring'])

export const componentStateMachineSchema = object({
  initial: str(),
  states: list(str()),
  transitions: list(componentStateTransitionSchema),
}, ['initial', 'states', 'transitions'])

export const componentPropertySchema: JsonSchema = { anyOf: [
  object({ ...propertyIdentity, kind: { type: 'string', enum: ['text'] }, sourceId: str(), defaultValue: { type: 'string' } }, ['id', 'name', 'kind', 'sourceId', 'defaultValue']),
  object({ ...propertyIdentity, kind: { type: 'string', enum: ['boolean'] }, sourceId: str(), defaultValue: flag, targetProperty: { type: 'string', enum: ['visible', 'kinetic.enabled', 'clipContent'] } }, ['id', 'name', 'kind', 'sourceId', 'defaultValue']),
  object({ ...propertyIdentity, kind: { type: 'string', enum: ['color'] }, sourceId: str(), defaultValue: str(), targetProperty: { type: 'string', enum: ['fill', 'stroke', 'shader'] } }, ['id', 'name', 'kind', 'sourceId', 'defaultValue']),
  object({ ...propertyIdentity, kind: { type: 'string', enum: ['number'] }, sourceId: str(), defaultValue: num, min: num, max: num, step: positive, targetProperty: str() }, ['id', 'name', 'kind', 'sourceId', 'defaultValue']),
  object({ ...propertyIdentity, kind: { type: 'string', enum: ['kinetic'] }, sourceId: str(), defaultValue: { anyOf: [str(), num, flag] }, targetProperty: { type: 'string', enum: ['enabled', 'amplitude', 'rotation', 'duration', 'stagger', 'waveShape', 'staggerMode', 'weightModulation', 'slantModulation', 'scaleModulation', 'playing', 'phase', 'horizontalAmplitude', 'widthModulation', 'opticalSizeModulation'] } }, ['id', 'name', 'kind', 'sourceId', 'defaultValue', 'targetProperty']),
  object({ ...propertyIdentity, kind: { type: 'string', enum: ['shader'] }, sourceId: str(), defaultValue: { anyOf: [str(), num, flag] }, targetProperty: { type: 'string', enum: ['speed', 'scale', 'rotation', 'frequency', 'octaves', 'turbulence', 'displacement', 'viewMode', 'blendMode', 'lacunarity', 'persistence', 'normalPerturbation', 'grainOverlay', 'chromaticAberration', 'warpModulation', 'fluidAdvection', 'fluidViscosity', 'noiseType'] } }, ['id', 'name', 'kind', 'sourceId', 'defaultValue', 'targetProperty']),
  object({ ...propertyIdentity, kind: { type: 'string', enum: ['variant'] }, defaultValue: str(), options: { ...list(object({ value: { ...str(), maxLength: 100 }, layers: { type: 'object', additionalProperties: componentOverridesSchema } }, ['value', 'layers'])), minItems: 1, maxItems: 100 }, stateMachine: componentStateMachineSchema }, ['id', 'name', 'kind', 'defaultValue', 'options']),
] }
export const variantDimensionSchema: JsonSchema = object({
  id: str(),
  name: str(),
  values: list(str()),
  defaultValue: str(),
}, ['id', 'name', 'values', 'defaultValue'])

export const variantMatrixCellSchema: JsonSchema = object({
  id: str(),
  dimensions: { type: 'object', additionalProperties: str() },
  layers: { type: 'object', additionalProperties: componentOverridesSchema },
  description: str(),
}, ['id', 'dimensions', 'layers'])

export const componentVariantMatrixSchema: JsonSchema = object({
  dimensions: list(variantDimensionSchema),
  combinations: list(variantMatrixCellSchema),
}, ['dimensions', 'combinations'])

export const componentSchema: JsonSchema = { anyOf: [
  object({
    kind: { type: 'string', enum: ['master'] },
    properties: { ...list(componentPropertySchema), maxItems: 100 },
    stateMachine: componentStateMachineSchema,
    variantMatrix: componentVariantMatrixSchema,
    description: str(),
    createdAt: num,
    updatedAt: num,
    metadata: { type: 'object', additionalProperties: true },
  }, ['kind']),
  object({ kind: { type: 'string', enum: ['instance'] }, masterId: str(), sourceId: str(), instanceId: str(), overrides: componentOverridesSchema, propertyValues: { type: 'object', additionalProperties: { anyOf: [{ type: 'string' }, num, flag] } }, activeState: str() }, ['kind', 'masterId', 'sourceId', 'instanceId', 'overrides']),
] }

export const componentRegistryEntrySchema: JsonSchema = object({
  masterId: str(),
  name: str(),
  description: str(),
  properties: { ...list(componentPropertySchema), maxItems: 100 },
  stateMachine: componentStateMachineSchema,
  variantMatrix: componentVariantMatrixSchema,
  instanceIds: list(str()),
  createdAt: num,
  updatedAt: num,
}, ['masterId', 'name', 'instanceIds'])

export const componentRegistrySchema: JsonSchema = {
  type: 'object',
  additionalProperties: componentRegistryEntrySchema,
}

export const elementSchema: JsonSchema = {
  anyOf: Object.entries(specific).map(([type, fields]) => {
    const properties = { ...identity, ...geometry, type: { type: 'string', enum: [type] } as JsonSchema, style: object(styleProperties, ['fill', 'stroke', 'opacity', 'shadow']), ...fields }
    return object({ ...properties, tokenBindings, sharedStyleBindings, sizing, component: componentSchema }, Object.keys(properties).filter(key => key !== 'layout'))
  }),
}
export const projectSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Paper project v1',
  ...object({
    format: { type: 'string', enum: ['paper'] }, version: { type: 'integer', enum: [1] },
    name: { ...str(), maxLength: 200 }, grid: flag,
    viewport: object({ x: num, y: num, zoom: { type: 'number', minimum: .1, maximum: 32 } }, ['x', 'y', 'zoom']),
    scene: object({ tokens: list(tokenSchema), styleLibrary: styleLibrarySchema, version: { type: 'integer', enum: [1] }, backgroundShader: nullable(shaderSchema), backgroundLayers: nullable(list(shaderSchema)), rootIds: list(str()), elements: { type: 'object', additionalProperties: elementSchema }, componentRegistry: componentRegistrySchema }, ['version', 'rootIds', 'elements']),
  }, ['format', 'version', 'name', 'grid', 'viewport', 'scene']),
}

// Exact compact read contracts. Large strings and paths are previews.
const layerType: JsonSchema = { type: 'string', enum: Object.keys(specific) }
const preview = (maxLength: number): JsonSchema => ({ type: 'string', maxLength })
const boundsSchema = object({ x: num, y: num, width: nonnegative, height: nonnegative }, ['x', 'y', 'width', 'height'])
const componentSummarySchema = object({ id: str(), name: preview(160), kind: { type: 'string', enum: ['master', 'instance'] }, masterId: str(), sourceId: str(), instanceId: str(), propertyCount: nonnegative }, ['id', 'name', 'kind'])
const compactProperties = {
  id: str(), name: preview(160), type: layerType, parentId: nullable(str()),
  ...geometry, zIndex: { type: 'integer', minimum: 0 } as JsonSchema, visible: flag, locked: flag,
  effectiveVisible: flag, effectiveLocked: flag, effectiveBounds: boundsSchema, truncated: flag,
  style: object({ fill: nullable(preview(160)), opacity: num, stroke: nullable(object({ color: preview(160), width: nonnegative }, ['color', 'width'])), shaderKind: nullable({ type: 'string', enum: shaderKinds }), effectCount: nonnegative }, ['fill', 'opacity', 'stroke', 'shaderKind', 'effectCount']),
}
const compactElementSchema = object({
  ...compactProperties, tokenBindings, sharedStyleBindings, component: componentSummarySchema, sizing,
  cornerRadius: nonnegative, clipContent: flag, childCount: nonnegative, layout,
  text: preview(256), fontFamily: preview(160), fontSize: positive, fontWeight: num, lineHeight: positive, letterSpacing: num, textAlign: specific.text.textAlign,
  alt: preview(160), fit: specific.image.fit, fillRule: specific.path.fillRule,
}, Object.keys(compactProperties))
const readIdentity = { projectId: str(), revision: str(), file: str(), live: flag, project_id: str() }
const omissions = { elements: nonnegative, ancestors: nonnegative, siblings: nonnegative, linkedTokens: nonnegative, sharedStyles: nonnegative, components: nonnegative }
const tokenPreviewValue: JsonSchema = { anyOf: [preview(256), num] }
export const selectionContextOutputSchema: JsonSchema = object({
  ...readIdentity, empty: flag, selectionCount: nonnegative,
  elements: { ...list(compactElementSchema), maxItems: 50 }, ancestors: { ...list(compactElementSchema), maxItems: 40 }, siblings: { ...list(compactElementSchema), maxItems: 30 }, effectiveBounds: nullable(boundsSchema),
  linkedTokens: { ...list(object({ id: str(), name: str(), type: { type: 'string', enum: Object.keys(TOKEN_META) }, value: tokenPreviewValue, resolvedValue: tokenPreviewValue, aliasId: str(), truncated: flag }, ['id', 'name', 'type', 'value', 'resolvedValue', 'truncated'])), maxItems: 50 },
  sharedStyles: { ...list(object({ id: str(), name: str(), kind: { type: 'string', enum: ['color', 'typography', 'effects'] }, tokenIds: list(str()) }, ['id', 'name', 'kind', 'tokenIds'])), maxItems: 50 },
  components: { ...list(componentSummarySchema), maxItems: 50 }, truncated: flag, omitted: object(omissions, Object.keys(omissions)),
}, ['projectId', 'revision', 'empty', 'selectionCount', 'elements', 'ancestors', 'siblings', 'effectiveBounds', 'linkedTokens', 'sharedStyles', 'components', 'truncated', 'omitted'])
const searchResultProperties = {
  id: str(), name: preview(160), type: layerType, parentId: nullable(str()),
  parentPath: { ...list(preview(160)), maxItems: 20 }, ancestorIds: { ...list(str()), maxItems: 20 },
  pathTruncated: flag, nameTruncated: flag, visible: flag, locked: flag, bounds: boundsSchema,
}
export const searchLayersOutputSchema: JsonSchema = object({
  ...readIdentity, results: { ...list(object({ ...searchResultProperties, text: preview(120), textTruncated: flag, shaderKind: { type: 'string', enum: shaderKinds } }, Object.keys(searchResultProperties))), maxItems: 100 },
  total: nonnegative, offset: nonnegative, limit: { type: 'integer', minimum: 1, maximum: 100 }, hasMore: flag, nextCursor: nullable(str()), truncated: flag,
}, ['projectId', 'revision', 'results', 'total', 'offset', 'limit', 'hasMore', 'nextCursor', 'truncated'])

export interface PaperTool {
  readonly name: string
  readonly description: string
  readonly inputSchema: JsonSchema
  readonly outputSchema?: JsonSchema
  readonly annotations: { readonly readOnlyHint: boolean; readonly destructiveHint: boolean; readonly idempotentHint: boolean; readonly openWorldHint: boolean }
}
const file = str('Paper JSON file path within the configured workspace. Omit to use the active live editor, or --file in offline mode.')
const revision = str('Optional opaque revision from get_basic_info or get_canvas_elements. Rejects stale edits; pass it unchanged.')
const base = { file }
const creation = { id: str('Optional stable ID; otherwise a UUID is generated.'), name: str(), parentId: nullable(str()), ...geometry, visible: flag, locked: flag, style, sizing }
const mutable = { name: str(), ...geometry, visible: flag, locked: flag, style, sizing }
export function patchSchema(type: string): JsonSchema {
  const fields = { ...specific[type] }
  delete fields.children
  return object({ ...mutable, ...fields })
}
const allPatchFields = Object.assign({}, ...Object.values(specific)) as Record<string, JsonSchema>
delete allPatchFields.children
const action = (names: string[]): JsonSchema => ({ type: 'string', enum: names })
const indexSchema: JsonSchema = { type: 'integer', minimum: 0 }
const target = { element_id: str(), id: str() }
const parent = { parentId: nullable(str()), index: indexSchema }
const targetOperations = (names: string[], fields: Record<string, JsonSchema> = {}, required: string[] = []): JsonSchema[] =>
  ['element_id', 'id'].map(key => object({ action: action(names), ...target, ...fields }, ['action', key, ...required]))
const masterOperations = (names: string[], fields: Record<string, JsonSchema> = {}, required: string[] = []): JsonSchema[] =>
  ['master_id', 'masterId'].map(key => object({ action: action(names), master_id: str(), masterId: str(), ...fields }, ['action', key, ...required]))
const tokenPatch = { name: { ...str(), pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$', maxLength: 100 }, value: { anyOf: [str(), num] }, aliasId: str(), palette: { type: 'string', maxLength: 100 } as JsonSchema, themeValues: { type: 'object', additionalProperties: { anyOf: [str(), num] } } as JsonSchema }
export const operationSchema: JsonSchema = { anyOf: [
  ...Object.keys(specific).map(type => object({
    action: action(['create', 'create_element']), type: { type: 'string', enum: [type] },
    ...creation, ...patchSchema(type).properties, index: indexSchema, tokenBindings, sharedStyleBindings,
  }, ['action', 'type'])),
  object({ action: action(['create_frame']), type: { type: 'string', enum: ['frame'] }, ...creation, clipContent: flag, cornerRadius: nonnegative, layout, index: indexSchema, tokenBindings, sharedStyleBindings }, ['action']),
  object({ action: action(['add_shader_shape']), ...creation, shape: { type: 'string', enum: ['rectangle', 'ellipse'] }, cornerRadius: nonnegative, index: indexSchema, shader_kind: { type: 'string', enum: shaderKinds }, params: { type: 'object', additionalProperties: true }, motion: object(motionProperties) }, ['action', 'shader_kind']),
  ...targetOperations(['update', 'update_element'], { ...mutable, ...allPatchFields, ...parent, patch: object({ ...mutable, ...allPatchFields }) }),
  ...targetOperations(['reparent', 'reparent_element'], parent, ['parentId']),
  ...targetOperations(['reorder', 'reorder_element'], { index: indexSchema }, ['index']),
  ...targetOperations(['delete', 'delete_element', 'remove', 'remove_element']),
  ...Object.keys(TOKEN_META).map(type => object({ action: action(['create_token', 'add_token']), id: str(), name: tokenPatch.name, type: { type: 'string', enum: [type] }, value: tokenValueSchema(type), aliasId: str(), palette: tokenPatch.palette, themeValues: { type: 'object', additionalProperties: tokenValueSchema(type) } }, ['action', 'name', 'type', 'value'])),
  ...['token_id', 'id'].map(key => object({ action: action(['update_token']), token_id: str(), id: str(), ...tokenPatch, patch: object(tokenPatch) }, ['action', key])),
  ...targetOperations(['bind_token'], { property: { type: 'string', enum: tokenProperties }, token_id: str(), tokenId: str() }, ['property']).flatMap(schema => ['token_id', 'tokenId'].map(key => ({ ...schema, required: [...schema.required!, key] }))),
  ...targetOperations(['unbind_token', 'detach_token'], { property: { type: 'string', enum: tokenProperties } }, ['property']),
  ...targetOperations(['create_component', 'detach_instance', 'detach_component_instance', 'reset_component_overrides']),
  ...masterOperations(['create_instance', 'create_component_instance'], { x: num, y: num, parentId: parent.parentId }),
  ...masterOperations(['set_component_properties'], { properties: { ...list(componentPropertySchema), maxItems: 100 } }, ['properties']),
  ...targetOperations(['set_component_property'], { property_id: str(), propertyId: str(), value: { anyOf: [{ type: 'string' }, flag, { type: 'null' }] } }, ['value']).flatMap(schema => ['property_id', 'propertyId'].map(key => ({ ...schema, required: [...schema.required!, key] }))),
  ...targetOperations(['set_layout', 'update_layout'], { layout }, ['layout']),
] }

const changeIdentity = object({ id: str(), name: { type: 'string' }, type: str() }, ['id', 'type'])
export const applyChangesOutputSchema: JsonSchema = object({
  ...readIdentity, applied: flag, dry_run: flag, changedIds: list(str()), warnings: list({ type: 'string' }),
  actionResults: list(object({ step: nonnegative, action: str(), status: { type: 'string', enum: ['ok'] }, id: str(), type: str(), details: { type: 'object', additionalProperties: true } }, ['step', 'action', 'status'])),
  summary: object({ totalOperations: nonnegative, createdCount: nonnegative, updatedCount: nonnegative, deletedCount: nonnegative, changedIds: list(str()), created: list(changeIdentity), updated: list(changeIdentity), deleted: list(changeIdentity), reparented: list(object({ id: str(), from: nullable(str()), to: nullable(str()) }, ['id', 'from', 'to'])), tokenBindings: list(object({ elementId: str(), property: str(), tokenId: nullable(str()) }, ['elementId', 'property', 'tokenId'])), before: { type: 'object', additionalProperties: true }, after: { type: 'object', additionalProperties: true }, truncated: flag, omittedCount: nonnegative }, ['totalOperations', 'createdCount', 'updatedCount', 'deletedCount', 'changedIds', 'created', 'updated', 'deleted', 'reparented', 'tokenBindings', 'before', 'after', 'truncated', 'omittedCount']),
}, ['revision', 'changedIds', 'warnings', 'actionResults', 'summary'])

const tool = (name: string, description: string, inputSchema: JsonSchema, readOnly = false, outputSchema?: JsonSchema): PaperTool => ({ name, description, inputSchema, ...(outputSchema ? { outputSchema } : {}), annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly && (name === 'update_element' || name === 'apply_changes'), idempotentHint: readOnly || name === 'update_element' || name === 'apply_changes', openWorldHint: false } })
export const paperTools: readonly PaperTool[] = [
  tool('get_basic_info', 'Identify the currently open file, artboards, selection, node count and revision before editing.', object(base), true),
  tool('get_selection_context', 'Read only the human selection in live mode; file/remote mode has no selection, so pass element_ids. Empty selection returns empty:true; any invalid ID is an error. Document order, root-to-parent ancestors, and up to five adjacent siblings per side. World AABB includes nested center rotations; effective flags include ancestors. Linked token aliases, style references and component masters are compact. Complete result is capped at 32 KiB: check truncated and omitted counters. Use returned opaque revision as expected_revision when editing.', object({ ...base, element_ids: { ...list(str()), maxItems: 200 } }), true, selectionContextOutputSchema),
  tool('search_layers', 'Case-insensitive substring search of layer name, full text and type in one project. Includes hidden/locked layers by default; visible/locked filter local flags. parentId filters direct children (null for roots); scope_id traverses frame descendants only. Invalid scope/parent IDs are errors. Document paint order; default 20 results, max 100 and 32 KiB. Paths keep the nearest 20 ancestors. Return nextCursor unchanged with identical filters and limit; a changed revision/project invalidates it. Use revision as expected_revision for edits.', object({ ...base,
    query: { type: 'string', maxLength: 512, description: 'Optional substring; empty/whitespace matches all layers.' },
    type: layerType, types: { ...list(layerType), maxItems: 6 },
    parentId: nullable(str('Direct parent frame; null matches roots.')), parent_id: nullable(str('Alias of parentId.')),
    scope_id: str('Frame whose descendants are searched, excluding the frame.'), scopeId: str('Alias of scope_id.'),
    visible: flag, locked: flag, limit: { type: 'integer', minimum: 1, maximum: 100 }, cursor: { ...str('Opaque continuation, bound to project, revision, filters and limit.'), maxLength: 200 },
  }), true, searchLayersOutputSchema),
  tool('list_tokens', 'List design tokens in the active file. Optional type filters the result.', object({ ...base, type: { type: 'string', enum: Object.keys(TOKEN_META) } }), true),
  tool('create_token', 'Create a named design token. Names use lowercase kebab-case; values follow the token type. Creation is atomic and undoable.', object({ ...base, expected_revision: revision, id: str(), name: { ...str(), pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$', maxLength: 100 }, type: { type: 'string', enum: Object.keys(TOKEN_META) }, value: { anyOf: [str(), num] } }, ['name', 'type', 'value'])),
  tool('get_canvas_elements', 'Read the latest canvas, hierarchy, project settings and file revision. Coordinates are relative to the parent frame, in pixels; the engineering grid is 120px. Optional element_ids includes those elements and their descendants.', object({ ...base, element_ids: { ...list(str()), minItems: 1 } }), true),
  tool('create_frame', 'Create a frame in a Paper file. Creates a new project if the file does not exist. Defaults: 720×480px, cream fill, clipped content, 120px grid. Optional layout enables flex flow; sizing controls each axis. Parent must be an unlocked frame.', object({ ...base, expected_revision: revision, project_name: { ...str(), maxLength: 200 }, ...creation, clipContent: flag, cornerRadius: nonnegative, layout })),
  tool('add_shader_shape', 'Add a rectangle or ellipse with a native @paper-design/shaders-react paint. Supply shader_kind; optional params and motion override catalog defaults. Inspect paper://shaders for supported controls.', object({ ...base, expected_revision: revision, ...creation, shape: { type: 'string', enum: ['rectangle', 'ellipse'] }, cornerRadius: nonnegative, shader_kind: { type: 'string', enum: shaderKinds }, params: { type: 'object', additionalProperties: true }, motion: object(motionProperties) }, ['shader_kind'])),
  tool('update_element', 'Patch an existing element. Style fields merge; shader paints are complete values. Optionally reparent or reorder using parentId and index. Structural edits and validation are atomic. Locked elements must be unlocked first.', object({ ...base, expected_revision: revision, element_id: str(), patch: object({ ...mutable, ...allPatchFields }), parentId: nullable(str()), index: { type: 'integer', minimum: 0 } }, ['element_id', 'patch'])),
  tool('apply_changes', 'Execute an atomic transaction of ordered design mutations with dry-run support, single-step undo in live mode, and full rollback on validation failure. Requires expected_revision. Use $0 (zero-based operation index) to reference an earlier create result; explicit IDs also work. Plans are limited to 100 operations and 512 KiB; summary previews are capped at 32 KiB with truncation warnings. With an idempotency_key, retry the identical plan and original revision; changed payloads under the same key reject. Receipts last up to 10 minutes / 200 transactions in the active editor or server process.', object({
    ...base,
    expected_revision: str('Required opaque revision from get_basic_info or get_canvas_elements. Rejects stale edits; pass it unchanged.'),
    operations: { ...list(operationSchema), minItems: 1, maxItems: 100, description: 'Ordered list of operations to execute atomically.' },
    dry_run: flag,
    idempotency_key: { ...str('Optional unique key to ensure retried submissions do not duplicate layers or changes.'), maxLength: 200 },
    idempotencyKey: { ...str('Alias of idempotency_key.'), maxLength: 200 },
  }, ['expected_revision', 'operations']), false, applyChangesOutputSchema),
  tool('export_selection', 'Export element_ids and frame descendants as editable Paper JSON (default) or SVG. Omit element_ids for the whole canvas. Shader JSON is lossless; SVG shaders require supplied shader_snapshots from the browser. Returns content inline; optional output writes a new file without overwriting existing files.', object({ ...base, element_ids: { ...list(str()), minItems: 1 }, format: { type: 'string', enum: ['json', 'svg'] }, background: { type: 'string', enum: ['transparent', 'cream'] }, output: str('New export path within the workspace.'), shader_snapshots: { type: 'object', additionalProperties: { type: 'string', pattern: '^data:image/png;base64,[A-Za-z0-9+/=]+$' } } })),
]

/** Validate the exact vocabulary above. SceneStore also checks graph invariants. */
export function validateSchema(value: unknown, schema: JsonSchema, path = 'arguments'): void {
  const fail = (reason: string): never => { throw new Error(`${path}: ${reason}`) }
  if (schema.anyOf) {
    for (const candidate of schema.anyOf) {
      try { validateSchema(value, candidate, path); return } catch { /* Try the next union member. */ }
    }
    fail('does not match a supported value')
  }
  if (schema.enum && !schema.enum.includes(value)) fail(`expected ${schema.enum.join(', ')}`)
  if (schema.type === 'null') { if (value !== null) fail('expected null'); return }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('expected an object')
    const record = value as Record<string, unknown>
    for (const key of schema.required ?? []) if (!Object.hasOwn(record, key)) fail(`missing ${key}`)
    for (const [key, entry] of Object.entries(record)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('reserved property')
      const child = schema.properties && Object.hasOwn(schema.properties, key) ? schema.properties[key] : undefined
      if (child) validateSchema(entry, child, `${path}.${key}`)
      else if (schema.additionalProperties === false) fail(`unknown property ${key}`)
      else if (typeof schema.additionalProperties === 'object') validateSchema(entry, schema.additionalProperties, `${path}.${key}`)
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) fail('expected an array')
    const entries = value as unknown[]
    if (schema.minItems !== undefined && entries.length < schema.minItems) fail('too few items')
    if (schema.maxItems !== undefined && entries.length > schema.maxItems) fail('too many items')
    if (schema.items) entries.forEach((entry, i) => validateSchema(entry, schema.items!, `${path}[${i}]`))
  } else if (schema.type === 'string') {
    if (typeof value !== 'string') fail('expected a string')
    const text = value as string
    if (schema.minLength !== undefined && text.trim().length < schema.minLength) fail('must not be empty')
    if (schema.maxLength !== undefined && text.length > schema.maxLength) fail('too long')
    if (schema.pattern && !new RegExp(schema.pattern).test(text)) fail('invalid format')
  } else if (schema.type === 'number' || schema.type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail('expected a finite number')
    const n = value as number
    if (schema.type === 'integer' && !Number.isInteger(n)) fail('expected an integer')
    if (schema.minimum !== undefined && n < schema.minimum) fail(`must be at least ${schema.minimum}`)
    if (schema.exclusiveMinimum !== undefined && n <= schema.exclusiveMinimum) fail(`must be greater than ${schema.exclusiveMinimum}`)
    if (schema.maximum !== undefined && n > schema.maximum) fail(`must be at most ${schema.maximum}`)
  } else if (schema.type === 'boolean' && typeof value !== 'boolean') fail('expected a boolean')
}
