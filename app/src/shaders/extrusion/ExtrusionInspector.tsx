import { Box, Compass, Eye, Palette, Sparkles, Sun } from 'lucide-react'
import { useId } from 'react'
import { EXTRUSION_PRESETS, extrusionPresetKeys } from './presets.ts'
import type { ExtrusionBevelProfile, ExtrusionViewMode, VectorExtrusionParams } from './types.ts'
import { extrusionBevelProfiles, extrusionViewModes } from './types.ts'
import './extrusion.css'

interface NumberSliderProps {
  readonly label: string
  readonly value: number
  readonly min: number
  readonly max: number
  readonly step: number
  readonly unit?: string
  readonly onChange: (value: number) => void
}

function NumberSlider({ label, value, min, max, step, unit = '', onChange }: NumberSliderProps) {
  const inputId = useId()
  const change = (v: number) => {
    if (Number.isFinite(v)) {
      onChange(Math.max(min, Math.min(max, v)))
    }
  }

  return (
    <div className="shader-slider">
      <label htmlFor={inputId}>
        {label} {unit && <span className="slider-unit">({unit})</span>}
      </label>
      <input
        id={inputId}
        type="number"
        aria-label={label}
        value={Number(value.toFixed(2))}
        min={min}
        max={max}
        step={step}
        onChange={e => change(e.currentTarget.valueAsNumber)}
      />
      <input
        type="range"
        aria-label={`${label} slider`}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={e => change(e.currentTarget.valueAsNumber)}
      />
    </div>
  )
}

interface ColorControlProps {
  readonly label: string
  readonly value: string
  readonly onChange: (color: string) => void
}

function ColorControl({ label, value, onChange }: ColorControlProps) {
  return (
    <div className="extrusion-color-row">
      <span className="color-label">{label}</span>
      <div className="color-inputs">
        <label className="property-color">
          <input
            type="color"
            aria-label={`${label} picker`}
            value={value.slice(0, 7)}
            onChange={e => onChange(e.currentTarget.value)}
          />
        </label>
        <input
          type="text"
          className="color-hex-input"
          aria-label={`${label} hex code`}
          value={value.toUpperCase()}
          onChange={e => {
            if (/^#[\da-f]{6}$/i.test(e.currentTarget.value)) {
              onChange(e.currentTarget.value.toLowerCase())
            }
          }}
        />
      </div>
    </div>
  )
}

interface ExtrusionInspectorProps {
  readonly params: VectorExtrusionParams
  readonly onChange: (params: VectorExtrusionParams) => void
  readonly target?: string
}

export function ExtrusionInspector({ params, onChange, target }: ExtrusionInspectorProps) {
  const update = (patch: Partial<VectorExtrusionParams>) => {
    onChange({
      ...params,
      ...patch,
    })
  }

  const applyPreset = (presetId: string) => {
    const preset = EXTRUSION_PRESETS[presetId]
    if (preset) {
      onChange({ ...preset.params })
    }
  }

  return (
    <div className="extrusion-inspector" data-testid="extrusion-inspector">
      <div className="shader-heading">
        <span className="section-caption">3D VECTOR EXTRUSION</span>
        <span className="shader-engine-mark">WEBGL 3D</span>
      </div>

      {target && <div className="shader-target"><i />{target}</div>}
      <p className="shader-description">
        Real-time WebGL 3D vector extrusion with configurable bevel depth, analytical normal maps, directional shadows, and crevice ambient occlusion.
      </p>

      {/* Preset Quick Chooser */}
      <div className="extrusion-section">
        <div className="section-title">
          <Sparkles size={12} />
          <span>Craft Presets</span>
        </div>
        <div className="preset-grid">
          {extrusionPresetKeys.map(key => {
            const p = EXTRUSION_PRESETS[key]
            return (
              <button
                key={key}
                type="button"
                className="preset-card"
                onClick={() => applyPreset(key)}
                title={p.description}
              >
                <div
                  className="preset-preview-chip"
                  style={{ backgroundColor: p.params.baseColor, borderColor: p.params.sideColor }}
                />
                <span className="preset-name">{p.name}</span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="shader-divider" />

      {/* 3D Extrusion & Bevel Section */}
      <div className="extrusion-section">
        <div className="section-title">
          <Box size={12} />
          <span>3D Geometry & Bevel Profile</span>
        </div>

        <NumberSlider
          label="Extrusion depth"
          value={params.extrusionDepth}
          min={0}
          max={100}
          step={1}
          unit="px"
          onChange={v => update({ extrusionDepth: v })}
        />

        <NumberSlider
          label="Bevel depth"
          value={params.bevelDepth}
          min={0}
          max={50}
          step={0.5}
          unit="px"
          onChange={v => update({ bevelDepth: v })}
        />

        <NumberSlider
          label="Bevel width"
          value={params.bevelWidth}
          min={1}
          max={50}
          step={0.5}
          unit="px"
          onChange={v => update({ bevelWidth: v })}
        />

        <label className="property-select">
          Bevel profile
          <select
            aria-label="Bevel profile"
            value={params.bevelProfile}
            onChange={e => update({ bevelProfile: e.currentTarget.value as ExtrusionBevelProfile })}
          >
            {extrusionBevelProfiles.map(prof => (
              <option key={prof} value={prof}>
                {prof.charAt(0).toUpperCase() + prof.slice(1)}
              </option>
            ))}
          </select>
        </label>

        {params.bevelProfile === 'stepped' && (
          <NumberSlider
            label="Stepped segments"
            value={params.bevelSegments}
            min={2}
            max={16}
            step={1}
            onChange={v => update({ bevelSegments: Math.round(v) })}
          />
        )}
      </div>

      <div className="shader-divider" />

      {/* Directional Lighting & Shadows Section */}
      <div className="extrusion-section">
        <div className="section-title">
          <Sun size={12} />
          <span>Directional Lighting & Shadows</span>
        </div>

        <NumberSlider
          label="Light azimuth"
          value={params.lightAzimuth}
          min={0}
          max={360}
          step={1}
          unit="°"
          onChange={v => update({ lightAzimuth: v })}
        />

        <NumberSlider
          label="Light elevation"
          value={params.lightElevation}
          min={5}
          max={90}
          step={1}
          unit="°"
          onChange={v => update({ lightElevation: v })}
        />

        <NumberSlider
          label="Light intensity"
          value={params.lightIntensity}
          min={0}
          max={3.0}
          step={0.05}
          onChange={v => update({ lightIntensity: v })}
        />

        <ColorControl
          label="Light color"
          value={params.lightColor}
          onChange={v => update({ lightColor: v })}
        />

        <NumberSlider
          label="Shadow softness"
          value={params.shadowSoftness}
          min={0.05}
          max={1.0}
          step={0.02}
          onChange={v => update({ shadowSoftness: v })}
        />

        <NumberSlider
          label="Shadow length"
          value={params.shadowLength}
          min={0}
          max={2.0}
          step={0.05}
          onChange={v => update({ shadowLength: v })}
        />

        <NumberSlider
          label="Shadow opacity"
          value={params.shadowOpacity}
          min={0}
          max={1.0}
          step={0.02}
          onChange={v => update({ shadowOpacity: v })}
        />
      </div>

      <div className="shader-divider" />

      {/* Ambient Occlusion Section */}
      <div className="extrusion-section">
        <div className="section-title">
          <Compass size={12} />
          <span>Ambient Occlusion</span>
        </div>

        <NumberSlider
          label="AO intensity"
          value={params.ambientOcclusion}
          min={0}
          max={1.0}
          step={0.02}
          onChange={v => update({ ambientOcclusion: v })}
        />

        <NumberSlider
          label="AO sampling radius"
          value={params.aoRadius}
          min={1}
          max={30}
          step={1}
          unit="px"
          onChange={v => update({ aoRadius: v })}
        />
      </div>

      <div className="shader-divider" />

      {/* Materials & Colors Section */}
      <div className="extrusion-section">
        <div className="section-title">
          <Palette size={12} />
          <span>Material Surface & Normals</span>
        </div>

        <ColorControl
          label="Top face color"
          value={params.baseColor}
          onChange={v => update({ baseColor: v })}
        />

        <ColorControl
          label="Side wall color"
          value={params.sideColor}
          onChange={v => update({ sideColor: v })}
        />

        <NumberSlider
          label="Roughness"
          value={params.roughness}
          min={0}
          max={1.0}
          step={0.01}
          onChange={v => update({ roughness: v })}
        />

        <NumberSlider
          label="Metallic"
          value={params.metallic}
          min={0}
          max={1.0}
          step={0.01}
          onChange={v => update({ metallic: v })}
        />

        <NumberSlider
          label="Specular intensity"
          value={params.specularIntensity}
          min={0}
          max={2.0}
          step={0.05}
          onChange={v => update({ specularIntensity: v })}
        />

        <NumberSlider
          label="Normal map strength"
          value={params.normalMapStrength}
          min={0}
          max={3.0}
          step={0.05}
          onChange={v => update({ normalMapStrength: v })}
        />
      </div>

      <div className="shader-divider" />

      {/* Diagnostic View Mode */}
      <div className="extrusion-section">
        <div className="section-title">
          <Eye size={12} />
          <span>Inspection View Mode</span>
        </div>

        <label className="property-select">
          View mode
          <select
            aria-label="Inspection view mode"
            value={params.viewMode}
            onChange={e => update({ viewMode: e.currentTarget.value as ExtrusionViewMode })}
          >
            {extrusionViewModes.map(mode => (
              <option key={mode} value={mode}>
                {mode === 'shaded'
                  ? 'Full Shaded (Composite)'
                  : mode === 'normal-map'
                    ? 'Normal Map (Surface Normals)'
                    : mode === 'depth'
                      ? 'Depth Field (Extrusion Height)'
                      : mode === 'ambient-occlusion'
                        ? 'Ambient Occlusion Only'
                        : 'Directional Lighting Only'}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  )
}
