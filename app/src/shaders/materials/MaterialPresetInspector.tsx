import {
  Check,
  Copy,
  Layers,
  MousePointer,
  RotateCcw,
  Sparkles,
  Wand2,
} from 'lucide-react'
import { useState, useId } from 'react'
import type { MaterialCategory, MaterialPresetId, MaterialPresetParams } from './types.ts'
import {
  MATERIAL_PRESETS,
  getMaterialPreset,
} from './presets.ts'
import { exportMaterialReact } from './materialExport.ts'
import type { ShaderPaint } from '../types.ts'

function SliderRow({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.01,
  suffix = '',
  onChange,
}: {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  suffix?: string
  onChange: (value: number) => void
}) {
  const inputId = useId()
  const displayVal = Number(value.toFixed(step >= 1 ? 0 : 2))

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
          if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v)))
        }}
      />
      <input
        type="range"
        aria-label={`${label} slider`}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(e.currentTarget.valueAsNumber)}
      />
    </div>
  )
}

const CATEGORIES: readonly ('All' | MaterialCategory)[] = [
  'All',
  'Optical',
  'Dispersion',
  'Fluid',
  'Tactile',
  'Atmospheric',
]

const IOR_PRESETS = [
  { label: 'Water', val: 1.33 },
  { label: 'Acrylic', val: 1.49 },
  { label: 'Glass', val: 1.52 },
  { label: 'Flint', val: 1.66 },
  { label: 'Diamond', val: 2.42 },
]

export function MaterialPresetInspector({
  paint,
  onChange,
  onBindTarget,
}: {
  paint: Extract<ShaderPaint, { kind: 'shader-material' }>
  onChange: (paint: ShaderPaint) => void
  target?: string
  onBindTarget?: (mode: 'selection' | 'background' | 'new-card') => void
}) {
  const [activeCategory, setActiveCategory] = useState<'All' | MaterialCategory>('All')
  const [copied, setCopied] = useState(false)
  const [mouseCoord, setMouseCoord] = useState<{ x: number; y: number } | null>(null)

  const params = paint.params
  const activePreset = getMaterialPreset(params.presetId)

  const update = (partial: Partial<MaterialPresetParams>) => {
    onChange({
      ...paint,
      params: {
        ...params,
        ...partial,
      },
    })
  }

  const applyPreset = (presetId: MaterialPresetId) => {
    const target = getMaterialPreset(presetId)
    onChange({
      ...paint,
      params: {
        ...target.params,
        colors: [...target.params.colors],
      },
    })
  }

  const handleCopyCode = async () => {
    try {
      const code = exportMaterialReact(paint)
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback
    }
  }

  const filteredPresets = MATERIAL_PRESETS.filter(
    p => activeCategory === 'All' || p.category === activeCategory
  )

  return (
    <div className="material-preset-inspector">
      {/* Preset Library Section */}
      <div className="material-preset-header">
        <span className="section-caption">MATERIAL PRESET LIBRARY</span>
        <span className="shader-engine-mark">
          {activePreset.category.toUpperCase()} · LIVE WEBGL
        </span>
      </div>

      {/* Category Pills */}
      <div className="material-category-pills" role="group" aria-label="Material categories">
        {CATEGORIES.map(cat => (
          <button
            key={cat}
            className={`material-category-pill ${activeCategory === cat ? 'active' : ''}`}
            aria-pressed={activeCategory === cat}
            onClick={() => setActiveCategory(cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Preset Chips Grid */}
      <div className="material-preset-grid" role="group" aria-label="Shader Material Presets">
        {filteredPresets.map(preset => {
          const isActive = params.presetId === preset.id
          return (
            <button
              key={preset.id}
              className={`material-preset-chip ${isActive ? 'preset-active' : ''}`}
              title={preset.description}
              aria-label={`Select ${preset.name} preset`}
              aria-pressed={isActive}
              onClick={() => applyPreset(preset.id)}
            >
              <div className="material-preset-dots">
                {preset.params.colors.slice(0, 3).map((col, idx) => (
                  <i key={idx} style={{ background: col }} />
                ))}
              </div>
              <span className="material-preset-chip-title">{preset.name}</span>
              {isActive && <Check size={11} className="material-preset-check" />}
            </button>
          )
        })}
      </div>

      <div className="shader-divider" />

      {/* Core Live WebGL Optics Controls */}
      <div className="property-heading">
        <span className="section-caption">LIVE OPTICAL & WAVE PARAMETERS</span>
        <button
          className="quiet-button"
          title="Reset to preset defaults"
          aria-label="Reset to preset defaults"
          onClick={() => applyPreset(params.presetId)}
        >
          <RotateCcw size={10} />
        </button>
      </div>

      {/* Refraction Index with common IOR chips */}
      <SliderRow
        label="Refractive Index (η)"
        value={params.refractionIndex}
        min={1.0}
        max={2.8}
        step={0.01}
        onChange={v => update({ refractionIndex: v })}
      />
      <div className="ior-quick-chips">
        {IOR_PRESETS.map(item => (
          <button
            key={item.label}
            className={`ior-chip ${Math.abs(params.refractionIndex - item.val) < 0.02 ? 'active' : ''}`}
            onClick={() => update({ refractionIndex: item.val })}
            title={`Set refractive index to ${item.val} (${item.label})`}
          >
            {item.label} {item.val}
          </button>
        ))}
      </div>

      {/* Dispersion Spread / Color Aberration (Cauchy spectral splitting) */}
      <SliderRow
        label="Color Aberration / Dispersion"
        value={params.dispersionSpread}
        min={0.0}
        max={1.0}
        step={0.01}
        onChange={v => update({ dispersionSpread: v })}
      />

      {/* Wave / Spatial Frequency */}
      <SliderRow
        label="Wave Frequency"
        value={params.frequency}
        min={0.1}
        max={20.0}
        step={0.1}
        onChange={v => update({ frequency: v })}
      />

      {/* Mouse Reactivity */}
      <SliderRow
        label="Mouse Reactivity"
        value={params.mouseReactivity}
        min={0.0}
        max={1.0}
        step={0.01}
        onChange={v => update({ mouseReactivity: v })}
      />

      {/* Microfacet Roughness / Frost */}
      <SliderRow
        label="Surface Roughness / Frost"
        value={params.roughness}
        min={0.0}
        max={1.0}
        step={0.01}
        onChange={v => update({ roughness: v })}
      />

      {/* Thin Film Thickness */}
      <SliderRow
        label="Film Thickness (Airy)"
        value={params.filmThickness}
        min={100}
        max={1200}
        step={10}
        suffix="nm"
        onChange={v => update({ filmThickness: v })}
      />

      {/* Iridescent Interference Sheen */}
      <SliderRow
        label="Rainbow Iridescence"
        value={params.iridescence}
        min={0.0}
        max={1.0}
        step={0.01}
        onChange={v => update({ iridescence: v })}
      />

      {/* Fluid Viscosity */}
      <SliderRow
        label="Fluid Viscosity Dampening"
        value={params.fluidViscosity}
        min={0.0}
        max={1.0}
        step={0.01}
        onChange={v => update({ fluidViscosity: v })}
      />

      {/* Analog Grain Scale & Intensity */}
      <div className="shader-divider" />
      <span className="section-caption">TACTILE GRAIN & STIPPLE</span>
      <SliderRow
        label="Reactive Grain Scale"
        value={params.grainScale}
        min={0.5}
        max={10.0}
        step={0.1}
        onChange={v => update({ grainScale: v })}
      />
      <SliderRow
        label="Grain Stipple Intensity"
        value={params.grainIntensity}
        min={0.0}
        max={1.0}
        step={0.01}
        onChange={v => update({ grainIntensity: v })}
      />

      {/* Lighting & Specular */}
      <div className="shader-divider" />
      <span className="section-caption">STUDIO LIGHTING</span>
      <SliderRow
        label="Light Angle"
        value={params.lightAngle}
        min={0}
        max={360}
        step={1}
        suffix="°"
        onChange={v => update({ lightAngle: v })}
      />
      <SliderRow
        label="Specular Glint Reflection"
        value={params.specularStrength}
        min={0.0}
        max={1.0}
        step={0.01}
        onChange={v => update({ specularStrength: v })}
      />

      {/* Interactive Mouse Test Pad */}
      <div className="shader-divider" />
      <div className="material-mouse-pad-container">
        <div className="material-mouse-pad-header">
          <span className="section-caption">LIVE CURSOR REACTIVITY PAD</span>
          <span className="shader-engine-mark">
            <MousePointer size={9} />
            {mouseCoord ? `X:${mouseCoord.x.toFixed(2)} Y:${mouseCoord.y.toFixed(2)}` : 'HOVER TO TEST'}
          </span>
        </div>
        <div
          className="material-mouse-pad"
          onPointerMove={e => {
            const rect = e.currentTarget.getBoundingClientRect()
            const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
            const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
            setMouseCoord({ x, y })
          }}
          onPointerLeave={() => setMouseCoord(null)}
        >
          <div
            className="material-mouse-indicator"
            style={{
              left: `${(mouseCoord?.x ?? 0.5) * 100}%`,
              top: `${(mouseCoord?.y ?? 0.5) * 100}%`,
              opacity: mouseCoord ? 1 : 0.4,
            }}
          />
          <span className="material-mouse-pad-hint">
            Move cursor here to test live WebGL wave deflection
          </span>
        </div>
      </div>

      {/* Multi-Stop Color Palette */}
      <div className="shader-divider" />
      <div className="property-heading">
        <span className="section-caption">PALETTE COLORS</span>
        <span className="shader-engine-mark">{params.colors.length} / 8</span>
      </div>
      <div className="shader-palette">
        {params.colors.map((hex, index) => (
          <div className="shader-swatch" key={index}>
            <input
              type="color"
              aria-label={`Material palette color ${index + 1}`}
              value={hex.slice(0, 7)}
              onChange={event =>
                update({
                  colors: params.colors.map((c, i) => (i === index ? event.currentTarget.value : c)),
                })
              }
            />
            {params.colors.length > 2 && (
              <button
                aria-label={`Remove color ${index + 1}`}
                onClick={() =>
                  update({
                    colors: params.colors.filter((_, i) => i !== index),
                  })
                }
              >
                ×
              </button>
            )}
          </div>
        ))}
        {params.colors.length < 8 && (
          <button
            className="shader-add-color"
            aria-label="Add palette color"
            onClick={() => update({ colors: [...params.colors, '#81adec'] })}
          >
            +
          </button>
        )}
      </div>

      {/* Tints */}
      <div className="material-tints-row">
        <div>
          <span className="slider-sublabel">Volume Tint</span>
          <label className="property-color">
            <input
              type="color"
              aria-label="Volume tint color"
              value={params.tintColor.slice(0, 7)}
              onChange={e => update({ tintColor: e.currentTarget.value })}
            />
            <span className="property-color-hex">{params.tintColor}</span>
          </label>
        </div>
        <div>
          <span className="slider-sublabel">Highlight Glint</span>
          <label className="property-color">
            <input
              type="color"
              aria-label="Highlight tint color"
              value={params.highlightColor.slice(0, 7)}
              onChange={e => update({ highlightColor: e.currentTarget.value })}
            />
            <span className="property-color-hex">{params.highlightColor}</span>
          </label>
        </div>
      </div>

      {/* Layer Blending & Opacity */}
      <div className="shader-divider" />
      <span className="section-caption">LAYER COMPOSITION & BLEND</span>
      <SliderRow
        label="Internal Shader Blend Ratio"
        value={params.blendRatio}
        min={0.0}
        max={1.0}
        step={0.01}
        onChange={v => update({ blendRatio: v })}
      />

      {/* Code Export & Bind Shortcuts */}
      <div className="material-actions-bar">
        <button
          type="button"
          className="material-action-btn"
          onClick={handleCopyCode}
          title="Export production React component"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied code!' : 'Export React'}
        </button>

        {onBindTarget && (
          <>
            <button
              type="button"
              className="material-action-btn"
              onClick={() => onBindTarget('background')}
              title="Apply material preset to canvas background"
            >
              <Wand2 size={12} />
              Set Background
            </button>
            <button
              type="button"
              className="material-action-btn"
              onClick={() => onBindTarget('new-card')}
              title="Create new material frame card on canvas"
            >
              <Layers size={12} />
              New Frame
            </button>
          </>
        )}
      </div>

      <div className="material-status-footer">
        <Sparkles size={11} />
        <span>Compiled with @paper-design/shaders-react · 60 FPS WebGL 2</span>
      </div>
    </div>
  )
}
