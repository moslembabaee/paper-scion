import { validateEffects } from '../tokens/library.ts'
import type { LayerEffect } from '../tokens/types.ts'
import type { BooleanCompound, ElementGeometry, ElementInput, ElementOf, ElementType, SceneElement, VectorElement } from './types.ts'
import { freezeShader, validateShader } from '../shaders/catalog.ts'
import { parsePath, serializePath } from './pathGeometry.ts'
import { freezeComponent, validateComponent } from './components.ts'
import { validateElementPhysics } from '../physics/constants.ts'

const names: Record<ElementType, string> = { frame: 'Frame', rectangle: 'Rectangle', ellipse: 'Ellipse', path: 'Vector path', text: 'Text', image: 'Image' }
const frozenElements = new WeakSet<SceneElement>()
const frozenCompounds = new WeakSet<BooleanCompound>()
const frozenEffectStacks = new WeakSet<readonly LayerEffect[]>()

function freezeEffects(effects: readonly LayerEffect[]): readonly LayerEffect[] {
  if (frozenEffectStacks.has(effects)) return effects
  const frozen = Object.freeze(effects.map(effect => Object.freeze(Object.fromEntries(Object.entries(effect).filter(([, value]) => value !== undefined))) as LayerEffect))
  frozenEffectStacks.add(frozen)
  return frozen
}

function freezeCompound(compound: BooleanCompound): BooleanCompound {
  if (frozenCompounds.has(compound)) return compound
  const frozen = Object.freeze({
    operation: compound.operation,
    operands: Object.freeze(compound.operands.map(operand => freezeElement(operand) as VectorElement)),
    ...(compound.mutedOperandIds ? { mutedOperandIds: Object.freeze([...compound.mutedOperandIds]) } : {}),
  })
  frozenCompounds.add(frozen)
  return frozen
}

/** Freeze records at the boundary so consumers cannot corrupt the observable state. */
export function freezeElement(element: SceneElement): SceneElement {
  if (frozenElements.has(element)) return element
  element = Object.fromEntries(Object.entries(element).filter(([, value]) => value !== undefined)) as unknown as SceneElement
  const tokenBindings = element.tokenBindings ? Object.freeze({ ...element.tokenBindings }) : undefined
  element = { ...element, ...(tokenBindings ? { tokenBindings } : {}), ...(element.sharedStyleBindings ? { sharedStyleBindings: Object.freeze({ ...element.sharedStyleBindings }) } : {}) }
  if (element.component) element = { ...element, component: freezeComponent(element.component) }
  if (element.type === 'text') element = { ...element, ...(element.variableAxes ? { variableAxes: Object.freeze({ ...element.variableAxes }) } : {}), ...(element.openTypeFeatures ? { openTypeFeatures: Object.freeze({ ...element.openTypeFeatures }) } : {}), ...(element.textOnPath ? { textOnPath: Object.freeze({ ...element.textOnPath }) } : {}) }
  if (element.mask) element = { ...element, mask: Object.freeze({ ...element.mask }) }
  if (element.type === 'text' && element.kinetic) element = { ...element, kinetic: Object.freeze({ ...element.kinetic }) }
  if (element.sizing) element = { ...element, sizing: Object.freeze({ ...element.sizing }) }
  if (element.constraints) element = { ...element, constraints: Object.freeze({ ...element.constraints }) }
  if (element.physics) element = { ...element, physics: Object.freeze({ ...element.physics }) }
  if (element.type === 'frame' && element.layout) element = { ...element, layout: Object.freeze({ ...element.layout, padding: Object.freeze({ ...element.layout.padding }) }) }
  if (element.type === 'frame' && element.layoutGrids) element = { ...element, layoutGrids: Object.freeze(element.layoutGrids.map(grid => Object.freeze({ ...grid }))) }
  const style = Object.freeze({
    ...element.style,
    ...(element.style.effects ? { effects: freezeEffects(element.style.effects) } : {}),
    shader: element.style.shader ? freezeShader(element.style.shader) : null,
    stroke: element.style.stroke ? Object.freeze({ ...element.style.stroke, dash: Object.freeze([...element.style.stroke.dash]) }) : null,
    shadow: element.style.shadow ? Object.freeze({ ...element.style.shadow }) : null,
  })
  const frozen: SceneElement = element.type === 'frame'
    ? Object.freeze({ ...element, style, children: Object.freeze([...element.children]) })
    : element.type === 'path'
      ? Object.freeze({ ...element, style, viewBox: Object.freeze([...element.viewBox]) as typeof element.viewBox,
        ...(element.nodes ? { nodes: Object.freeze(element.nodes.map(c => Object.freeze({ closed: c.closed, anchors: Object.freeze(c.anchors.map(a => Object.freeze({ ...a, ...(a.in ? { in: Object.freeze({ ...a.in }) } : {}), ...(a.out ? { out: Object.freeze({ ...a.out }) } : {}), ...(a.quadApex ? { quadApex: Object.freeze({ ...a.quadApex }) } : {}) }))) }))) } : {}),
        ...(element.boolean ? { boolean: freezeCompound(element.boolean) } : {}),
      })
      : Object.freeze({ ...element, style })
  frozenElements.add(frozen)
  return frozen
}

/** Layout changes only geometry. Reuse already-frozen paints, paths, and frame
 * children instead of copying those records for every frame of a resize gesture. */
export function withElementGeometry(element: SceneElement, geometry: Pick<ElementGeometry, 'x' | 'y' | 'width' | 'height'>): SceneElement {
  const next = { ...element, ...geometry }
  if (!frozenElements.has(element)) return freezeElement(next)
  const frozen = Object.freeze(next)
  frozenElements.add(frozen)
  return frozen
}

export function validateElement(element: SceneElement, depth = 0): void {
  if (element.mask !== undefined) {
    if (
      !element.mask ||
      !['frame', 'rectangle', 'ellipse', 'path'].includes(element.type) ||
      typeof element.mask.enabled !== 'boolean' ||
      typeof element.mask.showOutline !== 'boolean' ||
      (element.mask.mode !== undefined && !['vector', 'alpha', 'luminance'].includes(element.mask.mode)) ||
      (element.mask.luminanceThreshold !== undefined && (!Number.isFinite(element.mask.luminanceThreshold) || element.mask.luminanceThreshold < 0 || element.mask.luminanceThreshold > 1)) ||
      (element.mask.inverted !== undefined && typeof element.mask.inverted !== 'boolean') ||
      (element.mask.isolated !== undefined && typeof element.mask.isolated !== 'boolean')
    ) {
      throw new Error('Invalid vector mask')
    }
  }
  if (element.component !== undefined) validateComponent(element.component)
  if (element.physics !== undefined) validateElementPhysics(element.physics)
  if (element.themeMode !== undefined && element.themeMode !== null && (typeof element.themeMode !== 'string' || !element.themeMode.trim() || element.themeMode.length > 200)) throw new Error('Invalid theme mode')
  if (depth > 16) throw new Error('Boolean compounds may be nested up to 16 levels')
  if (typeof element.id !== 'string' || !element.id || typeof element.name !== 'string' || !element.name || (element.parentId !== null && typeof element.parentId !== 'string') || !['frame', 'rectangle', 'ellipse', 'path', 'text', 'image'].includes(element.type)) throw new Error('Invalid element identity')
  for (const key of ['x', 'y', 'width', 'height', 'rotation', 'zIndex'] as const) {
    if (!Number.isFinite(element[key])) throw new Error(`Invalid ${key}`)
  }
  if (element.width <= 0 || element.height <= 0 || !Number.isInteger(element.zIndex) || element.zIndex < 0) throw new Error('Invalid element dimensions or order')
  if (element.sizing !== undefined && (!element.sizing || !['fixed', 'hug', 'fill'].includes(element.sizing.width) || !['fixed', 'hug', 'fill'].includes(element.sizing.height))) throw new Error('Invalid sizing rules')
  if (element.sizing) {
    const { flexGrow, minWidth, maxWidth, minHeight, maxHeight } = element.sizing
    if (flexGrow !== undefined && (!Number.isFinite(flexGrow) || flexGrow <= 0)) throw new Error('Invalid flex grow')
    for (const [min, max] of [[minWidth, maxWidth], [minHeight, maxHeight]]) {
      if ((min !== undefined && (!Number.isFinite(min) || min < 0)) || (max !== undefined && (!Number.isFinite(max) || max < .01)) || (min !== undefined && max !== undefined && min > max)) throw new Error('Invalid sizing constraints')
    }
  }
  if (element.constraints !== undefined) {
    const c = element.constraints
    if (
      !c ||
      !['left', 'right', 'left-right', 'center', 'scale'].includes(c.horizontal) ||
      !['top', 'bottom', 'top-bottom', 'center', 'scale'].includes(c.vertical)
    ) {
      throw new Error('Invalid layout constraints')
    }
  }
  if ('layoutGrids' in element && element.layoutGrids !== undefined) {
    if (element.type !== 'frame') throw new Error('Only frames support layout grids')
    if (!Array.isArray(element.layoutGrids)) throw new Error('Invalid layout grids')
    for (const grid of element.layoutGrids) {
      if (
        !grid ||
        typeof grid.id !== 'string' ||
        !grid.id ||
        !['columns', 'rows', 'grid'].includes(grid.type) ||
        typeof grid.visible !== 'boolean' ||
        typeof grid.color !== 'string'
      ) {
        throw new Error('Invalid layout grid item')
      }
      if (grid.count !== undefined && (!Number.isFinite(grid.count) || grid.count < 1)) throw new Error('Invalid layout grid count')
      if (grid.gutter !== undefined && (!Number.isFinite(grid.gutter) || grid.gutter < 0)) throw new Error('Invalid layout grid gutter')
      if (grid.margin !== undefined && (!Number.isFinite(grid.margin) || grid.margin < 0)) throw new Error('Invalid layout grid margin')
      if (grid.size !== undefined && (!Number.isFinite(grid.size) || grid.size < 0.01)) throw new Error('Invalid layout grid size')
      if (grid.sectionSize !== undefined && (!Number.isFinite(grid.sectionSize) || grid.sectionSize < 0.01)) throw new Error('Invalid layout grid sectionSize')
      if (grid.alignment !== undefined && !['stretch', 'left', 'right', 'center', 'top', 'bottom'].includes(grid.alignment)) throw new Error('Invalid layout grid alignment')
    }
  }
  if ('layout' in element && element.layout !== undefined && element.layout !== null) {
    if (element.type !== 'frame') throw new Error('Only frames support auto layout')
    const layout = element.layout
    if ((layout.wrap !== undefined && !['nowrap', 'wrap', 'wrap-reverse'].includes(layout.wrap)) || (layout.alignContent !== undefined && !['start', 'center', 'end', 'space-between', 'stretch'].includes(layout.alignContent))) throw new Error('Invalid auto layout wrap or line alignment')
    if (!['horizontal', 'vertical'].includes(layout.direction) || !['start', 'center', 'end', 'space-between'].includes(layout.justify) || !['start', 'center', 'end'].includes(layout.align) || !Number.isFinite(layout.gap) || layout.gap < 0 || !layout.padding || !['top', 'right', 'bottom', 'left'].every(key => Number.isFinite(layout.padding[key as keyof typeof layout.padding]) && layout.padding[key as keyof typeof layout.padding] >= 0)) throw new Error('Invalid auto layout')
  }
  if (typeof element.visible !== 'boolean' || typeof element.locked !== 'boolean') throw new Error('Invalid element flags')
  const { fill, stroke, opacity, shadow } = element.style
  if (element.style.effects !== undefined) validateEffects(element.style.effects)
  if (element.style.shader !== undefined && element.style.shader !== null) validateShader(element.style.shader)
  if ((fill !== null && typeof fill !== 'string') || !Number.isFinite(opacity) || opacity < 0 || opacity > 1) throw new Error('Invalid fill or opacity')
  if (stroke && (typeof stroke.color !== 'string' || !Number.isFinite(stroke.width) || stroke.width < 0 || !Array.isArray(stroke.dash) || stroke.dash.some(n => !Number.isFinite(n) || n < 0))) throw new Error('Invalid stroke')
  if (shadow && (typeof shadow.color !== 'string' || ![shadow.x, shadow.y, shadow.blur].every(Number.isFinite) || shadow.blur < 0)) throw new Error('Invalid shadow')
  if ('cornerRadius' in element && (!Number.isFinite(element.cornerRadius) || element.cornerRadius < 0)) throw new Error('Invalid corner radius')
  if (element.type === 'frame' && (!Array.isArray(element.children) || typeof element.clipContent !== 'boolean')) throw new Error('Invalid frame')
  if (element.type === 'path' && (typeof element.d !== 'string' || !Array.isArray(element.viewBox) || element.viewBox.length !== 4 || !element.viewBox.every(Number.isFinite) || element.viewBox[2] <= 0 || element.viewBox[3] <= 0 || !['nonzero', 'evenodd'].includes(element.fillRule))) throw new Error('Invalid path')
  if (element.type === 'path' && element.nodes !== undefined) {
    if (!Array.isArray(element.nodes) || element.boolean) throw new Error('Invalid editable path')
    for (const c of element.nodes) {
      if (!c || typeof c.closed !== 'boolean' || !Array.isArray(c.anchors) || !c.anchors.length) throw new Error('Invalid path contour')
      for (const a of c.anchors) {
        if (!a || ![a.x, a.y].every(Number.isFinite) || (a.cornerRadius !== undefined && (!Number.isFinite(a.cornerRadius) || a.cornerRadius < 0)) || (a.handleType !== undefined && !['mirrored', 'asymmetric', 'disconnected'].includes(a.handleType))) throw new Error('Invalid path anchor')
        if (a.curveMode !== undefined && !['cubic', 'quadratic'].includes(a.curveMode)) throw new Error('Invalid curve mode')
        for (const h of [a.in, a.out, a.quadApex]) if (h !== undefined && (!h || ![h.x, h.y].every(Number.isFinite))) throw new Error('Invalid path handle')
      }
    }
    if (serializePath(element.nodes) !== element.d) throw new Error('Path outline does not match its anchors')
  }
  if (element.type === 'path' && element.boolean !== undefined) {
    const compound = element.boolean
    if (!compound || !['union', 'subtract', 'intersect', 'exclude'].includes(compound.operation) || !Array.isArray(compound.operands) || compound.operands.length < 2 || compound.operands.length > 2000) throw new Error('Invalid boolean compound')
    if (compound.mutedOperandIds !== undefined && (!Array.isArray(compound.mutedOperandIds) || !compound.mutedOperandIds.every(id => typeof id === 'string'))) throw new Error('Invalid muted operands')
    const ids = new Set<string>()
    for (const operand of compound.operands) {
      if (!operand || !['rectangle', 'ellipse', 'path'].includes(operand.type) || ids.has(operand.id)) throw new Error('Invalid boolean operand')
      ids.add(operand.id)
      validateElement(operand, depth + 1)
    }
  }
  if (element.type === 'text') {
    if (element.kinetic !== undefined) {
      const k = element.kinetic
      if (!k || typeof k.enabled !== 'boolean' || typeof k.playing !== 'boolean' || ![k.amplitude, k.rotation, k.duration, k.stagger, k.phase].every(Number.isFinite) || k.amplitude < 0 || k.amplitude > 240 || Math.abs(k.rotation) > 180 || k.duration < .2 || k.duration > 30 || k.stagger < 0 || k.stagger > 1000 || k.phase < 0 || k.phase > 1) throw new Error('Invalid kinetic typography')
      if (k.staggerMode !== undefined && !['cascade', 'left-to-right', 'right-to-left', 'wave', 'center-out', 'random', 'elastic'].includes(k.staggerMode)) throw new Error('Invalid kinetic stagger mode')
      if (k.waveShape !== undefined && !['triangle', 'sine', 'bounce', 'spring'].includes(k.waveShape)) throw new Error('Invalid kinetic wave shape')
      if (k.weightModulation !== undefined && (!Number.isFinite(k.weightModulation) || Math.abs(k.weightModulation) > 500)) throw new Error('Invalid kinetic weight modulation')
      if (k.slantModulation !== undefined && (!Number.isFinite(k.slantModulation) || Math.abs(k.slantModulation) > 30)) throw new Error('Invalid kinetic slant modulation')
      if (k.scaleModulation !== undefined && (!Number.isFinite(k.scaleModulation) || k.scaleModulation < 0 || k.scaleModulation > 1)) throw new Error('Invalid kinetic scale modulation')
      if (k.widthModulation !== undefined && (!Number.isFinite(k.widthModulation) || Math.abs(k.widthModulation) > 200)) throw new Error('Invalid kinetic width modulation')
      if (k.horizontalAmplitude !== undefined && (!Number.isFinite(k.horizontalAmplitude) || Math.abs(k.horizontalAmplitude) > 500)) throw new Error('Invalid kinetic horizontal amplitude')
      if (k.opticalSizeModulation !== undefined && (!Number.isFinite(k.opticalSizeModulation) || Math.abs(k.opticalSizeModulation) > 100)) throw new Error('Invalid kinetic optical size modulation')
    }
    if (typeof element.text !== 'string' || typeof element.fontFamily !== 'string' || ![element.fontSize, element.fontWeight, element.lineHeight, element.letterSpacing].every(Number.isFinite) || element.fontSize <= 0 || element.lineHeight <= 0 || element.fontWeight < 1 || element.fontWeight > 1000 || !['left', 'center', 'right'].includes(element.textAlign)) throw new Error('Invalid text')
    if (element.fontSource !== undefined && (typeof element.fontSource !== 'string' || !/^data:font\/(woff2?|ttf|otf);base64,[A-Za-z0-9+/=]+$/.test(element.fontSource) || element.fontSource.length > 4_200_000)) throw new Error('Invalid embedded font')
    if (element.variableAxes !== undefined) {
      if (!element.variableAxes || typeof element.variableAxes !== 'object' || Array.isArray(element.variableAxes)) throw new Error('Invalid variable axes')
      for (const [tag, val] of Object.entries(element.variableAxes)) {
        if (!/^[a-zA-Z0-9_ ]{4}$/.test(tag) || (val !== undefined && !Number.isFinite(val))) throw new Error(`Invalid variable axis ${tag}`)
      }
    }
    if (element.openTypeFeatures !== undefined) {
      if (!element.openTypeFeatures || typeof element.openTypeFeatures !== 'object' || Array.isArray(element.openTypeFeatures)) throw new Error('Invalid OpenType features')
      for (const [feat, val] of Object.entries(element.openTypeFeatures)) {
        if (!/^[a-zA-Z0-9 ]{4}$/.test(feat) || (val !== undefined && typeof val !== 'boolean')) throw new Error(`Invalid OpenType feature ${feat}`)
      }
    }
    if (element.renderMode !== undefined && !['html', 'outline'].includes(element.renderMode)) throw new Error('Invalid render mode')
    if (element.renderOutlines !== undefined && typeof element.renderOutlines !== 'boolean') throw new Error('Invalid render outlines')
    if (element.outlinePathD !== undefined && typeof element.outlinePathD !== 'string') throw new Error('Invalid outline path')
    if (element.fontKerning !== undefined && !['auto', 'normal', 'none', 'optical'].includes(element.fontKerning)) throw new Error('Invalid font kerning')
    if (element.opticalKerning !== undefined && !Number.isFinite(element.opticalKerning)) throw new Error('Invalid optical kerning')
    if (element.opticalMarginAlignment !== undefined && typeof element.opticalMarginAlignment !== 'boolean') throw new Error('Invalid optical margin alignment')
    if (element.showOpticalMetrics !== undefined && typeof element.showOpticalMetrics !== 'boolean') throw new Error('Invalid show optical metrics')
    if (element.textTransform !== undefined && !['none', 'uppercase', 'lowercase', 'capitalize'].includes(element.textTransform)) throw new Error('Invalid text transform')
    if (element.textOnPath !== undefined) {
      if (!element.textOnPath || typeof element.textOnPath !== 'object' || typeof element.textOnPath.enabled !== 'boolean') throw new Error('Invalid text on path')
      if (element.textOnPath.pathId !== undefined && element.textOnPath.pathId !== null && typeof element.textOnPath.pathId !== 'string') throw new Error('Invalid text on path reference')
      if (element.textOnPath.pathData !== undefined && typeof element.textOnPath.pathData !== 'string') throw new Error('Invalid text on path data')
      if (element.textOnPath.pathData?.trim()) {
        if (!parsePath(element.textOnPath.pathData).some(contour => contour.anchors.length > 1)) throw new Error('Invalid text on path data')
      }
      if (element.textOnPath.offset !== undefined && !Number.isFinite(element.textOnPath.offset)) throw new Error('Invalid text on path offset')
      if (element.textOnPath.offsetMode !== undefined && !['percent', 'pixels'].includes(element.textOnPath.offsetMode)) throw new Error('Invalid text on path offset mode')
      if (element.textOnPath.side !== undefined && !['left', 'right'].includes(element.textOnPath.side)) throw new Error('Invalid text on path side')
      if (element.textOnPath.align !== undefined && !['start', 'center', 'end', 'justify'].includes(element.textOnPath.align)) throw new Error('Invalid text on path align')
      if (element.textOnPath.spacing !== undefined && !Number.isFinite(element.textOnPath.spacing)) throw new Error('Invalid text on path spacing')
      if (element.textOnPath.reverse !== undefined && typeof element.textOnPath.reverse !== 'boolean') throw new Error('Invalid text on path reverse')
      if (element.textOnPath.preset !== undefined && !['custom', 'wave', 'arc', 'circle', 'scurve', 'spiral', 'banner', 'zigzag'].includes(element.textOnPath.preset)) throw new Error('Invalid text on path preset')
      if (element.textOnPath.baselineShift !== undefined && !Number.isFinite(element.textOnPath.baselineShift)) throw new Error('Invalid text on path baseline shift')
    }
  }
  if (element.type === 'image' && (typeof element.src !== 'string' || typeof element.alt !== 'string' || !['cover', 'contain', 'fill'].includes(element.fit))) throw new Error('Invalid image')
}

export function createElement<T extends ElementType>(type: T, input: ElementInput<T> = {}): ElementOf<T> {
  if (Object.hasOwn(input, 'component')) throw new Error('Components are managed by the store')
  if (Object.hasOwn(input, 'children') || Object.hasOwn(input, 'zIndex')) throw new Error('Children and order are managed by the store')
  const defaults: Record<ElementType, object> = {
    frame: { children: [], clipContent: true, cornerRadius: 0 },
    rectangle: { cornerRadius: 0 },
    ellipse: {},
    path: { d: 'M 0 120 L 60 0 L 120 120 Z', viewBox: [0, 0, 120, 120], fillRule: 'nonzero' },
    text: { text: 'A new idea.', fontFamily: 'Inter, Matter, ui-sans-serif, system-ui, sans-serif', fontSize: 32, fontWeight: 400, lineHeight: 1.2, letterSpacing: -0.5, textAlign: 'left' },
    image: { src: '/favicon.svg', alt: 'Paper mark', fit: 'contain', cornerRadius: 0 },
  }
  const element = {
    id: crypto.randomUUID(), name: names[type], parentId: null, zIndex: 0,
    x: 0, y: 0, width: type === 'frame' ? 720 : type === 'text' ? 240 : 120,
    height: type === 'frame' ? 480 : type === 'text' ? 48 : 120,
    rotation: 0, visible: true, locked: false,
    ...defaults[type], ...input, type,
    style: { fill: type === 'text' ? '#080808' : type === 'frame' ? '#f5f4ee' : type === 'image' ? null : '#81adec', stroke: null, opacity: 1, shadow: null, ...input.style },
    ...(input.physics ? { physics: input.physics } : {}),
  } as SceneElement
  const normalized = element.type === 'path' && element.nodes ? { ...element, d: serializePath(element.nodes) } : element
  validateElement(normalized)
  return freezeElement(normalized) as ElementOf<T>
}
