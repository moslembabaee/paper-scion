import {
  Activity,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Download,
  Droplet,
  Eye,
  EyeOff,
  Film,
  Glasses,
  Layers,
  Plus,
  Radio,
  Sparkles,
  Trash2,
  Waves,
} from 'lucide-react'
import { useState } from 'react'
import type { ShaderPaint } from '../types.ts'
import { shaderBlendModes } from '../types.ts'
import {
  addPipelineModulator,
  addPipelinePass,
  duplicatePipelinePass,
  loadPipelinePreset,
  removePipelineModulator,
  removePipelinePass,
  reorderPipelinePasses,
  togglePipelineModulator,
  togglePipelinePass,
  updatePipelineModulator,
  updatePipelinePass,
} from './pipelineOps.ts'
import { PIPELINE_PRESETS, presetKeys } from './presets.ts'
import { exportPipelineGLSL, exportPipelineReact, exportPipelineUniforms } from './pipelineExport.ts'
import type {
  ChromaticAberrationPassParams,
  CustomGLSLPassParams,
  GlassmorphismPassParams,
  GrainPassParams,
  LiquidDistortionPassParams,
  MeshGradientPassParams,
  ModulatorWaveform,
  PipelinePass,
  PipelinePassType,
} from './types.ts'
import { modulatorWaveforms, pipelinePassTypes } from './types.ts'
import { AudioModulatorPanel } from '../audio/AudioModulatorPanel'
import { audioSignals, audioSignalLabels as signalLabels } from '../audio/types'
import type { AudioSignal } from '../audio/types'

type MultiPassPaint = Extract<ShaderPaint, { kind: 'multi-pass' }>

const passIcons: Record<PipelinePassType, typeof Sparkles> = {
  'mesh-gradient': Sparkles,
  'liquid-distortion': Waves,
  glassmorphism: Glasses,
  'chromatic-aberration': Droplet,
  grain: Film,
  'custom-glsl': Code2,
}

const passTypeLabels: Record<PipelinePassType, string> = {
  'mesh-gradient': 'Mesh Gradient Field',
  'liquid-distortion': 'Liquid Domain Flow',
  glassmorphism: 'Glassmorphism Refraction',
  'chromatic-aberration': 'Chromatic Aberration',
  grain: 'Film Grain & Dither',
  'custom-glsl': 'Post-Process / GLSL',
}

const passModulatableParams: Record<PipelinePassType, readonly string[]> = {
  'mesh-gradient': ['turbulence', 'frequency', 'swirl', 'distortion'],
  'liquid-distortion': ['distortion', 'frequency', 'speed', 'swirl', 'viscosity'],
  glassmorphism: ['refraction', 'frost', 'specular', 'bevel'],
  'chromatic-aberration': ['intensity', 'spread', 'angle'],
  grain: ['intensity', 'size'],
  'custom-glsl': ['contrast', 'brightness', 'saturation', 'vignette'],
}

const waveformIcons: Record<ModulatorWaveform, string> = {
  sine: '∿',
  triangle: '⋀',
  sawtooth: '⧘',
  pulse: '⎍',
  noise: '∯',
}

function NumberRow({
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
  onChange: (v: number) => void
}) {
  return (
    <div className="composer-row">
      <div className="composer-row-label">
        <span>{label}</span>
        <span className="composer-row-val">{Number(value.toFixed(2))}</span>
      </div>
      <div className="composer-slider-wrap">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={label}
          onChange={e => onChange(e.currentTarget.valueAsNumber)}
        />
      </div>
    </div>
  )
}

function PassDetailEditor({
  pass,
  onUpdateParams,
}: {
  pass: PipelinePass
  onUpdateParams: (params: Record<string, unknown>) => void
}) {
  switch (pass.type) {
    case 'mesh-gradient': {
      const p = pass.params as MeshGradientPassParams
      return (
        <div className="composer-pass-details">
          <div className="composer-colors-strip">
            <span className="composer-sublabel">Palette Stops ({p.colors.length}/10)</span>
            <div className="composer-palette-list">
              {p.colors.map((c, i) => (
                <div key={i} className="composer-color-chip">
                  <input
                    type="color"
                    value={c.slice(0, 7)}
                    aria-label={`Color ${i + 1}`}
                    onChange={e => {
                      const next = [...p.colors]
                      next[i] = e.currentTarget.value
                      onUpdateParams({ ...p, colors: next })
                    }}
                  />
                  {p.colors.length > 2 && (
                    <button
                      type="button"
                      className="composer-remove-chip"
                      aria-label="Remove stop"
                      onClick={() => onUpdateParams({ ...p, colors: p.colors.filter((_, idx) => idx !== i) })}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              {p.colors.length < 10 && (
                <button
                  type="button"
                  className="composer-add-chip"
                  aria-label="Add stop"
                  onClick={() => onUpdateParams({ ...p, colors: [...p.colors, '#81adec'] })}
                >
                  <Plus size={10} />
                </button>
              )}
            </div>
          </div>
          <NumberRow
            label="Turbulence"
            value={p.turbulence}
            min={0}
            max={1}
            step={0.01}
            onChange={v => onUpdateParams({ ...p, turbulence: v })}
          />
          <NumberRow
            label="Frequency"
            value={p.frequency}
            min={0.5}
            max={10}
            step={0.1}
            onChange={v => onUpdateParams({ ...p, frequency: v })}
          />
          <NumberRow
            label="Swirl"
            value={p.swirl}
            min={0}
            max={2}
            step={0.05}
            onChange={v => onUpdateParams({ ...p, swirl: v })}
          />
          <NumberRow
            label="Distortion"
            value={p.distortion}
            min={0}
            max={1}
            step={0.01}
            onChange={v => onUpdateParams({ ...p, distortion: v })}
          />
        </div>
      )
    }
    case 'liquid-distortion': {
      const p = pass.params as LiquidDistortionPassParams
      return (
        <div className="composer-pass-details">
          <NumberRow
            label="Fluid Distortion"
            value={p.distortion}
            min={0}
            max={1}
            step={0.01}
            onChange={v => onUpdateParams({ ...p, distortion: v })}
          />
          <NumberRow
            label="Frequency"
            value={p.frequency}
            min={0.5}
            max={8}
            step={0.1}
            onChange={v => onUpdateParams({ ...p, frequency: v })}
          />
          <NumberRow
            label="Flow Speed"
            value={p.speed}
            min={0}
            max={3}
            step={0.05}
            onChange={v => onUpdateParams({ ...p, speed: v })}
          />
          <NumberRow
            label="Swirl Vector"
            value={p.swirl}
            min={0}
            max={2}
            step={0.05}
            onChange={v => onUpdateParams({ ...p, swirl: v })}
          />
          <NumberRow
            label="Viscosity"
            value={p.viscosity}
            min={0}
            max={1}
            step={0.02}
            onChange={v => onUpdateParams({ ...p, viscosity: v })}
          />
          <NumberRow
            label="Swirl Iterations"
            value={p.swirlIterations}
            min={1}
            max={8}
            step={1}
            onChange={v => onUpdateParams({ ...p, swirlIterations: Math.round(v) })}
          />
        </div>
      )
    }
    case 'glassmorphism': {
      const p = pass.params as GlassmorphismPassParams
      return (
        <div className="composer-pass-details">
          <div className="composer-row">
            <span className="composer-sublabel">Glass Pattern</span>
            <select
              className="composer-select"
              value={p.pattern}
              onChange={e =>
                onUpdateParams({
                  ...p,
                  pattern: e.currentTarget.value as GlassmorphismPassParams['pattern'],
                })
              }
            >
              <option value="smooth">Smooth Curvature</option>
              <option value="fluted">Fluted Ribbed</option>
              <option value="prism">Prism Facets</option>
              <option value="wave">Wave Caustic</option>
            </select>
          </div>
          <NumberRow
            label="Refraction"
            value={p.refraction}
            min={0}
            max={1}
            step={0.01}
            onChange={v => onUpdateParams({ ...p, refraction: v })}
          />
          <NumberRow
            label="Frost Roughness"
            value={p.frost}
            min={0}
            max={1}
            step={0.01}
            onChange={v => onUpdateParams({ ...p, frost: v })}
          />
          <NumberRow
            label="Pattern Angle"
            value={p.angle}
            min={0}
            max={180}
            step={1}
            onChange={v => onUpdateParams({ ...p, angle: v })}
          />
          <NumberRow
            label="Specular Highlight"
            value={p.specular}
            min={0}
            max={1}
            step={0.02}
            onChange={v => onUpdateParams({ ...p, specular: v })}
          />
          <NumberRow
            label="Bevel Edge"
            value={p.bevel}
            min={0}
            max={1}
            step={0.02}
            onChange={v => onUpdateParams({ ...p, bevel: v })}
          />
          <div className="composer-row">
            <span className="composer-sublabel">Glass Tint</span>
            <div className="composer-color-chip">
              <input
                type="color"
                value={p.tint?.slice(0, 7) ?? '#edebe1'}
                onChange={e => onUpdateParams({ ...p, tint: e.currentTarget.value })}
              />
            </div>
          </div>
        </div>
      )
    }
    case 'chromatic-aberration': {
      const p = pass.params as ChromaticAberrationPassParams
      return (
        <div className="composer-pass-details">
          <NumberRow
            label="Intensity"
            value={p.intensity}
            min={0}
            max={1}
            step={0.01}
            onChange={v => onUpdateParams({ ...p, intensity: v })}
          />
          <NumberRow
            label="Spread"
            value={p.spread}
            min={0}
            max={1}
            step={0.01}
            onChange={v => onUpdateParams({ ...p, spread: v })}
          />
          <div className="composer-row">
            <span className="composer-sublabel">Mode</span>
            <div className="composer-pill-toggle" role="group">
              <button
                type="button"
                className={`composer-chip ${p.radial ? 'active' : ''}`}
                onClick={() => onUpdateParams({ ...p, radial: true })}
              >
                Radial
              </button>
              <button
                type="button"
                className={`composer-chip ${!p.radial ? 'active' : ''}`}
                onClick={() => onUpdateParams({ ...p, radial: false })}
              >
                Linear
              </button>
            </div>
          </div>
          {!p.radial && (
            <NumberRow
              label="Dispersion Angle"
              value={p.angle}
              min={0}
              max={360}
              step={1}
              onChange={v => onUpdateParams({ ...p, angle: v })}
            />
          )}
        </div>
      )
    }
    case 'grain': {
      const p = pass.params as GrainPassParams
      return (
        <div className="composer-pass-details">
          <NumberRow
            label="Grain Intensity"
            value={p.intensity}
            min={0}
            max={1}
            step={0.01}
            onChange={v => onUpdateParams({ ...p, intensity: v })}
          />
          <NumberRow
            label="Grain Scale"
            value={p.size}
            min={0.5}
            max={4}
            step={0.1}
            onChange={v => onUpdateParams({ ...p, size: v })}
          />
          <div className="composer-row">
            <span className="composer-sublabel">Dynamics</span>
            <div className="composer-pill-toggle" role="group">
              <button
                type="button"
                className={`composer-chip ${p.temporal ? 'active' : ''}`}
                onClick={() => onUpdateParams({ ...p, temporal: true })}
              >
                Animated
              </button>
              <button
                type="button"
                className={`composer-chip ${!p.temporal ? 'active' : ''}`}
                onClick={() => onUpdateParams({ ...p, temporal: false })}
              >
                Static
              </button>
            </div>
          </div>
          <div className="composer-row">
            <span className="composer-sublabel">Color Mode</span>
            <div className="composer-pill-toggle" role="group">
              <button
                type="button"
                className={`composer-chip ${p.monochrome ? 'active' : ''}`}
                onClick={() => onUpdateParams({ ...p, monochrome: true })}
              >
                Monochrome
              </button>
              <button
                type="button"
                className={`composer-chip ${!p.monochrome ? 'active' : ''}`}
                onClick={() => onUpdateParams({ ...p, monochrome: false })}
              >
                Chromatic
              </button>
            </div>
          </div>
        </div>
      )
    }
    case 'custom-glsl': {
      const p = pass.params as CustomGLSLPassParams
      return (
        <div className="composer-pass-details">
          <NumberRow
            label="Contrast"
            value={p.contrast}
            min={-1}
            max={1}
            step={0.02}
            onChange={v => onUpdateParams({ ...p, contrast: v })}
          />
          <NumberRow
            label="Brightness"
            value={p.brightness}
            min={-1}
            max={1}
            step={0.02}
            onChange={v => onUpdateParams({ ...p, brightness: v })}
          />
          <NumberRow
            label="Saturation"
            value={p.saturation}
            min={-1}
            max={1}
            step={0.02}
            onChange={v => onUpdateParams({ ...p, saturation: v })}
          />
          <NumberRow
            label="Vignette"
            value={p.vignette}
            min={0}
            max={1}
            step={0.02}
            onChange={v => onUpdateParams({ ...p, vignette: v })}
          />
          <div className="composer-row">
            <span className="composer-sublabel">Color Grade Tint</span>
            <div className="composer-color-chip">
              <input
                type="color"
                value={p.tint?.slice(0, 7) ?? '#ffffff'}
                onChange={e => onUpdateParams({ ...p, tint: e.currentTarget.value })}
              />
            </div>
          </div>
        </div>
      )
    }
  }
}

export function MaterialComposer({
  paint,
  onChange,
}: {
  paint: MultiPassPaint
  onChange: (paint: ShaderPaint) => void
}) {
  const [activeTab, setActiveTab] = useState<'passes' | 'modulators' | 'code'>('passes')
  const [expandedPassId, setExpandedPassId] = useState<string | null>(null)
  const [codeType, setCodeType] = useState<'react' | 'glsl' | 'uniforms'>('react')
  const [copied, setCopied] = useState(false)
  const [showAddMenu, setShowAddMenu] = useState(false)

  const pipeline = paint.pipeline ?? PIPELINE_PRESETS['prismatic-glass'].createPipeline()

  const copyCode = (text: string) => {
    navigator.clipboard?.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const downloadFile = (filename: string, content: string, type: string) => {
    const blob = new Blob([content], { type })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const currentCode =
    codeType === 'react'
      ? exportPipelineReact(paint)
      : codeType === 'glsl'
        ? exportPipelineGLSL()
        : exportPipelineUniforms(paint)

  return (
    <div className="material-composer">
      {/* Preset Pill Bar */}
      <div className="composer-preset-bar">
        <div className="composer-preset-header">
          <span className="section-caption">PRESETS</span>
          <span className="shader-engine-mark">{pipeline.preset.toUpperCase()}</span>
        </div>
        <div className="composer-preset-scroll" role="group" aria-label="Pipeline Presets">
          {presetKeys.map(key => {
            const preset = PIPELINE_PRESETS[key]
            const active = pipeline.preset === key
            return (
              <button
                key={key}
                type="button"
                className={`composer-preset-pill ${active ? 'active' : ''}`}
                title={preset.description}
                onClick={() => onChange(loadPipelinePreset(paint, key))}
              >
                <span className="composer-preset-dot" />
                <span>{preset.name}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Mode Navigation Tabs */}
      <div className="composer-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'passes'}
          className={`composer-tab-btn ${activeTab === 'passes' ? 'active' : ''}`}
          onClick={() => setActiveTab('passes')}
        >
          <Layers size={12} />
          <span>Pass Stack</span>
          <span className="composer-badge">{pipeline.passes.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'modulators'}
          className={`composer-tab-btn ${activeTab === 'modulators' ? 'active' : ''}`}
          onClick={() => setActiveTab('modulators')}
        >
          <Activity size={12} />
          <span>Modulators</span>
          <span className="composer-badge">{pipeline.modulators.filter(m => m.enabled).length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'code'}
          className={`composer-tab-btn ${activeTab === 'code' ? 'active' : ''}`}
          onClick={() => setActiveTab('code')}
        >
          <Code2 size={12} />
          <span>GLSL & Code</span>
        </button>
      </div>

      {/* TAB 1: PASS STACK */}
      {activeTab === 'passes' && (
        <div className="composer-tab-panel">
          <div className="composer-panel-actions">
            <span className="composer-sublabel">Layered Shader Passes</span>
            <div className="composer-add-wrapper">
              <button
                type="button"
                className="composer-add-pass-btn"
                onClick={() => setShowAddMenu(prev => !prev)}
              >
                <Plus size={11} />
                <span>Add Pass</span>
              </button>
              {showAddMenu && (
                <div className="composer-dropdown-menu">
                  {pipelinePassTypes.map(type => {
                    const Icon = passIcons[type]
                    return (
                      <button
                        key={type}
                        type="button"
                        className="composer-menu-item"
                        onClick={() => {
                          onChange(addPipelinePass(paint, type))
                          setShowAddMenu(false)
                        }}
                      >
                        <Icon size={12} />
                        <span>{passTypeLabels[type]}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="composer-pass-list">
            {pipeline.passes.map((pass, index) => {
              const Icon = passIcons[pass.type] ?? Sparkles
              const isExpanded = expandedPassId === pass.id
              return (
                <div
                  key={pass.id}
                  className={`composer-pass-card ${pass.enabled ? '' : 'disabled'} ${isExpanded ? 'expanded' : ''}`}
                >
                  <div className="composer-pass-card-header">
                    <button
                      type="button"
                      className="composer-pass-expand-btn"
                      aria-label={isExpanded ? 'Collapse pass' : 'Expand pass'}
                      onClick={() => setExpandedPassId(isExpanded ? null : pass.id)}
                    >
                      {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </button>

                    <button
                      type="button"
                      className="composer-pass-visibility-btn"
                      aria-label={pass.enabled ? 'Disable pass' : 'Enable pass'}
                      onClick={() => onChange(togglePipelinePass(paint, pass.id))}
                    >
                      {pass.enabled ? <Eye size={12} /> : <EyeOff size={12} />}
                    </button>

                    <div
                      className="composer-pass-title-group"
                      onClick={() => setExpandedPassId(isExpanded ? null : pass.id)}
                    >
                      <Icon size={12} className="composer-pass-icon" />
                      <span className="composer-pass-name">{pass.name}</span>
                      <span className="composer-pass-type-badge">{pass.type.replace('-', ' ')}</span>
                    </div>

                    <div className="composer-pass-tools">
                      <button
                        type="button"
                        disabled={index === 0}
                        aria-label="Move pass up"
                        title="Move up"
                        className="composer-tool-btn"
                        onClick={() => onChange(reorderPipelinePasses(paint, index, index - 1))}
                      >
                        <ArrowUp size={11} />
                      </button>
                      <button
                        type="button"
                        disabled={index === pipeline.passes.length - 1}
                        aria-label="Move pass down"
                        title="Move down"
                        className="composer-tool-btn"
                        onClick={() => onChange(reorderPipelinePasses(paint, index, index + 1))}
                      >
                        <ArrowDown size={11} />
                      </button>
                      <button
                        type="button"
                        aria-label="Duplicate pass"
                        title="Duplicate"
                        className="composer-tool-btn"
                        onClick={() => onChange(duplicatePipelinePass(paint, pass.id))}
                      >
                        <Layers size={11} />
                      </button>
                      {pipeline.passes.length > 1 && (
                        <button
                          type="button"
                          aria-label="Delete pass"
                          title="Delete pass"
                          className="composer-tool-btn delete"
                          onClick={() => onChange(removePipelinePass(paint, pass.id))}
                        >
                          <Trash2 size={11} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Pass Quick Bar: Blend Mode & Opacity */}
                  <div className="composer-pass-quick-bar">
                    <label className="composer-inline-select">
                      <span>Blend</span>
                      <select
                        value={pass.blendMode}
                        onChange={e =>
                          onChange(
                            updatePipelinePass(paint, pass.id, p => ({
                              ...p,
                              blendMode: e.currentTarget.value as typeof shaderBlendModes[number],
                            }))
                          )
                        }
                      >
                        {shaderBlendModes.map(mode => (
                          <option key={mode} value={mode}>
                            {mode}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className="composer-inline-slider">
                      <span>{Math.round(pass.opacity * 100)}%</span>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.02}
                        value={pass.opacity}
                        aria-label={`${pass.name} opacity`}
                        onChange={e =>
                          onChange(
                            updatePipelinePass(paint, pass.id, p => ({
                              ...p,
                              opacity: e.currentTarget.valueAsNumber,
                            }))
                          )
                        }
                      />
                    </div>
                  </div>

                  {/* Expandable Pass Details */}
                  {isExpanded && (
                    <PassDetailEditor
                      pass={pass}
                      onUpdateParams={params =>
                        onChange(
                          updatePipelinePass(paint, pass.id, p => ({
                            ...p,
                            params: { ...p.params, ...params } as typeof p.params,
                          }))
                        )
                      }
                    />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* TAB 2: UNIFORM MODULATORS (LFOs) */}
      {activeTab === 'modulators' && (
        <div className="composer-tab-panel">
          <AudioModulatorPanel onAddRoute={() => {
            const targetPass = pipeline.passes.find(pass => pass.type === 'liquid-distortion') ?? pipeline.passes[0]
            if (!targetPass) return
            onChange(addPipelineModulator(paint, {
              name: `Audio ${pipeline.modulators.length + 1}`,
              targetPassId: targetPass.id,
              targetParam: passModulatableParams[targetPass.type][0],
              source: 'bass', waveform: 'sine', frequency: 1, amplitude: 0.8, offset: 0, enabled: true,
            }))
          }} />
          <div className="composer-panel-actions">
            <div>
              <span className="composer-sublabel">Real-Time Uniform LFOs</span>
              <p className="composer-hint">Modulates WebGL uniforms at 60fps across time.</p>
            </div>
            <button
              type="button"
              className="composer-add-pass-btn"
              onClick={() => {
                const targetPass = pipeline.passes[0]
                if (!targetPass) return
                const allowedParams = passModulatableParams[targetPass.type] ?? ['distortion']
                onChange(
                  addPipelineModulator(paint, {
                    name: `LFO ${pipeline.modulators.length + 1}`,
                    targetPassId: targetPass.id,
                    targetParam: allowedParams[0] ?? 'distortion',
                    waveform: 'sine',
                    frequency: 0.35,
                    amplitude: 0.25,
                    offset: 0,
                    enabled: true,
                  })
                )
              }}
            >
              <Plus size={11} />
              <span>Add LFO</span>
            </button>
          </div>

          <div className="composer-modulator-list">
            {pipeline.modulators.length === 0 ? (
              <div className="composer-empty-state">
                <Radio size={20} />
                <span>No active uniform modulators</span>
                <p>Add an LFO modulator to animate distortion, refraction or color harmonics in real-time.</p>
              </div>
            ) : (
              pipeline.modulators.map(mod => {
                const targetPass = pipeline.passes.find(p => p.id === mod.targetPassId)
                const availableParams = targetPass ? passModulatableParams[targetPass.type] ?? [] : []

                return (
                  <div key={mod.id} className={`composer-mod-card ${mod.enabled ? '' : 'disabled'}`}>
                    <div className="composer-mod-header">
                      <button
                        type="button"
                        className="composer-pass-visibility-btn"
                        aria-label={mod.enabled ? 'Disable modulator' : 'Enable modulator'}
                        onClick={() => onChange(togglePipelineModulator(paint, mod.id))}
                      >
                        {mod.enabled ? <Activity size={12} className="composer-active-lfo" /> : <EyeOff size={12} />}
                      </button>

                      <input
                        type="text"
                        className="composer-mod-title-input"
                        value={mod.name}
                        onChange={e =>
                          onChange(
                            updatePipelineModulator(paint, mod.id, m => ({ ...m, name: e.currentTarget.value }))
                          )
                        }
                      />

                      <span className="composer-waveform-badge">
                        {mod.source && mod.source !== 'lfo' ? signalLabels[mod.source] : `${waveformIcons[mod.waveform]} ${mod.waveform}`}
                      </span>

                      <button
                        type="button"
                        className="composer-tool-btn delete"
                        aria-label="Delete modulator"
                        onClick={() => onChange(removePipelineModulator(paint, mod.id))}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>

                    {/* Routing: Pass -> Parameter */}
                    <div className="composer-routing-row">
                      <label className="composer-routing-field">
                        <span>Target Pass</span>
                        <select
                          value={mod.targetPassId}
                          onChange={e => {
                            const newPassId = e.currentTarget.value
                            const newPass = pipeline.passes.find(p => p.id === newPassId)
                            const newParams = newPass ? passModulatableParams[newPass.type] : []
                            onChange(
                              updatePipelineModulator(paint, mod.id, m => ({
                                ...m,
                                targetPassId: newPassId,
                                targetParam: newParams[0] ?? m.targetParam,
                              }))
                            )
                          }}
                        >
                          {pipeline.passes.map(p => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="composer-routing-field">
                        <span>Parameter</span>
                        <select
                          value={mod.targetParam}
                          onChange={e =>
                            onChange(
                              updatePipelineModulator(paint, mod.id, m => ({
                                ...m,
                                targetParam: e.currentTarget.value,
                              }))
                            )
                          }
                        >
                          {availableParams.map(param => (
                            <option key={param} value={param}>
                              {param}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    {/* Waveform Selector */}
                    <label className="composer-routing-field">
                      <span>Signal source</span>
                      <select aria-label={`Signal source for ${mod.name}`} value={mod.source ?? 'lfo'} onChange={event => onChange(updatePipelineModulator(paint, mod.id, previous => ({ ...previous, source: event.currentTarget.value as 'lfo' | AudioSignal })))}>
                        <option value="lfo">LFO · Time</option>
                        {audioSignals.map(signal => <option key={signal} value={signal}>Audio · {signalLabels[signal]}</option>)}
                      </select>
                    </label>
                    {(!mod.source || mod.source === 'lfo') && <><div className="composer-waveform-strip" role="group" aria-label="LFO Waveform">
                      {modulatorWaveforms.map(wf => (
                        <button
                          key={wf}
                          type="button"
                          className={`composer-wf-btn ${mod.waveform === wf ? 'active' : ''}`}
                          onClick={() =>
                            onChange(
                              updatePipelineModulator(paint, mod.id, m => ({
                                ...m,
                                waveform: wf,
                              }))
                            )
                          }
                        >
                          <span>{waveformIcons[wf]}</span>
                          <span className="composer-wf-name">{wf}</span>
                        </button>
                      ))}
                    </div>

                    {/* Sliders: Frequency, Amplitude, Offset */}
                    <NumberRow
                      label="Frequency (Hz)"
                      value={mod.frequency}
                      min={0.05}
                      max={4}
                      step={0.05}
                      onChange={v =>
                        onChange(
                          updatePipelineModulator(paint, mod.id, m => ({
                            ...m,
                            frequency: v,
                          }))
                        )
                      }
                    />
                    </>}
                    <NumberRow
                      label="Depth / Amplitude"
                      value={mod.amplitude}
                      min={0}
                      max={1}
                      step={0.02}
                      onChange={v =>
                        onChange(
                          updatePipelineModulator(paint, mod.id, m => ({
                            ...m,
                            amplitude: v,
                          }))
                        )
                      }
                    />
                    {(!mod.source || mod.source === 'lfo') && <NumberRow
                      label="Phase Offset"
                      value={mod.offset}
                      min={-1}
                      max={1}
                      step={0.05}
                      onChange={v =>
                        onChange(
                          updatePipelineModulator(paint, mod.id, m => ({
                            ...m,
                            offset: v,
                          }))
                        )
                      }
                    />}
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}

      {/* TAB 3: CODE & GLSL COMPOSER EXPORT */}
      {activeTab === 'code' && (
        <div className="composer-tab-panel">
          <div className="composer-code-header">
            <div className="composer-code-types" role="group" aria-label="Code format">
              <button
                type="button"
                className={`composer-code-pill ${codeType === 'react' ? 'active' : ''}`}
                onClick={() => setCodeType('react')}
              >
                React Component
              </button>
              <button
                type="button"
                className={`composer-code-pill ${codeType === 'glsl' ? 'active' : ''}`}
                onClick={() => setCodeType('glsl')}
              >
                GLSL 300 es
              </button>
              <button
                type="button"
                className={`composer-code-pill ${codeType === 'uniforms' ? 'active' : ''}`}
                onClick={() => setCodeType('uniforms')}
              >
                Uniforms JSON
              </button>
            </div>

            <div className="composer-code-actions">
              <button
                type="button"
                className="composer-copy-btn"
                title="Copy code to clipboard"
                onClick={() => copyCode(currentCode)}
              >
                {copied ? <Check size={11} /> : <Copy size={11} />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
              <button
                type="button"
                className="composer-download-btn"
                title="Download file"
                onClick={() => {
                  const ext = codeType === 'react' ? 'tsx' : codeType === 'glsl' ? 'glsl' : 'json'
                  const mime = codeType === 'uniforms' ? 'application/json' : 'text/plain'
                  downloadFile(`MaterialComposer.${ext}`, currentCode, mime)
                }}
              >
                <Download size={11} />
              </button>
            </div>
          </div>

          <div className="composer-code-viewport">
            <pre className="composer-code-block">
              <code>{currentCode}</code>
            </pre>
          </div>

          <p className="composer-hint">
            Ready for production. Directly compatible with <code>@paper-design/shaders-react</code> and Paper’s infinite canvas runtime.
          </p>
        </div>
      )}
    </div>
  )
}
