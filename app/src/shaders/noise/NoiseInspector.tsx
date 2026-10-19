import {
  Code2,
  Copy,
  Layers,
  Sparkles,
  Sun,
  Wand2,
  Waves,
} from 'lucide-react'
import { useState } from 'react'
import type { ProceduralNoiseParams, ShaderPaint } from '../types.ts'
import { PROCEDURAL_NOISE_PRESETS } from './proceduralNoise.ts'
import { exportProceduralNoiseReact } from './noiseExport.ts'

type ProceduralPaint = Extract<ShaderPaint, { kind: 'procedural-noise' }>

function NoiseRange({
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
    <div className="property-slider">
      <div className="property-slider-label">
        <span>{label}</span>
        <span className="property-slider-value">
          {step >= 1 ? value : value.toFixed(2)}
        </span>
      </div>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(e.currentTarget.valueAsNumber)}
      />
    </div>
  )
}

export function NoiseInspector({
  paint,
  onChange,
  target,
  onBindTarget,
}: {
  paint: ProceduralPaint
  onChange: (paint: ShaderPaint) => void
  target?: string
  onBindTarget?: (mode: 'selection' | 'background' | 'new-card') => void
}) {
  const [copied, setCopied] = useState(false)
  const params: ProceduralNoiseParams = paint.params

  const update = (patch: Partial<ProceduralNoiseParams>) => {
    onChange({
      ...paint,
      params: { ...params, ...patch },
    })
  }

  const copyCode = () => {
    const code = exportProceduralNoiseReact(paint)
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="noise-inspector" role="region" aria-label="Procedural Noise Inspector">
      <div className="noise-inspector-header">
        <span className="section-caption">PROCEDURAL GENERATOR & RELIEF</span>
        <span className="shader-engine-mark">GPU MULTI-OCTAVE</span>
      </div>

      {/* Preset Chips */}
      <div className="noise-presets-section">
        <span className="section-caption">MATERIAL PRESETS</span>
        <div className="noise-preset-chips" role="group" aria-label="Procedural noise presets">
          {PROCEDURAL_NOISE_PRESETS.map(preset => {
            const isPresetActive =
              params.noiseType === preset.params.noiseType &&
              Math.abs(params.frequency - preset.params.frequency) < 0.01 &&
              params.octaves === preset.params.octaves &&
              Math.abs(params.lacunarity - preset.params.lacunarity) < 0.01 &&
              Math.abs(params.normalPerturbation - preset.params.normalPerturbation) < 0.01 &&
              Math.abs(params.displacement - preset.params.displacement) < 0.01
            return (
              <button
                key={preset.id}
                type="button"
                className={`noise-preset-chip ${isPresetActive ? 'preset-active' : ''}`}
                title={preset.description}
                aria-label={`Apply ${preset.name} preset`}
                onClick={() => update(preset.params)}
              >
                <Wand2 size={10} />
                <span>{preset.name}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Generator Type Selector: Simplex, Perlin, Worley */}
      <div className="noise-generator-select">
        <span className="section-caption">NOISE ALGORITHM</span>
        <div className="noise-generator-tabs" role="group" aria-label="Noise generator algorithms">
          {(['simplex', 'perlin', 'worley'] as const).map(gen => (
            <button
              key={gen}
              type="button"
              className={`noise-generator-tab ${params.noiseType === gen ? 'active' : ''}`}
              aria-pressed={params.noiseType === gen}
              onClick={() => update({ noiseType: gen })}
            >
              <Sparkles size={11} />
              <span>{gen.charAt(0).toUpperCase() + gen.slice(1)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* View Mode Toggle: Shaded Relief, Normal Map, Heightmap */}
      <div className="noise-viewmode-select">
        <span className="section-caption">VIEW MODE</span>
        <div className="noise-viewmode-tabs" role="group" aria-label="Shader output view modes">
          {[
            { id: 'shaded', label: 'Shaded Relief', icon: Sun },
            { id: 'normal-map', label: 'Normal Map', icon: Layers },
            { id: 'heightmap', label: 'Heightmap', icon: Waves },
          ].map(mode => {
            const Icon = mode.icon
            const active = (params.viewMode ?? 'shaded') === mode.id
            return (
              <button
                key={mode.id}
                type="button"
                className={`noise-viewmode-tab ${active ? 'active' : ''}`}
                aria-pressed={active}
                onClick={() => update({ viewMode: mode.id as ProceduralNoiseParams['viewMode'] })}
              >
                <Icon size={11} />
                <span>{mode.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Frequency & Octave Controls */}
      <div className="shader-divider" />
      <span className="section-caption">OCTAVE & HARMONIC CONTROLS</span>
      <NoiseRange
        label="Noise Frequency"
        min={0.5}
        max={20}
        step={0.1}
        value={params.frequency}
        onChange={frequency => update({ frequency })}
      />
      <NoiseRange
        label="Octave Count"
        min={1}
        max={8}
        step={1}
        value={params.octaves}
        onChange={octaves => update({ octaves })}
      />
      <NoiseRange
        label="Lacunarity (Frequency Step)"
        min={1.0}
        max={5.0}
        step={0.1}
        value={params.lacunarity}
        onChange={lacunarity => update({ lacunarity })}
      />
      <NoiseRange
        label="Roughness (Persistence)"
        min={0.1}
        max={1.0}
        step={0.05}
        value={params.persistence}
        onChange={persistence => update({ persistence })}
      />
      <NoiseRange
        label="Turbulence Folding"
        min={0}
        max={1}
        step={0.01}
        value={params.turbulence}
        onChange={turbulence => update({ turbulence })}
      />

      {/* Displacement & Normal Perturbation */}
      <div className="shader-divider" />
      <span className="section-caption">SURFACE DISPLACEMENT & NORMALS</span>
      <NoiseRange
        label="Displacement Height"
        min={0}
        max={1}
        step={0.01}
        value={params.displacement}
        onChange={displacement => update({ displacement })}
      />
      <NoiseRange
        label="Normal Surface Perturbation"
        min={0}
        max={1}
        step={0.01}
        value={params.normalPerturbation}
        onChange={normalPerturbation => update({ normalPerturbation })}
      />
      <NoiseRange
        label="Light Direction Angle"
        min={0}
        max={360}
        step={1}
        value={params.lightAngle}
        onChange={lightAngle => update({ lightAngle })}
      />
      <NoiseRange
        label="Specular Highlight"
        min={0}
        max={1}
        step={0.01}
        value={params.specularStrength}
        onChange={specularStrength => update({ specularStrength })}
      />

      {/* Grain Finish */}
      <div className="shader-divider" />
      <span className="section-caption">GRAIN FINISH</span>
      <NoiseRange
        label="Grain Mixer"
        min={0}
        max={1}
        step={0.01}
        value={params.grainMixer}
        onChange={grainMixer => update({ grainMixer })}
      />
      <NoiseRange
        label="Grain Overlay"
        min={0}
        max={1}
        step={0.01}
        value={params.grainOverlay}
        onChange={grainOverlay => update({ grainOverlay })}
      />

      {/* Color Ramp */}
      <div className="shader-divider" />
      <span className="section-caption">MATERIAL PALETTE</span>
      <div className="noise-colors-grid">
        <label className="noise-color-field">
          <span>Highlight</span>
          <div className="noise-color-swatch-row">
            <input
              type="color"
              aria-label="Highlight color"
              value={params.colorFront.slice(0, 7)}
              onChange={e => update({ colorFront: e.currentTarget.value })}
            />
            <span className="noise-color-hex">{params.colorFront.toUpperCase()}</span>
          </div>
        </label>
        <label className="noise-color-field">
          <span>Midtone</span>
          <div className="noise-color-swatch-row">
            <input
              type="color"
              aria-label="Midtone color"
              value={params.colorMid.slice(0, 7)}
              onChange={e => update({ colorMid: e.currentTarget.value })}
            />
            <span className="noise-color-hex">{params.colorMid.toUpperCase()}</span>
          </div>
        </label>
        <label className="noise-color-field">
          <span>Base</span>
          <div className="noise-color-swatch-row">
            <input
              type="color"
              aria-label="Base color"
              value={params.colorBack.slice(0, 7)}
              onChange={e => update({ colorBack: e.currentTarget.value })}
            />
            <span className="noise-color-hex">{params.colorBack.toUpperCase()}</span>
          </div>
        </label>
      </div>

      {/* Direct Scene Canvas Binding */}
      {target && onBindTarget && (
        <div className="noise-binding-section">
          <div className="shader-divider" />
          <div className="mesh-binding-row">
            <span className="section-caption">CANVAS BINDING</span>
            <span className="mesh-binding-target-badge">{target}</span>
          </div>
          <div className="mesh-binding-actions">
            {target !== 'Canvas background' && (
              <button
                type="button"
                className="mesh-binding-btn"
                title="Apply this noise material to canvas background"
                onClick={() => onBindTarget('background')}
              >
                Apply to Background
              </button>
            )}
            {target === 'Canvas background' && (
              <button
                type="button"
                className="mesh-binding-btn"
                title="Bind this noise material to selected canvas layers"
                onClick={() => onBindTarget('selection')}
              >
                Bind to Selection
              </button>
            )}
            <button
              type="button"
              className="mesh-binding-btn"
              title="Create a new canvas card with this procedural noise"
              onClick={() => onBindTarget('new-card')}
            >
              Create Noise Card
            </button>
          </div>
        </div>
      )}

      {/* Code Export */}
      <details className="mesh-code">
        <summary>
          <Code2 size={12} />
          React shader code
        </summary>
        <div className="mesh-code-body">
          <div className="mesh-code-actions">
            <button
              type="button"
              className="mesh-code-copy"
              onClick={copyCode}
              title="Copy React shader component"
            >
              <Copy size={11} />
              <span>{copied ? 'Copied!' : 'Copy Component'}</span>
            </button>
          </div>
          <pre>
            <code>{exportProceduralNoiseReact(paint)}</code>
          </pre>
        </div>
      </details>
    </div>
  )
}
