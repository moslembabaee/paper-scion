import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Plus,
  Repeat2,
  RotateCcw,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  Zap,
} from 'lucide-react'
import type { ViewportController } from '../canvas/ViewportController.ts'
import type { Point } from '../canvas/types.ts'
import type { SceneStore } from '../scene/store.ts'
import { useScene } from '../scene/useScene.ts'
import {
  addKeyframeAtTime,
  EMPTY_MOTION,
  formatTime,
  patchKeyframe,
} from './model.ts'
import {
  motionJumpKeyframe,
  motionRestore,
  motionSeek,
  motionSetLooping,
  motionStepFrame,
  motionToggle,
  setMotionActiveKey,
  useMotionState,
} from './motionState.ts'
import { computeElementTrajectory, snapToGrid, type TrajectoryKeyframeNode, type TrajectoryPathData } from './trajectory.ts'
import './motion.css'

export function MotionCanvasOverlay({
  store,
  controller,
  motionOpen = false,
  onToggleDrawer,
}: {
  store: SceneStore
  controller: ViewportController
  motionOpen?: boolean
  onToggleDrawer?: () => void
}) {
  const elements = useScene(store, state => state.elements)
  const selection = useScene(store, state => state.selection)
  const motion = useScene(store, state => state.motion) ?? EMPTY_MOTION
  const motionState = useMotionState()

  const [viewport, setViewport] = useState(() => controller.getSnapshot())
  const [hoveredKeyId, setHoveredKeyId] = useState<string | null>(null)
  const [draggedNode, setDraggedNode] = useState<{
    elementId: string
    node: TrajectoryKeyframeNode
    startX: number
    startY: number
    origOffX: number
    origOffY: number
    currentOffX: number
    currentOffY: number
  } | null>(null)

  const keyDragGesture = useRef(false)
  const overlayRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => controller.subscribe(setViewport), [controller])

  // Determine active elements to show trajectory for
  const activeElements = useMemo(() => {
    if (!motion.tracks.length) return []
    const trackElementIds = new Set(motion.tracks.filter(t => t.enabled).map(t => t.elementId))
    // If elements are selected, prioritize selected elements with tracks
    const selectedWithTracks = selection.filter(id => trackElementIds.has(id))
    if (selectedWithTracks.length > 0) {
      return selectedWithTracks.map(id => elements[id]).filter(Boolean)
    }
    // Otherwise if motionOpen, show trajectories for all animated elements (up to 4)
    if (motionOpen) {
      return Array.from(trackElementIds).slice(0, 4).map(id => elements[id]).filter(Boolean)
    }
    return []
  }, [motion.tracks, selection, motionOpen, elements])

  // Compute trajectories in world coordinates
  const trajectories = useMemo(() => {
    if (!motionState.showTrajectory || !activeElements.length) return []
    const result: TrajectoryPathData[] = []
    for (const elem of activeElements) {
      const traj = computeElementTrajectory(elem, motion, motionState.currentTimeMs, 80)
      if (traj) result.push(traj)
    }
    return result
  }, [activeElements, motion, motionState.currentTimeMs, motionState.showTrajectory])

  // Coordinate transforms: world to screen
  const toScreen = useCallback(
    (pt: { x: number; y: number }): Point => {
      const { camera } = viewport
      return {
        x: pt.x * camera.zoom + camera.x,
        y: pt.y * camera.zoom + camera.y,
      }
    },
    [viewport]
  )

  // Handle dragging keyframe handles on the canvas
  const handleKeyframePointerDown = (
    event: ReactPointerEvent,
    elemId: string,
    node: TrajectoryKeyframeNode
  ) => {
    event.stopPropagation()
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)

    if (!keyDragGesture.current && !store.getHistorySnapshot().active) {
      store.beginTransaction('Move motion keyframe on canvas')
      keyDragGesture.current = true
    }

    setDraggedNode({
      elementId: elemId,
      node,
      startX: event.clientX,
      startY: event.clientY,
      origOffX: node.offsetX,
      origOffY: node.offsetY,
      currentOffX: node.offsetX,
      currentOffY: node.offsetY,
    })

    if (node.trackIdX && node.keyIdX) {
      setMotionActiveKey(node.trackIdX, node.keyIdX, node.easing)
    } else if (node.trackIdY && node.keyIdY) {
      setMotionActiveKey(node.trackIdY, node.keyIdY, node.easing)
    }
    motionSeek(node.time)
  }

  const handleKeyframePointerMove = (event: ReactPointerEvent) => {
    if (!draggedNode) return
    event.stopPropagation()

    const { camera } = viewport
    const deltaScreenX = event.clientX - draggedNode.startX
    const deltaScreenY = event.clientY - draggedNode.startY
    const deltaWorldX = deltaScreenX / camera.zoom
    const deltaWorldY = deltaScreenY / camera.zoom

    let newOffX = draggedNode.origOffX + deltaWorldX
    let newOffY = draggedNode.origOffY + deltaWorldY

    // Snap to 120px grid unless Shift is held
    if (!event.shiftKey) {
      const elem = elements[draggedNode.elementId]
      if (elem) {
        const rawWorldX = elem.x + newOffX
        const rawWorldY = elem.y + newOffY
        const snappedWorldX = snapToGrid(rawWorldX, 120)
        const snappedWorldY = snapToGrid(rawWorldY, 120)
        newOffX = snappedWorldX - elem.x
        newOffY = snappedWorldY - elem.y
      }
    } else {
      newOffX = Math.round(newOffX)
      newOffY = Math.round(newOffY)
    }

    setDraggedNode(prev => (prev ? { ...prev, currentOffX: newOffX, currentOffY: newOffY } : null))

    // Update tracks in store
    const currentMotion = store.getSnapshot().motion
    if (!currentMotion) return

    let updatedTracks = currentMotion.tracks
    const { node } = draggedNode

    if (node.trackIdX && node.keyIdX) {
      const tX = updatedTracks.find(t => t.id === node.trackIdX)
      if (tX) {
        updatedTracks = updatedTracks.map(t =>
          t.id === tX.id ? patchKeyframe(t, node.keyIdX!, { value: Number(newOffX.toFixed(2)) }) : t
        )
      }
    }
    if (node.trackIdY && node.keyIdY) {
      const tY = updatedTracks.find(t => t.id === node.trackIdY)
      if (tY) {
        updatedTracks = updatedTracks.map(t =>
          t.id === tY.id ? patchKeyframe(t, node.keyIdY!, { value: Number(newOffY.toFixed(2)) }) : t
        )
      }
    }

    store.setMotion({ ...currentMotion, tracks: updatedTracks })
  }

  const handleKeyframePointerUp = (event: ReactPointerEvent) => {
    if (draggedNode) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId)
      } catch {}
      setDraggedNode(null)
      if (keyDragGesture.current) {
        keyDragGesture.current = false
        store.endTransaction()
      }
    }
  }

  // Quick insert keyframe at current playhead on canvas
  const handleQuickAddKeyframe = () => {
    const targetElementId = selection[0] || (motion.tracks[0]?.elementId ?? '')
    if (!targetElementId) return

    const tracks = motion.tracks.filter(t => t.elementId === targetElementId && t.enabled)
    if (!tracks.length) return

    let updatedTracks = motion.tracks
    let lastKeyId: string | undefined

    for (const track of tracks) {
      const res = addKeyframeAtTime(track, motionState.currentTimeMs)
      if (res) {
        updatedTracks = updatedTracks.map(t => (t.id === track.id ? res.track : t))
        lastKeyId = res.keyframeId
      }
    }

    if (lastKeyId) {
      store.setMotion({ ...motion, tracks: updatedTracks }, 'Add keyframe at playhead')
      setMotionActiveKey(tracks[0].id, lastKeyId, tracks[0].keyframes[0].easing)
    }
  }

  // Format current playback time
  const timeFormatted = formatTime(motionState.currentTimeMs)
  const isPlaying = motionState.playing
  const isLoop = motionState.loop || (motion.loop ?? false)

  // Find all keyframe timestamps across enabled tracks for scrubber notches
  const keyframeTimes = useMemo(() => {
    const set = new Set<number>()
    for (const t of motion.tracks) {
      if (t.enabled) {
        t.keyframes.forEach(k => set.add(k.time))
      }
    }
    return Array.from(set).sort((a, b) => a - b)
  }, [motion.tracks])

  // Active track and easing summary
  const activeTrack = motion.tracks.find(t => t.id === motionState.activeTrackId)
  const activeKey = activeTrack?.keyframes.find(k => k.id === motionState.activeKeyId)
  const currentEasing = activeKey?.easing ?? motionState.activeEasing

  const shouldRenderHud = motionOpen || motion.tracks.length > 0

  if (!shouldRenderHud && !trajectories.length) {
    return null
  }

  return (
    <div
      ref={overlayRef}
      className="motion-canvas-overlay viewport-ui"
      data-testid="motion-canvas-overlay"
      aria-label="Motion canvas overlay"
    >
      {/* 1. 2D Motion Trajectories & On-Canvas Keyframe Handles */}
      {trajectories.map(traj => {
        const elem = elements[traj.elementId]
        if (!elem) return null

        // Convert trajectory SVG samples to screen coordinates
        const screenSamples = traj.samples.map(s => toScreen({ x: s.worldX, y: s.worldY }))
        const screenPath = screenSamples
          .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
          .join(' ')

        const currentScreenPos = toScreen({
          x: traj.currentPosition.worldX,
          y: traj.currentPosition.worldY,
        })

        const overshootScreen = traj.overshootPeak
          ? toScreen({ x: traj.overshootPeak.worldX, y: traj.overshootPeak.worldY })
          : null

        return (
          <div key={traj.elementId} className="motion-trajectory-group">
            <svg
              className="motion-trajectory-svg"
              aria-hidden="true"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
                overflow: 'visible',
              }}
            >
              <defs>
                <linearGradient id={`traj-grad-${traj.elementId}`} x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#81adec" stopOpacity="0.85" />
                  <stop offset="100%" stopColor="#c084fc" stopOpacity="0.85" />
                </linearGradient>
                <filter id="motion-glow" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#81adec" floodOpacity="0.5" />
                </filter>
              </defs>

              {/* Trajectory Guide Shadow & Line */}
              <path
                d={screenPath}
                className="motion-trajectory-path-shadow"
                fill="none"
                stroke="rgba(8, 8, 8, 0.7)"
                strokeWidth="5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d={screenPath}
                className="motion-trajectory-path"
                fill="none"
                stroke={`url(#traj-grad-${traj.elementId})`}
                strokeWidth="2.5"
                strokeDasharray="5 3"
                strokeLinecap="round"
                strokeLinejoin="round"
                filter="url(#motion-glow)"
              />

              {/* Direction Indicator Dots along the Trajectory */}
              {screenSamples
                .filter((_, idx) => idx > 0 && idx < screenSamples.length - 1 && idx % 10 === 0)
                .map((pt, i) => (
                  <circle
                    key={i}
                    cx={pt.x}
                    cy={pt.y}
                    r="2"
                    fill="#81adec"
                    opacity="0.7"
                  />
                ))}

              {/* Spring Overshoot Arc Marker */}
              {overshootScreen && traj.overshootPeak && (
                <g className="motion-overshoot-marker">
                  <circle
                    cx={overshootScreen.x}
                    cy={overshootScreen.y}
                    r="6"
                    fill="none"
                    stroke="#fbbf24"
                    strokeWidth="1.5"
                    strokeDasharray="3 2"
                  />
                  <circle cx={overshootScreen.x} cy={overshootScreen.y} r="2.5" fill="#fbbf24" />
                </g>
              )}
            </svg>

            {/* Overshoot Telemetry Pill in Screen Space */}
            {overshootScreen && traj.overshootPeak && (
              <div
                className="motion-overshoot-badge"
                style={{
                  position: 'absolute',
                  left: overshootScreen.x + 10,
                  top: overshootScreen.y - 12,
                }}
              >
                <Zap size={10} />
                <span>Spring Peak +{traj.overshootPeak.percent}%</span>
              </div>
            )}

            {/* Interactive On-Canvas Keyframe Diamond Handles */}
            {traj.keyframeNodes.map((node, index) => {
              const screenPt = toScreen({ x: node.worldX, y: node.worldY })
              const isSelected =
                (node.trackIdX && node.trackIdX === motionState.activeTrackId && node.keyIdX === motionState.activeKeyId) ||
                (node.trackIdY && node.trackIdY === motionState.activeTrackId && node.keyIdY === motionState.activeKeyId)
              const isHovered = hoveredKeyId === node.id
              const isSpring = node.easing.kind === 'spring'

              return (
                <div
                  key={node.id}
                  className={`motion-canvas-key-handle ${isSelected ? 'is-selected' : ''} ${
                    isHovered ? 'is-hovered' : ''
                  }`}
                  style={{
                    position: 'absolute',
                    left: screenPt.x,
                    top: screenPt.y,
                  }}
                  onPointerEnter={() => setHoveredKeyId(node.id)}
                  onPointerLeave={() => setHoveredKeyId(null)}
                >
                  <button
                    type="button"
                    className={`motion-canvas-diamond ${isSpring ? 'is-spring' : 'is-bezier'}`}
                    aria-label={`Keyframe ${index + 1} at ${(node.time / 1000).toFixed(2)}s. Drag to reposition.`}
                    title={`Keyframe ${index + 1}: ${(node.time / 1000).toFixed(2)}s · X: ${Math.round(
                      node.offsetX
                    )}px, Y: ${Math.round(node.offsetY)}px · ${isSpring ? 'Spring physics' : 'Cubic Bézier'}`}
                    onPointerDown={e => handleKeyframePointerDown(e, elem.id, node)}
                    onPointerMove={handleKeyframePointerMove}
                    onPointerUp={handleKeyframePointerUp}
                    onPointerCancel={handleKeyframePointerUp}
                  />

                  {/* On-Canvas Timestamp Badge */}
                  <span className="motion-canvas-key-label">
                    K{index + 1} {(node.time / 1000).toFixed(2)}s
                  </span>

                  {/* Drag Coordinate Tooltip */}
                  {draggedNode?.node.id === node.id && (
                    <div className="motion-canvas-drag-hud">
                      <span>
                        X: {draggedNode.currentOffX > 0 ? `+${Math.round(draggedNode.currentOffX)}` : Math.round(draggedNode.currentOffX)}px
                      </span>
                      <span>
                        Y: {draggedNode.currentOffY > 0 ? `+${Math.round(draggedNode.currentOffY)}` : Math.round(draggedNode.currentOffY)}px
                      </span>
                      <small>120px Grid Snap</small>
                    </div>
                  )}
                </div>
              )
            })}

            {/* Current Playhead Puck Trajectory Cursor */}
            <div
              className={`motion-canvas-puck ${isPlaying ? 'is-playing' : ''}`}
              style={{
                position: 'absolute',
                left: currentScreenPos.x,
                top: currentScreenPos.y,
              }}
              title={`Playhead: ${(motionState.currentTimeMs / 1000).toFixed(2)}s · ${elem.name}`}
            >
              <div className="motion-puck-inner" />
              <div className="motion-puck-pulse" />
            </div>
          </div>
        )
      })}

      {/* 2. Floating On-Canvas Timeline Scrubber & Sequencer HUD */}
      {shouldRenderHud && (
        <aside
          className={`motion-canvas-hud ${motionState.drawerMinimized ? 'is-minimized' : ''}`}
          role="region"
          aria-label="Interactive Motion Timeline Scrubber"
          data-testid="motion-canvas-hud"
        >
          <div className="motion-hud-panel">
            {/* HUD Header & Drag Grip */}
            <div className="motion-hud-brand">
              <span className="motion-hud-tag">
                <SlidersHorizontal size={12} className="text-accent" />
                MOTION
              </span>
              <span className="motion-hud-fps">60 FPS · 120Hz</span>
            </div>

            {/* Transport Controls */}
            <div className="motion-hud-transport" role="toolbar" aria-label="Timeline transport">
              <button
                type="button"
                className="motion-hud-btn"
                title="Rewind to start (Home / 0)"
                aria-label="Rewind to start"
                onClick={() => motionSeek(0)}
              >
                <SkipBack size={12} />
              </button>

              <button
                type="button"
                className="motion-hud-btn"
                title="Step back 1 frame (←)"
                aria-label="Step back 1 frame"
                onClick={() => motionStepFrame(-1)}
              >
                <ChevronLeft size={13} />
              </button>

              <button
                type="button"
                className={`motion-hud-btn motion-hud-play ${isPlaying ? 'is-active' : ''}`}
                title={isPlaying ? 'Pause motion (Space)' : 'Play motion (Space)'}
                aria-label={isPlaying ? 'Pause motion' : 'Play motion'}
                onClick={motionToggle}
              >
                {isPlaying ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
              </button>

              <button
                type="button"
                className="motion-hud-btn"
                title="Step forward 1 frame (→)"
                aria-label="Step forward 1 frame"
                onClick={() => motionStepFrame(1)}
              >
                <ChevronRight size={13} />
              </button>

              <button
                type="button"
                className="motion-hud-btn"
                title="Jump to next keyframe (])"
                aria-label="Jump to next keyframe"
                onClick={() => motionJumpKeyframe('next')}
              >
                <SkipForward size={12} />
              </button>
            </div>

            {/* Digital Readout */}
            <div className="motion-hud-readout">
              <span className="motion-hud-time">{timeFormatted.seconds}</span>
              <span className="motion-hud-frames">{timeFormatted.frames}</span>
            </div>

            {/* Interactive Timeline Scrubber Slider with Keyframe Notches */}
            <div className="motion-hud-scrubber-track-wrap">
              <div
                className="motion-hud-scrubber-track"
                onPointerDown={event => {
                  const rect = event.currentTarget.getBoundingClientRect()
                  const percent = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
                  motionSeek(Math.round(percent * motion.duration))
                }}
              >
                {/* Progress Fill */}
                <div
                  className="motion-hud-scrubber-progress"
                  style={{
                    width: `${Math.max(0, Math.min(100, (motionState.currentTimeMs / Math.max(1, motion.duration)) * 100))}%`,
                  }}
                />

                {/* Keyframe tick notches */}
                {keyframeTimes.map(t => (
                  <div
                    key={t}
                    className="motion-hud-key-tick"
                    style={{ left: `${(t / Math.max(1, motion.duration)) * 100}%` }}
                    title={`Keyframe at ${(t / 1000).toFixed(2)}s`}
                  />
                ))}

                {/* Draggable thumb */}
                <input
                  type="range"
                  className="motion-hud-slider"
                  min="0"
                  max={motion.duration}
                  step="1"
                  value={motionState.currentTimeMs}
                  aria-label="Canvas timeline scrubber"
                  onChange={e => motionSeek(Number(e.target.value))}
                />
              </div>
            </div>

            {/* Spring / Bézier Easing Indicator Badge */}
            {currentEasing && (
              <div
                className={`motion-hud-easing-pill ${currentEasing.kind === 'spring' ? 'is-spring' : 'is-bezier'}`}
                title={
                  currentEasing.kind === 'spring'
                    ? `Spring Physics: Stiffness ${currentEasing.spring.stiffness}, Damping ${currentEasing.spring.damping}, Mass ${currentEasing.spring.mass}`
                    : `Cubic Bézier: [${currentEasing.curve.join(', ')}]`
                }
                onClick={onToggleDrawer}
              >
                {currentEasing.kind === 'spring' ? (
                  <>
                    <Zap size={11} className="text-accent" />
                    <span>Spring</span>
                    <small>{currentEasing.spring.stiffness}/{currentEasing.spring.damping}</small>
                  </>
                ) : (
                  <>
                    <Sparkles size={11} />
                    <span>Bézier</span>
                  </>
                )}
              </div>
            )}

            {/* Quick Add Keyframe */}
            <button
              type="button"
              className="motion-hud-btn"
              title="Add keyframe at current playhead (+)"
              aria-label="Add keyframe at current playhead"
              onClick={handleQuickAddKeyframe}
            >
              <Plus size={13} />
            </button>

            {/* Loop Toggle */}
            <button
              type="button"
              className={`motion-hud-btn ${isLoop ? 'is-active' : ''}`}
              title={`Loop playback: ${isLoop ? 'ON' : 'OFF'}`}
              aria-pressed={isLoop}
              aria-label="Toggle loop"
              onClick={() => motionSetLooping(!isLoop)}
            >
              <Repeat2 size={13} />
            </button>

            {/* Restore Design (if preview active) */}
            {motionState.preview && (
              <button
                type="button"
                className="motion-hud-btn motion-hud-restore"
                title="Restore canvas to design values"
                aria-label="Restore canvas to design values"
                onClick={motionRestore}
              >
                <RotateCcw size={12} />
              </button>
            )}

            {/* Drawer Expansion Toggle */}
            {onToggleDrawer && (
              <button
                type="button"
                className="motion-hud-btn motion-hud-expand"
                title={motionOpen ? 'Collapse sequencer drawer' : 'Open multi-track sequencer'}
                aria-label={motionOpen ? 'Collapse sequencer' : 'Expand sequencer'}
                onClick={onToggleDrawer}
              >
                {motionOpen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
              </button>
            )}
          </div>
        </aside>
      )}
    </div>
  )
}
