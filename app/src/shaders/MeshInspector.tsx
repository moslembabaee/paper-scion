import {
  Check,
  CircleDot,
  Code2,
  Copy,
  Crosshair,
  Download,
  Grid,
  Layers,
  LayoutGrid,
  Pipette,
  Plus,
  RotateCcw,
  Sparkles,
  Sun,
  Wand2,
  Waves,
  X,
} from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { freezeShader, validateShader } from './catalog'
import {
  clampUnit,
  createMeshMaterial,
  defaultMeshAnchor,
  generateCornerPatchLayout,
  generateGridLayout,
  generateRadialLayout,
  generateSpiralLayout,
  generateWaveLayout,
  interpolateMeshColor,
  interpolatePaletteColors,
  meshHarmonyModes,
  meshToSurface,
  MESH_DISPLACEMENT_PRESETS,
  MESH_PALETTE_PRESETS,
  smoothMeshColors,
  surfaceToMesh,
  synthesizeProceduralColorField,
} from './mesh'
import type { MeshHarmonyMode } from './mesh'
import { MeshAnchorHandle } from './MeshAnchorHandle'
import {
  setMeshActiveAnchor,
  setMeshPlacementMode,
  useMeshActiveAnchor,
  useMeshPlacementMode,
} from './meshState'
import { ShaderSurface } from './ShaderSurface'
import { exportMeshReact } from './shaderExport'
import { MeshGradientEngine } from './MeshGradientEngine'
import type { MeshAnchor, MeshDistortionMode, MeshMaterial, NoiseGenerator, ShaderPaint } from './types'
import { grainBlendModes, noiseGenerators } from './types'

type MeshPaint = Extract<ShaderPaint, { kind: 'mesh-gradient' }>

export function MeshInspector({
  paint,
  onChange,
  onGestureStart,
  onGestureEnd,
  target,
  onBindTarget,
}: {
  paint: MeshPaint
  onChange: (paint: ShaderPaint) => void
  onGestureStart?: () => boolean | void
  onGestureEnd?: (cancel: boolean) => void
  target?: string
  onBindTarget?: (mode: 'selection' | 'background' | 'new-card') => void
}) {
  const activeAnchor = useMeshActiveAnchor()
  const placementMode = useMeshPlacementMode()
  const [synthesizerHarmony, setSynthesizerHarmony] = useState<MeshHarmonyMode>('harmonic')
  const [copiedSource, setCopiedSource] = useState('')
  const [copyError, setCopyError] = useState('')
  const preview = useRef<HTMLDivElement>(null)
  const before = useRef<MeshPaint | null>(null)
  const mesh = paint.mesh
  const source = exportMeshReact(paint)

  const commit = (next: MeshPaint) => {
    validateShader(next)
    onChange(freezeShader(next))
  }

  const update = (changes: Partial<MeshMaterial>) => {
    if (mesh) commit({ ...paint, mesh: { ...mesh, ...changes } })
  }

  const active = Math.min(activeAnchor, (mesh?.anchors.length ?? 1) - 1)
  const anchor = mesh?.anchors[active]

  const start = () => {
    if (onGestureStart?.() === false) return false
    before.current = paint
  }

  const end = (cancel: boolean) => {
    if (onGestureEnd) onGestureEnd(cancel)
    else if (cancel && before.current) onChange(before.current)
    before.current = null
  }

  const addStop = (point?: { x: number; y: number }) => {
    if (!mesh || mesh.anchors.length >= 10) return
    const meshPt = point ?? defaultMeshAnchor(mesh.anchors.length)
    const sampledColor = interpolateMeshColor(mesh.anchors, paint.params.colors, meshPt)
    const newAnchor: MeshAnchor = { x: clampUnit(meshPt.x), y: clampUnit(meshPt.y), radius: 0.65 }
    const nextAnchors = [...mesh.anchors, newAnchor]
    const nextColors = [...paint.params.colors, sampledColor]
    setMeshActiveAnchor(nextAnchors.length - 1)
    commit({
      ...paint,
      params: { ...paint.params, colors: nextColors },
      mesh: { ...mesh, anchors: nextAnchors },
    })
  }

  const handlePreviewDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!mesh || !preview.current || mesh.anchors.length >= 10) return
    const rect = preview.current.getBoundingClientRect()
    const surfacePoint = {
      x: (e.clientX - rect.left) / Math.max(1, rect.width),
      y: (e.clientY - rect.top) / Math.max(1, rect.height),
    }
    const meshPoint = surfaceToMesh(surfacePoint, paint)
    addStop(meshPoint)
  }

  const handlePreviewClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!placementMode || !mesh || !preview.current || mesh.anchors.length >= 10) return
    if ((e.target as Element).closest('.mesh-anchor, .mesh-anchor-container')) return
    const rect = preview.current.getBoundingClientRect()
    const surfacePoint = {
      x: (e.clientX - rect.left) / Math.max(1, rect.width),
      y: (e.clientY - rect.top) / Math.max(1, rect.height),
    }
    const meshPoint = surfaceToMesh(surfacePoint, paint)
    addStop(meshPoint)
    setMeshPlacementMode(false)
  }

  const applyPalettePreset = (presetColors: readonly string[]) => {
    if (!mesh) return
    const targetCount = paint.params.colors.length
    const mapped = interpolatePaletteColors(presetColors, targetCount)
    commit({
      ...paint,
      params: { ...paint.params, colors: mapped },
    })
  }

  const applyDisplacementPreset = (preset: (typeof MESH_DISPLACEMENT_PRESETS)[number]) => {
    update({
      noiseType: preset.noiseType,
      octaves: preset.octaves,
      lacunarity: preset.lacunarity,
      turbulence: preset.turbulence,
      frequency: preset.frequency,
      normalPerturbation: preset.normalPerturbation,
      grainDisplacement: preset.grainDisplacement,
    })
  }

  const applyLayout = (type: 'grid' | 'radial' | 'spiral' | 'wave' | 'patch') => {
    if (!mesh) return
    const count = mesh.anchors.length
    let anchors: MeshAnchor[]
    if (type === 'grid') anchors = generateGridLayout(count)
    else if (type === 'radial') anchors = generateRadialLayout(count)
    else if (type === 'spiral') anchors = generateSpiralLayout(count)
    else if (type === 'wave') anchors = generateWaveLayout(count)
    else anchors = generateCornerPatchLayout(count)
    update({ anchors })
  }

  const harmonizeColors = () => {
    if (!mesh) return
    const smoothed = smoothMeshColors(mesh.anchors, paint.params.colors)
    commit({
      ...paint,
      params: { ...paint.params, colors: smoothed },
    })
  }

  const interpolateSpectrum = () => {
    if (!mesh) return
    const interpolated = interpolatePaletteColors(paint.params.colors, paint.params.colors.length)
    commit({
      ...paint,
      params: { ...paint.params, colors: interpolated },
    })
  }

  const synthesizeField = (
    harmony: MeshHarmonyMode = synthesizerHarmony
  ) => {
    if (!mesh) return
    const baseColor = paint.params.colors[active] ?? '#81adec'
    const synthesized = synthesizeProceduralColorField(
      baseColor,
      paint.params.colors.length,
      harmony
    )
    commit({
      ...paint,
      params: { ...paint.params, colors: synthesized },
    })
  }

  const sampleFieldForActive = () => {
    if (!mesh || !anchor) return
    const others = mesh.anchors.filter((_, i) => i !== active)
    const otherColors = paint.params.colors.filter((_, i) => i !== active)
    const interp = mesh.interpolation ?? 'bicubic'
    const sampled = interpolateMeshColor(others, otherColors, anchor, interp)
    commit({
      ...paint,
      params: {
        ...paint.params,
        colors: paint.params.colors.map((c, i) => i === active ? sampled : c),
      },
    })
  }

  return (
    <div className="mesh-studio">
      <div className="mesh-studio-heading">
        <span className="section-caption">MESH / COLOR FIELD</span>
        <span className="shader-engine-mark">{paint.params.colors.length} / 10 STOPS</span>
      </div>

      {!mesh ? (
        <button
          className="mesh-enable"
          onClick={() => commit({ ...paint, mesh: createMeshMaterial(paint.params.colors.length) })}
        >
          Open interactive mesh studio
        </button>
      ) : (
        <>
          <div className="mesh-editor-grid">
            <div
              ref={preview}
              className={`mesh-editor-preview ${placementMode ? 'placing-mode' : ''}`}
              aria-label="Interactive mesh material preview"
              onClick={handlePreviewClick}
              onDoubleClick={handlePreviewDoubleClick}
            >
              <ShaderSurface paint={paint} />
              {mesh.anchors.map((point, index) => {
                const position = meshToSurface(point, paint)
                return (
                  <MeshAnchorHandle
                    key={index}
                    index={index}
                    selected={index === active}
                    color={paint.params.colors[index]}
                    anchor={point}
                    style={{ left: `${position.x * 100}%`, top: `${position.y * 100}%` }}
                    project={(x, y) => {
                      const rect = preview.current!.getBoundingClientRect()
                      return surfaceToMesh(
                        { x: (x - rect.left) / rect.width, y: (y - rect.top) / rect.height },
                        paint
                      )
                    }}
                    onSelect={idx => setMeshActiveAnchor(idx)}
                    onStart={() => {
                      setMeshActiveAnchor(index)
                      return start()
                    }}
                    onEnd={end}
                    onMove={next =>
                      update({
                        anchors: mesh.anchors.map((value, i) => (i === index ? { ...value, ...next } : value)),
                      })
                    }
                  />
                )
              })}
            </div>
          </div>

          <p className="mesh-hint">
            Drag vertex on preview or canvas. Double-click anywhere to place stop.
          </p>

          {/* Quick Layout & Tool Presets */}
          <div className="mesh-tool-bar" role="toolbar" aria-label="Mesh distribution tools">
            <div className="mesh-tool-group">
              <span className="mesh-tool-label">Layout</span>
              <button
                type="button"
                className="mesh-tool-btn"
                title="Arrange in grid"
                aria-label="Arrange vertices in grid"
                onClick={() => applyLayout('grid')}
              >
                <Grid size={11} />
                <span>Grid</span>
              </button>
              <button
                type="button"
                className="mesh-tool-btn"
                title="Arrange radially"
                aria-label="Arrange vertices radially"
                onClick={() => applyLayout('radial')}
              >
                <CircleDot size={11} />
                <span>Radial</span>
              </button>
              <button
                type="button"
                className="mesh-tool-btn"
                title="Arrange in spiral"
                aria-label="Arrange vertices in spiral"
                onClick={() => applyLayout('spiral')}
              >
                <RotateCcw size={11} />
                <span>Spiral</span>
              </button>
              <button
                type="button"
                className="mesh-tool-btn"
                title="Arrange along harmonic wave curve"
                aria-label="Arrange vertices in wave"
                onClick={() => applyLayout('wave')}
              >
                <Waves size={11} />
                <span>Wave</span>
              </button>
              <button
                type="button"
                className="mesh-tool-btn"
                title="Arrange as 2D bicubic patch corners"
                aria-label="Arrange vertices in patch"
                onClick={() => applyLayout('patch')}
              >
                <LayoutGrid size={11} />
                <span>Patch</span>
              </button>
            </div>

            <div className="mesh-tool-group">
              <span className="mesh-tool-label">Color</span>
              <button
                type="button"
                className="mesh-tool-btn"
                title="Harmonize and blend colors from neighbor vertices"
                aria-label="Harmonize vertex colors"
                onClick={harmonizeColors}
              >
                <Sparkles size={11} />
                <span>Harmonize</span>
              </button>
              <button
                type="button"
                className="mesh-tool-btn"
                title="Interpolate spectrum across all stops"
                aria-label="Interpolate color spectrum"
                onClick={interpolateSpectrum}
              >
                <Wand2 size={11} />
                <span>Spectrum</span>
              </button>
            </div>
          </div>

          {/* Procedural Color Field Synthesizer */}
          <div className="mesh-synthesizer-section" role="region" aria-label="Procedural Color Field Synthesizer">
            <div className="mesh-synthesizer-header">
              <span className="section-caption">COLOR FIELD SYNTHESIZER</span>
              <span className="shader-engine-mark">GPU BICUBIC</span>
            </div>
            <div className="mesh-synthesizer-base-row">
              <span className="mesh-synthesizer-base-label">Seed vertex V{String(active + 1).padStart(2, '0')}:</span>
              <span className="mesh-synthesizer-base-swatch" style={{ background: paint.params.colors[active] ?? '#81adec' }} />
              <span className="mesh-synthesizer-base-hex">{(paint.params.colors[active] ?? '#81adec').toUpperCase()}</span>
            </div>
            <div className="mesh-harmony-chips" role="group" aria-label="Color harmony modes">
              {meshHarmonyModes.map(mode => (
                <button
                  key={mode}
                  type="button"
                  className={`mesh-harmony-chip ${synthesizerHarmony === mode ? 'active' : ''}`}
                  onClick={() => setSynthesizerHarmony(mode)}
                >
                  {mode.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="mesh-synthesize-btn"
              title={`Synthesize ${synthesizerHarmony} procedural color field from vertex ${active + 1}`}
              aria-label={`Synthesize ${synthesizerHarmony} color field`}
              onClick={() => synthesizeField(synthesizerHarmony)}
            >
              <Wand2 size={11} />
              <span>Synthesize {synthesizerHarmony.toUpperCase()} field</span>
            </button>
          </div>

          {/* Curated Palette Presets */}
          <div className="mesh-presets-section">
            <span className="section-caption">PALETTE PRESETS</span>
            <div className="mesh-preset-chips" role="group" aria-label="Mesh color palette presets">
              {MESH_PALETTE_PRESETS.map(preset => (
                <button
                  key={preset.name}
                  type="button"
                  className="mesh-preset-chip"
                  title={`Apply ${preset.name} palette`}
                  aria-label={`Apply ${preset.name} palette`}
                  onClick={() => applyPalettePreset(preset.colors)}
                >
                  <span className="mesh-preset-dots">
                    {preset.colors.slice(0, 4).map((c, idx) => (
                      <i key={idx} style={{ background: c }} />
                    ))}
                  </span>
                  <span>{preset.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Color Stops List */}
          <div className="mesh-stops-header">
            <span className="section-caption">COLOR STOPS</span>
            <div className="mesh-header-actions">
              <button
                type="button"
                className={`mesh-action-toggle ${placementMode ? 'active' : ''}`}
                aria-pressed={placementMode}
                title="Click canvas to place vertex"
                aria-label="Toggle canvas vertex placement mode"
                onClick={() => setMeshPlacementMode(!placementMode)}
              >
                <Crosshair size={11} />
                <span>{placementMode ? 'Placing...' : 'Place Stop'}</span>
              </button>
            </div>
          </div>

          <div className="mesh-stops" aria-label="Mesh color stops">
            {paint.params.colors.map((color, index) => (
              <div key={index} className="mesh-stop" data-active={index === active}>
                <button
                  className="mesh-stop-index"
                  aria-label={`Edit mesh stop ${index + 1}`}
                  aria-pressed={index === active}
                  onClick={() => setMeshActiveAnchor(index)}
                >
                  {String(index + 1).padStart(2, '0')}
                </button>
                <input
                  type="color"
                  aria-label={`Mesh stop ${index + 1} color`}
                  value={color.slice(0, 7)}
                  onFocus={() => setMeshActiveAnchor(index)}
                  onChange={event =>
                    commit({
                      ...paint,
                      params: {
                        ...paint.params,
                        colors: paint.params.colors.map((value, i) =>
                          i === index ? event.currentTarget.value + color.slice(7) : value
                        ),
                      },
                    })
                  }
                />
                <input
                  className="mesh-stop-hex"
                  key={color}
                  aria-label={`Mesh stop ${index + 1} hex`}
                  defaultValue={color.toUpperCase()}
                  spellCheck={false}
                  maxLength={9}
                  onFocus={() => setMeshActiveAnchor(index)}
                  onBlur={event => {
                    const hex = event.currentTarget.value.trim()
                    if (/^#[\da-f]{6}([\da-f]{2})?$/i.test(hex)) {
                      commit({
                        ...paint,
                        params: {
                          ...paint.params,
                          colors: paint.params.colors.map((value, i) => (i === index ? hex : value)),
                        },
                      })
                    } else {
                      event.currentTarget.value = color.toUpperCase()
                    }
                  }}
                  onKeyDown={event => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                  }}
                />
                <button
                  aria-label={`Remove mesh stop ${index + 1}`}
                  disabled={mesh.anchors.length <= 2}
                  onClick={() => {
                    setMeshActiveAnchor(Math.max(0, index - 1))
                    commit({
                      ...paint,
                      params: {
                        ...paint.params,
                        colors: paint.params.colors.filter((_, i) => i !== index),
                      },
                      mesh: {
                        ...mesh,
                        anchors: mesh.anchors.filter((_, i) => i !== index),
                      },
                    })
                  }}
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>

          <div className="mesh-stop-actions">
            <button
              disabled={mesh.anchors.length >= 10}
              onClick={() => addStop()}
            >
              <Plus size={11} />
              Add stop
            </button>
            <button
              title="Reset anchor positions"
              aria-label="Reset mesh anchors"
              onClick={() => update({ anchors: mesh.anchors.map((_, i) => defaultMeshAnchor(i)) })}
            >
              <RotateCcw size={11} />
            </button>
          </div>

          {/* Active Anchor Properties */}
          {anchor && (
            <div className="mesh-anchor-details">
              <div className="mesh-anchor-details-header">
                <span className="section-caption">
                  VERTEX V{String(active + 1).padStart(2, '0')}
                </span>
                <button
                  type="button"
                  className="mesh-sample-btn"
                  title="Sample surrounding gradient color at this vertex"
                  aria-label="Sample field color at vertex"
                  onClick={sampleFieldForActive}
                >
                  <Pipette size={10} />
                  <span>Sample field</span>
                </button>
              </div>

              <div className="mesh-position-fields">
                {(['x', 'y'] as const).map(axis => (
                  <label key={axis}>
                    {axis.toUpperCase()}
                    <input
                      aria-label={`Mesh anchor ${axis.toUpperCase()} percent`}
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={Number((anchor[axis] * 100).toFixed(1))}
                      onChange={event => {
                        const n = event.currentTarget.valueAsNumber
                        if (Number.isFinite(n)) {
                          update({
                            anchors: mesh.anchors.map((value, i) =>
                              i === active ? { ...value, [axis]: clampUnit(n / 100) } : value
                            ),
                          })
                        }
                      }}
                    />
                    <span>%</span>
                  </label>
                ))}
              </div>

              <MeshRange
                label="Anchor influence"
                min={0.1}
                max={2.0}
                step={0.05}
                value={anchor.radius}
                onChange={radius =>
                  update({
                    anchors: mesh.anchors.map((value, i) => (i === active ? { ...value, radius } : value)),
                  })
                }
              />
            </div>
          )}

          {/* Procedural Noise & Grain Finish */}
          <div className="shader-divider" />
          <span className="section-caption">ENGINE & INTERPOLATION</span>
          <label className="property-select">
            Interpolation
            <select
              aria-label="Mesh interpolation mode"
              value={mesh.interpolation ?? 'bicubic'}
              onChange={event =>
                update({ interpolation: event.currentTarget.value as MeshMaterial['interpolation'] })
              }
            >
              <option value="bicubic">Bicubic Spline (Smooth Hermite)</option>
              <option value="gaussian-rbf">Gaussian RBF (Inverse-Distance)</option>
              <option value="catmull-rom">Catmull-Rom (Tension Spline)</option>
            </select>
          </label>
          <MeshRange
            label="Warp modulation"
            value={mesh.warpModulation ?? 0.25}
            onChange={warpModulation => update({ warpModulation })}
          />
          <label className="property-select">
            Distortion dynamics
            <select
              aria-label="Mesh distortion dynamics mode"
              value={mesh.distortionMode ?? 'curl-fluid'}
              onChange={event =>
                update({ distortionMode: event.currentTarget.value as MeshDistortionMode })
              }
            >
              <option value="curl-fluid">Incompressible Curl Fluid</option>
              <option value="domain-warp">Nested Domain Warp</option>
              <option value="turbulent-swirl">Turbulent Vortex Swirl</option>
              <option value="simplex-flow">Harmonic Simplex Flow</option>
            </select>
          </label>
          <MeshRange
            label="Fluid advection"
            min={0}
            max={1}
            step={0.01}
            value={mesh.fluidAdvection ?? 0.35}
            onChange={fluidAdvection => update({ fluidAdvection })}
          />
          <MeshRange
            label="Fluid viscosity"
            min={0}
            max={1}
            step={0.01}
            value={mesh.fluidViscosity ?? 0.5}
            onChange={fluidViscosity => update({ fluidViscosity })}
          />

          <div className="shader-divider" />
          <span className="section-caption">SURFACE VIEW MODE</span>
          <div className="mesh-tool-row" role="group" aria-label="Surface view mode">
            <button
              type="button"
              className={`mesh-tool-btn ${(!mesh.viewMode || mesh.viewMode === 'shaded') ? 'active' : ''}`}
              onClick={() => update({ viewMode: 'shaded' })}
              title="Shaded material surface"
            >
              <Sun size={13} />
              <span>Shaded</span>
            </button>
            <button
              type="button"
              className={`mesh-tool-btn ${mesh.viewMode === 'normal-map' ? 'active' : ''}`}
              onClick={() => update({ viewMode: 'normal-map' })}
              title="Tangent space normal map"
            >
              <Layers size={13} />
              <span>Normals</span>
            </button>
            <button
              type="button"
              className={`mesh-tool-btn ${mesh.viewMode === 'displacement' ? 'active' : ''}`}
              onClick={() => update({ viewMode: 'displacement' })}
              title="Height / displacement map"
            >
              <Waves size={13} />
              <span>Height</span>
            </button>
          </div>

          <div className="mesh-presets-section">
            <span className="section-caption">DISPLACEMENT PRESETS</span>
            <div className="mesh-preset-chips" role="group" aria-label="Displacement presets">
              {MESH_DISPLACEMENT_PRESETS.map(preset => (
                <button
                  key={preset.id}
                  type="button"
                  className="mesh-preset-chip"
                  title={preset.description}
                  aria-label={`Apply ${preset.name} displacement preset`}
                  onClick={() => applyDisplacementPreset(preset)}
                >
                  <span>{preset.name}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="shader-divider" />
          <span className="section-caption">PROCEDURAL NOISE & DISPLACEMENT</span>
          <label className="property-select">
            Noise generator
            <select
              aria-label="Mesh noise generator"
              value={mesh.noiseType ?? 'simplex'}
              onChange={event =>
                update({ noiseType: event.currentTarget.value as NoiseGenerator })
              }
            >
              {noiseGenerators.map(gen => (
                <option key={gen} value={gen}>
                  {gen.charAt(0).toUpperCase() + gen.slice(1)} ({gen === 'simplex' ? '2D Harmonic' : gen === 'perlin' ? 'Gradient' : 'Cellular / Voronoi'})
                </option>
              ))}
            </select>
          </label>
          <MeshRange
            label="Octaves"
            min={1}
            max={6}
            step={1}
            value={mesh.octaves ?? 3}
            onChange={octaves => update({ octaves: Math.round(octaves) })}
          />
          <MeshRange
            label="Lacunarity"
            min={1.0}
            max={5.0}
            step={0.1}
            value={mesh.lacunarity ?? 2.0}
            onChange={lacunarity => update({ lacunarity })}
          />
          <MeshRange
            label="Turbulence"
            value={mesh.turbulence}
            onChange={turbulence => update({ turbulence })}
          />
          <MeshRange
            label="Noise frequency"
            min={1}
            max={12}
            step={0.1}
            value={mesh.frequency}
            onChange={frequency => update({ frequency })}
          />
          <MeshRange
            label="Normal perturbation"
            min={0}
            max={1}
            step={0.01}
            value={mesh.normalPerturbation ?? 0.2}
            onChange={normalPerturbation => update({ normalPerturbation })}
          />
          <MeshRange
            label="Grain displacement"
            min={0}
            max={1}
            step={0.01}
            value={mesh.grainDisplacement ?? 0.15}
            onChange={grainDisplacement => update({ grainDisplacement })}
          />
          <MeshRange
            label="Distortion"
            value={paint.params.distortion}
            onChange={distortion => commit({ ...paint, params: { ...paint.params, distortion } })}
          />
          <MeshRange
            label="Swirl"
            min={-1}
            max={1}
            step={0.02}
            value={paint.params.swirl}
            onChange={swirl => commit({ ...paint, params: { ...paint.params, swirl } })}
          />
          <MeshRange
            label="Chromatic aberration"
            value={mesh.chromaticAberration}
            onChange={chromaticAberration => update({ chromaticAberration })}
          />
          <MeshRange
            label="Grain mixer"
            value={paint.params.grainMixer}
            onChange={grainMixer => commit({ ...paint, params: { ...paint.params, grainMixer } })}
          />
          <MeshRange
            label="Grain overlay"
            value={paint.params.grainOverlay}
            onChange={grainOverlay => commit({ ...paint, params: { ...paint.params, grainOverlay } })}
          />
          <label className="property-select">
            Grain blending
            <select
              aria-label="Mesh grain blending"
              value={mesh.grainBlend}
              onChange={event =>
                update({ grainBlend: event.currentTarget.value as MeshMaterial['grainBlend'] })
              }
            >
              {grainBlendModes.map(mode => (
                <option key={mode} value={mode}>
                  {mode.replace('-', ' ')}
                </option>
              ))}
            </select>
          </label>

          {/* Grid Mesh Topology Engine */}
          <div className="shader-divider" />
          <MeshGradientEngine
            paint={paint}
            onChange={onChange}
            onGestureStart={onGestureStart}
            onGestureEnd={onGestureEnd}
            target={target}
            onBindTarget={onBindTarget}
          />

          {/* Direct Scene Canvas Binding */}
          {(target || onBindTarget) && (
            <div className="mesh-binding-section" role="region" aria-label="Scene canvas binding">
              <div className="mesh-binding-row">
                <span className="section-caption">CANVAS BINDING</span>
                <span className="mesh-binding-target-badge">{target ?? 'Canvas layer'}</span>
              </div>
              {onBindTarget && (
                <div className="mesh-binding-actions">
                  {target !== 'Canvas background' && (
                    <button
                      type="button"
                      className="mesh-binding-btn"
                      title="Apply this mesh gradient to canvas background"
                      onClick={() => onBindTarget('background')}
                    >
                      Apply to Background
                    </button>
                  )}
                  {target === 'Canvas background' && (
                    <button
                      type="button"
                      className="mesh-binding-btn"
                      title="Bind this mesh gradient to selected canvas layers"
                      onClick={() => onBindTarget('selection')}
                    >
                      Bind to Selection
                    </button>
                  )}
                  <button
                    type="button"
                    className="mesh-binding-btn"
                    title="Create a new canvas shape with this mesh gradient"
                    onClick={() => onBindTarget('new-card')}
                  >
                    Create Mesh Card
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Code Export */}
      <details className="mesh-code">
        <summary>
          <Code2 size={12} />
          React shader code
          <span>JSX</span>
        </summary>
        <p>Ready to paste. Set a height on the parent.</p>
        <pre tabIndex={0} aria-label="React shader source">
          <code>{source}</code>
        </pre>
        <div className="mesh-code-actions">
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(source)
                setCopiedSource(source)
                setCopyError('')
              } catch {
                setCopyError('Clipboard unavailable. Download the source instead.')
              }
            }}
          >
            {copiedSource === source ? <Check size={12} /> : <Copy size={12} />}
            {copiedSource === source ? 'Copied' : 'Copy React'}
          </button>
          <button
            aria-label="Download React shader"
            onClick={() => {
              const url = URL.createObjectURL(new Blob([source], { type: 'text/plain' }))
              const link = document.createElement('a')
              link.href = url
              link.download = 'PaperMaterial.tsx'
              link.click()
              setTimeout(() => URL.revokeObjectURL(url), 1000)
            }}
          >
            <Download size={12} />
            .tsx
          </button>
        </div>
        <span role="status" className="mesh-copy-status">
          {copyError || (copiedSource === source ? 'React source copied.' : '')}
        </span>
      </details>
    </div>
  )
}

function MeshRange({
  label,
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
}) {
  const id = useId()
  return (
    <div className="shader-slider">
      <label htmlFor={id}>{label}</label>
      <output htmlFor={id}>{value.toFixed(2)}</output>
      <input
        id={id}
        type="range"
        aria-label={`Mesh ${label}`}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={event => onChange(event.currentTarget.valueAsNumber)}
      />
    </div>
  )
}

