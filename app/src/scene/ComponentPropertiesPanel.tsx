import { useState } from 'react'
import { Plus, RotateCcw, Sparkles, Trash2, Upload } from 'lucide-react'
import type { SceneStore } from './store'
import type { ComponentOverrides, ComponentProperty, ComponentPropertyValue, SceneElement } from './types'
import { subtree } from './components'
import { ComponentStateMachineEditor } from './ComponentStateMachineEditor'
import { ComponentVariantMatrixEditor } from './ComponentVariantMatrixEditor'
import { getEffectiveStateMachine, DEFAULT_INTERACTIVE_STATES } from './stateMachine'
import { shaderBlendModes } from '../shaders/types'

/** Capture visual channels, preserving token/style links for future theme changes. */
function capture(node: SceneElement): ComponentOverrides {
  return {
    style: { ...node.style },
    properties: {
      width: node.width,
      height: node.height,
      ...('cornerRadius' in node ? { cornerRadius: node.cornerRadius } : {}),
      ...(node.type === 'text'
        ? {
            text: node.text,
            fontFamily: node.fontFamily,
            fontSize: node.fontSize,
            fontWeight: node.fontWeight,
            lineHeight: node.lineHeight,
            letterSpacing: node.letterSpacing,
            textAlign: node.textAlign,
            ...(node.kinetic ? { kinetic: node.kinetic } : {}),
          }
        : {}),
    },
    ...(node.tokenBindings ? { tokenBindings: node.tokenBindings } : {}),
    ...(node.sharedStyleBindings ? { sharedStyleBindings: node.sharedStyleBindings } : {}),
  }
}

function propertySubtitle(prop: ComponentProperty): string {
  if (prop.kind === 'variant') return 'Variant'
  if (prop.kind === 'boolean') {
    return prop.targetProperty === 'clipContent'
      ? 'Clip content'
      : prop.targetProperty === 'kinetic.enabled'
      ? 'Kinetic toggle'
      : 'Visibility'
  }
  if (prop.kind === 'text') return 'Text slot'
  if (prop.kind === 'color') return `Color · ${prop.targetProperty ?? 'fill'}`
  if (prop.kind === 'number') return `Number · ${prop.targetProperty ?? 'value'}`
  if (prop.kind === 'kinetic') return `Kinetic · ${prop.targetProperty}`
  if (prop.kind === 'shader') return `Shader · ${prop.targetProperty}`
  return 'Property'
}

function formatMasterDefault(property: ComponentProperty): string {
  if (property.kind === 'boolean') {
    return property.defaultValue ? 'Active' : 'Off'
  }
  if (property.kind === 'number') {
    return `${property.defaultValue}${property.targetProperty === 'opacity' ? '' : 'px'}`
  }
  if (property.kind === 'color') {
    return String(property.defaultValue)
  }
  if (property.kind === 'text') {
    const str = String(property.defaultValue)
    return str.length > 14 ? `"${str.slice(0, 12)}…"` : `"${str}"`
  }
  return String(property.defaultValue)
}

function PropertyField({
  property,
  value,
  disabled,
  onChange,
}: {
  property: ComponentProperty
  value: ComponentPropertyValue
  disabled: boolean
  onChange: (val: ComponentPropertyValue) => void
}) {
  if (property.kind === 'variant') {
    return (
      <select
        className="property-input"
        aria-label={property.name}
        disabled={disabled}
        value={String(value)}
        onChange={event => onChange(event.currentTarget.value)}
      >
        {property.options.map(option => (
          <option key={option.value} value={option.value}>
            {option.value}
          </option>
        ))}
      </select>
    )
  }

  if (property.kind === 'boolean') {
    const labelText = value
      ? property.targetProperty === 'clipContent'
        ? 'Clipped'
        : property.targetProperty === 'kinetic.enabled'
        ? 'Kinetic Active'
        : 'Visible'
      : property.targetProperty === 'clipContent'
      ? 'Unclipped'
      : property.targetProperty === 'kinetic.enabled'
      ? 'Static'
      : 'Hidden'
    return (
      <label className="component-property-switch">
        <input
          type="checkbox"
          aria-label={property.name}
          disabled={disabled}
          checked={Boolean(value)}
          onChange={event => onChange(event.currentTarget.checked)}
        />
        <span>{labelText}</span>
      </label>
    )
  }

  if (property.kind === 'text') {
    return (
      <input
        className="property-input"
        aria-label={property.name}
        disabled={disabled}
        value={String(value)}
        onChange={event => onChange(event.currentTarget.value)}
      />
    )
  }

  if (property.kind === 'color') {
    const colorStr = String(value)
    return (
      <div className="component-color-field">
        <input
          type="color"
          className="component-color-swatch"
          aria-label={`${property.name} swatch`}
          disabled={disabled}
          value={colorStr.startsWith('#') && (colorStr.length === 7 || colorStr.length === 9) ? colorStr.slice(0, 7) : '#81adec'}
          onChange={event => onChange(event.currentTarget.value)}
        />
        <input
          className="property-input property-mono"
          aria-label={property.name}
          disabled={disabled}
          value={colorStr}
          onChange={event => onChange(event.currentTarget.value)}
        />
      </div>
    )
  }

  if (property.kind === 'number') {
    const step = property.step ?? (property.targetProperty === 'opacity' ? 0.05 : 1)
    return (
      <input
        type="number"
        className="property-input"
        aria-label={property.name}
        disabled={disabled}
        value={Number(value)}
        min={property.min}
        max={property.max}
        step={step}
        onChange={event => onChange(event.currentTarget.valueAsNumber)}
      />
    )
  }

  if (property.kind === 'kinetic') {
    if (property.targetProperty === 'enabled' || property.targetProperty === 'playing') {
      const isPlayingProp = property.targetProperty === 'playing'
      const labelText = isPlayingProp
        ? (value ? 'Playing' : 'Paused')
        : (value ? 'Kinetic Active' : 'Static')
      return (
        <label className="component-property-switch">
          <input
            type="checkbox"
            aria-label={property.name}
            disabled={disabled}
            checked={Boolean(value)}
            onChange={event => onChange(event.currentTarget.checked)}
          />
          <span>{labelText}</span>
        </label>
      )
    }
    if (property.targetProperty === 'waveShape') {
      return (
        <select
          className="property-input"
          aria-label={property.name}
          disabled={disabled}
          value={String(value)}
          onChange={event => onChange(event.currentTarget.value)}
        >
          <option value="sine">Sine</option>
          <option value="triangle">Triangle</option>
          <option value="bounce">Bounce</option>
          <option value="spring">Spring</option>
        </select>
      )
    }
    if (property.targetProperty === 'staggerMode') {
      return (
        <select
          className="property-input"
          aria-label={property.name}
          disabled={disabled}
          value={String(value)}
          onChange={event => onChange(event.currentTarget.value)}
        >
          <option value="cascade">Cascade</option>
          <option value="wave">Wave</option>
          <option value="center-out">Center Out</option>
          <option value="random">Random</option>
          <option value="elastic">Elastic</option>
        </select>
      )
    }
    const kineticStep = property.targetProperty === 'duration'
      ? 50
      : property.targetProperty === 'stagger'
      ? 5
      : property.targetProperty === 'scaleModulation'
      ? 0.05
      : property.targetProperty === 'weightModulation'
      ? 10
      : 1
    return (
      <input
        type="number"
        className="property-input"
        aria-label={property.name}
        disabled={disabled}
        value={Number(value)}
        step={kineticStep}
        onChange={event => onChange(event.currentTarget.valueAsNumber)}
      />
    )
  }

  if (property.kind === 'shader') {
    if (property.targetProperty === 'blendMode') {
      return (
        <select
          className="property-input"
          aria-label={property.name}
          disabled={disabled}
          value={String(value)}
          onChange={event => onChange(event.currentTarget.value)}
        >
          {shaderBlendModes.map(mode => (
            <option key={mode} value={mode}>
              {mode}
            </option>
          ))}
        </select>
      )
    }
    if (property.targetProperty === 'viewMode') {
      return (
        <select
          className="property-input"
          aria-label={property.name}
          disabled={disabled}
          value={String(value)}
          onChange={event => onChange(event.currentTarget.value)}
        >
          <option value="shaded">Shaded Surface</option>
          <option value="normal-map">Tangent Normal Map</option>
          <option value="displacement">Height / Displacement</option>
        </select>
      )
    }
    if (property.targetProperty === 'noiseType') {
      return (
        <select
          className="property-input"
          aria-label={property.name}
          disabled={disabled}
          value={String(value)}
          onChange={event => onChange(event.currentTarget.value)}
        >
          <option value="simplex">Simplex</option>
          <option value="perlin">Perlin</option>
          <option value="worley">Worley</option>
        </select>
      )
    }
    const shaderStep = property.targetProperty === 'octaves'
      ? 1
      : ['frequency', 'turbulence', 'displacement', 'normalPerturbation', 'lacunarity', 'fluidAdvection', 'fluidViscosity'].includes(property.targetProperty)
      ? 0.05
      : property.targetProperty === 'chromaticAberration'
      ? 0.01
      : 0.1
    return (
      <input
        type="number"
        className="property-input"
        aria-label={property.name}
        disabled={disabled}
        value={Number(value)}
        step={shaderStep}
        onChange={event => onChange(event.currentTarget.valueAsNumber)}
      />
    )
  }

  return null
}

export function ComponentPropertiesPanel({
  store,
  master,
  root,
  disabled,
}: {
  store: SceneStore
  master: SceneElement
  root: SceneElement
  disabled: boolean
}) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<ComponentProperty['kind']>('variant')
  const [options, setOptions] = useState('Default, Accent')
  const [target, setTarget] = useState(master.id)
  const [targetProperty, setTargetProperty] = useState<string>('visible')
  const [error, setError] = useState('')

  if (master.component?.kind !== 'master') return null
  const properties = master.component.properties ?? []
  const instance = root.component?.kind === 'instance' ? root.component : undefined
  const machine = getEffectiveStateMachine(master)
  const variantProp = properties.find(p => p.kind === 'variant')
  const availableStates =
    machine?.states ??
    (variantProp && variantProp.kind === 'variant'
      ? variantProp.options.map(o => o.value)
      : DEFAULT_INTERACTIVE_STATES)
  const layers = subtree(store.getSnapshot().elements, master.id)

  const perform = (action: () => void) => {
    try {
      action()
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to edit property')
    }
  }

  const replace = (next: ComponentProperty) =>
    store.setComponentProperties(
      master.id,
      properties.map(property => (property.id === next.id ? next : property))
    )

  const add = () =>
    perform(() => {
      const source = layers.find(layer => layer.id === target)
      const common = { id: crypto.randomUUID(), name: name.trim() }
      let property: ComponentProperty

      if (kind === 'variant') {
        const values = options
          .split(',')
          .map(value => value.trim())
          .filter(Boolean)
        if (!values.length) throw new Error('Enter at least one variant option')
        property = {
          ...common,
          kind,
          defaultValue: values[0],
          options: values.map(value => ({ value, layers: {} })),
        }
      } else if (kind === 'text') {
        if (!source || source.type !== 'text') throw new Error('Choose a text layer for a text slot')
        property = { ...common, kind, sourceId: source.id, defaultValue: source.text }
      } else if (kind === 'boolean') {
        if (!source) throw new Error('Choose a layer for a boolean property')
        const tProp = (targetProperty as 'visible' | 'kinetic.enabled' | 'clipContent') || 'visible'
        const def =
          tProp === 'clipContent' && source.type === 'frame'
            ? source.clipContent
            : tProp === 'kinetic.enabled' && source.type === 'text'
            ? source.kinetic?.enabled ?? true
            : source.visible
        property = { ...common, kind, sourceId: source.id, defaultValue: def, targetProperty: tProp }
      } else if (kind === 'color') {
        if (!source) throw new Error('Choose a layer for a color property')
        const tProp = (targetProperty as 'fill' | 'stroke' | 'shader') || 'fill'
        const def =
          tProp === 'stroke'
            ? source.style.stroke?.color ?? '#080808'
            : source.style.fill ?? '#81adec'
        property = { ...common, kind, sourceId: source.id, defaultValue: def, targetProperty: tProp }
      } else if (kind === 'number') {
        if (!source) throw new Error('Choose a layer for a numeric parameter')
        const tProp = targetProperty || 'opacity'
        let def = 1
        if (tProp === 'opacity') def = source.style.opacity ?? 1
        else if (tProp === 'cornerRadius' && 'cornerRadius' in source) def = source.cornerRadius
        else if (tProp === 'width') def = source.width
        else if (tProp === 'height') def = source.height
        else if (tProp === 'strokeWidth') def = source.style.stroke?.width ?? 1
        else if (tProp === 'fontSize' && source.type === 'text') def = source.fontSize
        else if (tProp === 'fontWeight' && source.type === 'text') def = source.fontWeight
        else if (tProp === 'letterSpacing' && source.type === 'text') def = source.letterSpacing
        property = { ...common, kind, sourceId: source.id, defaultValue: def, targetProperty: tProp }
      } else if (kind === 'kinetic') {
        if (!source || source.type !== 'text') throw new Error('Choose a text layer for kinetic typography')
        const tProp =
          (targetProperty as
            | 'enabled'
            | 'amplitude'
            | 'rotation'
            | 'duration'
            | 'stagger'
            | 'waveShape'
            | 'staggerMode'
            | 'weightModulation'
            | 'slantModulation'
            | 'scaleModulation'
            | 'playing'
            | 'phase'
            | 'horizontalAmplitude'
            | 'widthModulation'
            | 'opticalSizeModulation') || 'amplitude'
        let def: string | number | boolean = 16
        if (tProp === 'enabled') def = source.kinetic?.enabled ?? true
        else if (tProp === 'playing') def = source.kinetic?.playing ?? true
        else if (tProp === 'waveShape') def = source.kinetic?.waveShape ?? 'sine'
        else if (tProp === 'staggerMode') def = source.kinetic?.staggerMode ?? 'cascade'
        else if (tProp === 'duration') def = source.kinetic?.duration ?? 800
        else if (tProp === 'stagger') def = source.kinetic?.stagger ?? 40
        else if (tProp === 'phase') def = source.kinetic?.phase ?? 0
        else if (source.kinetic && tProp in source.kinetic) {
          def = (source.kinetic as any)[tProp] ?? 16
        }
        property = { ...common, kind, sourceId: source.id, defaultValue: def, targetProperty: tProp }
      } else if (kind === 'shader') {
        if (!source || !source.style.shader) throw new Error('Choose a layer with a shader effect')
        const tProp =
          (targetProperty as
            | 'speed'
            | 'scale'
            | 'rotation'
            | 'frequency'
            | 'octaves'
            | 'turbulence'
            | 'displacement'
            | 'viewMode'
            | 'blendMode'
            | 'lacunarity'
            | 'persistence'
            | 'normalPerturbation'
            | 'grainOverlay'
            | 'chromaticAberration'
            | 'warpModulation'
            | 'fluidAdvection'
            | 'fluidViscosity'
            | 'noiseType') || 'speed'
        let def: string | number | boolean = 1
        if (tProp === 'speed') def = source.style.shader.speed ?? 1
        else if (tProp === 'scale') def = source.style.shader.scale ?? 1
        else if (tProp === 'rotation') def = source.style.shader.rotation ?? 0
        else if (tProp === 'viewMode') def = (source.style.shader.mesh?.viewMode ?? (source.style.shader.params as any)?.viewMode) ?? 'shaded'
        else if (tProp === 'noiseType') def = (source.style.shader.mesh?.noiseType ?? (source.style.shader.params as any)?.noiseType) ?? 'simplex'
        else if (tProp === 'blendMode') def = source.style.shader.composite?.blendMode ?? 'normal'
        else if (source.style.shader.mesh && tProp in source.style.shader.mesh) {
          def = (source.style.shader.mesh as any)[tProp] ?? 1
        } else if (source.style.shader.params && tProp in source.style.shader.params) {
          def = (source.style.shader.params as any)[tProp] ?? 1
        }
        property = { ...common, kind, sourceId: source.id, defaultValue: def, targetProperty: tProp }
      } else {
        throw new Error('Unsupported property kind')
      }

      store.setComponentProperties(master.id, [...properties, property])
      setAdding(false)
      setName('')
    })

  return (
    <div className="component-properties" data-testid="component-properties">
      <div className="component-section-heading">
        <span className="section-caption">DYNAMIC PROPERTIES</span>
        {!instance && (
          <div className="component-heading-actions">
            <button
              className="quiet-button"
              title="Auto-expose detected properties (kinetic typography, shaders, colors)"
              aria-label="Auto-expose properties"
              disabled={disabled}
              onClick={() => perform(() => store.autoExposeComponentProperties(master.id))}
            >
              <Sparkles size={13} />
            </button>
            <button
              className="quiet-button"
              title="Add component property"
              aria-label="Add component property"
              disabled={disabled}
              onClick={() => setAdding(value => !value)}
            >
              <Plus size={13} />
            </button>
          </div>
        )}
      </div>

      {!properties.length && (
        <p>
          {instance
            ? 'This master has no configurable properties.'
            : 'Expose variants, kinetic typography, and shader parameters as reusable controls.'}
        </p>
      )}

      {instance && master.component.variantMatrix?.dimensions.map(dim => {
        const dimVal = instance.propertyValues?.[dim.id] ?? instance.propertyValues?.[dim.name] ?? dim.defaultValue
        const isLocal = Boolean(instance.propertyValues && (Object.hasOwn(instance.propertyValues, dim.id) || Object.hasOwn(instance.propertyValues, dim.name)))
        const change = (val: string) =>
          perform(() => store.setComponentProperty(root.id, dim.name, val))
        const reset = () =>
          perform(() => store.setComponentProperty(root.id, dim.name, null))

        return (
          <div key={dim.id} className={`component-property ${isLocal ? 'is-local' : ''}`}>
            <div className="component-property-heading">
              <span>
                {dim.name}
                <small>
                  Variant Dimension
                  {isLocal && <span className="property-master-hint"> · Default: {dim.defaultValue}</span>}
                </small>
              </span>
              {isLocal && (
                <div className="component-property-actions">
                  <span className="property-override-badge" title={`Locally overridden (Default: ${dim.defaultValue})`}>
                    <span className="property-override-dot" />
                    Override
                  </span>
                  <button
                    className="quiet-button"
                    disabled={disabled || store.isLocked(master.id)}
                    aria-label={`Push ${dim.name} to master`}
                    title={`Push "${dim.name}" override back to master default`}
                    onClick={() => perform(() => store.pushComponentPropertyToMaster(root.id, dim.id))}
                  >
                    <Upload size={11} />
                  </button>
                  <button
                    className="quiet-button"
                    disabled={disabled}
                    aria-label={`Reset ${dim.name}`}
                    title={`Reset "${dim.name}" to default (${dim.defaultValue})`}
                    onClick={reset}
                  >
                    <RotateCcw size={11} />
                  </button>
                </div>
              )}
            </div>
            <select
              className="property-input"
              aria-label={dim.name}
              disabled={disabled}
              value={String(dimVal)}
              onChange={e => change(e.currentTarget.value)}
            >
              {dim.values.map(val => (
                <option key={val} value={val}>
                  {val} {val === dim.defaultValue ? '(Default)' : ''}
                </option>
              ))}
            </select>
          </div>
        )
      })}

      {instance && (machine || (variantProp && variantProp.options.length > 1)) && (
        <div className={`component-property ${instance.activeState ? 'is-local' : ''}`}>
          <div className="component-property-heading">
            <span>
              Interactive State<small>Micro-interaction</small>
            </span>
            {instance.activeState && (
              <div className="component-property-actions">
                <span className="property-override-badge" title="Locally overridden state">
                  <span className="property-override-dot" />
                  Override
                </span>
                <button
                  className="quiet-button"
                  disabled={disabled}
                  aria-label="Reset interactive state"
                  title="Use default state"
                  onClick={() => perform(() => store.setComponentActiveState(root.id, null))}
                >
                  <RotateCcw size={11} />
                </button>
              </div>
            )}
          </div>
          <select
            className="property-input"
            aria-label="Interactive State"
            disabled={disabled}
            value={instance.activeState ?? 'default'}
            onChange={event =>
              perform(() =>
                store.setComponentActiveState(
                  root.id,
                  event.currentTarget.value === 'default' ? null : event.currentTarget.value
                )
              )
            }
          >
            {availableStates.map(stateName => (
              <option key={stateName} value={stateName}>
                {stateName} {stateName === (machine?.initial ?? 'default') ? '(Default)' : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {properties.map(property => {
        const value = instance?.propertyValues?.[property.id] ?? property.defaultValue ?? ''
        const local = instance && Object.hasOwn(instance.propertyValues ?? {}, property.id)
        const change = (next: ComponentPropertyValue) =>
          perform(() =>
            instance
              ? store.setComponentProperty(root.id, property.id, next)
              : replace({ ...property, defaultValue: next } as ComponentProperty)
          )

        return (
          <div key={property.id} className={`component-property ${local ? 'is-local' : ''}`}>
            <div className="component-property-heading">
              <span>
                {property.name}
                <small>
                  {propertySubtitle(property)}
                  {local && <span className="property-master-hint"> · Master: {formatMasterDefault(property)}</span>}
                </small>
              </span>
              {instance ? (
                <div className="component-property-actions">
                  {local && (
                    <>
                      <span className="property-override-badge" title={`Locally overridden (Master default: ${formatMasterDefault(property)})`}>
                        <span className="property-override-dot" />
                        Override
                      </span>
                      <button
                        className="quiet-button"
                        disabled={disabled || store.isLocked(master.id)}
                        aria-label={`Push ${property.name} to master`}
                        title={`Push "${property.name}" override back to master symbol`}
                        onClick={() => perform(() => store.pushComponentPropertyToMaster(root.id, property.id))}
                      >
                        <Upload size={11} />
                      </button>
                    </>
                  )}
                  <button
                    className="quiet-button"
                    disabled={!local || disabled}
                    aria-label={`Reset ${property.name}`}
                    title={local ? `Reset "${property.name}" to master default (${formatMasterDefault(property)})` : 'Inherited from master'}
                    onClick={() => perform(() => store.setComponentProperty(root.id, property.id, null))}
                  >
                    <RotateCcw size={11} />
                  </button>
                </div>
              ) : (
                <button
                  className="quiet-button"
                  disabled={disabled}
                  aria-label={`Remove ${property.name}`}
                  onClick={() =>
                    perform(() =>
                      store.setComponentProperties(
                        master.id,
                        properties.filter(item => item.id !== property.id)
                      )
                    )
                  }
                >
                  <Trash2 size={11} />
                </button>
              )}
            </div>

            <PropertyField
              property={property}
              value={value}
              disabled={disabled}
              onChange={change}
            />

            {!instance && property.kind === 'variant' && (
              <div className="component-variant-capture">
                {property.options.map(option => (
                  <div key={option.value}>
                    <span>
                      {option.value}
                      <small>
                        {Object.keys(option.layers).length
                          ? `${Object.keys(option.layers).length} captured layers`
                          : 'Inherits master'}
                      </small>
                    </span>
                    <button
                      className="text-action"
                      disabled={disabled}
                      title="Save the current master’s appearance for this option"
                      aria-label={`Capture ${property.name} ${option.value}`}
                      onClick={() =>
                        perform(() =>
                          replace({
                            ...property,
                            options: property.options.map(item =>
                              item.value === option.value
                                ? {
                                    ...item,
                                    layers: Object.fromEntries(
                                      layers.map(layer => [layer.id, capture(layer)])
                                    ),
                                  }
                                : item
                            ),
                          })
                        )
                      }
                    >
                      Capture
                    </button>
                    {Object.keys(option.layers).length > 0 && (
                      <button
                        className="quiet-button"
                        disabled={disabled}
                        title="Restore inheritance"
                        aria-label={`Clear ${property.name} ${option.value}`}
                        onClick={() =>
                          perform(() =>
                            replace({
                              ...property,
                              options: property.options.map(item =>
                                item.value === option.value ? { ...item, layers: {} } : item
                              ),
                            })
                          )
                        }
                      >
                        <RotateCcw size={11} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}

      {!instance && properties.some(property => property.kind === 'variant') && (
        <p>Edit the master, then capture an option. Captured tokens stay linked; uncaptured options inherit the master.</p>
      )}

      {!instance && <ComponentVariantMatrixEditor store={store} master={master} disabled={disabled} />}
      {!instance && <ComponentStateMachineEditor store={store} master={master} disabled={disabled} />}

      {adding && !instance && (
        <form
          className="component-property-form"
          onSubmit={event => {
            event.preventDefault()
            add()
          }}
        >
          <input
            className="property-input"
            autoFocus
            aria-label="Property name"
            placeholder="Property name (e.g. Wave Amplitude, Tint, Speed)"
            required
            maxLength={100}
            value={name}
            onChange={event => setName(event.currentTarget.value)}
          />

          <select
            className="property-input"
            aria-label="Property kind"
            value={kind}
            onChange={event => {
              const next = event.currentTarget.value as ComponentProperty['kind']
              setKind(next)
              if (next === 'text' || next === 'kinetic') {
                const textLayer = layers.find(layer => layer.type === 'text')
                setTarget(textLayer ? textLayer.id : master.id)
                if (next === 'kinetic') setTargetProperty('amplitude')
              } else if (next === 'shader') {
                const shaderLayer = layers.find(layer => Boolean(layer.style.shader))
                setTarget(shaderLayer ? shaderLayer.id : master.id)
                setTargetProperty('speed')
              } else if (next === 'color') {
                setTargetProperty('fill')
              } else if (next === 'number') {
                setTargetProperty('opacity')
              } else if (next === 'boolean') {
                setTargetProperty('visible')
              }
            }}
          >
            <option value="variant">Variant switch</option>
            <option value="boolean">Visibility / boolean switch</option>
            <option value="text">Text slot</option>
            <option value="color">Color override</option>
            <option value="number">Numeric parameter</option>
            <option value="kinetic">Kinetic typography</option>
            <option value="shader">Shader parameter</option>
          </select>

          {kind === 'variant' && (
            <input
              className="property-input"
              aria-label="Variant options"
              placeholder="Default, Accent, Muted"
              required
              value={options}
              onChange={event => setOptions(event.currentTarget.value)}
            />
          )}

          {kind !== 'variant' && (
            <select
              className="property-input"
              aria-label="Property layer"
              value={target}
              onChange={event => setTarget(event.currentTarget.value)}
            >
              {layers
                .filter(layer => {
                  if (kind === 'text' || kind === 'kinetic') return layer.type === 'text'
                  if (kind === 'shader') return Boolean(layer.style.shader)
                  return true
                })
                .map(layer => (
                  <option key={layer.id} value={layer.id}>
                    {layer.name} ({layer.type})
                  </option>
                ))}
            </select>
          )}

          {kind === 'boolean' && (
            <select
              className="property-input"
              aria-label="Target property"
              value={targetProperty}
              onChange={event => setTargetProperty(event.currentTarget.value)}
            >
              <option value="visible">Visibility</option>
              <option value="kinetic.enabled">Kinetic Active</option>
              <option value="clipContent">Clip Content</option>
            </select>
          )}

          {kind === 'color' && (
            <select
              className="property-input"
              aria-label="Target property"
              value={targetProperty}
              onChange={event => setTargetProperty(event.currentTarget.value)}
            >
              <option value="fill">Fill color</option>
              <option value="stroke">Stroke color</option>
              <option value="shader">Shader tint</option>
            </select>
          )}

          {kind === 'number' && (
            <select
              className="property-input"
              aria-label="Target property"
              value={targetProperty}
              onChange={event => setTargetProperty(event.currentTarget.value)}
            >
              <option value="opacity">Opacity (0 to 1)</option>
              <option value="cornerRadius">Corner radius</option>
              <option value="width">Width</option>
              <option value="height">Height</option>
              <option value="strokeWidth">Stroke width</option>
              <option value="fontSize">Font size</option>
              <option value="fontWeight">Font weight</option>
              <option value="letterSpacing">Letter spacing</option>
            </select>
          )}

          {kind === 'kinetic' && (
            <select
              className="property-input"
              aria-label="Target property"
              value={targetProperty}
              onChange={event => setTargetProperty(event.currentTarget.value)}
            >
              <option value="amplitude">Amplitude (px)</option>
              <option value="horizontalAmplitude">Horizontal amplitude (px)</option>
              <option value="rotation">Rotation (°)</option>
              <option value="duration">Duration (ms)</option>
              <option value="stagger">Stagger delay (ms)</option>
              <option value="phase">Phase offset (°)</option>
              <option value="waveShape">Wave shape</option>
              <option value="staggerMode">Stagger mode</option>
              <option value="weightModulation">Weight modulation</option>
              <option value="slantModulation">Slant modulation</option>
              <option value="scaleModulation">Scale modulation</option>
              <option value="widthModulation">Width modulation</option>
              <option value="opticalSizeModulation">Optical size modulation</option>
              <option value="enabled">Active toggle</option>
              <option value="playing">Playing toggle</option>
            </select>
          )}

          {kind === 'shader' && (
            <select
              className="property-input"
              aria-label="Target property"
              value={targetProperty}
              onChange={event => setTargetProperty(event.currentTarget.value)}
            >
              <option value="speed">Animation speed</option>
              <option value="scale">Texture scale</option>
              <option value="rotation">Rotation (°)</option>
              <option value="frequency">Noise frequency</option>
              <option value="octaves">Noise octaves</option>
              <option value="turbulence">Turbulence</option>
              <option value="displacement">Displacement</option>
              <option value="viewMode">Surface view mode</option>
              <option value="noiseType">Noise generator</option>
              <option value="normalPerturbation">Normal perturbation</option>
              <option value="lacunarity">Lacunarity</option>
              <option value="persistence">Persistence</option>
              <option value="grainOverlay">Grain overlay</option>
              <option value="chromaticAberration">Chromatic aberration</option>
              <option value="warpModulation">Warp modulation</option>
              <option value="fluidAdvection">Fluid advection</option>
              <option value="fluidViscosity">Fluid viscosity</option>
              <option value="blendMode">Blend mode</option>
            </select>
          )}

          <button className="component-action primary" disabled={disabled} type="submit">
            <Plus size={12} />
            Add property
          </button>
        </form>
      )}

      {error && (
        <p className="component-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
