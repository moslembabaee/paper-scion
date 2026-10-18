import { Pause, Play, Sparkles } from 'lucide-react'
import { useId, useState } from 'react'
import { createShader, motionControls, shaderCatalog, shaderKinds, updateShaderParameter } from './catalog'
import type { ShaderControl, ShaderDefinition, ShaderKind, ShaderMotion, ShaderPaint, ShaderValue } from './types'
import { shaderBlendModes } from './types'
import './shaders.css'
import { MeshInspector } from './MeshInspector'
import { MaterialComposer } from './pipeline/MaterialComposer'
import { PostProcessingInspector } from '../canvas/postprocessing/PostProcessingInspector'
import { NoiseInspector } from './noise/NoiseInspector'
import { GradientInspector } from './GradientInspector'
import { createDefaultGradient, gradientToShaderPaint } from './gradient'
import { RefractiveInspector } from './refractive/RefractiveInspector'
import type { RefractivePaint } from './refractive/types'
import { MaterialPresetInspector } from './materials/MaterialPresetInspector'
import { FluidInspector } from './fluid/FluidInspector'
import { ParticleInspector } from './particle/ParticleInspector'

function Slider({ control, value, onChange }: { control: Extract<ShaderControl, { type: 'number' }>; value: number; onChange: (value: number) => void }) {
  const inputId = useId()
  const change = (next: number) => { if (Number.isFinite(next)) onChange(Math.max(control.min, Math.min(control.max, control.integer ? Math.round(next) : next))) }
  return <div className="shader-slider"><label htmlFor={inputId}>{control.label}</label>
    <input id={inputId} type="number" aria-label={`Shader ${control.label}`} value={Number(value.toFixed(3))} min={control.min} max={control.max} step={control.step} onChange={event => change(event.currentTarget.valueAsNumber)} />
    <input type="range" aria-label={`Shader ${control.label} slider`} value={value} min={control.min} max={control.max} step={control.step} onChange={event => change(event.currentTarget.valueAsNumber)} />
  </div>
}

function ImageSource({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [error, setError] = useState('')
  return <label className="property-label">Source image<input className="property-input" key={value} aria-label="Shader source image" defaultValue={value} spellCheck={false} onBlur={event => {
    try { onChange(event.currentTarget.value.trim()); setError('') } catch { setError('Use a local path, image data URL, or an HTTP image URL.') }
  }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} />{error && <span className="shader-image-error" role="alert">{error}</span>}</label>
}

export function ShaderInspector({ paint, onChange, target, image, showPicker = true, allowRemove = true, onBrowse, onGestureStart, onGestureEnd, onBindTarget }: { paint: ShaderPaint | null; onChange: (paint: ShaderPaint | null) => void; target: string; image?: string; showPicker?: boolean; allowRemove?: boolean; onBrowse?: () => void; onGestureStart?: () => boolean | void; onGestureEnd?: (cancel: boolean) => void; onBindTarget?: (mode: 'selection' | 'background' | 'new-card') => void }) {
  const definition: ShaderDefinition | undefined = paint ? shaderCatalog[paint.kind] : undefined
  const params = paint?.params as Readonly<Record<string, ShaderValue>> | undefined
  const parameter = (key: string, value: ShaderValue) => { if (paint) onChange(updateShaderParameter(paint, key, value)) }
  const motion = (changes: Partial<ShaderMotion>) => { if (paint) onChange({ ...paint, ...changes }) }
  return <div className="inspector-section shader-section">
    <div className="shader-heading"><span className="section-caption">PAPER SHADERS</span>{onBrowse ? <button type="button" className="quiet-button shader-catalog-link" aria-label="Browse shader library" title="Browse shader library (S)" onClick={onBrowse}><Sparkles size={11} />FX studio</button> : <span className="shader-engine-mark">FX / {String(shaderKinds.length).padStart(2, '0')}</span>}</div>
    {showPicker && <label className="property-select">Effect<select aria-label="Paper shader effect" value={paint?.kind ?? ''} onChange={event => onChange(event.currentTarget.value ? createShader(event.currentTarget.value as ShaderKind, image) : null)}>
      <option value="">None</option>{shaderKinds.map(kind => <option key={kind} value={kind}>{shaderCatalog[kind].label}</option>)}
    </select></label>}
    {paint && definition && params ? <>
      <div className="shader-target"><i />{target}</div><p className="shader-description">{definition.description}</p>
      {paint.kind === 'glass-refraction' && <p className="shader-image-note">Glass refracts the source image. Animated mode gently shifts the texture.</p>}
      {paint.kind === 'mesh-gradient' && <MeshInspector paint={paint} onChange={onChange} onGestureStart={onGestureStart} onGestureEnd={onGestureEnd} target={target} onBindTarget={onBindTarget} />}
      {paint.kind === 'multi-pass' && <MaterialComposer paint={paint} onChange={onChange} />}
      {paint.kind === 'procedural-noise' && <NoiseInspector paint={paint} onChange={onChange} target={target} onBindTarget={onBindTarget} />}
      {paint.kind === 'multi-stop-gradient' && (
        <GradientInspector
          gradient={paint.gradient ?? createDefaultGradient(paint.params.gradientType)}
          onChange={grad => {
            onChange(gradientToShaderPaint(grad, paint))
          }}
          onGestureStart={onGestureStart}
          onGestureEnd={onGestureEnd}
          showShaderLinkToggle={false}
        />
      )}
      {(paint.kind === 'glassmorphism' || paint.kind === 'liquid-chrome') && (
        <RefractiveInspector
          paint={paint as unknown as RefractivePaint}
          onChange={onChange as unknown as (p: RefractivePaint) => void}
          target={target}
          onBindTarget={onBindTarget}
        />
      )}
      {paint.kind === 'shader-material' && (
        <MaterialPresetInspector
          paint={paint as Extract<ShaderPaint, { kind: 'shader-material' }>}
          onChange={onChange}
          target={target}
          onBindTarget={onBindTarget}
        />
      )}
      {paint.kind === 'fluid-simulation' && (
        <FluidInspector
          paint={paint as Extract<ShaderPaint, { kind: 'fluid-simulation' }>}
          onChange={onChange as any}
          target={target}
          onBindTarget={onBindTarget}
        />
      )}
      {paint.kind === 'particle-simulation' && (
        <ParticleInspector
          paint={paint as Extract<ShaderPaint, { kind: 'particle-simulation' }>}
          onChange={onChange as any}
          target={target}
          onBindTarget={onBindTarget}
        />
      )}
      {definition.controls.map(control => {
        if (paint.kind === 'multi-pass') return null
        if (paint.kind === 'procedural-noise') return null
        if (paint.kind === 'multi-stop-gradient') return null
        if (paint.kind === 'glassmorphism' || paint.kind === 'liquid-chrome') return null
        if (paint.kind === 'shader-material') return null
        if (paint.kind === 'fluid-simulation') return null
        if (paint.kind === 'particle-simulation') return null
        if (paint.kind === 'mesh-gradient' && paint.mesh && control.type === 'palette') return null
        if (paint.kind === 'mesh-gradient' && paint.mesh && (control.key === 'grainMixer' || control.key === 'grainOverlay')) return null
        const value = params[control.key]
        if (control.type === 'number') return <Slider key={control.key} control={control} value={value as number} onChange={next => parameter(control.key, next)} />
        if (control.type === 'select') return <label key={control.key} className="property-select">{control.label}<select aria-label={`Shader ${control.label}`} value={value as string} onChange={event => parameter(control.key, event.currentTarget.value)}>{control.options.map(option => <option key={option} value={option}>{option}</option>)}</select></label>
        if (control.type === 'image') return <ImageSource key={control.key} value={value as string} onChange={next => parameter(control.key, next)} />
        if (control.type === 'color') return <div key={control.key}><div className="property-heading"><span>{control.label}</span></div><label className="property-color"><input type="color" aria-label={`Shader ${control.label} color`} value={(value as string).slice(0, 7)} onChange={event => parameter(control.key, event.currentTarget.value)} /><input key={value as string} aria-label={`Shader ${control.label} hex`} defaultValue={value as string} spellCheck={false} onBlur={event => { const hex = event.currentTarget.value.trim(); if (/^#[\da-f]{6}([\da-f]{2})?$/i.test(hex)) parameter(control.key, hex); else event.currentTarget.value = value as string }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} /></label></div>
        const colors = value as readonly string[]
        return <div key={control.key}><div className="property-heading"><span>Palette</span><span className="shader-engine-mark">{colors.length} / {control.max}</span></div><div className="shader-palette">{colors.map((hex, index) => <div className="shader-swatch" key={index}>
          <input type="color" aria-label={`Shader palette color ${index + 1}`} value={hex.slice(0, 7)} onChange={event => parameter(control.key, colors.map((color, i) => i === index ? event.currentTarget.value : color))} />
          {colors.length > 2 && <button aria-label={`Remove shader color ${index + 1}`} onClick={() => parameter(control.key, colors.filter((_, i) => i !== index))}>×</button>}
        </div>)}{colors.length < control.max && <button className="shader-add-color" aria-label="Add shader palette color" onClick={() => parameter(control.key, [...colors, '#81adec'])}>+</button>}</div></div>
      })}
      <PostProcessingInspector pipeline={paint.postProcessing} onChange={postProcessing => onChange({ ...paint, postProcessing })} />
      <div className="shader-divider" /><span className="section-caption">COMPOSITING</span>
      <label className="property-select">Blend mode<select aria-label="Shader blend mode" value={paint.composite?.blendMode ?? 'normal'} onChange={event => onChange({ ...paint, composite: { opacity: paint.composite?.opacity ?? 1, blendMode: event.currentTarget.value as typeof shaderBlendModes[number] } })}>
        {shaderBlendModes.map(mode => <option key={mode} value={mode}>{mode.replace(/-/g, ' ').replace(/^./, char => char.toUpperCase())}</option>)}
      </select></label>
      <Slider control={{ key: 'materialOpacity', label: 'Material opacity %', type: 'number', min: 0, max: 100, step: 1 }} value={(paint.composite?.opacity ?? 1) * 100} onChange={opacity => onChange({ ...paint, composite: { blendMode: paint.composite?.blendMode ?? 'normal', opacity: opacity / 100 } })} />
      <p className="shader-image-note">Mix with the layer’s fill or image. Layer opacity applies to the result.</p>
      <div className="shader-divider" /><span className="section-caption">MOTION & POSITION</span>
      <div className="shader-mode" role="group" aria-label="Shader playback"><button aria-pressed={paint.animated} onClick={() => motion({ animated: true })}><Play size={10} />Animated</button><button aria-pressed={!paint.animated} onClick={() => motion({ animated: false })}><Pause size={10} />Static</button></div>
      {motionControls.filter(control => control.key !== 'speed' || paint.animated).map(control => <Slider key={control.key} control={control as Extract<ShaderControl, { type: 'number' }>} value={paint[control.key as keyof Omit<ShaderMotion, 'animated'>]} onChange={value => motion({ [control.key]: value })} />)}
      <div className="shader-actions"><button onClick={() => onChange(createShader(paint.kind, image))}>Reset parameters</button>{allowRemove && <button onClick={() => onChange(null)}>Remove effect</button>}</div>
    </> : <p className="shader-description"><Sparkles size={11} aria-hidden="true" /> Add texture, color and a little motion.</p>}
  </div>
}
