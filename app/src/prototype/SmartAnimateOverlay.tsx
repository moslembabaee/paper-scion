import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  ChevronDown,
  ChevronRight,
  Maximize2,
  Minimize2,
  Move,
  Pause,
  Play,
  RotateCcw,
  Sliders,
  Sparkles,
  X,
} from 'lucide-react'
import type { SceneStore } from '../scene/store'
import { useScene } from '../scene/useScene'
import {
  computeScreenDiff,
  elementToCubicContours,
  interpolateSmartPath,
  isSpringSettled,
  springMicroInteractionStep,
  springPhysicsMetrics,
  type ScreenDiff,
} from './smartAnimate'
import { prepareMorph } from '../morph/interpolate'
import { DEFAULT_MORPH_CONFIG } from '../morph/presets'
import { DEFAULT_SPRING, SPRING_LIMITS, SPRING_PRESETS, springDuration, springProgress } from './spring'
import type { PrototypeTransition, SpringParameters } from './types'

export interface SmartAnimateOverlayProps {
  store: SceneStore
  fromFrameId: string
  toFrameId: string
  transition: PrototypeTransition
  onUpdateTransition?: (patch: Partial<PrototypeTransition>) => void
  scrubProgress: number | null
  onScrub: (progress: number | null) => void
  showGhosts: boolean
  onToggleGhosts: (show: boolean) => void
  onClose: () => void
}

export function SmartAnimateOverlay({
  store,
  fromFrameId,
  toFrameId,
  transition,
  onUpdateTransition,
  scrubProgress,
  onScrub,
  showGhosts,
  onToggleGhosts,
  onClose,
}: SmartAnimateOverlayProps) {
  const state = useScene(store, s => s)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackSpeed, setPlaybackSpeed] = useState<0.25 | 0.5 | 1>(1)
  const [activeTab, setActiveTab] = useState<'diff' | 'physics' | 'pad'>('diff')
  const [expandedLayerId, setExpandedLayerId] = useState<string | null>(null)
  const [isMinimized, setIsMinimized] = useState(false)
  const animFrameRef = useRef<number>(0)
  const startTimeRef = useRef<number>(0)

  // Spring parameters
  const spring = transition.spring ?? DEFAULT_SPRING
  const duration = transition.duration || springDuration(spring)
  const metrics = useMemo(() => springPhysicsMetrics(spring), [spring])

  // Screen diff calculation
  const screenDiff: ScreenDiff = useMemo(() => {
    return computeScreenDiff(state.elements, fromFrameId, toFrameId)
  }, [state.elements, fromFrameId, toFrameId])

  // Current progress normalized [0, 1]
  const currentT = scrubProgress ?? 0
  const easedT = transition.easing === 'spring'
    ? springProgress(currentT, spring, duration)
    : currentT

  // Scrubber playback loop
  useEffect(() => {
    if (!isPlaying) {
      cancelAnimationFrame(animFrameRef.current)
      return
    }

    const effectiveDuration = (duration / playbackSpeed)
    startTimeRef.current = performance.now() - (currentT * effectiveDuration)

    const tick = (now: number) => {
      const elapsed = now - startTimeRef.current
      const nextT = Math.min(1, elapsed / effectiveDuration)
      onScrub(nextT)

      if (nextT < 1) {
        animFrameRef.current = requestAnimationFrame(tick)
      } else {
        setIsPlaying(false)
      }
    }

    animFrameRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animFrameRef.current)
  }, [isPlaying, duration, playbackSpeed, onScrub])

  const handleSliderChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setIsPlaying(false)
    const val = parseFloat(event.target.value) / 100
    onScrub(val)
  }

  const restartScrub = () => {
    setIsPlaying(false)
    onScrub(0)
    window.setTimeout(() => setIsPlaying(true), 20)
  }

  const selectPreset = (key: keyof typeof SPRING_PRESETS) => {
    if (onUpdateTransition) {
      onUpdateTransition({
        easing: 'spring',
        spring: SPRING_PRESETS[key].spring,
      })
    }
  }

  const updateSpringParam = (param: keyof SpringParameters, val: number) => {
    if (onUpdateTransition) {
      onUpdateTransition({
        easing: 'spring',
        spring: { ...spring, [param]: val },
      })
    }
  }

  // Interactive 2D Spring Puck Micro-Interaction State
  const [puckPos, setPuckPos] = useState({ x: 0, y: 0 })
  const puckDragging = useRef(false)
  const puckDragStart = useRef({ x: 0, y: 0 })
  const puckCurrent = useRef({ x: 0, y: 0 })
  const puckAnimFrame = useRef<number>(0)

  const morphPreviewPair = useMemo(() => {
    const existing = screenDiff.matched.find(p => p.geometryDiff.isMorphable && p.geometryDiff.preparedMorph)
    if (existing) return existing.geometryDiff.preparedMorph
    try {
      const rawA = elementToCubicContours({ type: 'ellipse', id: 'm-a', name: 'Circle', x: 0, y: 0, width: 44, height: 44, rotation: 0, parentId: null, visible: true, style: { opacity: 1, fill: '#81adec' } } as any)
      const rawB = elementToCubicContours({ type: 'rectangle', id: 'm-b', name: 'Square', x: 0, y: 0, width: 44, height: 44, cornerRadius: 6, rotation: 0, parentId: null, visible: true, style: { opacity: 1, fill: '#81adec' } } as any)
      if (rawA && rawB) return prepareMorph(rawA, rawB, DEFAULT_MORPH_CONFIG)
    } catch {}
    return null
  }, [screenDiff.matched])

  const onPuckDown = (e: React.PointerEvent) => {
    puckDragging.current = true
    puckDragStart.current = { x: e.clientX - puckCurrent.current.x, y: e.clientY - puckCurrent.current.y }
    cancelAnimationFrame(puckAnimFrame.current)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPuckMove = (e: React.PointerEvent) => {
    if (!puckDragging.current) return
    const nx = Math.max(-60, Math.min(60, e.clientX - puckDragStart.current.x))
    const ny = Math.max(-40, Math.min(40, e.clientY - puckDragStart.current.y))
    puckCurrent.current = { x: nx, y: ny }
    setPuckPos({ x: nx, y: ny })
  }

  const onPuckUp = (e: React.PointerEvent) => {
    if (!puckDragging.current) return
    puckDragging.current = false
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }

    // Spring physics release simulation
    let lastTime = performance.now()
    let posX = puckCurrent.current.x
    let posY = puckCurrent.current.y
    let vx = 0
    let vy = 0

    const runPhysics = (now: number) => {
      const dt = Math.min(0.032, (now - lastTime) / 1000)
      lastTime = now

      const nextX = springMicroInteractionStep({ position: posX, velocity: vx }, 0, spring, dt)
      const nextY = springMicroInteractionStep({ position: posY, velocity: vy }, 0, spring, dt)

      posX = nextX.position
      vx = nextX.velocity
      posY = nextY.position
      vy = nextY.velocity

      puckCurrent.current = { x: posX, y: posY }
      setPuckPos({ x: posX, y: posY })

      if (!isSpringSettled(nextX, 0, 0.3, 0.5) || !isSpringSettled(nextY, 0, 0.3, 0.5)) {
        puckAnimFrame.current = requestAnimationFrame(runPhysics)
      } else {
        puckCurrent.current = { x: 0, y: 0 }
        setPuckPos({ x: 0, y: 0 })
      }
    }
    puckAnimFrame.current = requestAnimationFrame(runPhysics)
  }

  return (
    <div
      className={`smart-animate-overlay ${isMinimized ? 'is-minimized' : ''}`}
      data-testid="smart-animate-overlay"
      aria-label="Smart Animate Morphing and Physics Micro-Interaction HUD"
    >
      <div className="smart-animate-header">
        <div className="smart-animate-title">
          <Sparkles size={14} className="accent-icon" />
          <span>Smart Animate & Morph Engine</span>
          <span className="smart-animate-badge-phase">60fps Live</span>
        </div>
        <div className="smart-animate-header-actions">
          <button
            type="button"
            className="quiet-button"
            onClick={() => setIsMinimized(!isMinimized)}
            aria-label={isMinimized ? 'Expand HUD' : 'Minimize HUD'}
          >
            {isMinimized ? <Maximize2 size={13} /> : <Minimize2 size={13} />}
          </button>
          <button
            type="button"
            className="quiet-button"
            onClick={onClose}
            aria-label="Close Smart Animate HUD"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {!isMinimized && (
        <div className="smart-animate-body">
          {/* Screens connection bar */}
          <div className="smart-animate-screens-bar">
            <span className="screen-node source">{screenDiff.fromFrameName}</span>
            <div className="screen-wire-indicator">
              <span className="wire-line" />
              <span className="wire-arrow">➔</span>
            </div>
            <span className="screen-node target">{screenDiff.toFrameName}</span>
          </div>

          {/* Diff Summary Badges */}
          <div className="smart-animate-badges">
            <span className="smart-badge matched" title="Matched layers across screens">
              <strong>{screenDiff.summary.totalMatched}</strong> Matched
            </span>
            {screenDiff.summary.morphablePathCount > 0 && (
              <span className="smart-badge morphs" title="Bézier paths morphing with cubic curves">
                <strong>{screenDiff.summary.morphablePathCount}</strong> Bézier Morphs
              </span>
            )}
            <span className="smart-badge layouts" title="Layers with position, scale or rotation changes">
              <strong>{screenDiff.summary.layoutDiffCount}</strong> Layout Diffs
            </span>
            {screenDiff.summary.enteringCount > 0 && (
              <span className="smart-badge entering" title="Layers entering on target screen">
                +{screenDiff.summary.enteringCount} Entering
              </span>
            )}
            {screenDiff.summary.exitingCount > 0 && (
              <span className="smart-badge exiting" title="Layers exiting from source screen">
                -{screenDiff.summary.exitingCount} Exiting
              </span>
            )}
          </div>

          {/* Interactive Scrubbing Timeline */}
          <div className="smart-animate-scrubber-section">
            <div className="scrubber-header">
              <span className="scrubber-label">Morph & Physics Scrubber</span>
              <div className="scrubber-time-readout">
                <span>{(currentT * 100).toFixed(0)}%</span>
                <span className="scrubber-divider">/</span>
                <span>{Math.round(currentT * duration)}ms</span>
              </div>
            </div>

            <div className="scrubber-control-row">
              <button
                type="button"
                className="scrub-toggle-btn"
                onClick={() => setIsPlaying(!isPlaying)}
                aria-label={isPlaying ? 'Pause morph scrubbing' : 'Play morph transition'}
              >
                {isPlaying ? <Pause size={12} /> : <Play size={12} fill="currentColor" />}
              </button>

              <button
                type="button"
                className="scrub-step-btn"
                onClick={restartScrub}
                title="Restart transition"
                aria-label="Restart transition"
              >
                <RotateCcw size={12} />
              </button>

              <div className="scrubber-track-wrapper">
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="0.5"
                  value={currentT * 100}
                  onChange={handleSliderChange}
                  className="smart-animate-slider"
                  aria-label="Morph progress scrubber"
                />
                <div
                  className="scrubber-fill-bar"
                  style={{ width: `${Math.min(100, Math.max(0, currentT * 100))}%` }}
                />
              </div>

              <div className="speed-pills">
                {([0.25, 0.5, 1] as const).map(speed => (
                  <button
                    key={speed}
                    type="button"
                    className={`speed-pill ${playbackSpeed === speed ? 'active' : ''}`}
                    onClick={() => setPlaybackSpeed(speed)}
                  >
                    {speed}x
                  </button>
                ))}
              </div>
            </div>

            <div className="scrubber-options">
              <label className="checkbox-option">
                <input
                  type="checkbox"
                  checked={showGhosts}
                  onChange={e => onToggleGhosts(e.target.checked)}
                />
                <span>Ghost Outlines & Trajectories</span>
              </label>
              <span className="eased-readout">
                Physics Eased: <strong>{easedT.toFixed(3)}</strong>
              </span>
            </div>
          </div>

          {/* Sub-tabs: Diff Breakdown / Physics Tuning / Micro-interaction Pad */}
          <div className="smart-animate-tabs">
            <button
              type="button"
              className={`tab-btn ${activeTab === 'diff' ? 'active' : ''}`}
              onClick={() => setActiveTab('diff')}
            >
              <Sliders size={12} />
              <span>Layer Diffs</span>
            </button>
            <button
              type="button"
              className={`tab-btn ${activeTab === 'physics' ? 'active' : ''}`}
              onClick={() => setActiveTab('physics')}
            >
              <Activity size={12} />
              <span>Spring Physics</span>
            </button>
            <button
              type="button"
              className={`tab-btn ${activeTab === 'pad' ? 'active' : ''}`}
              onClick={() => setActiveTab('pad')}
            >
              <Move size={12} />
              <span>Physics Touchpad</span>
            </button>
          </div>

          {activeTab === 'diff' && (
            <div className="smart-diff-list">
              {screenDiff.matched.map(pair => {
                const isExpanded = expandedLayerId === pair.to.id
                return (
                  <div key={pair.to.id} className="diff-item">
                    <button
                      type="button"
                      className="diff-item-summary"
                      onClick={() => setExpandedLayerId(isExpanded ? null : pair.to.id)}
                    >
                      <div className="diff-item-title">
                        {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        <span className="layer-name">{pair.to.name}</span>
                        <span className="layer-type">{pair.to.type}</span>
                      </div>
                      <div className="diff-mini-tags">
                        {pair.geometryDiff.isMorphable && (
                          <span className="mini-tag morph">Bézier Morph</span>
                        )}
                        {pair.layoutDiff.hasLayoutChanged && (
                          <span className="mini-tag layout">Layout</span>
                        )}
                        {pair.styleDiff.hasStyleChanged && (
                          <span className="mini-tag style">Paint</span>
                        )}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="diff-item-details">
                        <div className="detail-row">
                          <span>Δ Position:</span>
                          <code>
                            x: {pair.layoutDiff.dx >= 0 ? `+${pair.layoutDiff.dx.toFixed(1)}` : pair.layoutDiff.dx.toFixed(1)}px,{' '}
                            y: {pair.layoutDiff.dy >= 0 ? `+${pair.layoutDiff.dy.toFixed(1)}` : pair.layoutDiff.dy.toFixed(1)}px
                          </code>
                        </div>
                        <div className="detail-row">
                          <span>Δ Dimensions:</span>
                          <code>
                            w: {pair.layoutDiff.dWidth >= 0 ? `+${pair.layoutDiff.dWidth.toFixed(1)}` : pair.layoutDiff.dWidth.toFixed(1)}px,{' '}
                            h: {pair.layoutDiff.dHeight >= 0 ? `+${pair.layoutDiff.dHeight.toFixed(1)}` : pair.layoutDiff.dHeight.toFixed(1)}px
                          </code>
                        </div>
                        {pair.layoutDiff.dRotation !== 0 && (
                          <div className="detail-row">
                            <span>Δ Rotation:</span>
                            <code>{pair.layoutDiff.dRotation.toFixed(1)}°</code>
                          </div>
                        )}
                        {pair.geometryDiff.isMorphable && (
                          <div className="detail-row morph-info">
                            <span>Bézier Engine:</span>
                            <code>{pair.geometryDiff.segmentCount} equalized cubic segments</code>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {activeTab === 'physics' && (
            <div className="smart-physics-panel">
              {/* Presets */}
              <div className="presets-row">
                <span className="panel-caption">SPRING PRESETS</span>
                <div className="presets-chips">
                  {(Object.keys(SPRING_PRESETS) as (keyof typeof SPRING_PRESETS)[]).map(key => {
                    const preset = SPRING_PRESETS[key]
                    const isSelected =
                      preset.spring.stiffness === spring.stiffness &&
                      preset.spring.damping === spring.damping &&
                      preset.spring.mass === spring.mass
                    return (
                      <button
                        key={key}
                        type="button"
                        className={`preset-chip ${isSelected ? 'active' : ''}`}
                        onClick={() => selectPreset(key)}
                      >
                        {preset.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Sliders */}
              <div className="spring-sliders">
                {(Object.keys(SPRING_LIMITS) as (keyof SpringParameters)[]).map(key => {
                  const [min, max] = SPRING_LIMITS[key]
                  return (
                    <div key={key} className="spring-param-row">
                      <div className="param-label-row">
                        <span className="param-name">{key[0].toUpperCase() + key.slice(1)}</span>
                        <span className="param-value">{spring[key]}</span>
                      </div>
                      <input
                        type="range"
                        min={min}
                        max={max}
                        step={key === 'mass' ? 0.1 : 1}
                        value={spring[key]}
                        onChange={e => updateSpringParam(key, parseFloat(e.target.value))}
                        className="smart-animate-slider"
                      />
                    </div>
                  )
                })}
              </div>

              {/* Analytics */}
              <div className="physics-metrics-grid">
                <div className="metric-cell">
                  <span className="metric-label">Settling Time</span>
                  <span className="metric-num">{metrics.duration}ms</span>
                </div>
                <div className="metric-cell">
                  <span className="metric-label">Damping Ratio (ζ)</span>
                  <span className="metric-num">{metrics.dampingRatio}</span>
                </div>
                <div className="metric-cell">
                  <span className="metric-label">Frequency (ω₀)</span>
                  <span className="metric-num">{metrics.undampedFrequency} rad/s</span>
                </div>
                <div className="metric-cell">
                  <span className="metric-label">Overshoot</span>
                  <span className="metric-num">{metrics.overshootPercent}%</span>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'pad' && (
            <div className="smart-touchpad-container">
              <span className="panel-caption">INTERACTIVE MICRO-INTERACTION SPRING PAD</span>
              <p className="touchpad-hint">Drag and release the blueprint puck to feel physical spring dynamics in real time.</p>
              <div
                className="touchpad-area"
                onPointerDown={onPuckDown}
                onPointerMove={onPuckMove}
                onPointerUp={onPuckUp}
                onPointerCancel={onPuckUp}
              >
                <div className="touchpad-grid" />
                <div className="touchpad-crosshair" />
                {/* Tension vector line */}
                <svg className="touchpad-vector-svg">
                  <line
                    x1="50%"
                    y1="50%"
                    x2={`calc(50% + ${puckPos.x}px)`}
                    y2={`calc(50% + ${puckPos.y}px)`}
                    stroke="#81adec"
                    strokeWidth="1.5"
                    strokeDasharray="3 3"
                  />
                </svg>
                <div
                  className="touchpad-puck"
                  style={{
                    transform: `translate(${puckPos.x}px, ${puckPos.y}px)`,
                  }}
                >
                  <span className="puck-core" />
                </div>
              </div>
              {(() => {
                const puckDist = Math.hypot(puckPos.x, puckPos.y)
                const pullT = Math.min(1, puckDist / 50)
                const currentMorphD = morphPreviewPair ? interpolateSmartPath(morphPreviewPair, pullT) : null
                if (!currentMorphD) return null
                return (
                  <div className="touchpad-morph-preview" style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, padding: '8px 10px', background: '#222222', borderRadius: 6, border: '1px solid #2e2e2e' }}>
                    <svg width="36" height="36" viewBox="0 0 44 44" style={{ flexShrink: 0 }}>
                      <path d={currentMorphD} fill="#81adec22" stroke="#81adec" strokeWidth="1.5" />
                    </svg>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontSize: 10, fontWeight: 500, color: '#edebe1' }}>Spring-Morph Restitution</span>
                      <span style={{ fontSize: 9, color: '#888' }}>Tension: {Math.round(pullT * 100)}% · Physical harmonic restore</span>
                    </div>
                  </div>
                )
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
