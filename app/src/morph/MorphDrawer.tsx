import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeftRight,
  Check,
  ChevronRight,
  Copy,
  Download,
  FlipHorizontal,
  FlipVertical,
  Layers,
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Sparkles,
  X,
} from 'lucide-react'
import type { ViewportController } from '../canvas/ViewportController.ts'
import { Dialog } from '../workspace/Dialog.tsx'
import type { PathElement } from '../scene/types.ts'
import type { SceneStore } from '../scene/store.ts'
import { useScene } from '../scene/useScene.ts'
import {
  applyMorphToCanvas,
  downloadMorphSVG,
  generateExportCode,
} from './export.ts'
import { MORPH_PRESETS, SHAPE_PRESETS } from './presets.ts'
import type {
  AlignmentStrategy,
  EqualizationStrategy,
  InterpolationMode,
  MorphEasing,
  MorphExportFormat,
  MorphPreset,
  MorphTarget,
} from './types.ts'
import { useMorphEngine } from './useMorphEngine.ts'
import './morph.css'

export function MorphDrawer({
  store,
  controller,
  initialTargetA,
  initialTargetB,
  onClose,
}: {
  store: SceneStore
  controller: ViewportController
  initialTargetA?: MorphTarget
  initialTargetB?: MorphTarget
  onClose: () => void
}) {
  const sceneState = useScene(store, s => s)

  // Initialize engine
  const initialPreset = useMemo<MorphPreset>(() => {
    if (initialTargetA && initialTargetB) {
      return {
        id: 'custom-session',
        name: 'Custom Session',
        description: 'User canvas selections',
        targetA: initialTargetA,
        targetB: initialTargetB,
      }
    }
    if (initialTargetA) {
      return {
        ...MORPH_PRESETS[0],
        targetA: initialTargetA,
      }
    }
    return MORPH_PRESETS[0]
  }, [initialTargetA, initialTargetB])

  const {
    targetA,
    targetB,
    setTargetA,
    setTargetB,
    config,
    updateConfig,
    rawProgress,
    isPlaying,
    playbackSpeed,
    setPlaybackSpeed,
    morphResult,
    validTargets,
    togglePlay,
    scrubTo,
    stepForward,
    stepBackward,
    reset,
    loadPreset,
    swapTargets,
    rotateTarget,
    flipTarget,
    reverseTargetWinding,
    shiftTargetStart,
    setTargetCustomD,
  } = useMorphEngine(initialPreset)

  const [activeTab, setActiveTab] = useState<'targets' | 'trajectories' | 'presets' | 'export'>('targets')
  const [exportFormat, setExportFormat] = useState<MorphExportFormat>('svg-smil')
  const [copiedCode, setCopiedCode] = useState(false)
  const [copyError, setCopyError] = useState('')
  const [appliedNotice, setAppliedNotice] = useState(false)
  const [hoveredAnchor, setHoveredAnchor] = useState<number | null>(null)
  const [customDOpenA, setCustomDOpenA] = useState(false)
  const [customDOpenB, setCustomDOpenB] = useState(false)

  // Canvas elements candidates for "Pick from Canvas"
  const canvasPathElements = useMemo(() => {
    return Object.values(sceneState.elements).filter(
      (el): el is PathElement => el.type === 'path' && Boolean(el.d && el.d.trim().length > 0)
    )
  }, [sceneState.elements])

  const handlePickFromCanvas = (targetKey: 'A' | 'B', id: string) => {
    const path = canvasPathElements.find(el => el.id === id)
    if (!path) return
    const target: MorphTarget = { id: `canvas-${path.id}`, name: path.name, d: path.d,
      viewBox: path.viewBox, fillRule: path.fillRule, color: path.style.fill ?? '#81adec' }
    if (targetKey === 'A') setTargetA(target)
    else setTargetB(target)
  }

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement
      if (event.code !== 'Space' || el.matches('input, textarea, select, button') || el.isContentEditable) return
      event.preventDefault()
      if (validTargets) togglePlay()
    }
    document.addEventListener('keydown', keydown)
    return () => document.removeEventListener('keydown', keydown)
  }, [togglePlay, validTargets])

  const handleApplyToCanvas = () => {
    applyMorphToCanvas(store, controller, morphResult.d, targetA)
    setAppliedNotice(true)
    setTimeout(() => setAppliedNotice(false), 2400)
  }

  const handleDownloadSVG = (animated = true) => {
    downloadMorphSVG(targetA, targetB, config, morphResult.d, animated)
  }

  const exportD = exportFormat === 'svg-static' ? morphResult.d : ''
  const generatedCode = useMemo(() => activeTab === 'export' && validTargets
    ? generateExportCode(exportFormat, targetA, targetB, config, exportD) : '',
    [activeTab, validTargets, exportFormat, targetA, targetB, config, exportD])

  const handleCopyCode = async () => {
    try {
      setCopyError('')
      await navigator.clipboard.writeText(generatedCode)
      setCopiedCode(true)
      setTimeout(() => setCopiedCode(false), 2000)
    } catch {
      setCopyError('Clipboard access failed. Select and copy the code below.')
    }
  }

  return (
    <Dialog className="morph-studio-dialog" labelledBy="morph-studio-title" onClose={onClose}>
      {/* Header */}
      <header className="morph-header">
        <div className="morph-brand-group">
          <div className="morph-brand-title">
            <Sparkles size={17} />
            <span id="morph-studio-title">Path Morph Engine</span>
          </div>
          <span className="morph-badge">Procedural</span>
          <div className="morph-header-stats">
            <span>Points: {morphResult.shapeA.totalSegments}</span>
            <span>·</span>
            <span>Strain: {morphResult.trajectoryStrain.toFixed(1)}px</span>
            <span>·</span>
            <span>t: {(morphResult.easedProgress * 100).toFixed(1)}%</span>
          </div>
        </div>

        <div className="morph-header-actions">
          <button
            className="morph-secondary-btn"
            title="Download animated standalone SVG"
            disabled={!validTargets}
            onClick={() => handleDownloadSVG(true)}
          >
            <Download size={13} />
            <span>Export SVG</span>
          </button>
          <button
            className="morph-primary-btn"
            title="Insert this morphed shape as a new vector on the Paper canvas"
            disabled={!validTargets}
            onClick={handleApplyToCanvas}
          >
            {appliedNotice ? <Check size={13} /> : <Layers size={13} />}
            <span>{appliedNotice ? 'Baked to Canvas!' : 'Bake to Canvas'}</span>
          </button>
          <button className="quiet-button" aria-label="Close morph studio" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
      </header>

      {/* Main Body */}
      <div className="morph-main">
        {/* Left: Stage & Scrubber */}
        <div className="morph-stage-wrapper">
          {/* Stage Viewport */}
          <div className="morph-stage-viewport">
            <svg
              className="morph-svg-canvas"
              viewBox="-8 -8 136 136"
              role="img" aria-label="Interpolated vector preview"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <defs>
                <pattern id="morph-minor-grid" width="24" height="24" patternUnits="userSpaceOnUse">
                  <path d="M 24 0 L 0 0 0 24" fill="none" className="morph-grid-pattern" />
                </pattern>
              </defs>

              {/* Grid Background */}
              <rect x="0" y="0" width="120" height="120" fill="url(#morph-minor-grid)" />
              <rect x="0" y="0" width="120" height="120" fill="none" className="morph-grid-major" />

              {/* Center crosshair */}
              <line x1="60" y1="52" x2="60" y2="68" stroke="var(--paper-border-strong)" strokeWidth="0.75" />
              <line x1="52" y1="60" x2="68" y2="60" stroke="var(--paper-border-strong)" strokeWidth="0.75" />

              {/* Trajectory correspondence lines */}
              {config.showTrajectories &&
                morphResult.trajectories.map((traj, idx) => (
                  <line
                    key={`traj-${idx}`}
                    x1={traj.from.x}
                    y1={traj.from.y}
                    x2={traj.to.x}
                    y2={traj.to.y}
                    className="morph-trajectory-line"
                    opacity={hoveredAnchor === idx ? 0.9 : 0.35}
                    strokeWidth={hoveredAnchor === idx ? 1.5 : 0.75}
                  />
                ))}

              {/* Ghost Target A */}
              {config.showGhostA && <path className="morph-ghost-a" d={morphResult.shapeA.contours.length ? targetA.d : ''} transform={targetTransform(targetA)} />}

              {/* Ghost Target B */}
              {config.showGhostB && <path className="morph-ghost-b" d={morphResult.shapeB.contours.length ? targetB.d : ''} transform={targetTransform(targetB)} />}

              {/* Main Interpolated Path */}
              <path
                className="morph-active-path" data-testid="morph-preview-path"
                d={morphResult.d}
                fill={targetA.color ?? '#81adec'}
                fillRule={targetA.fillRule ?? 'nonzero'}
              />

              {/* Anchor Vertices */}
              {config.showAnchors &&
                morphResult.trajectories.map((traj, idx) => (
                  <circle
                    key={`anchor-${idx}`}
                    className="morph-anchor-point"
                    cx={traj.current.x}
                    cy={traj.current.y}
                    r={hoveredAnchor === idx ? 4 : 2.2}
                    onPointerEnter={() => setHoveredAnchor(idx)}
                    onPointerLeave={() => setHoveredAnchor(null)}
                  />
                ))}

              {/* Centroid marker */}
              {config.showCentroid && (
                <g>
                  <circle
                    cx={morphResult.interpolatedShape.centroid.x}
                    cy={morphResult.interpolatedShape.centroid.y}
                    r={3}
                    fill="none"
                    stroke="var(--paper-text)"
                    strokeWidth="1"
                  />
                  <line
                    x1={morphResult.interpolatedShape.centroid.x - 5}
                    y1={morphResult.interpolatedShape.centroid.y}
                    x2={morphResult.interpolatedShape.centroid.x + 5}
                    y2={morphResult.interpolatedShape.centroid.y}
                    className="morph-centroid-marker"
                  />
                  <line
                    x1={morphResult.interpolatedShape.centroid.x}
                    y1={morphResult.interpolatedShape.centroid.y - 5}
                    x2={morphResult.interpolatedShape.centroid.x}
                    y2={morphResult.interpolatedShape.centroid.y + 5}
                    className="morph-centroid-marker"
                  />
                </g>
              )}
            </svg>

            {/* Stage HUD Overlay */}
            <div className="morph-stage-hud">
              <span className="morph-hud-pill">
                t = {(morphResult.easedProgress * 100).toFixed(0)}%
              </span>
              <span className="morph-hud-pill">{config.easing}</span>
              <span className="morph-hud-pill">{config.interpolationMode}</span>
            </div>
          </div>

          {!validTargets && <p className="morph-input-error" role="alert">Enter valid SVG path data for both targets to preview, export, or bake.</p>}
          {/* Scrub Controller */}
          <div className="morph-scrub-controller">
            {/* Slider */}
            <div className="morph-scrub-slider-container">
              <input
                type="range"
                className="morph-scrub-slider"
                aria-label="Morph timeline scrub progress"
                min="0"
                max="1"
                step="0.001"
                value={rawProgress}
                onChange={e => { scrubTo(parseFloat(e.target.value)) }}
              />
              <span className="morph-scrub-time">{(rawProgress * 100).toFixed(0)}%</span>
            </div>

            {/* Playback Controls */}
            <div className="morph-playback-bar">
              <div className="morph-playback-controls">
                <button
                  className="morph-icon-btn"
                  title="Reset to start"
                  aria-label="Reset to start"
                  onClick={reset}
                >
                  <RotateCcw size={13} />
                </button>
                <button
                  className="morph-icon-btn"
                  title="Step backward (-5%)"
                  aria-label="Step backward"
                  onClick={() => stepBackward(0.05)}
                >
                  ◀
                </button>
                <button
                  className={`morph-icon-btn ${isPlaying ? 'active' : ''}`}
                  title={isPlaying ? 'Pause' : 'Play'}
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                  disabled={!validTargets}
                  onClick={togglePlay}
                >
                  {isPlaying ? <Pause size={14} /> : <Play size={14} fill="currentColor" />}
                </button>
                <button
                  className="morph-icon-btn"
                  title="Step forward (+5%)"
                  aria-label="Step forward"
                  onClick={() => stepForward(0.05)}
                >
                  ▶
                </button>
              </div>

              {/* Speed chips */}
              <div className="morph-speed-chips">
                {([0.25, 0.5, 1, 2] as const).map(speed => (
                  <button
                    key={speed}
                    className={`morph-chip ${playbackSpeed === speed ? 'active' : ''}`}
                    onClick={() => setPlaybackSpeed(speed)}
                  >
                    {speed}x
                  </button>
                ))}
              </div>

              {/* Mode button */}
              <button
                className="morph-secondary-btn"
                title={`Playback mode: ${config.playbackMode}`}
                onClick={() =>
                  updateConfig({
                    playbackMode:
                      config.playbackMode === 'pingpong'
                        ? 'loop'
                        : config.playbackMode === 'loop'
                        ? 'once'
                        : 'pingpong',
                  })
                }
              >
                <span>{config.playbackMode}</span>
              </button>

              {/* Easing selector */}
              <select
                className="morph-easing-select"
                aria-label="Interpolation easing function"
                value={config.easing}
                onChange={e => updateConfig({ easing: e.target.value as MorphEasing })}
              >
                <option value="easeInOutCubic">Ease In-Out Cubic</option>
                <option value="linear">Linear</option>
                <option value="easeInQuad">Ease In Quad</option>
                <option value="easeOutQuad">Ease Out Quad</option>
                <option value="easeInOutQuad">Ease In-Out Quad</option>
                <option value="anticipate">Anticipate (Pull back)</option>
                <option value="easeOutBack">Ease Out Back</option>
                <option value="spring">Spring Dynamics</option>
                <option value="elastic">Elastic</option>
                <option value="bounce">Bounce</option>
              </select>
            </div>
          </div>
        </div>

        {/* Right: Inspector Tabs */}
        <aside className="morph-inspector">
          <nav className="morph-tabs" aria-label="Morph studio controls">
            <button
              className={`morph-tab-btn ${activeTab === 'targets' ? 'active' : ''}`}
              onClick={() => setActiveTab('targets')}
            >
              Targets
            </button>
            <button
              className={`morph-tab-btn ${activeTab === 'trajectories' ? 'active' : ''}`}
              onClick={() => setActiveTab('trajectories')}
            >
              Trajectory
            </button>
            <button
              className={`morph-tab-btn ${activeTab === 'presets' ? 'active' : ''}`}
              onClick={() => setActiveTab('presets')}
            >
              Presets
            </button>
            <button
              className={`morph-tab-btn ${activeTab === 'export' ? 'active' : ''}`}
              onClick={() => setActiveTab('export')}
            >
              Code
            </button>
          </nav>

          <div className="morph-panel-content">
            {/* TAB: TARGETS */}
            {activeTab === 'targets' && (
              <>
                {/* Target A */}
                <div className="morph-target-card target-a">
                  <div className="morph-target-header">
                    <span className="morph-target-label">
                      <span className="morph-target-dot a" />
                      Target A (Origin)
                    </span>
                    <select className="morph-canvas-picker" aria-label="Target A canvas path"
                      value="" disabled={!canvasPathElements.length}
                      onChange={e => handlePickFromCanvas('A', e.target.value)}>
                      <option value="">From canvas…</option>
                      {canvasPathElements.map(el => <option key={el.id} value={el.id}>{el.name}</option>)}
                    </select>
                  </div>

                  <select
                    className="morph-preset-select"
                    aria-label="Select shape for Target A"
                    value={
                      Object.keys(SHAPE_PRESETS).find(
                        k => SHAPE_PRESETS[k].d === targetA.d
                      ) ?? 'custom'
                    }
                    onChange={e => {
                      const key = e.target.value
                      if (SHAPE_PRESETS[key]) {
                        setTargetA(SHAPE_PRESETS[key])
                      }
                    }}
                  >
                    {Object.entries(SHAPE_PRESETS).map(([k, shape]) => (
                      <option key={k} value={k}>
                        {shape.name}
                      </option>
                    ))}
                    {!Object.values(SHAPE_PRESETS).some(s => s.d === targetA.d) && (
                      <option value="custom">{targetA.name} (Custom)</option>
                    )}
                  </select>

                  <div className="morph-target-tools">
                    <button
                      className="morph-tool-mini-btn"
                      title="Rotate 90° clockwise"
                      aria-label="Rotate Target A 90 degrees clockwise"
                      onClick={() => rotateTarget('A', 90)}
                    >
                      <RotateCw size={12} />
                    </button>
                    <button
                      className="morph-tool-mini-btn"
                      title="Flip horizontally"
                      aria-label="Flip Target A horizontally"
                      onClick={() => flipTarget('A', true, false)}
                    >
                      <FlipHorizontal size={12} />
                    </button>
                    <button
                      className="morph-tool-mini-btn"
                      title="Flip vertically"
                      aria-label="Flip Target A vertically"
                      onClick={() => flipTarget('A', false, true)}
                    >
                      <FlipVertical size={12} />
                    </button>
                    <button
                      className="morph-tool-mini-btn"
                      title="Invert winding direction"
                      aria-label="Invert Target A winding direction"
                      onClick={() => reverseTargetWinding('A')}
                    >
                      <ArrowLeftRight size={12} />
                    </button>
                    <button
                      className="morph-tool-mini-btn"
                      title="Shift start anchor (+1)"
                      aria-label="Shift Target A start anchor"
                      onClick={() => shiftTargetStart('A', 1)}
                    >
                      +1
                    </button>
                  </div>

                  <div className="morph-color-picker-row">
                    <span>Fill Color:</span>
                    <input
                      type="color"
                      className="morph-color-input"
                      aria-label="Target A fill color"
                      value={targetA.color ?? '#81adec'}
                      onChange={e => setTargetA(t => ({ ...t, color: e.target.value }))}
                    />
                    <button
                      className="quiet-button"
                      style={{ fontSize: '10px' }}
                      onClick={() => setCustomDOpenA(v => !v)}
                    >
                      {customDOpenA ? 'Hide SVG d' : 'Edit SVG d'}
                    </button>
                  </div>

                  {customDOpenA && (
                    <textarea
                      className="morph-custom-d-input"
                      aria-label="Target A SVG path data"
                      value={targetA.d}
                      onChange={e => setTargetCustomD('A', e.target.value)}
                    />
                  )}
                </div>

                {/* Swap button */}
                <div className="morph-swap-container">
                  <button
                    className="morph-swap-btn"
                    title="Swap Target A and Target B"
                    onClick={swapTargets}
                  >
                    <ArrowLeftRight size={12} />
                    <span>Swap Targets</span>
                  </button>
                </div>

                {/* Target B */}
                <div className="morph-target-card target-b">
                  <div className="morph-target-header">
                    <span className="morph-target-label">
                      <span className="morph-target-dot b" />
                      Target B (Destination)
                    </span>
                    <select className="morph-canvas-picker" aria-label="Target B canvas path"
                      value="" disabled={!canvasPathElements.length}
                      onChange={e => handlePickFromCanvas('B', e.target.value)}>
                      <option value="">From canvas…</option>
                      {canvasPathElements.map(el => <option key={el.id} value={el.id}>{el.name}</option>)}
                    </select>
                  </div>

                  <select
                    className="morph-preset-select"
                    aria-label="Select shape for Target B"
                    value={
                      Object.keys(SHAPE_PRESETS).find(
                        k => SHAPE_PRESETS[k].d === targetB.d
                      ) ?? 'custom'
                    }
                    onChange={e => {
                      const key = e.target.value
                      if (SHAPE_PRESETS[key]) {
                        setTargetB(SHAPE_PRESETS[key])
                      }
                    }}
                  >
                    {Object.entries(SHAPE_PRESETS).map(([k, shape]) => (
                      <option key={k} value={k}>
                        {shape.name}
                      </option>
                    ))}
                    {!Object.values(SHAPE_PRESETS).some(s => s.d === targetB.d) && (
                      <option value="custom">{targetB.name} (Custom)</option>
                    )}
                  </select>

                  <div className="morph-target-tools">
                    <button
                      className="morph-tool-mini-btn"
                      title="Rotate 90° clockwise"
                      aria-label="Rotate Target B 90 degrees clockwise"
                      onClick={() => rotateTarget('B', 90)}
                    >
                      <RotateCw size={12} />
                    </button>
                    <button
                      className="morph-tool-mini-btn"
                      title="Flip horizontally"
                      aria-label="Flip Target B horizontally"
                      onClick={() => flipTarget('B', true, false)}
                    >
                      <FlipHorizontal size={12} />
                    </button>
                    <button
                      className="morph-tool-mini-btn"
                      title="Flip vertically"
                      aria-label="Flip Target B vertically"
                      onClick={() => flipTarget('B', false, true)}
                    >
                      <FlipVertical size={12} />
                    </button>
                    <button
                      className="morph-tool-mini-btn"
                      title="Invert winding direction"
                      aria-label="Invert Target B winding direction"
                      onClick={() => reverseTargetWinding('B')}
                    >
                      <ArrowLeftRight size={12} />
                    </button>
                    <button
                      className="morph-tool-mini-btn"
                      title="Shift start anchor (+1)"
                      aria-label="Shift Target B start anchor"
                      onClick={() => shiftTargetStart('B', 1)}
                    >
                      +1
                    </button>
                  </div>

                  <div className="morph-color-picker-row">
                    <span>Fill Color:</span>
                    <input
                      type="color"
                      className="morph-color-input"
                      aria-label="Target B fill color"
                      value={targetB.color ?? '#f59e0b'}
                      onChange={e => setTargetB(t => ({ ...t, color: e.target.value }))}
                    />
                    <button
                      className="quiet-button"
                      style={{ fontSize: '10px' }}
                      onClick={() => setCustomDOpenB(v => !v)}
                    >
                      {customDOpenB ? 'Hide SVG d' : 'Edit SVG d'}
                    </button>
                  </div>

                  {customDOpenB && (
                    <textarea
                      className="morph-custom-d-input"
                      aria-label="Target B SVG path data"
                      value={targetB.d}
                      onChange={e => setTargetCustomD('B', e.target.value)}
                    />
                  )}
                </div>
              </>
            )}

            {/* TAB: TRAJECTORIES & EQUALIZATION */}
            {activeTab === 'trajectories' && (
              <>
                <div className="morph-control-group">
                  <span className="morph-group-title">Point Equalization</span>

                  <div className="morph-slider-row">
                    <label>
                      <span>Anchor Count</span>
                      <span className="val">{config.pointCount} points</span>
                    </label>
                    <input
                      type="range"
                      className="morph-slider"
                      min="16"
                      max="128"
                      step="4"
                      value={config.pointCount}
                      onChange={e => updateConfig({ pointCount: parseInt(e.target.value, 10) })}
                    />
                  </div>

                  <label className="property-select" style={{ marginTop: 4 }}>
                    <span>Strategy</span>
                    <select
                      value={config.equalizationStrategy}
                      onChange={e =>
                        updateConfig({
                          equalizationStrategy: e.target.value as EqualizationStrategy,
                        })
                      }
                    >
                      <option value="adaptive-arclength">Adaptive Arc-Length</option>
                      <option value="curvature">Curvature-Weighted</option>
                      <option value="uniform">Uniform Spacing</option>
                    </select>
                  </label>
                </div>

                <div className="morph-control-group">
                  <span className="morph-group-title">Trajectory Alignment</span>

                  <label className="property-select">
                    <span>Alignment Method</span>
                    <select
                      value={config.alignmentStrategy}
                      onChange={e =>
                        updateConfig({
                          alignmentStrategy: e.target.value as AlignmentStrategy,
                        })
                      }
                    >
                      <option value="auto-distance">Best-fit Distance (Auto)</option>
                      <option value="manual-shift">Manual Circular Shift</option>
                      <option value="none">Raw Index Matching</option>
                    </select>
                  </label>

                  {config.alignmentStrategy === 'manual-shift' && (
                    <div className="morph-slider-row" style={{ marginTop: 6 }}>
                      <label>
                        <span>Index Shift Offset</span>
                        <span className="val">{config.manualShiftOffset}</span>
                      </label>
                      <input
                        type="range"
                        className="morph-slider"
                        min="0"
                        max={config.pointCount - 1}
                        value={config.manualShiftOffset}
                        onChange={e =>
                          updateConfig({ manualShiftOffset: parseInt(e.target.value, 10) })
                        }
                      />
                    </div>
                  )}

                  <label className="morph-checkbox-row" style={{ marginTop: 4 }}>
                    <input
                      type="checkbox"
                      checked={config.autoMatchWinding}
                      onChange={e => updateConfig({ autoMatchWinding: e.target.checked })}
                    />
                    <span>Auto-Match Winding Direction</span>
                  </label>
                </div>

                <div className="morph-control-group">
                  <span className="morph-group-title">Interpolation Geometry</span>

                  <label className="property-select">
                    <span>Coordinates</span>
                    <select
                      value={config.interpolationMode}
                      onChange={e =>
                        updateConfig({
                          interpolationMode: e.target.value as InterpolationMode,
                        })
                      }
                    >
                      <option value="blended">Blended (Cartesian + Polar)</option>
                      <option value="cartesian">Pure Cartesian Lerp</option>
                      <option value="polar">Polar Centroid</option>
                    </select>
                  </label>

                  {config.interpolationMode === 'blended' && (
                    <div className="morph-slider-row" style={{ marginTop: 6 }}>
                      <label>
                        <span>Polar Blend Share</span>
                        <span className="val">{(config.polarBlend * 100).toFixed(0)}%</span>
                      </label>
                      <input
                        type="range"
                        className="morph-slider"
                        min="0"
                        max="1"
                        step="0.05"
                        value={config.polarBlend}
                        onChange={e => updateConfig({ polarBlend: parseFloat(e.target.value) })}
                      />
                    </div>
                  )}
                </div>

                <div className="morph-control-group">
                  <span className="morph-group-title">Stage Overlays</span>

                  <label className="morph-checkbox-row">
                    <input
                      type="checkbox"
                      checked={config.showTrajectories}
                      onChange={e => updateConfig({ showTrajectories: e.target.checked })}
                    />
                    <span>Trajectory Vectors</span>
                  </label>
                  <label className="morph-checkbox-row">
                    <input
                      type="checkbox"
                      checked={config.showAnchors}
                      onChange={e => updateConfig({ showAnchors: e.target.checked })}
                    />
                    <span>Anchor Vertices</span>
                  </label>
                  <label className="morph-checkbox-row">
                    <input
                      type="checkbox"
                      checked={config.showGhostA}
                      onChange={e => updateConfig({ showGhostA: e.target.checked })}
                    />
                    <span>Target A Ghost Outline</span>
                  </label>
                  <label className="morph-checkbox-row">
                    <input
                      type="checkbox"
                      checked={config.showGhostB}
                      onChange={e => updateConfig({ showGhostB: e.target.checked })}
                    />
                    <span>Target B Ghost Outline</span>
                  </label>
                  <label className="morph-checkbox-row">
                    <input
                      type="checkbox"
                      checked={config.showCentroid}
                      onChange={e => updateConfig({ showCentroid: e.target.checked })}
                    />
                    <span>Centroid Crosshair</span>
                  </label>
                </div>
              </>
            )}

            {/* TAB: PRESETS */}
            {activeTab === 'presets' && (
              <div className="morph-presets-grid">
                {MORPH_PRESETS.map(p => (
                  <button
                    key={p.id}
                    className="morph-preset-card"
                    onClick={() => loadPreset(p)}
                  >
                    <div className="morph-preset-thumb">
                      <svg viewBox="0 0 120 120" fill="none">
                        <path d={p.targetA.d} fill="#81adec" opacity="0.8" />
                      </svg>
                      <ChevronRight size={14} style={{ opacity: 0.4 }} />
                      <svg viewBox="0 0 120 120" fill="none">
                        <path d={p.targetB.d} fill="var(--paper-text-secondary)" opacity="0.8" />
                      </svg>
                    </div>
                    <span className="morph-preset-name">{p.name}</span>
                    <span className="morph-preset-desc">{p.description}</span>
                  </button>
                ))}
              </div>
            )}

            {/* TAB: EXPORT & CODE */}
            {activeTab === 'export' && (
              <div className="morph-code-container">
                <div className="morph-format-chips">
                  {(
                    [
                      ['svg-smil', 'SVG Animated (SMIL)'],
                      ['react-framer', 'React Framer Motion'],
                      ['css-keyframes', 'CSS Keyframes'],
                      ['waapi', 'Web Animations API'],
                      ['svg-static', 'SVG Static Frame'],
                    ] as const
                  ).map(([fmt, label]) => (
                    <button
                      key={fmt}
                      className={`morph-chip ${exportFormat === fmt ? 'active' : ''}`}
                      onClick={() => setExportFormat(fmt)}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {copyError && <p role="status">{copyError}</p>}
                <pre className="morph-code-box" tabIndex={0}>{generatedCode}</pre>

                <div className="morph-code-actions">
                  <button className="morph-primary-btn" disabled={!validTargets} onClick={handleCopyCode}>
                    {copiedCode ? <Check size={13} /> : <Copy size={13} />}
                    <span>{copiedCode ? 'Copied to Clipboard' : 'Copy Code'}</span>
                  </button>
                  <button
                    className="morph-secondary-btn"
                    disabled={!validTargets}
                    onClick={() => handleDownloadSVG(exportFormat === 'svg-smil')}
                  >
                    <Download size={13} />
                    <span>Download SVG</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>
    </Dialog>
  )
}

function targetTransform(target: MorphTarget): string {
  const [x, y, w, h] = target.viewBox
  const scale = 120 / Math.max(w, h)
  return `translate(${60 - (x + w / 2) * scale} ${60 - (y + h / 2) * scale}) scale(${scale})`
}
