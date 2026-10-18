import {
  Check,
  Copy,
  Layers,
  Magnet,
  Radio,
  Sparkles,
  Wand2,
  Wind,
} from 'lucide-react'
import { useState } from 'react'
import type { ShaderPaint } from '../types.ts'
import type {
  ParticleColorMode,
  ParticleMagneticMode,
  ParticlePresetId,
  ParticleSimulationParams,
  ParticleViewMode,
} from './types.ts'
import { PARTICLE_PRESETS } from './presets.ts'
import { exportParticleReact } from './particleExport.ts'

type ParticlePaint = Extract<ShaderPaint, { kind: 'particle-simulation' }>

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

export function ParticleInspector({
  paint,
  onChange,
  onBindTarget,
}: {
  paint: ParticlePaint
  onChange: (paint: ParticlePaint) => void
  target?: string
  onBindTarget?: (mode: 'selection' | 'background' | 'new-card') => void
}) {
  const [copied, setCopied] = useState(false)
  const params = paint.params

  const updateParams = (patch: Partial<ParticleSimulationParams>) => {
    onChange({
      ...paint,
      params: { ...paint.params, ...patch },
    })
  }

  const copyCode = async () => {
    try {
      const code = exportParticleReact(paint)
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback
    }
  }

  const addColor = (hex: string) => {
    if (params.particleColors.length < 8) {
      updateParams({ particleColors: [...params.particleColors, hex] })
    }
  }

  const removeColor = (index: number) => {
    if (params.particleColors.length > 2) {
      updateParams({ particleColors: params.particleColors.filter((_, i) => i !== index) })
    }
  }

  const updateColor = (index: number, hex: string) => {
    updateParams({
      particleColors: params.particleColors.map((c, i) => (i === index ? hex : c)),
    })
  }

  const applyPreset = (presetId: ParticlePresetId) => {
    const preset = PARTICLE_PRESETS.find(p => p.id === presetId)
    if (preset) {
      updateParams({ ...preset.params, particleColors: [...preset.params.particleColors] })
    }
  }

  const magneticModes: readonly { id: ParticleMagneticMode; label: string }[] = [
    { id: 'vortex', label: 'Vortex' },
    { id: 'attract', label: 'Attract' },
    { id: 'repel', label: 'Repel' },
    { id: 'dipole', label: 'Dipole' },
    { id: 'cross-flow', label: 'Cross Flow' },
    { id: 'orbit', label: 'Orbit' },
  ]

  const particleCounts = [4096, 12288, 16384, 24576, 32768, 65536]

  return (
    <div className="particle-inspector" data-testid="particle-inspector">
      {/* PRESETS BLOCK */}
      <div className="refractive-presets-block">
        <div className="property-heading">
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Sparkles size={11} /> PARTICLE PRESETS
          </span>
          <span className="shader-engine-mark">{PARTICLE_PRESETS.length} CRAFT MODES</span>
        </div>
        <div className="refractive-chip-grid">
          {PARTICLE_PRESETS.map(preset => (
            <button
              key={preset.id}
              type="button"
              className="refractive-chip"
              onClick={() => applyPreset(preset.id)}
            >
              <Wand2 size={10} />
              <span>{preset.name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="shader-divider" />

      {/* CURSOR MAGNETIC FIELD CONTROLS */}
      <div className="property-heading">
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Magnet size={11} /> CURSOR MAGNETIC FIELD
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, margin: '6px 0 10px' }}>
        {magneticModes.map(mode => (
          <button
            key={mode.id}
            type="button"
            className={`material-category-pill ${params.magneticMode === mode.id ? 'active' : ''}`}
            onClick={() => updateParams({ magneticMode: mode.id })}
            style={{ textAlign: 'center', justifyContent: 'center' }}
          >
            {mode.label}
          </button>
        ))}
      </div>

      <SliderRow
        label="Magnetic force"
        value={params.magneticForce}
        min={0.0}
        max={10.0}
        step={0.1}
        onChange={v => updateParams({ magneticForce: v })}
      />

      <SliderRow
        label="Magnetic radius"
        value={params.magneticRadius}
        min={0.05}
        max={1.0}
        step={0.01}
        onChange={v => updateParams({ magneticRadius: v })}
      />

      <SliderRow
        label="Grid magnetic poles"
        value={params.magneticPolesCount}
        min={0}
        max={8}
        step={1}
        onChange={v => updateParams({ magneticPolesCount: v })}
      />

      <SliderRow
        label="120px grid alignment"
        value={params.gridAlignment}
        min={0.0}
        max={1.0}
        step={0.05}
        onChange={v => updateParams({ gridAlignment: v })}
      />

      <div className="shader-divider" />

      {/* CURL NOISE DYNAMICS */}
      <div className="property-heading">
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Wind size={11} /> INCOMPRESSIBLE CURL NOISE
        </span>
      </div>

      <SliderRow
        label="Curl strength"
        value={params.curlStrength}
        min={0.0}
        max={10.0}
        step={0.1}
        onChange={v => updateParams({ curlStrength: v })}
      />

      <SliderRow
        label="Curl scale"
        value={params.curlScale}
        min={0.2}
        max={10.0}
        step={0.1}
        onChange={v => updateParams({ curlScale: v })}
      />

      <SliderRow
        label="Fractal octaves"
        value={params.curlOctaves}
        min={1}
        max={5}
        step={1}
        onChange={v => updateParams({ curlOctaves: v })}
      />

      <SliderRow
        label="Advection speed"
        value={params.advectionSpeed}
        min={0.1}
        max={5.0}
        step={0.05}
        onChange={v => updateParams({ advectionSpeed: v })}
      />

      <SliderRow
        label="Velocity damping"
        value={params.velocityDamping}
        min={0.8}
        max={0.999}
        step={0.005}
        onChange={v => updateParams({ velocityDamping: v })}
      />

      <SliderRow
        label="Brownian jitter"
        value={params.jitter}
        min={0.0}
        max={1.0}
        step={0.02}
        onChange={v => updateParams({ jitter: v })}
      />

      <div className="shader-divider" />

      {/* PARTICLES & OPTICS */}
      <div className="property-heading">
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Radio size={11} /> PARTICLES & TRAILS
        </span>
      </div>

      <label className="property-select">
        Particle density
        <select
          value={params.particleCount}
          onChange={e => updateParams({ particleCount: Number(e.currentTarget.value) })}
        >
          {particleCounts.map(count => (
            <option key={count} value={count}>
              {count.toLocaleString()} particles ({Math.round(Math.sqrt(count))}×{Math.round(Math.sqrt(count))})
            </option>
          ))}
        </select>
      </label>

      <SliderRow
        label="Particle size"
        value={params.particleSize}
        min={0.5}
        max={12.0}
        step={0.2}
        onChange={v => updateParams({ particleSize: v })}
      />

      <SliderRow
        label="Trail persistence"
        value={params.trailDecay}
        min={0.7}
        max={0.99}
        step={0.01}
        onChange={v => updateParams({ trailDecay: v })}
      />

      <SliderRow
        label="Bloom glow"
        value={params.glowIntensity}
        min={0.0}
        max={2.0}
        step={0.05}
        onChange={v => updateParams({ glowIntensity: v })}
      />

      <label className="property-select">
        View mode
        <select
          value={params.viewMode}
          onChange={e => updateParams({ viewMode: e.currentTarget.value as ParticleViewMode })}
        >
          <option value="field-composite">Composite (Particles + Trails + 120px Grid)</option>
          <option value="particles-only">Particles Only</option>
          <option value="trails-only">Phosphorescent Trails Only</option>
          <option value="velocity-stream">Velocity Streamlines</option>
          <option value="flow-vectors">Curl Vector Flow Field</option>
          <option value="magnetic-potential">Magnetic Equipotential Lines</option>
        </select>
      </label>

      <div className="shader-divider" />

      {/* PALETTE & COLOR MODE */}
      <div className="property-heading">
        <span>PALETTE & COLOR MODE</span>
        <span className="shader-engine-mark">{params.particleColors.length} / 8 COLORS</span>
      </div>

      <label className="property-select">
        Color mapping
        <select
          value={params.colorMode}
          onChange={e => updateParams({ colorMode: e.currentTarget.value as ParticleColorMode })}
        >
          <option value="palette">Palette Lifecycle Interpolation</option>
          <option value="magnetic-flow">Magnetic Flow Angle</option>
          <option value="velocity">Velocity Heatmap</option>
          <option value="paper-blueprint">Paper Blueprint (#81adec)</option>
          <option value="aurora">Aurora Atmospheric</option>
          <option value="monochrome">Monochrome Minimal</option>
        </select>
      </label>

      <div className="shader-palette">
        {params.particleColors.map((hex, index) => (
          <div className="shader-swatch" key={index}>
            <input
              type="color"
              aria-label={`Particle palette color ${index + 1}`}
              value={hex.slice(0, 7)}
              onChange={e => updateColor(index, e.currentTarget.value)}
            />
            {params.particleColors.length > 2 && (
              <button
                type="button"
                aria-label={`Remove particle color ${index + 1}`}
                onClick={() => removeColor(index)}
              >
                ×
              </button>
            )}
          </div>
        ))}
        {params.particleColors.length < 8 && (
          <button
            type="button"
            className="shader-add-color"
            aria-label="Add particle palette color"
            onClick={() => addColor('#81adec')}
          >
            +
          </button>
        )}
      </div>

      {/* BIND ACTIONS & EXPORT */}
      {onBindTarget && (
        <div className="refractive-bind-toolbar">
          <span className="refractive-bind-label">
            <Layers size={10} /> Bind to:
          </span>
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
              Canvas BG
            </button>
            <button
              type="button"
              className="refractive-action-btn"
              onClick={() => onBindTarget('new-card')}
            >
              New Layer
            </button>
          </div>
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <button
          type="button"
          className="refractive-copy-btn"
          style={{ width: '100%', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: 6 }}
          onClick={copyCode}
        >
          {copied ? <Check size={12} color="#81adec" /> : <Copy size={12} />}
          {copied ? 'Code Copied to Clipboard!' : 'Export React Component'}
        </button>
      </div>
    </div>
  )
}
