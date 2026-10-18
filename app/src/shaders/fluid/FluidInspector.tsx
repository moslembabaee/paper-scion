import {
  Check,
  Copy,
  Layers,
  Waves,
  Wand2,
} from 'lucide-react'
import { useState } from 'react'
import type { ShaderPaint } from '../types.ts'
import type { FluidColorMode, FluidSimulationParams, FluidViewMode } from './types.ts'
import { FLUID_PRESETS } from './presets.ts'
import { exportFluidReact } from './fluidExport.ts'

type FluidPaint = Extract<ShaderPaint, { kind: 'fluid-simulation' }>

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

export function FluidInspector({
  paint,
  onChange,
  onBindTarget,
}: {
  paint: FluidPaint
  onChange: (paint: FluidPaint) => void
  target?: string
  onBindTarget?: (mode: 'selection' | 'background' | 'new-card') => void
}) {
  const [copied, setCopied] = useState(false)
  const params = paint.params

  const updateParams = (patch: Partial<FluidSimulationParams>) => {
    onChange({
      ...paint,
      params: { ...paint.params, ...patch },
    })
  }

  const copyCode = async () => {
    try {
      const code = exportFluidReact(paint)
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback
    }
  }

  const addDyeColor = (hex: string) => {
    if (params.dyeColors.length < 8) {
      updateParams({ dyeColors: [...params.dyeColors, hex] })
    }
  }

  const removeDyeColor = (index: number) => {
    if (params.dyeColors.length > 1) {
      updateParams({ dyeColors: params.dyeColors.filter((_, i) => i !== index) })
    }
  }

  const updateDyeColor = (index: number, hex: string) => {
    updateParams({
      dyeColors: params.dyeColors.map((c, i) => (i === index ? hex : c)),
    })
  }

  return (
    <div className="fluid-inspector" data-testid="fluid-inspector">
      <div className="refractive-header">
        <div className="refractive-title-badge">
          <Waves size={11} />
          <span>NAVIER-STOKES 2D FLUID DYNAMICS</span>
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
        <span className="section-caption">SIMULATION PRESETS</span>
        <div className="refractive-chip-grid">
          {FLUID_PRESETS.map(preset => (
            <button
              key={preset.id}
              type="button"
              className="refractive-chip"
              onClick={() => updateParams(preset.params)}
              title={preset.description}
            >
              <Wand2 size={10} />
              <span>{preset.name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="shader-divider" />

      {/* View Mode & Diagnostics */}
      <div className="property-group">
        <label className="property-select">
          Diagnostics View
          <select
            aria-label="Fluid diagnostic view mode"
            value={params.viewMode}
            onChange={e => updateParams({ viewMode: e.currentTarget.value as FluidViewMode })}
          >
            <option value="fluid-composite">Composite (Shaded Fluid & Optics)</option>
            <option value="dye-only">Dye Dispersion Only</option>
            <option value="velocity">Velocity Vector Field</option>
            <option value="pressure">Pressure Poisson Field</option>
            <option value="normal-map">Surface Normal Map</option>
            <option value="refraction-only">Refraction Offset Field</option>
          </select>
        </label>
      </div>

      <div className="shader-divider" />

      {/* Fluid Physical Dynamics */}
      <span className="section-caption">FLUID MECHANICS</span>
      <SliderRow
        label="Kinematic Viscosity"
        value={params.viscosity}
        min={0}
        max={1}
        step={0.01}
        onChange={viscosity => updateParams({ viscosity })}
      />
      <SliderRow
        label="Vorticity / Curl Confinement"
        value={params.curlStrength}
        min={0}
        max={50}
        step={0.5}
        onChange={curlStrength => updateParams({ curlStrength })}
      />
      <SliderRow
        label="Dye Dissipation"
        value={params.densityDissipation}
        min={0.8}
        max={1.0}
        step={0.005}
        onChange={densityDissipation => updateParams({ densityDissipation })}
      />
      <SliderRow
        label="Velocity Damping"
        value={params.velocityDissipation}
        min={0.8}
        max={1.0}
        step={0.005}
        onChange={velocityDissipation => updateParams({ velocityDissipation })}
      />
      <SliderRow
        label="Poisson Iterations"
        value={params.pressureIterations}
        min={4}
        max={64}
        step={1}
        onChange={pressureIterations => updateParams({ pressureIterations })}
      />
      <SliderRow
        label="Impulse Force"
        value={params.splatForce}
        min={500}
        max={10000}
        step={100}
        onChange={splatForce => updateParams({ splatForce })}
      />
      <SliderRow
        label="Impulse Radius"
        value={params.splatRadius}
        min={0.005}
        max={0.1}
        step={0.005}
        onChange={splatRadius => updateParams({ splatRadius })}
      />
      <SliderRow
        label="Ambient Flow Drift"
        value={params.ambientFlow}
        min={0}
        max={2}
        step={0.05}
        onChange={ambientFlow => updateParams({ ambientFlow })}
      />

      <div className="shader-divider" />

      {/* Optics & Surface Ripple Refraction */}
      <span className="section-caption">SURFACE RIPPLES & REFRACTION</span>
      <SliderRow
        label="Refractive Index (IOR)"
        value={params.refractionIndex}
        min={1.0}
        max={2.5}
        step={0.01}
        onChange={refractionIndex => updateParams({ refractionIndex })}
      />
      <SliderRow
        label="Chromatic Dispersion"
        value={params.dispersion}
        min={0}
        max={1}
        step={0.01}
        onChange={dispersion => updateParams({ dispersion })}
      />
      <SliderRow
        label="Surface Tension"
        value={params.surfaceTension}
        min={0}
        max={1}
        step={0.01}
        onChange={surfaceTension => updateParams({ surfaceTension })}
      />
      <SliderRow
        label="Normal Bump Relief"
        value={params.normalPerturbation}
        min={0}
        max={1}
        step={0.01}
        onChange={normalPerturbation => updateParams({ normalPerturbation })}
      />
      <SliderRow
        label="Specular Glint"
        value={params.specularStrength}
        min={0}
        max={2}
        step={0.05}
        onChange={specularStrength => updateParams({ specularStrength })}
      />
      <SliderRow
        label="Key Light Angle"
        value={params.lightAngle}
        min={0}
        max={360}
        step={1}
        onChange={lightAngle => updateParams({ lightAngle })}
      />

      <div className="shader-divider" />

      {/* Dye Palette & Color Modes */}
      <span className="section-caption">DYE DISPERSION PALETTE</span>
      <div className="property-group">
        <label className="property-select">
          Color Mapping
          <select
            aria-label="Fluid dye color mode"
            value={params.colorMode}
            onChange={e => updateParams({ colorMode: e.currentTarget.value as FluidColorMode })}
          >
            <option value="palette">Palette Swatches</option>
            <option value="rainbow">Spectral Rainbow</option>
            <option value="monochrome">Monochrome / Mercury</option>
            <option value="fire">Thermal Flare</option>
            <option value="velocity">Velocity Energy</option>
          </select>
        </label>
      </div>

      <div className="shader-palette">
        {params.dyeColors.map((hex, index) => (
          <div className="shader-swatch" key={index}>
            <input
              type="color"
              aria-label={`Dye color ${index + 1}`}
              value={hex.slice(0, 7)}
              onChange={e => updateDyeColor(index, e.currentTarget.value)}
            />
            {params.dyeColors.length > 1 && (
              <button
                type="button"
                aria-label={`Remove dye color ${index + 1}`}
                onClick={() => removeDyeColor(index)}
              >
                ×
              </button>
            )}
          </div>
        ))}
        {params.dyeColors.length < 8 && (
          <button
            type="button"
            className="shader-add-color"
            aria-label="Add dye color"
            onClick={() => addDyeColor('#81adec')}
          >
            +
          </button>
        )}
      </div>

      <div className="shader-divider" />

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
              + Fluid Layer
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
