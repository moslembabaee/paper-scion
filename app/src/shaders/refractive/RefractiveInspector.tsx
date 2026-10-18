import {
  Check,
  Copy,
  Layers,
  Sparkles,
  Wand2,
} from 'lucide-react'
import { useState } from 'react'
import type {
  ChromeEnvironmentStyle,
  GlassSurfacePattern,
  GlassmorphismParams,
  GlassmorphismPaint,
  LiquidChromeParams,
  LiquidChromePaint,
  RefractivePaint,
} from './types.ts'
import {
  GLASSMORPHISM_PRESETS,
  LIQUID_CHROME_PRESETS,
} from './presets.ts'
import {
  exportGlassmorphismReact,
  exportLiquidChromeReact,
} from './refractiveExport.ts'

function SliderRow({
  label,
  value,
  min = 0,
  max = 1,
  step = 0.01,
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
  return (
    <div className="shader-slider">
      <label>{label}</label>
      <input
        type="number"
        aria-label={label}
        value={Number(value.toFixed(step >= 1 ? 0 : 2))}
        min={min}
        max={max}
        step={step}
        onChange={e => onChange(e.currentTarget.valueAsNumber)}
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

export function RefractiveInspector({
  paint,
  onChange,
  onBindTarget,
}: {
  paint: RefractivePaint
  onChange: (paint: RefractivePaint) => void
  target?: string
  onBindTarget?: (mode: 'selection' | 'background' | 'new-card') => void
}) {
  const [copied, setCopied] = useState(false)
  const isGlass = paint.kind === 'glassmorphism'

  const copyCode = async () => {
    try {
      const code = isGlass
        ? exportGlassmorphismReact(paint as GlassmorphismPaint)
        : exportLiquidChromeReact(paint as LiquidChromePaint)
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback
    }
  }

  const updateGlass = (patch: Partial<GlassmorphismParams>) => {
    if (paint.kind !== 'glassmorphism') return
    onChange({
      ...paint,
      params: { ...paint.params, ...patch },
    })
  }

  const updateChrome = (patch: Partial<LiquidChromeParams>) => {
    if (paint.kind !== 'liquid-chrome') return
    onChange({
      ...paint,
      params: { ...paint.params, ...patch },
    })
  }

  return (
    <div className="refractive-inspector" data-testid="refractive-inspector">
      <div className="refractive-header">
        <div className="refractive-title-badge">
          <Sparkles size={11} />
          <span>{isGlass ? 'PHYSICAL GLASS OPTICS' : 'MOLTEN CHROME & IRIDESCENCE'}</span>
        </div>
        <button
          type="button"
          className="quiet-button refractive-copy-btn"
          aria-label="Export React Code"
          title="Export React Component"
          onClick={copyCode}
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
          <span>{copied ? 'Copied' : 'Export'}</span>
        </button>
      </div>

      {/* Preset Chips */}
      <div className="refractive-presets-block">
        <span className="section-caption">PRESETS</span>
        <div className="refractive-chip-grid">
          {isGlass
            ? GLASSMORPHISM_PRESETS.map(preset => (
                <button
                  key={preset.id}
                  type="button"
                  className="refractive-chip"
                  onClick={() => updateGlass(preset.params)}
                  title={preset.description}
                >
                  <Wand2 size={10} />
                  <span>{preset.name}</span>
                </button>
              ))
            : LIQUID_CHROME_PRESETS.map(preset => (
                <button
                  key={preset.id}
                  type="button"
                  className="refractive-chip"
                  onClick={() => updateChrome(preset.params)}
                  title={preset.description}
                >
                  <Wand2 size={10} />
                  <span>{preset.name}</span>
                </button>
              ))}
        </div>
      </div>

      <div className="shader-divider" />

      {/* Main Material Controls */}
      {isGlass ? (
        <GlassControls
          params={(paint as GlassmorphismPaint).params}
          onUpdate={updateGlass}
        />
      ) : (
        <ChromeControls
          params={(paint as LiquidChromePaint).params}
          onUpdate={updateChrome}
        />
      )}

      {/* Target Canvas Binding Toolbar */}
      {onBindTarget && (
        <div className="refractive-bind-toolbar">
          <div className="refractive-bind-label">
            <Layers size={10} />
            <span>Apply To Canvas</span>
          </div>
          <div className="refractive-bind-actions">
            <button
              type="button"
              className="refractive-action-btn"
              onClick={() => onBindTarget('selection')}
            >
              Selection
            </button>
            <button
              type="button"
              className="refractive-action-btn"
              onClick={() => onBindTarget('background')}
            >
              Background
            </button>
            <button
              type="button"
              className="refractive-action-btn"
              onClick={() => onBindTarget('new-card')}
            >
              + Glass Card
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function GlassControls({
  params,
  onUpdate,
}: {
  params: GlassmorphismParams
  onUpdate: (patch: Partial<GlassmorphismParams>) => void
}) {
  return (
    <div className="refractive-controls-section">
      <span className="section-caption">REFRACTIVE OPTICS</span>
      <SliderRow
        label="Refractive Index (IOR)"
        value={params.refractionIndex}
        min={1.0}
        max={2.5}
        step={0.01}
        onChange={v => onUpdate({ refractionIndex: v })}
      />
      <SliderRow
        label="Chromatic Dispersion"
        value={params.dispersion}
        min={0.0}
        max={1.0}
        step={0.01}
        onChange={v => onUpdate({ dispersion: v })}
      />
      <SliderRow
        label="Surface Roughness"
        value={params.roughness}
        min={0.0}
        max={1.0}
        step={0.01}
        onChange={v => onUpdate({ roughness: v })}
      />
      <SliderRow
        label="Dynamic Backdrop Blur"
        value={params.blurRadius}
        min={0.0}
        max={1.0}
        step={0.01}
        onChange={v => onUpdate({ blurRadius: v })}
      />
      <SliderRow
        label="Spectral Shift"
        value={params.chromaticShift}
        min={0.0}
        max={1.0}
        step={0.01}
        onChange={v => onUpdate({ chromaticShift: v })}
      />

      <div className="shader-divider" />
      <span className="section-caption">SURFACE & FROST GEOMETRY</span>
      <label className="property-select">
        Surface Pattern
        <select
          aria-label="Surface Pattern"
          value={params.surfacePattern}
          onChange={e =>
            onUpdate({ surfacePattern: e.currentTarget.value as GlassSurfacePattern })
          }
        >
          <option value="smooth">Smooth Curvature Lens</option>
          <option value="frosted">Frosted Etched Glass</option>
          <option value="fluted">Fluted Architectural Ribs</option>
          <option value="rippled">Liquid Ripple Waves</option>
          <option value="faceted">Faceted Prismatic Crystal</option>
        </select>
      </label>
      <SliderRow
        label="Pattern Scale"
        value={params.patternScale}
        min={0.5}
        max={10.0}
        step={0.1}
        onChange={v => onUpdate({ patternScale: v })}
      />
      <SliderRow
        label="Frost Etching Intensity"
        value={params.frostIntensity}
        min={0.0}
        max={1.0}
        step={0.01}
        onChange={v => onUpdate({ frostIntensity: v })}
      />
      <SliderRow
        label="Bevel Edge Scatter"
        value={params.bevelWidth}
        min={0.0}
        max={1.0}
        step={0.01}
        onChange={v => onUpdate({ bevelWidth: v })}
      />

      <div className="shader-divider" />
      <span className="section-caption">LIGHTING & ABSORPTION TINT</span>
      <SliderRow
        label="Specular Glint"
        value={params.specularStrength}
        min={0.0}
        max={1.0}
        step={0.01}
        onChange={v => onUpdate({ specularStrength: v })}
      />
      <SliderRow
        label="Light Angle"
        value={params.lightAngle}
        min={0}
        max={360}
        step={1}
        onChange={v => onUpdate({ lightAngle: v })}
      />
      <SliderRow
        label="Tint Depth Opacity"
        value={params.tintOpacity}
        min={0.0}
        max={1.0}
        step={0.01}
        onChange={v => onUpdate({ tintOpacity: v })}
      />

      <div className="property-heading">
        <span>Tint & Highlight</span>
      </div>
      <div className="refractive-color-row">
        <label className="refractive-color-picker" title="Base Glass Tint">
          <input
            type="color"
            aria-label="Base Glass Tint"
            value={params.tintColor.slice(0, 7)}
            onChange={e => onUpdate({ tintColor: e.currentTarget.value })}
          />
          <span>Tint: {params.tintColor}</span>
        </label>
        <label className="refractive-color-picker" title="Specular Highlight Tint">
          <input
            type="color"
            aria-label="Specular Highlight Tint"
            value={params.highlightColor.slice(0, 7)}
            onChange={e => onUpdate({ highlightColor: e.currentTarget.value })}
          />
          <span>Highlight: {params.highlightColor}</span>
        </label>
      </div>
    </div>
  )
}

function ChromeControls({
  params,
  onUpdate,
}: {
  params: LiquidChromeParams
  onUpdate: (patch: Partial<LiquidChromeParams>) => void
}) {
  return (
    <div className="refractive-controls-section">
      <span className="section-caption">METALLIC & IRIDESCENT OPTICS</span>
      <SliderRow
        label="Metallic Sheen"
        value={params.metallicSheen}
        min={0.0}
        max={1.0}
        step={0.01}
        onChange={v => onUpdate({ metallicSheen: v })}
      />
      <SliderRow
        label="Rainbow Iridescence"
        value={params.iridescence}
        min={0.0}
        max={1.0}
        step={0.01}
        onChange={v => onUpdate({ iridescence: v })}
      />
      <SliderRow
        label="Film Thickness (nm)"
        value={params.filmThickness}
        min={100}
        max={1000}
        step={10}
        onChange={v => onUpdate({ filmThickness: v })}
      />
      <SliderRow
        label="Surface Roughness"
        value={params.roughness}
        min={0.0}
        max={1.0}
        step={0.01}
        onChange={v => onUpdate({ roughness: v })}
      />
      <SliderRow
        label="Highlight Dispersion"
        value={params.dispersion}
        min={0.0}
        max={1.0}
        step={0.01}
        onChange={v => onUpdate({ dispersion: v })}
      />

      <div className="shader-divider" />
      <span className="section-caption">FLUID FLOW DYNAMICS</span>
      <SliderRow
        label="Fluid Viscosity"
        value={params.fluidViscosity}
        min={0.0}
        max={1.0}
        step={0.01}
        onChange={v => onUpdate({ fluidViscosity: v })}
      />
      <SliderRow
        label="Flow Speed"
        value={params.flowSpeed}
        min={0.0}
        max={3.0}
        step={0.05}
        onChange={v => onUpdate({ flowSpeed: v })}
      />
      <SliderRow
        label="Ripple Frequency"
        value={params.rippleFrequency}
        min={0.5}
        max={10.0}
        step={0.1}
        onChange={v => onUpdate({ rippleFrequency: v })}
      />
      <SliderRow
        label="Normal Perturbation"
        value={params.normalPerturbation}
        min={0.0}
        max={1.0}
        step={0.01}
        onChange={v => onUpdate({ normalPerturbation: v })}
      />

      <div className="shader-divider" />
      <span className="section-caption">STUDIO ENVIRONMENT & PALETTE</span>
      <label className="property-select">
        Environment Reflection Map
        <select
          aria-label="Environment Reflection Map"
          value={params.environmentStyle}
          onChange={e =>
            onUpdate({
              environmentStyle: e.currentTarget.value as ChromeEnvironmentStyle,
            })
          }
        >
          <option value="studio">High-Craft Photo Studio</option>
          <option value="horizon">Horizon Mirror</option>
          <option value="aurora">Aurora Borealis</option>
          <option value="cyber">Cyber Chrome</option>
          <option value="monochrome">Monochrome Mercury</option>
        </select>
      </label>
      <SliderRow
        label="Light Angle"
        value={params.lightAngle}
        min={0}
        max={360}
        step={1}
        onChange={v => onUpdate({ lightAngle: v })}
      />
      <SliderRow
        label="Micro-Grain Dither"
        value={params.grainMixer}
        min={0.0}
        max={1.0}
        step={0.01}
        onChange={v => onUpdate({ grainMixer: v })}
      />

      <div className="property-heading">
        <span>Metal Base & Sheen</span>
      </div>
      <div className="refractive-color-row">
        <label className="refractive-color-picker" title="Metal Base Color">
          <input
            type="color"
            aria-label="Metal Base Color"
            value={params.baseColor.slice(0, 7)}
            onChange={e => onUpdate({ baseColor: e.currentTarget.value })}
          />
          <span>Base: {params.baseColor}</span>
        </label>
        <label className="refractive-color-picker" title="Metallic Sheen Tint">
          <input
            type="color"
            aria-label="Metallic Sheen Tint"
            value={params.sheenColor.slice(0, 7)}
            onChange={e => onUpdate({ sheenColor: e.currentTarget.value })}
          />
          <span>Sheen: {params.sheenColor}</span>
        </label>
      </div>
    </div>
  )
}
