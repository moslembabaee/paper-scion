import { SharedStyleInspector, EffectStackEditor } from '../tokens/StyleLibraryPanel'
import type { ReactNode } from 'react'
import { TokenSelector } from '../tokens/TokenSelector'
import type { TokenProperty } from '../tokens/types'
import { ArrowDown, ArrowUp, ChevronRight, Circle, Component as Diamonds, LockKeyhole, Plus, RotateCcw, Trash2, Upload, X } from 'lucide-react'
import type { ViewportController } from '../canvas/ViewportController'
import { getWorldBounds } from './geometry'
import type { SceneStore } from './store'
import type { ElementPatch, ElementType, SceneElement } from './types'
import { useScene } from './useScene'
import { useRangeHistory } from './useRangeHistory'
import { ShaderInspector } from '../shaders/ShaderInspector'
import { BackgroundLayersInspector } from '../shaders/BackgroundLayersInspector'
import { ArrangeBar } from './ArrangeBar'
import { BooleanBar } from './BooleanBar'
import { MaskInspector } from './MaskInspector'
import { AutoLayoutInspector } from './AutoLayoutInspector'
import { ComponentInspector } from './ComponentPanel'
import type { MorphTarget } from '../morph/types'
import { TypographyStudio } from './TypographyStudio'
import { componentRoot } from './components'
import { GradientInspector } from '../shaders/GradientInspector'
import { createDefaultGradient, gradientToShaderPaint } from '../shaders/gradient'
import { VariableModeInspector } from '../tokens/VariableModeInspector'

function NumberField({ label, value, onChange, min, max, step = 1, binding, disabled = false }: { disabled?: boolean; binding?: ReactNode; label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number }) {
  return <div className="token-number-field"><label className="property-number"><span>{label}</span><input key={value} aria-label={label} disabled={disabled} type="number" defaultValue={Number(value.toFixed(3))} min={min} max={max} step={step} onBlur={(event) => {
    const next = event.currentTarget.valueAsNumber
    if (Number.isFinite(next) && (min === undefined || next >= min) && (max === undefined || next <= max)) { if (next !== value) onChange(next) }
    else event.currentTarget.value = String(value)
  }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} /></label>{binding}</div>
}

function ColorField({ label, value, onChange, binding }: { binding?: ReactNode; label: string; value: string; onChange: (value: string) => void }) {
  const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : '#080808'
  return <div className="token-color-field"><label className="property-color"><input type="color" aria-label={`${label} color picker`} value={hex} onChange={event => onChange(event.currentTarget.value)} /><input key={value} aria-label={`${label} color`} defaultValue={value} spellCheck={false} onBlur={event => { const next = event.currentTarget.value.trim(); if (CSS.supports('color', next)) { if (next !== value) onChange(next) } else event.currentTarget.value = value }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} /></label>{binding}</div>
}

export function ElementInspector({ store, controller, grid, onGridChange, onOpenShaders, onOpenMorph }: { store: SceneStore; controller: ViewportController; grid: boolean; onGridChange: () => void; onOpenShaders?: () => void; onOpenMorph?: (target?: MorphTarget) => void }) {
  const onRangePointerDown = useRangeHistory(store)
  const meshGestureStart = () => { if (store.getHistorySnapshot().active) return false; store.beginTransaction('Move mesh anchor') }
  const meshGestureEnd = (cancel: boolean) => { if (cancel) store.cancelTransaction(); else store.endTransaction() }
  const state = useScene(store, snapshot => snapshot)
  const node = state.selection.length === 1 ? state.elements[state.selection[0]] : undefined
  const parent = node?.parentId ? state.elements[node.parentId] : undefined
  const managed = parent?.type === 'frame' && !!parent.layout
  const instanceChild = node?.component?.kind === 'instance' && node.component.instanceId !== node.id
  const component = node ? componentRoot(state.elements, node.id) : undefined
  const binding = (property: TokenProperty, label: string, color = false) => node ? <TokenSelector key={`${node.id}-${property}`} store={store} node={node} property={property} label={label} tokens={store.getMultiThemeResolver().resolveForElement(node.id, state.elements)} color={color} /> : null
  const patch = (changes: ElementPatch<ElementType>) => { if (node) store.update(node.id, node.type, changes) }
  const style = (changes: Partial<SceneElement['style']>) => patch({ style: changes })
  const isInstanceLayer = node?.component?.kind === 'instance'
  const masterId = node?.component?.kind === 'instance' ? node.component.masterId : undefined
  const isMasterLocked = masterId ? store.isLocked(masterId) : false
  const hasFillOverride = isInstanceLayer && Object.hasOwn(node.component.overrides.style ?? {}, 'fill')
  const hasGradientOverride = isInstanceLayer && Object.hasOwn(node.component.overrides.style ?? {}, 'gradient')
  const hasStrokeOverride = isInstanceLayer && Object.hasOwn(node.component.overrides.style ?? {}, 'stroke')
  const hasOpacityOverride = isInstanceLayer && Object.hasOwn(node.component.overrides.style ?? {}, 'opacity')
  const hasShadowOverride = isInstanceLayer && Object.hasOwn(node.component.overrides.style ?? {}, 'shadow')
  const hasShaderOverride = isInstanceLayer && Object.hasOwn(node.component.overrides.style ?? {}, 'shader')
  const hasRadiusOverride = isInstanceLayer && Object.hasOwn(node.component.overrides.properties ?? {}, 'cornerRadius')
  const hasXOverride = isInstanceLayer && Object.hasOwn(node.component.overrides.properties ?? {}, 'x')
  const hasYOverride = isInstanceLayer && Object.hasOwn(node.component.overrides.properties ?? {}, 'y')
  const hasWidthOverride = isInstanceLayer && Object.hasOwn(node.component.overrides.properties ?? {}, 'width')
  const hasHeightOverride = isInstanceLayer && Object.hasOwn(node.component.overrides.properties ?? {}, 'height')
  const hasRotationOverride = isInstanceLayer && Object.hasOwn(node.component.overrides.properties ?? {}, 'rotation')
  const hasTextOverride = isInstanceLayer && Object.hasOwn(node.component.overrides.properties ?? {}, 'text')
  const hasKineticOverride = isInstanceLayer && Object.hasOwn(node.component.overrides.properties ?? {}, 'kinetic')
  const parentOptions = Object.values(state.elements).filter(candidate => {
    if (candidate.type !== 'frame' || candidate.id === node?.id) return false
    const destination = componentRoot(state.elements, candidate.id)
    if (destination?.component?.kind === 'instance' || (component?.id === node?.id && destination)) return false
    let parent: SceneElement | undefined = candidate
    while (parent) { if (parent.id === node?.id) return false; parent = parent.parentId === null ? undefined : state.elements[parent.parentId] }
    return !store.isLocked(candidate.id)
  })
  return <aside className="inspector-panel" data-testid="inspector-panel" aria-label="Canvas properties" onPointerDownCapture={onRangePointerDown}>
    <div className="panel-heading"><span>{node ? node.type === 'frame' ? 'Frame' : node.type[0].toUpperCase() + node.type.slice(1) : state.selection.length > 1 ? `${state.selection.length} layers` : 'Canvas'}</span>{state.selection.length ? <button className="quiet-button" aria-label="Deselect elements" onClick={() => store.select([])}><X size={14} /></button> : <Circle size={11} />}</div>
    <ArrangeBar store={store} controller={controller} />
    <BooleanBar key={state.selection.join(':')} store={store} />
    <MaskInspector key={`mask-${state.selection.join(':')}`} store={store} />
    {!node && state.selection.length > 1 && (
      <div className="inspector-section component-section" data-testid="multi-selection-component">
        <span className="section-caption">REUSABLE DESIGN</span>
        <button
          className="component-action primary"
          disabled={!!store.selectionComponentCreationReason(state.selection)}
          title={store.selectionComponentCreationReason(state.selection) ?? 'Turn selection into a master component symbol'}
          onClick={() => store.createComponentFromSelection(state.selection)}
        >
          <Diamonds size={14} />
          Create component symbol ({state.selection.length} layers)
          <Plus size={12} />
        </button>
      </div>
    )}
    {node ? <>
      <ComponentInspector key={`component-${node.id}`} store={store} controller={controller} node={node} />
      <VariableModeInspector key={`var-mode-${node.id}`} store={store} node={node} />
      <div className="inspector-section">
        <span className="section-caption">SELECTION</span>
        <input className="property-name" key={node.id + node.name} aria-label="Layer name" defaultValue={node.name} onBlur={event => { const name = event.currentTarget.value.trim(); if (name) patch({ name }); else event.currentTarget.value = node.name }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} />
        <div className="property-pair">
          <NumberField
            disabled={managed}
            binding={
              managed ? null : hasXOverride ? (
                <div className="override-inline-controls">
                  <span className="property-override-badge mini" title="X position overridden from master">
                    <span className="property-override-dot" />
                    Override
                  </span>
                  <button
                    className="quiet-button override-inline-push"
                    disabled={isMasterLocked}
                    aria-label="Push X to master"
                    title="Push X position override to master"
                    onClick={() => store.pushPropertyOverrideToMaster(node.id, 'properties.x')}
                  >
                    <Upload size={10} />
                  </button>
                  <button
                    className="quiet-button override-inline-reset"
                    aria-label="Reset X override"
                    title="Reset X position override to master"
                    onClick={() => store.resetPropertyOverride(node.id, 'properties.x')}
                  >
                    <RotateCcw size={10} />
                  </button>
                </div>
              ) : (
                binding('x', 'X')
              )
            }
            label="X"
            value={node.x}
            onChange={x => patch({ x })}
          />
          <NumberField
            disabled={managed}
            binding={
              managed ? null : hasYOverride ? (
                <div className="override-inline-controls">
                  <span className="property-override-badge mini" title="Y position overridden from master">
                    <span className="property-override-dot" />
                    Override
                  </span>
                  <button
                    className="quiet-button override-inline-push"
                    disabled={isMasterLocked}
                    aria-label="Push Y to master"
                    title="Push Y position override to master"
                    onClick={() => store.pushPropertyOverrideToMaster(node.id, 'properties.y')}
                  >
                    <Upload size={10} />
                  </button>
                  <button
                    className="quiet-button override-inline-reset"
                    aria-label="Reset Y override"
                    title="Reset Y position override to master"
                    onClick={() => store.resetPropertyOverride(node.id, 'properties.y')}
                  >
                    <RotateCcw size={10} />
                  </button>
                </div>
              ) : (
                binding('y', 'Y')
              )
            }
            label="Y"
            value={node.y}
            onChange={y => patch({ y })}
          />
        </div>
        <div className="property-pair">
          <NumberField
            binding={
              hasWidthOverride ? (
                <div className="override-inline-controls">
                  <span className="property-override-badge mini" title="Width overridden from master">
                    <span className="property-override-dot" />
                    Override
                  </span>
                  <button
                    className="quiet-button override-inline-push"
                    disabled={isMasterLocked}
                    aria-label="Push width to master"
                    title="Push width override to master"
                    onClick={() => store.pushPropertyOverrideToMaster(node.id, 'properties.width')}
                  >
                    <Upload size={10} />
                  </button>
                  <button
                    className="quiet-button override-inline-reset"
                    aria-label="Reset width override"
                    title="Reset width override to master"
                    onClick={() => store.resetPropertyOverride(node.id, 'properties.width')}
                  >
                    <RotateCcw size={10} />
                  </button>
                </div>
              ) : (
                binding('width', 'Width')
              )
            }
            label="Width"
            value={node.width}
            min={.01}
            onChange={width => patch({ width })}
          />
          <NumberField
            binding={
              hasHeightOverride ? (
                <div className="override-inline-controls">
                  <span className="property-override-badge mini" title="Height overridden from master">
                    <span className="property-override-dot" />
                    Override
                  </span>
                  <button
                    className="quiet-button override-inline-push"
                    disabled={isMasterLocked}
                    aria-label="Push height to master"
                    title="Push height override to master"
                    onClick={() => store.pushPropertyOverrideToMaster(node.id, 'properties.height')}
                  >
                    <Upload size={10} />
                  </button>
                  <button
                    className="quiet-button override-inline-reset"
                    aria-label="Reset height override"
                    title="Reset height override to master"
                    onClick={() => store.resetPropertyOverride(node.id, 'properties.height')}
                  >
                    <RotateCcw size={10} />
                  </button>
                </div>
              ) : (
                binding('height', 'Height')
              )
            }
            label="Height"
            value={node.height}
            min={.01}
            onChange={height => patch({ height })}
          />
        </div>
        <div className="property-pair">
          <NumberField
            label="Rotation"
            value={node.rotation}
            onChange={rotation => patch({ rotation })}
            binding={
              hasRotationOverride ? (
                <div className="override-inline-controls">
                  <span className="property-override-badge mini" title="Rotation overridden from master">
                    <span className="property-override-dot" />
                    Override
                  </span>
                  <button
                    className="quiet-button override-inline-push"
                    disabled={isMasterLocked}
                    aria-label="Push rotation to master"
                    title="Push rotation override to master"
                    onClick={() => store.pushPropertyOverrideToMaster(node.id, 'properties.rotation')}
                  >
                    <Upload size={10} />
                  </button>
                  <button
                    className="quiet-button override-inline-reset"
                    aria-label="Reset rotation override"
                    title="Reset rotation override to master"
                    onClick={() => store.resetPropertyOverride(node.id, 'properties.rotation')}
                  >
                    <RotateCcw size={10} />
                  </button>
                </div>
              ) : null
            }
          />
          <NumberField
            label="Opacity %"
            value={node.style.opacity * 100}
            min={0}
            max={100}
            onChange={opacity => style({ opacity: opacity / 100 })}
            binding={
              hasOpacityOverride ? (
                <div className="override-inline-controls">
                  <span className="property-override-badge mini" title="Opacity overridden from master">
                    <span className="property-override-dot" />
                    Override
                  </span>
                  <button
                    className="quiet-button override-inline-push"
                    disabled={isMasterLocked}
                    aria-label="Push opacity to master"
                    title="Push opacity override to master"
                    onClick={() => store.pushPropertyOverrideToMaster(node.id, 'style.opacity')}
                  >
                    <Upload size={10} />
                  </button>
                  <button
                    className="quiet-button override-inline-reset"
                    aria-label="Reset opacity override"
                    title="Reset opacity override to master"
                    onClick={() => store.resetPropertyOverride(node.id, 'style.opacity')}
                  >
                    <RotateCcw size={10} />
                  </button>
                </div>
              ) : null
            }
          />
        </div>
        {'cornerRadius' in node && (
          <NumberField
            binding={
              hasRadiusOverride ? (
                <div className="override-inline-controls">
                  <span className="property-override-badge mini" title="Radius overridden from master">
                    <span className="property-override-dot" />
                    Override
                  </span>
                  <button
                    className="quiet-button override-inline-push"
                    disabled={isMasterLocked}
                    aria-label="Push radius to master"
                    title="Push corner radius override to master"
                    onClick={() => store.pushPropertyOverrideToMaster(node.id, 'properties.cornerRadius')}
                  >
                    <Upload size={10} />
                  </button>
                  <button
                    className="quiet-button override-inline-reset"
                    aria-label="Reset radius override"
                    title="Reset corner radius override to master"
                    onClick={() => store.resetPropertyOverride(node.id, 'properties.cornerRadius')}
                  >
                    <RotateCcw size={10} />
                  </button>
                </div>
              ) : binding('cornerRadius', 'Radius')
            }
            label="Radius"
            value={node.cornerRadius}
            min={0}
            onChange={cornerRadius => patch({ cornerRadius })}
          />
        )}
        <button className="text-action" onClick={() => controller.fit(getWorldBounds(state, node.id))}>Focus element <ChevronRight size={12} /></button>
      </div>
      <SharedStyleInspector key={`shared-${node.id}`} store={store} node={node} />
      <AutoLayoutInspector key={`layout-${node.id}`} node={node} parent={parent} store={store} />
      <div className="inspector-section">
        <span className="section-caption">APPEARANCE</span>
        <div className="property-heading">
          <span className="property-heading-title">
            Fill
            {hasFillOverride && (
              <span className="property-override-badge mini" title="Fill locally overridden from master">
                <span className="property-override-dot" />
                Override
              </span>
            )}
          </span>
          <div className="property-heading-actions">
            {hasFillOverride && (
              <>
                <button
                  className="quiet-button"
                  disabled={isMasterLocked}
                  aria-label="Push fill to master"
                  title="Push fill override to master"
                  onClick={() => store.pushPropertyOverrideToMaster(node.id, 'style.fill')}
                >
                  <Upload size={11} />
                </button>
                <button
                  className="quiet-button"
                  aria-label="Reset fill override"
                  title="Reset fill override to master"
                  onClick={() => store.resetPropertyOverride(node.id, 'style.fill')}
                >
                  <RotateCcw size={11} />
                </button>
              </>
            )}
            <button className="quiet-button paint-toggle" aria-label="Toggle fill" aria-pressed={node.style.fill !== null} onClick={() => style({ fill: node.style.fill === null ? '#81adec' : null })}>{node.style.fill === null ? '+' : '−'}</button>
          </div>
        </div>
        {node.style.fill !== null && <ColorField binding={binding('fill', 'Fill', true)} label="Fill" value={node.style.fill} onChange={fill => style({ fill })} />}
        <div className="property-heading">
          <span className="property-heading-title">
            Gradient
            {hasGradientOverride && (
              <span className="property-override-badge mini" title="Gradient locally overridden from master">
                <span className="property-override-dot" />
                Override
              </span>
            )}
          </span>
          <div className="property-heading-actions">
            {hasGradientOverride && (
              <>
                <button
                  className="quiet-button"
                  disabled={isMasterLocked}
                  aria-label="Push gradient to master"
                  title="Push gradient override to master"
                  onClick={() => store.pushPropertyOverrideToMaster(node.id, 'style.gradient')}
                >
                  <Upload size={11} />
                </button>
                <button
                  className="quiet-button"
                  aria-label="Reset gradient override"
                  title="Reset gradient override to master"
                  onClick={() => store.resetPropertyOverride(node.id, 'style.gradient')}
                >
                  <RotateCcw size={11} />
                </button>
              </>
            )}
            <button
              className="quiet-button paint-toggle"
              aria-label="Toggle gradient"
              aria-pressed={!!node.style.gradient}
              onClick={() => {
                if (node.style.gradient) {
                  style({
                    gradient: null,
                    ...(node.style.shader?.kind === 'multi-stop-gradient' ? { shader: null } : {}),
                  })
                } else {
                  const defaultGrad = createDefaultGradient('linear')
                  style({ gradient: defaultGrad })
                }
              }}
            >
              {node.style.gradient ? '−' : '+'}
            </button>
          </div>
        </div>
        {node.style.gradient && (
          <GradientInspector
            gradient={node.style.gradient}
            onChange={gradient => {
              const shaderUpdate = (gradient.linkToShader || node.style.shader?.kind === 'multi-stop-gradient' || gradient.type === 'angular')
                ? { shader: gradientToShaderPaint(gradient, node.style.shader ?? undefined) }
                : {}
              style({
                gradient,
                ...shaderUpdate,
              })
            }}
            onLinkToShader={linked => {
              if (linked && node.style.gradient) {
                const nextGrad = { ...node.style.gradient, linkToShader: true }
                style({
                  gradient: nextGrad,
                  shader: gradientToShaderPaint(nextGrad, node.style.shader ?? undefined),
                })
              } else if (!linked && node.style.gradient) {
                style({
                  gradient: { ...node.style.gradient, linkToShader: false },
                  ...(node.style.shader?.kind === 'multi-stop-gradient' ? { shader: null } : {}),
                })
              }
            }}
          />
        )}
        <div className="property-heading">
          <span className="property-heading-title">
            Stroke
            {hasStrokeOverride && (
              <span className="property-override-badge mini" title="Stroke locally overridden from master">
                <span className="property-override-dot" />
                Override
              </span>
            )}
          </span>
          <div className="property-heading-actions">
            {hasStrokeOverride && (
              <>
                <button
                  className="quiet-button"
                  disabled={isMasterLocked}
                  aria-label="Push stroke to master"
                  title="Push stroke override to master"
                  onClick={() => store.pushPropertyOverrideToMaster(node.id, 'style.stroke')}
                >
                  <Upload size={11} />
                </button>
                <button
                  className="quiet-button"
                  aria-label="Reset stroke override"
                  title="Reset stroke override to master"
                  onClick={() => store.resetPropertyOverride(node.id, 'style.stroke')}
                >
                  <RotateCcw size={11} />
                </button>
              </>
            )}
            <button className="quiet-button paint-toggle" aria-label="Toggle stroke" aria-pressed={node.style.stroke !== null} onClick={() => style({ stroke: node.style.stroke ? null : { color: '#080808', width: 1, dash: [] } })}>{node.style.stroke ? '−' : '+'}</button>
          </div>
        </div>
        {node.style.stroke && <><ColorField binding={binding('stroke', 'Stroke', true)} label="Stroke" value={node.style.stroke.color} onChange={color => style({ stroke: { ...node.style.stroke!, color } })} /><NumberField label="Stroke width" value={node.style.stroke.width} min={0} step={.5} onChange={width => style({ stroke: { ...node.style.stroke!, width } })} /></>}
        <div className="property-heading">
          <span className="property-heading-title">
            Shadow
            {hasShadowOverride && (
              <span className="property-override-badge mini" title="Shadow locally overridden from master">
                <span className="property-override-dot" />
                Override
              </span>
            )}
          </span>
          <div className="property-heading-actions">
            {hasShadowOverride && (
              <>
                <button
                  className="quiet-button"
                  disabled={isMasterLocked}
                  aria-label="Push shadow to master"
                  title="Push shadow override to master"
                  onClick={() => store.pushPropertyOverrideToMaster(node.id, 'style.shadow')}
                >
                  <Upload size={11} />
                </button>
                <button
                  className="quiet-button"
                  aria-label="Reset shadow override"
                  title="Reset shadow override to master"
                  onClick={() => store.resetPropertyOverride(node.id, 'style.shadow')}
                >
                  <RotateCcw size={11} />
                </button>
              </>
            )}
            <button className="quiet-button paint-toggle" aria-label="Toggle shadow" aria-pressed={node.style.shadow !== null} onClick={() => style({ shadow: node.style.shadow ? null : { color: '#08080833', x: 0, y: 4, blur: 16 }, effects: [] })}>{node.style.shadow ? '−' : '+'}</button>
          </div>
        </div>
        {binding('shadow', 'Elevation')}
        {node.style.shadow && <><ColorField label="Shadow" value={node.style.shadow.color} onChange={color => style({ shadow: { ...node.style.shadow!, color } })} /><div className="property-pair"><NumberField label="Shadow X" value={node.style.shadow.x} onChange={x => style({ shadow: { ...node.style.shadow!, x } })} /><NumberField label="Shadow Y" value={node.style.shadow.y} onChange={y => style({ shadow: { ...node.style.shadow!, y } })} /></div><NumberField label="Blur" value={node.style.shadow.blur} min={0} onChange={blur => style({ shadow: { ...node.style.shadow!, blur } })} /></>}
      </div>
      <div className="inspector-section"><span className="section-caption">LAYER EFFECTS</span><EffectStackEditor effects={node.style.effects ?? []} tokens={store.getMultiThemeResolver().resolveForElement(node.id, state.elements)} onChange={effects => { try { style({ effects, shadow: null }) } catch { /* Keep the last valid effect while a color is being typed. */ } }} /></div>
      {hasShaderOverride && (
        <div className="property-heading" style={{ marginTop: 8 }}>
          <span className="property-heading-title">
            Shader FX
            <span className="property-override-badge mini" title="Shader effect locally overridden from master">
              <span className="property-override-dot" />
              Override
            </span>
          </span>
          <div className="property-heading-actions">
            <button
              className="quiet-button"
              disabled={isMasterLocked}
              aria-label="Push shader to master"
              title="Push shader effect override to master"
              onClick={() => store.pushPropertyOverrideToMaster(node.id, 'style.shader')}
            >
              <Upload size={11} />
            </button>
            <button
              className="quiet-button"
              aria-label="Reset shader override"
              title="Reset shader effect override to master"
              onClick={() => store.resetPropertyOverride(node.id, 'style.shader')}
            >
              <RotateCcw size={11} />
            </button>
          </div>
        </div>
      )}
      <ShaderInspector
        onGestureStart={meshGestureStart}
        onGestureEnd={meshGestureEnd}
        key={`shader-${node.id}`}
        paint={node.style.shader ?? null}
        onChange={shader => style({ shader })}
        target={node.type === 'image' ? 'Image effect' : `${node.name || 'Layer'} fill`}
        image={node.type === 'image' ? node.src : undefined}
        onBrowse={onOpenShaders}
        onBindTarget={mode => {
          if (mode === 'background') {
            if (node.style.shader) store.setBackgroundShader(node.style.shader)
          } else if (mode === 'new-card') {
            if (node.style.shader) {
              const newNode = store.add('rectangle', {
                x: node.x + 40,
                y: node.y + 40,
                width: node.width,
                height: node.height,
                cornerRadius: 8,
                style: { fill: null, shader: node.style.shader },
              })
              store.select([newNode.id])
            }
          }
        }}
      />
      {node.type === 'text' && hasTextOverride && (
        <div className="property-heading" style={{ marginTop: 8 }}>
          <span className="property-heading-title">
            Text Copy
            <span className="property-override-badge mini" title="Text copy locally overridden from master">
              <span className="property-override-dot" />
              Override
            </span>
          </span>
          <div className="property-heading-actions">
            <button
              className="quiet-button"
              disabled={isMasterLocked}
              aria-label="Push text override to master"
              title="Push text override to master"
              onClick={() => store.pushPropertyOverrideToMaster(node.id, 'properties.text')}
            >
              <Upload size={11} />
            </button>
            <button
              className="quiet-button"
              aria-label="Reset text override"
              title="Reset text override to master"
              onClick={() => store.resetPropertyOverride(node.id, 'properties.text')}
            >
              <RotateCcw size={11} />
            </button>
          </div>
        </div>
      )}
      {node.type === 'text' && hasKineticOverride && (
        <div className="property-heading" style={{ marginTop: 8 }}>
          <span className="property-heading-title">
            Kinetic Motion
            <span className="property-override-badge mini" title="Kinetic typography locally overridden from master">
              <span className="property-override-dot" />
              Override
            </span>
          </span>
          <div className="property-heading-actions">
            <button
              className="quiet-button"
              disabled={isMasterLocked}
              aria-label="Push kinetic override to master"
              title="Push kinetic typography override to master"
              onClick={() => store.pushPropertyOverrideToMaster(node.id, 'properties.kinetic')}
            >
              <Upload size={11} />
            </button>
            <button
              className="quiet-button"
              aria-label="Reset kinetic override"
              title="Reset kinetic typography override to master"
              onClick={() => store.resetPropertyOverride(node.id, 'properties.kinetic')}
            >
              <RotateCcw size={11} />
            </button>
          </div>
        </div>
      )}
      {node.type === 'text' && <TypographyStudio key={node.id} store={store} node={node} binding={binding} />}
      {node.type === 'path' && <div className="inspector-section"><span className="section-caption">VECTOR PATH</span><textarea className="property-textarea property-mono" key={node.id + node.d} aria-label="SVG path data" readOnly={!!node.boolean} defaultValue={node.d} onBlur={event => { if (!node.boolean && event.currentTarget.value !== node.d) store.update(node.id, 'path', { d: event.currentTarget.value }) }} />{node.boolean && <p>Flatten the compound to edit its merged outline with the pen tool.</p>}{!node.boolean && onOpenMorph && <button className="text-action" style={{ marginTop: 8 }} onClick={() => onOpenMorph?.({ id: `canvas-${node.id}`, name: node.name, d: node.d, viewBox: node.viewBox ?? [0, 0, 120, 120], fillRule: node.fillRule, color: node.style.fill ?? '#81adec' })}>Morph vector path <ChevronRight size={12} /></button>}</div>}
      {node.type === 'image' && <div className="inspector-section"><span className="section-caption">IMAGE</span><label className="property-label">Source<input className="property-input" key={node.id + node.src} aria-label="Image source" defaultValue={node.src} onBlur={event => store.update(node.id, 'image', { src: event.currentTarget.value })} /></label><label className="property-label">Alt text<input className="property-input" key={node.id + node.alt} aria-label="Image alt text" defaultValue={node.alt} onBlur={event => store.update(node.id, 'image', { alt: event.currentTarget.value })} /></label><label className="property-select">Fit<select aria-label="Image fit" value={node.fit} onChange={event => store.update(node.id, 'image', { fit: event.currentTarget.value as typeof node.fit })}><option value="contain">Contain</option><option value="cover">Cover</option><option value="fill">Fill</option></select></label></div>}
      <div className="inspector-section"><span className="section-caption">HIERARCHY</span>
        <label className="property-select">Parent<select disabled={instanceChild} aria-label="Parent frame" value={node.parentId ?? ''} onChange={event => store.reparent(node.id, event.currentTarget.value || null)}><option value="">Canvas</option>{instanceChild && parent && <option value={parent.id}>{parent.name}</option>}{parentOptions.map(frame => <option key={frame.id} value={frame.id}>{frame.name}</option>)}</select></label>
        {node.type === 'frame' && <div className="setting-row"><span>Clip content</span><button className={`grid-switch ${node.clipContent ? 'on' : ''}`} role="switch" aria-checked={node.clipContent} aria-label="Clip frame content" onClick={() => store.update(node.id, 'frame', { clipContent: !node.clipContent })}><span /></button></div>}
        <div className="element-actions"><button aria-label="Send backward" disabled={instanceChild || node.zIndex === 0} onClick={() => store.reorder(node.id, node.zIndex - 1)}><ArrowDown size={13} /></button><button aria-label="Bring forward" disabled={instanceChild || node.zIndex === store.getChildren(node.parentId).length - 1} onClick={() => store.reorder(node.id, node.zIndex + 1)}><ArrowUp size={13} /></button><button aria-label="Lock selected element" onClick={() => store.setLocked(node.id, true)}><LockKeyhole size={13} /></button><button aria-label="Delete selected element" disabled={instanceChild} title={instanceChild ? 'Detach the instance to delete individual layers' : 'Delete layer'} onClick={() => store.remove(node.id)}><Trash2 size={13} /></button></div>
      </div>
    </> : <div className="inspector-section"><span className="section-caption">WORKING SPACE</span><h3>{state.selection.length > 1 ? 'Ideas, together.' : 'Beyond the edges.'}</h3><p>{state.selection.length > 1 ? 'Select a single layer to edit its properties.' : <>Select a layer to shape it.<br />Add something. Make it yours.</>}</p></div>}
    {state.selection.length === 0 && (
      <BackgroundLayersInspector
        store={store}
        onGestureStart={meshGestureStart}
        onGestureEnd={meshGestureEnd}
        onBrowse={onOpenShaders}
      />
    )}
    <div className="inspector-section"><span className="section-caption">ENGINEERING GRID</span><div className="setting-row"><span>Show grid</span><button className={`grid-switch ${grid ? 'on' : ''}`} role="switch" aria-checked={grid} aria-label="Show engineering grid" onClick={onGridChange}><span /></button></div><div className="setting-row"><span>Major interval</span><code>120 px</code></div><div className="setting-row"><span>Subdivisions</span><code>24 px</code></div></div>
    {!node && <div className="inspector-section navigation-guide"><span className="section-caption">FIND YOUR WAY</span><div><span>Pan</span><kbd>Space + drag</kbd></div><div><span>Zoom</span><kbd>Scroll / pinch</kbd></div><div><span>Actual size</span><kbd>0</kbd></div><div><span>Fit canvas</span><kbd>1</kbd></div><div><span>Multi-select</span><kbd>Shift + click</kbd></div></div>}
    <div className="inspector-bottom"><p>Your ideas.<br />Your tools. Your space.</p><span>OPEN SOURCE · SELF HOSTED</span></div>
  </aside>
}
