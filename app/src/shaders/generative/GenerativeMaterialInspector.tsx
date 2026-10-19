import {
  Check,
  Copy,
  Plus,
  RotateCcw,
  Shuffle,
} from 'lucide-react'
import { useState, useId } from 'react'
import type { GenerativeMaterialParams, GenerativePresetId } from './types.ts'
import {
  GENERATIVE_PRESETS,
  getGenerativePreset,
} from './presets.ts'
import { exportGenerativeReact } from './generativeExport.ts'
import type { ShaderPaint } from '../types.ts'

function SliderRow({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  suffix = '',
  integer = false,
  onChange,
}: {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  suffix?: string
  integer?: boolean
  onChange: (value: number) => void
}) {
  const inputId = useId()
  const displayVal = integer ? Math.round(value) : Number(value.toFixed(step >= 1 ? 0 : 2))

  return (
    <div className="shader-slider">
      <label htmlFor={inputId}>
        {label}
        {suffix && <span className="slider-suffix"> {suffix}</span>}
      </label>
      <input
        id={inputId}
        type="number"
        aria-label={label}
        value={displayVal}
        min={min}
        max={max}
        step={step}
        onChange={e => {
          const v = e.currentTarget.valueAsNumber
          if (Number.isFinite(v)) {
            const clamped = Math.max(min, Math.min(max, v))
            onChange(integer ? Math.round(clamped) : clamped)
          }
        }}
      />
      <input
        type="range"
        aria-label={`${label} slider`}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => {
          const v = e.currentTarget.valueAsNumber
          onChange(integer ? Math.round(v) : v)
        }}
      />
    </div>
  )
}

export function GenerativeMaterialInspector({
  paint,
  onChange,
  onBindTarget,
}: {
  paint: Extract<ShaderPaint, { kind: 'generative-material' }>
  onChange: (paint: ShaderPaint) => void
  target?: string
  onBindTarget?: (mode: 'selection' | 'background' | 'new-card') => void
}) {
  const [copied, setCopied] = useState(false)
  const params = paint.params as GenerativeMaterialParams

  const updateParam = <K extends keyof GenerativeMaterialParams>(
    key: K,
    val: GenerativeMaterialParams[K]
  ) => {
    const nextParams = { ...params, [key]: val }
    onChange({
      ...paint,
      params: nextParams,
    } as ShaderPaint)
  }

  const handlePresetChange = (presetId: GenerativePresetId) => {
    const p = getGenerativePreset(presetId)
    if (!p) return
    onChange({
      ...paint,
      params: {
        ...p.params,
        colorStops: [...p.params.colorStops],
      },
    } as ShaderPaint)
  }

  const handleColorChange = (index: number, newHex: string) => {
    const current = [...params.colorStops]
    current[index] = newHex
    updateParam('colorStops', current)
  }

  const handleAddColor = () => {
    if (params.colorStops.length >= 8) return
    const lastColor = params.colorStops[params.colorStops.length - 1] ?? '#81adec'
    // Slightly alter brightness or reuse
    const nextColors = [...params.colorStops, lastColor]
    updateParam('colorStops', nextColors)
  }

  const handleRemoveColor = (index: number) => {
    if (params.colorStops.length <= 2) return
    const nextColors = params.colorStops.filter((_, i) => i !== index)
    updateParam('colorStops', nextColors)
  }

  const handleRandomize = () => {
    const rand = (min: number, max: number, step = 0.01) => {
      const v = min + Math.random() * (max - min)
      return Number((Math.round(v / step) * step).toFixed(2))
    }
    const nextParams: GenerativeMaterialParams = {
      ...params,
      grainIntensity: rand(0.05, 0.4),
      fluidDistortion: rand(0.2, 0.8),
      chromaticAberration: rand(0.1, 0.6),
      turbulenceSpeed: rand(0.2, 1.5, 0.05),
      frequency: rand(1.0, 5.0, 0.1),
      contrast: rand(0.9, 1.5, 0.05),
      octaves: Math.floor(Math.random() * 3) + 3,
    }
    onChange({ ...paint, params: nextParams } as ShaderPaint)
  }

  const handleReset = () => {
    const currentPreset = getGenerativePreset(params.preset) ?? GENERATIVE_PRESETS[0]
    onChange({
      ...paint,
      params: {
        ...currentPreset.params,
        colorStops: [...currentPreset.params.colorStops],
      },
    } as ShaderPaint)
  }

  const handleCopyCode = async () => {
    try {
      const code = exportGenerativeReact(paint)
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback
    }
  }

  return (
    <div className="generative-material-inspector">
      {/* Preset Selector */}
      <div className="inspector-field" style={{ marginBottom: 12 }}>
        <label className="property-select">
          Material Preset
          <select
            aria-label="Generative Material Preset"
            value={params.preset}
            onChange={e => handlePresetChange(e.currentTarget.value as GenerativePresetId)}
          >
            {GENERATIVE_PRESETS.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Preset Swatches Quick Switcher */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, marginBottom: 14 }}>
        {GENERATIVE_PRESETS.slice(0, 4).map(p => {
          const isActive = params.preset === p.id
          return (
            <button
              key={p.id}
              type="button"
              className={`quiet-button ${isActive ? 'preset-active' : ''}`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
                padding: '5px 2px',
                border: isActive ? '1px solid var(--paper-accent-text, #81adec)' : '1px solid var(--paper-border, #333)',
                borderRadius: 4,
                background: isActive ? 'rgba(129, 172, 236, 0.1)' : 'transparent',
                fontSize: 9,
                cursor: 'pointer',
              }}
              title={p.description}
              onClick={() => handlePresetChange(p.id)}
            >
              <div style={{ display: 'flex', height: 8, width: 28, borderRadius: 2, overflow: 'hidden' }}>
                {p.params.colorStops.slice(0, 4).map((c, idx) => (
                  <div key={idx} style={{ flex: 1, backgroundColor: c }} />
                ))}
              </div>
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 44 }}>
                {p.name.split(' ')[0]}
              </span>
            </button>
          )
        })}
      </div>

      {/* Color Stops Section */}
      <div style={{ margin: '14px 0 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ font: '9px var(--font-mono, monospace)', fontWeight: 600, color: 'var(--paper-text-muted, #888)', textTransform: 'uppercase' }}>
            Color Stops ({params.colorStops.length}/8)
          </span>
          {params.colorStops.length < 8 && (
            <button
              type="button"
              className="quiet-button"
              aria-label="Add Color Stop"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, cursor: 'pointer', padding: '2px 6px' }}
              onClick={handleAddColor}
            >
              <Plus size={11} />
              Add stop
            </button>
          )}
        </div>

        <div className="shader-palette" style={{ gridTemplateColumns: `repeat(${Math.min(4, params.colorStops.length)}, minmax(0, 1fr))` }}>
          {params.colorStops.map((hex, idx) => (
            <div key={idx} className="shader-swatch" style={{ position: 'relative' }}>
              <input
                type="color"
                aria-label={`Color stop ${idx + 1}`}
                value={hex.slice(0, 7)}
                onChange={e => handleColorChange(idx, e.currentTarget.value)}
                style={{
                  display: 'block',
                  width: '100%',
                  height: 28,
                  padding: 1,
                  background: hex,
                  border: '1px solid var(--paper-border-strong, #444)',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              />
              {params.colorStops.length > 2 && (
                <button
                  type="button"
                  aria-label={`Remove color stop ${idx + 1}`}
                  onClick={() => handleRemoveColor(idx)}
                  style={{
                    position: 'absolute',
                    top: -4,
                    right: -4,
                    width: 14,
                    height: 14,
                    borderRadius: '50%',
                    border: '1px solid var(--paper-border-strong, #555)',
                    background: 'var(--paper-surface, #222)',
                    color: 'var(--paper-text, #fff)',
                    fontSize: 8,
                    display: 'grid',
                    placeItems: 'center',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="shader-divider" />

      {/* Core Material Parameters */}
      <div style={{ margin: '8px 0' }}>
        <span style={{ font: '9px var(--font-mono, monospace)', fontWeight: 600, color: 'var(--paper-text-muted, #888)', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
          Generative Dynamics
        </span>

        <SliderRow
          label="Grain Intensity"
          value={params.grainIntensity}
          min={0}
          max={1}
          step={0.01}
          onChange={v => updateParam('grainIntensity', v)}
        />

        <SliderRow
          label="Fluid Distortion"
          value={params.fluidDistortion}
          min={0}
          max={1}
          step={0.01}
          onChange={v => updateParam('fluidDistortion', v)}
        />

        <SliderRow
          label="Chromatic Aberration"
          value={params.chromaticAberration}
          min={0}
          max={1}
          step={0.01}
          onChange={v => updateParam('chromaticAberration', v)}
        />

        <SliderRow
          label="Turbulence Speed"
          value={params.turbulenceSpeed}
          min={0}
          max={3}
          step={0.05}
          onChange={v => updateParam('turbulenceSpeed', v)}
        />
      </div>

      <div className="shader-divider" />

      {/* Optical & Spatial Tuning */}
      <div style={{ margin: '8px 0' }}>
        <span style={{ font: '9px var(--font-mono, monospace)', fontWeight: 600, color: 'var(--paper-text-muted, #888)', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
          Spatial & Tonal Tuning
        </span>

        <SliderRow
          label="Spatial Frequency"
          value={params.frequency}
          min={0.1}
          max={10}
          step={0.1}
          onChange={v => updateParam('frequency', v)}
        />

        <SliderRow
          label="Color Contrast"
          value={params.contrast}
          min={0.1}
          max={2.5}
          step={0.05}
          onChange={v => updateParam('contrast', v)}
        />

        <SliderRow
          label="Fractal Octaves"
          value={params.octaves}
          min={1}
          max={6}
          step={1}
          integer={true}
          onChange={v => updateParam('octaves', v)}
        />
      </div>

      {/* Action Toolbar */}
      <div className="shader-actions" style={{ display: 'flex', gap: 6, marginTop: 16 }}>
        <button
          type="button"
          className="quiet-button"
          aria-label="Randomize material"
          title="Randomize parameters"
          onClick={handleRandomize}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, cursor: 'pointer' }}
        >
          <Shuffle size={11} />
          Randomize
        </button>

        <button
          type="button"
          className="quiet-button"
          aria-label="Reset material"
          title="Reset to preset defaults"
          onClick={handleReset}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, cursor: 'pointer' }}
        >
          <RotateCcw size={11} />
          Reset
        </button>

        <button
          type="button"
          className="quiet-button"
          aria-label="Copy React Code"
          title="Export React component"
          onClick={handleCopyCode}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, cursor: 'pointer', marginLeft: 'auto' }}
        >
          {copied ? <Check size={11} color="var(--paper-accent-text, #81adec)" /> : <Copy size={11} />}
          {copied ? 'Copied' : 'React JSX'}
        </button>
      </div>

      {onBindTarget && (
        <div style={{ display: 'flex', gap: 4, marginTop: 12 }}>
          <button
            type="button"
            className="quiet-button"
            style={{ flex: 1, fontSize: 9, padding: '4px 6px', border: '1px solid var(--paper-border)', borderRadius: 3, cursor: 'pointer' }}
            onClick={() => onBindTarget('background')}
          >
            Apply to Canvas BG
          </button>
          <button
            type="button"
            className="quiet-button"
            style={{ flex: 1, fontSize: 9, padding: '4px 6px', border: '1px solid var(--paper-border)', borderRadius: 3, cursor: 'pointer' }}
            onClick={() => onBindTarget('new-card')}
          >
            New Card with Fill
          </button>
        </div>
      )}
    </div>
  )
}
