import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent, RefObject } from 'react'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  Copy,
  Download,
  Eye,
  EyeOff,
  Frame,
  Image as ImageIcon,
  PenTool,
  Play,
  Pause,
  Plus,
  Repeat2,
  RotateCcw,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  Type,
  X,
} from 'lucide-react'
import type { SceneStore } from '../scene/store.ts'
import type { SceneElement } from '../scene/types.ts'
import { useScene } from '../scene/useScene.ts'
import { downloadFile } from '../io/project.ts'
import { EasingEditor } from './EasingEditor.tsx'
import {
  addKeyframeAtTime,
  createTrack,
  deleteKeyframeFromTrack,
  duplicateKeyframeInTrack,
  EMPTY_MOTION,
  formatTime,
  getElementPropertyValue,
  isShaderProperty,
  isTypographyProperty,
  patchKeyframe,
  PROPERTY_META,
  trackValue,
} from './model.ts'
import { exportMotion, type ExportFormat } from './export.ts'
import { useMotionPlayback } from './useMotionPlayback.ts'
import type { MotionEasing, MotionKeyframe, MotionProperty, MotionTrack } from './types.ts'
import './motion.css'

function LayerIcon({ type, size = 12 }: { type: SceneElement['type']; size?: number }) {
  switch (type) {
    case 'frame': return <Frame size={size} />
    case 'rectangle': return <Square size={size} />
    case 'ellipse': return <Circle size={size} />
    case 'text': return <Type size={size} />
    case 'path': return <PenTool size={size} />
    case 'image': return <ImageIcon size={size} />
  }
}

export function MotionDrawer({
  store,
  stage,
  onClose,
}: {
  store: SceneStore
  stage: RefObject<HTMLElement | null>
  onClose: () => void
}) {
  const motion = useScene(store, state => state.motion) ?? EMPTY_MOTION
  const elements = useScene(store, state => state.elements)
  const selection = useScene(store, state => state.selection)

  const [active, setActive] = useState<{ trackId: string; keyId: string } | null>(null)
  const [selectedLayerId, setSelectedLayerId] = useState<string>('')
  const [property, setProperty] = useState<MotionProperty>('x')
  const loop = motion.loop ?? false
  const [format, setFormat] = useState<ExportFormat>('framer')
  const [exportOpen, setExportOpen] = useState(false)
  const [notice, setNotice] = useState('')

  const {
    playing,
    preview,
    time,
    currentTimeMs,
    playbackRate,
    setPlaybackRate,
    root,
    readout,
    scrubber,
    seek,
    toggle,
    restore,
    stepFrame,
    jumpKeyframe,
    setLooping,
  } = useMotionPlayback(motion, elements, stage)
  const gesture = useRef(false)
  const keyDrag = useRef<{ trackId: string; keyId: string; lane: HTMLElement } | null>(null)

  const begin = useCallback(() => {
    if (!gesture.current && !store.getHistorySnapshot().active) {
      store.beginTransaction('Edit motion curve')
      gesture.current = true
    }
  }, [store])

  const end = useCallback(() => {
    if (gesture.current) {
      gesture.current = false
      store.endTransaction()
    }
  }, [store])

  useEffect(() => () => {
    if (gesture.current) store.endTransaction()
  }, [store])

  const effectiveLayerId =
    selection.length > 0 && elements[selection[0]]
      ? selection[0]
      : selectedLayerId && elements[selectedLayerId]
        ? selectedLayerId
        : Object.keys(elements)[0] ?? ''

  const track = motion.tracks.find(item => item.id === active?.trackId)
  const key = track?.keyframes.find(item => item.id === active?.keyId)
  const activeIndex = track?.keyframes.findIndex(item => item.id === key?.id) ?? -1

  // Filter available layers for adding tracks
  const availableLayerIds = useMemo(() => {
    const list = Object.keys(elements).filter(id => !store.isLocked(id) && store.isVisible(id))
    return list.sort((a, b) => {
      const aSel = selection.includes(a) ? -1 : 1
      const bSel = selection.includes(b) ? -1 : 1
      return aSel - bSel
    })
  }, [elements, store, selection])

  const currentLayer = elements[effectiveLayerId] ?? (availableLayerIds[0] ? elements[availableLayerIds[0]] : null)
  const currentLayerHasShader = !!currentLayer?.style.shader

  const canAddSelectedProperty =
    !!currentLayer &&
    !motion.tracks.some(item => item.elementId === currentLayer.id && item.property === property) &&
    motion.tracks.length < 200 &&
    (!isShaderProperty(property) || currentLayerHasShader) &&
    (!isTypographyProperty(property) || currentLayer.type === 'text')

  const updateTrack = (next: MotionTrack) => {
    store.setMotion({
      ...motion,
      tracks: motion.tracks.map(item => (item.id === next.id ? next : item)),
    })
  }

  const updateKey = (patch: Partial<MotionKeyframe>) => {
    if (track && key) {
      updateTrack(patchKeyframe(track, key.id, patch))
    }
  }

  const updateEasing = useCallback(
    (easing: MotionEasing) => {
      const current = store.getSnapshot().motion
      if (!current || !active) return
      store.setMotion({
        ...current,
        tracks: current.tracks.map(item =>
          item.id === active.trackId ? patchKeyframe(item, active.keyId, { easing }) : item
        ),
      })
    },
    [store, active]
  )

  const handleAddTrack = (targetElementId: string, prop: MotionProperty) => {
    if (motion.tracks.length >= 200) return
    const targetElement = elements[targetElementId]
    if (!targetElement) return
    if (motion.tracks.some(t => t.elementId === targetElementId && t.property === prop)) return

    const newTrack = createTrack(targetElementId, prop, motion.duration, targetElement)
    store.setMotion(
      {
        ...motion,
        tracks: [...motion.tracks, newTrack],
      },
      `Add motion track ${PROPERTY_META[prop].label}`
    )
    setActive({ trackId: newTrack.id, keyId: newTrack.keyframes[0].id })
  }

  const handleAddKeyframeAtPlayhead = () => {
    if (!track) {
      setNotice('Select a track to add a keyframe.')
      return
    }
    const result = addKeyframeAtTime(track, time.current)
    if (!result) {
      setNotice('Playhead is too close to an existing keyframe or track limit reached.')
      return
    }
    updateTrack(result.track)
    setActive({ trackId: track.id, keyId: result.keyframeId })
    setNotice('')
  }

  const handleDuplicateKeyframe = () => {
    if (!track || !key) return
    const result = duplicateKeyframeInTrack(track, key.id, motion.duration, 150)
    if (!result) {
      setNotice('Cannot duplicate keyframe: no free time slot found.')
      return
    }
    updateTrack(result.track)
    setActive({ trackId: track.id, keyId: result.newKeyId })
    seek(result.track.keyframes.find(k => k.id === result.newKeyId)?.time ?? key.time)
    setNotice('Keyframe duplicated.')
  }

  const handleDeleteKeyframe = () => {
    if (!track || !key || track.keyframes.length <= 2) return
    const nextTrack = deleteKeyframeFromTrack(track, key.id)
    if (nextTrack) {
      updateTrack(nextTrack)
      const remainingKey = nextTrack.keyframes[0]
      setActive({ trackId: track.id, keyId: remainingKey.id })
    }
  }

  const handleCaptureCurrentValue = () => {
    if (!track || !key) return
    const element = elements[track.elementId]
    if (!element) return
    const val = getElementPropertyValue(element, track.property)
    updateKey({ value: Number(val.toFixed(3)) })
    setNotice(`Captured current design value (${val}${PROPERTY_META[track.property].unit}).`)
  }

  const dragKey = (event: PointerEvent) => {
    const drag = keyDrag.current
    if (!drag) return
    const current = store.getSnapshot().motion!
    const item = current.tracks.find(i => i.id === drag.trackId)!
    const index = item.keyframes.findIndex(i => i.id === drag.keyId)
    const rect = drag.lane.getBoundingClientRect()
    const min = index > 0 ? item.keyframes[index - 1].time + 1 : 0
    const max = index < item.keyframes.length - 1 ? item.keyframes[index + 1].time - 1 : current.duration

    const step = event.shiftKey ? 1 : 10
    const rawTime = ((event.clientX - rect.left) / rect.width) * current.duration
    const time = Math.max(min, Math.min(max, Math.round(rawTime / step) * step))

    store.setMotion({
      ...current,
      tracks: current.tracks.map(t => (t.id === item.id ? patchKeyframe(t, drag.keyId, { time }) : t)),
    })
    seek(time)
  }

  // Quick Starter Templates for Empty State
  const applyStarterTemplate = (type: 'position' | 'scale-fade' | 'shader' | 'kinetic-typography') => {
    const targetId = currentLayer?.id ?? availableLayerIds[0]
    if (!targetId || !elements[targetId]) return

    const targetElem = elements[targetId]
    const created: MotionTrack[] = []

    if (type === 'position') {
      if (!motion.tracks.some(t => t.elementId === targetId && t.property === 'x')) {
        created.push(createTrack(targetId, 'x', motion.duration, targetElem))
      }
      if (!motion.tracks.some(t => t.elementId === targetId && t.property === 'y')) {
        created.push(createTrack(targetId, 'y', motion.duration, targetElem))
      }
    } else if (type === 'scale-fade') {
      if (!motion.tracks.some(t => t.elementId === targetId && t.property === 'scale')) {
        created.push(createTrack(targetId, 'scale', motion.duration, targetElem))
      }
      if (!motion.tracks.some(t => t.elementId === targetId && t.property === 'opacity')) {
        created.push(createTrack(targetId, 'opacity', motion.duration, targetElem))
      }
    } else if (type === 'shader') {
      if (!motion.tracks.some(t => t.elementId === targetId && t.property === 'shaderScale')) {
        created.push(createTrack(targetId, 'shaderScale', motion.duration, targetElem))
      }
      if (!motion.tracks.some(t => t.elementId === targetId && t.property === 'shaderSpeed')) {
        created.push(createTrack(targetId, 'shaderSpeed', motion.duration, targetElem))
      }
    } else if (type === 'kinetic-typography') {
      if (targetElem.type === 'text') {
        if (!motion.tracks.some(t => t.elementId === targetId && t.property === 'fontWeight')) {
          created.push(createTrack(targetId, 'fontWeight', motion.duration, targetElem))
        }
        if (!motion.tracks.some(t => t.elementId === targetId && t.property === 'fontWidth')) {
          created.push(createTrack(targetId, 'fontWidth', motion.duration, targetElem))
        }
        if (!motion.tracks.some(t => t.elementId === targetId && t.property === 'letterSpacing')) {
          created.push(createTrack(targetId, 'letterSpacing', motion.duration, targetElem))
        }
        if (!motion.tracks.some(t => t.elementId === targetId && t.property === 'kineticPhase')) {
          created.push(createTrack(targetId, 'kineticPhase', motion.duration, targetElem))
        }
      }
    }

    if (created.length > 0) {
      store.setMotion({ ...motion, tracks: [...motion.tracks, ...created] }, 'Apply motion template')
      setActive({ trackId: created[0].id, keyId: created[0].keyframes[0].id })
    }
  }

  // Group tracks by layer
  const tracksByLayer = useMemo(() => {
    const map = new Map<string, MotionTrack[]>()
    for (const t of motion.tracks) {
      const list = map.get(t.elementId) ?? []
      list.push(t)
      map.set(t.elementId, list)
    }
    return map
  }, [motion.tracks])

  const code = useMemo(
    () => exportOpen ? exportMotion(motion, elements, format) : '',
    [exportOpen, motion, elements, format],
  )
  const formattedTime = formatTime(currentTimeMs)

  return (
    <section
      ref={root}
      className="motion-drawer viewport-ui"
      aria-label="Motion timeline"
      data-testid="motion-drawer"
      tabIndex={0}
      onKeyDown={event => {
        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey ||
          (event.target as Element).closest('input, textarea, select, [contenteditable="true"]')) {
          return
        }
        if (event.code === 'Space') {
          event.preventDefault()
          toggle()
        } else if (event.key === 'Home' || event.key === '0') {
          event.preventDefault()
          seek(0)
        } else if (event.key === 'ArrowLeft' && !keyDrag.current) {
          event.preventDefault()
          stepFrame(-1)
        } else if (event.key === 'ArrowRight' && !keyDrag.current) {
          event.preventDefault()
          stepFrame(1)
        } else if (event.key === '[') {
          event.preventDefault()
          jumpKeyframe('prev')
        } else if (event.key === ']') {
          event.preventDefault()
          jumpKeyframe('next')
        } else if (event.key === 'Delete' || event.key === 'Backspace') {
          if (track && key && track.keyframes.length > 2) {
            event.preventDefault()
            handleDeleteKeyframe()
          }
        } else if (event.key === 'Escape') {
          end()
          onClose()
        }
      }}
    >
      <header className="motion-header">
        <span className="motion-title">
          <SlidersHorizontal size={14} />
          Motion
          <span className="motion-badge">SEQUENCER</span>
        </span>

        <div className="motion-transport" role="toolbar" aria-label="Playback transport controls">
          <button
            type="button"
            aria-label="Rewind to start (Home)"
            title="Rewind to 0s (Home)"
            onClick={() => seek(0)}
          >
            <SkipBack size={12} />
          </button>
          <button
            type="button"
            aria-label="Step back 1 frame (Left Arrow)"
            title="Step back 1 frame (←)"
            onClick={() => stepFrame(-1)}
          >
            <ChevronLeft size={13} />
          </button>
          <button
            type="button"
            className="motion-play"
            aria-label={playing ? 'Pause motion (Space)' : 'Play motion (Space)'}
            title={playing ? 'Pause (Space)' : 'Play (Space)'}
            disabled={!motion.tracks.some(t => t.enabled)}
            onClick={toggle}
          >
            {playing ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
          </button>
          <button
            type="button"
            aria-label="Step forward 1 frame (Right Arrow)"
            title="Step forward 1 frame (→)"
            onClick={() => stepFrame(1)}
          >
            <ChevronRight size={13} />
          </button>
          <button
            type="button"
            aria-label="Jump to end"
            title="Jump to end"
            onClick={() => seek(motion.duration)}
          >
            <SkipForward size={12} />
          </button>
          <div className="motion-time-display">
            <output ref={readout} aria-label="Motion current time">
              {formattedTime.seconds}
            </output>
            <span className="motion-frame-counter">{formattedTime.frames}</span>
          </div>
          <button
            type="button"
            aria-label="Loop motion"
            aria-pressed={loop}
            title={`Loop playback: ${loop ? 'ON' : 'OFF'}`}
            onClick={() => {
              const nextLoop = !loop
              setLooping(nextLoop)
              store.setMotion({ ...motion, loop: nextLoop })
            }}
          >
            <Repeat2 size={13} />
          </button>
          <select
            className="motion-rate-select"
            aria-label="Playback rate"
            value={playbackRate}
            onChange={e => setPlaybackRate(Number(e.target.value))}
            title="Playback speed"
          >
            <option value={0.25}>0.25×</option>
            <option value={0.5}>0.5×</option>
            <option value={1}>1.0×</option>
            <option value={2}>2.0×</option>
          </select>
        </div>

        <label className="motion-duration">
          Duration
          <input
            aria-label="Motion duration milliseconds"
            type="number"
            min={Math.max(100, ...motion.tracks.flatMap(t => t.keyframes.map(k => k.time)))}
            max="30000"
            step="100"
            value={motion.duration}
            onChange={event => {
              const dur = event.currentTarget.valueAsNumber
              if (
                Number.isFinite(dur) &&
                dur >= 100 &&
                dur <= 30000 &&
                motion.tracks.every(t => t.keyframes.every(k => k.time <= dur))
              ) {
                store.setMotion({ ...motion, duration: dur })
              }
            }}
          />
          <span>ms</span>
        </label>

        {preview && (
          <button
            type="button"
            className="motion-restore"
            onClick={restore}
            title="Restore canvas to design geometry & clear preview"
          >
            <RotateCcw size={12} />
            Restore design
          </button>
        )}

        <button
          type="button"
          className="motion-export-button"
          aria-expanded={exportOpen}
          onClick={() => setExportOpen(!exportOpen)}
        >
          <Download size={13} />
          Export code
        </button>

        <button type="button" aria-label="Close motion timeline" onClick={() => { end(); onClose() }}>
          <X size={15} />
        </button>
      </header>

      <div className="motion-body">
        <div className="motion-tracks-panel">
          <div className="motion-track-tools">
            <span className="motion-track-count">
              {motion.tracks.length.toString().padStart(2, '0')} TRACKS
            </span>

            {/* Target layer selection */}
            <select
              aria-label="Target layer for new track"
              className="motion-layer-select"
              value={effectiveLayerId}
              onChange={event => {
                setSelectedLayerId(event.target.value)
                store.select([event.target.value])
              }}
              title="Target layer"
            >
              {availableLayerIds.map(id => (
                <option key={id} value={id}>
                  {elements[id]?.name} {elements[id]?.style.shader ? '✦' : ''}
                </option>
              ))}
            </select>

            {/* Target property selection with shader grouping */}
            <select
              aria-label="Motion property to add"
              className="motion-property-select"
              value={property}
              onChange={event => setProperty(event.target.value as MotionProperty)}
            >
              <optgroup label="Transform & Opacity">
                <option value="x">Translate X</option>
                <option value="y">Translate Y</option>
                <option value="rotation">Rotation</option>
                <option value="scale">Scale</option>
                <option value="opacity">Opacity</option>
              </optgroup>
              <optgroup label={`Shader Material ${currentLayerHasShader ? '(Active)' : '(Requires Shader)'}`}>
                <option value="shaderOpacity">Shader Opacity</option>
                <option value="shaderScale">Shader Scale</option>
                <option value="shaderRotation">Shader Rotation</option>
                <option value="shaderOffsetX">Shader Offset X</option>
                <option value="shaderOffsetY">Shader Offset Y</option>
                <option value="shaderSpeed">Shader Speed</option>
              </optgroup>
              <optgroup label={`Variable Typography & Kinetics ${currentLayer?.type === 'text' ? '(Active)' : '(Requires Text Layer)'}`}>
                <option value="fontWeight" disabled={currentLayer?.type !== 'text'}>Font Weight (wght)</option>
                <option value="fontWidth" disabled={currentLayer?.type !== 'text'}>Font Width (wdth)</option>
                <option value="fontSlant" disabled={currentLayer?.type !== 'text'}>Font Slant (slnt)</option>
                <option value="fontOpticalSize" disabled={currentLayer?.type !== 'text'}>Optical Size (opsz)</option>
                <option value="fontSize" disabled={currentLayer?.type !== 'text'}>Font Size</option>
                <option value="letterSpacing" disabled={currentLayer?.type !== 'text'}>Tracking</option>
                <option value="lineHeight" disabled={currentLayer?.type !== 'text'}>Line Height</option>
                <option value="textPathOffset" disabled={currentLayer?.type !== 'text'}>Text Path Offset</option>
                <option value="kineticPhase" disabled={currentLayer?.type !== 'text'}>Kinetic Phase</option>
                <option value="kineticAmplitude" disabled={currentLayer?.type !== 'text'}>Kinetic Amplitude</option>
                <option value="kineticRotation" disabled={currentLayer?.type !== 'text'}>Kinetic Rotation</option>
                <option value="kineticStagger" disabled={currentLayer?.type !== 'text'}>Kinetic Stagger</option>
                <option value="kineticWeightModulation" disabled={currentLayer?.type !== 'text'}>Kinetic Weight Mod</option>
                <option value="kineticSlantModulation" disabled={currentLayer?.type !== 'text'}>Kinetic Slant Mod</option>
                <option value="kineticScaleModulation" disabled={currentLayer?.type !== 'text'}>Kinetic Scale Mod</option>
              </optgroup>
            </select>

            <button
              type="button"
              disabled={!canAddSelectedProperty}
              onClick={() => {
                if (currentLayer) {
                  handleAddTrack(currentLayer.id, property)
                }
              }}
              title="Add property track to selected layer"
            >
              <Plus size={12} />
              Add Track
            </button>

            <button
              type="button"
              disabled={!track || track.keyframes.length >= 200}
              onClick={handleAddKeyframeAtPlayhead}
              title="Insert keyframe on active track at current playhead"
            >
              <Plus size={12} />
              Keyframe
            </button>
          </div>

          <div className="motion-track-scroll">
            <div className="motion-timeline-table">
              {/* Sticky Ruler */}
              <div className="motion-ruler-row">
                <div className="motion-layer-heading">LAYER / PROPERTY</div>
                <div
                  className="motion-ruler"
                  onPointerDown={event => {
                    const rect = event.currentTarget.getBoundingClientRect()
                    const time = Math.max(0, Math.min(motion.duration, ((event.clientX - rect.left) / rect.width) * motion.duration))
                    seek(time)
                  }}
                >
                  {Array.from({ length: 9 }, (_, i) => (
                    <span key={i} style={{ left: `${i * 12.5}%` }}>
                      {(motion.duration * i / 8000).toFixed(2)}s
                    </span>
                  ))}
                  <div className="motion-playhead" />
                  <input
                    ref={scrubber}
                    type="range"
                    min="0"
                    max={motion.duration}
                    step="1"
                    defaultValue="0"
                    aria-label="Motion playback scrubber"
                    onChange={event => seek(event.currentTarget.valueAsNumber)}
                  />
                </div>
              </div>

              {/* Grouped tracks by Layer */}
              {Array.from(tracksByLayer.entries()).map(([elementId, tracks]) => {
                const elem = elements[elementId]
                if (!elem) return null

                return (
                  <div key={elementId} className="motion-layer-group">
                    {/* Layer Header */}
                    <div className="motion-layer-header-row">
                      <div className="motion-layer-header-cell">
                        <LayerIcon type={elem.type} size={13} />
                        <span className="motion-layer-title" title={elem.name}>
                          {elem.name}
                        </span>
                        {elem.style.shader && (
                          <span className="motion-shader-tag" title="Layer has active shader material">
                            <Sparkles size={9} />
                            SHADER
                          </span>
                        )}
                        <span className="motion-track-badge">{tracks.length}</span>
                      </div>
                      <div className="motion-layer-header-lane" />
                    </div>

                    {/* Property Rows */}
                    {tracks.map(item => {
                      const meta = PROPERTY_META[item.property]
                      const isCurrent = track?.id === item.id
                      const liveVal = trackValue(item, currentTimeMs)
                      const isShader = isShaderProperty(item.property)
                      const isTypo = isTypographyProperty(item.property)

                      return (
                        <div
                          className={`motion-track-row ${isCurrent ? 'is-active' : ''}`}
                          key={item.id}
                        >
                          <div className="motion-track-label">
                            <button
                              type="button"
                              aria-label={`${item.enabled ? 'Mute' : 'Enable'} ${elem.name} ${meta.label}`}
                              title={item.enabled ? 'Mute track' : 'Enable track'}
                              onClick={() => updateTrack({ ...item, enabled: !item.enabled })}
                            >
                              {item.enabled ? <Eye size={12} /> : <EyeOff size={12} />}
                            </button>

                            <button
                              type="button"
                              className="motion-track-name"
                              onClick={() => {
                                setActive({ trackId: item.id, keyId: item.keyframes[0].id })
                                if (!store.isLocked(item.elementId)) store.select([item.elementId])
                              }}
                            >
                              <div className="motion-prop-name-row">
                                <span
                                  className={`motion-prop-kind-badge ${
                                    isShader ? 'is-shader' : isTypo ? 'is-typography' : 'is-transform'
                                  }`}
                                >
                                  {isShader ? 'SH' : isTypo ? 'TY' : 'TR'}
                                </span>
                                <strong>{meta.label}</strong>
                              </div>
                              <span className="motion-track-value-preview">
                                {liveVal.toFixed(meta.unit === '°' || meta.unit === 'px' ? 0 : 2)}
                                {meta.unit}
                              </span>
                            </button>

                            <button
                              type="button"
                              aria-label={`Remove ${elem.name} ${meta.label} track`}
                              title="Delete track"
                              onClick={() =>
                                store.setMotion(
                                  {
                                    ...motion,
                                    tracks: motion.tracks.filter(t => t.id !== item.id),
                                  },
                                  'Remove motion track'
                                )
                              }
                            >
                              <X size={11} />
                            </button>
                          </div>

                          <div
                            className={`motion-keyframe-lane ${!item.enabled ? 'is-muted' : ''}`}
                            onPointerDown={event => {
                              if (event.target === event.currentTarget) {
                                const rect = event.currentTarget.getBoundingClientRect()
                                seek(
                                  ((event.clientX - rect.left) / rect.width) * motion.duration
                                )
                              }
                            }}
                          >
                            {/* Segment bars between keyframes with easing indicator */}
                            {item.keyframes.slice(0, -1).map((k1, i) => {
                              const k2 = item.keyframes[i + 1]
                              const left = (k1.time / motion.duration) * 100
                              const width = ((k2.time - k1.time) / motion.duration) * 100
                              const isSpring = k1.easing.kind === 'spring'

                              return (
                                <div
                                  key={k1.id}
                                  className={`motion-segment ${isSpring ? 'is-spring' : 'is-bezier'}`}
                                  style={{ left: `${left}%`, width: `${width}%` }}
                                  title={`Segment: ${k1.time}ms → ${k2.time}ms · ${isSpring ? 'Spring physics' : 'Bézier curve'}`}
                                />
                              )
                            })}

                            {/* Keyframe Diamonds */}
                            {item.keyframes.map((frame, index) => {
                              const isSelected = key?.id === frame.id && track?.id === item.id

                              return (
                                <button
                                  type="button"
                                  key={frame.id}
                                  className={`motion-diamond ${isSelected ? 'is-selected' : ''}`}
                                  style={{ left: `${(frame.time / motion.duration) * 100}%` }}
                                  aria-label={`${elem.name} ${meta.label} keyframe ${index + 1}`}
                                  title={`${frame.time} ms · ${frame.value}${meta.unit} · Drag to retime (Shift for 1ms precision)`}
                                  onPointerDown={event => {
                                    event.preventDefault()
                                    event.currentTarget.setPointerCapture(event.pointerId)
                                    keyDrag.current = {
                                      trackId: item.id,
                                      keyId: frame.id,
                                      lane: event.currentTarget.parentElement!,
                                    }
                                    setActive({ trackId: item.id, keyId: frame.id })
                                    seek(frame.time)
                                    begin()
                                  }}
                                  onPointerMove={dragKey}
                                  onPointerUp={() => {
                                    keyDrag.current = null
                                    end()
                                  }}
                                  onPointerCancel={() => {
                                    keyDrag.current = null
                                    end()
                                  }}
                                  onLostPointerCapture={() => {
                                    keyDrag.current = null
                                    end()
                                  }}
                                  onClick={() => {
                                    setActive({ trackId: item.id, keyId: frame.id })
                                    seek(frame.time)
                                  }}
                                  onKeyDown={event => {
                                    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                                      event.preventDefault()
                                      const delta = (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 1 : 10)
                                      const targetTime = frame.time + delta
                                      const min = item.keyframes[index - 1]?.time ?? -1
                                      const max = item.keyframes[index + 1]?.time ?? Infinity
                                      if (targetTime >= 0 && targetTime <= motion.duration && targetTime > min && targetTime < max) {
                                        updateTrack(patchKeyframe(item, frame.id, { time: targetTime }))
                                        seek(targetTime)
                                      }
                                    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                                      event.preventDefault()
                                      const step = meta.step * (event.shiftKey ? 5 : 1)
                                      const delta = (event.key === 'ArrowUp' ? 1 : -1) * step
                                      const targetVal = Math.max(meta.min, Math.min(meta.max, Number((frame.value + delta).toFixed(3))))
                                      updateTrack(patchKeyframe(item, frame.id, { value: targetVal }))
                                    }
                                  }}
                                />
                              )
                            })}

                            <div className="motion-playhead" />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })}

              {!motion.tracks.length && (
                <div className="motion-empty">
                  <SlidersHorizontal size={24} />
                  <strong>Canvas Keyframe Motion Sequencer</strong>
                  <span>
                    Animate positions, scale, rotation, opacity, and WebGL shader parameters over time with smooth Bézier and spring easing.
                  </span>
                  <div className="motion-starter-templates">
                    <button
                      type="button"
                      className="motion-starter-btn"
                      onClick={() => applyStarterTemplate('position')}
                    >
                      <Plus size={11} />
                      Animate Position (X/Y)
                    </button>
                    <button
                      type="button"
                      className="motion-starter-btn"
                      onClick={() => applyStarterTemplate('scale-fade')}
                    >
                      <Plus size={11} />
                      Animate Scale & Opacity
                    </button>
                    <button
                      type="button"
                      className="motion-starter-btn"
                      onClick={() => applyStarterTemplate('shader')}
                    >
                      <Sparkles size={11} />
                      Animate Shader Params
                    </button>
                    {currentLayer?.type === 'text' && (
                      <button
                        type="button"
                        className="motion-starter-btn"
                        onClick={() => applyStarterTemplate('kinetic-typography')}
                      >
                        <Type size={11} />
                        Animate Kinetic Typography
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <footer className="motion-timeline-footer">
            <span className="motion-footer-notice">
              {notice ||
                (preview
                  ? 'Previewing motion · Click "Restore design" to return to original geometry'
                  : 'Drag diamond to retime (Shift for 1ms) · Space to play/pause · [ ] to jump keyframe')}
            </span>
            <span className="motion-footer-specs">
              120 Hz baked clock · {motion.duration / 1000}s ({Math.round((motion.duration / 1000) * 60)} frames @ 60fps)
            </span>
          </footer>
        </div>

        {/* Right Inspector Sidebar */}
        <aside className="motion-inspector" aria-label="Motion keyframe editor">
          {track && key ? (
            <>
              <div className="motion-inspector-heading">
                <div>
                  <span>
                    KEYFRAME {activeIndex + 1} / {track.keyframes.length}
                  </span>
                  <small>{PROPERTY_META[track.property].label}</small>
                </div>
                <div className="motion-key-actions">
                  <button
                    type="button"
                    title="Duplicate keyframe (+150ms)"
                    onClick={handleDuplicateKeyframe}
                  >
                    <Plus size={12} />
                  </button>
                  <button
                    type="button"
                    disabled={track.keyframes.length <= 2}
                    aria-label="Delete motion keyframe"
                    title={track.keyframes.length <= 2 ? 'Tracks require at least 2 keyframes' : 'Delete keyframe (Del)'}
                    onClick={handleDeleteKeyframe}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>

              <div className="motion-key-fields">
                <label className="motion-field">
                  Time · ms
                  <input
                    aria-label="Keyframe time milliseconds"
                    type="number"
                    min={track.keyframes[activeIndex - 1]?.time + 1 || 0}
                    max={track.keyframes[activeIndex + 1] ? track.keyframes[activeIndex + 1].time - 1 : motion.duration}
                    value={key.time}
                    onChange={event => {
                      const t = event.currentTarget.valueAsNumber
                      const min = track.keyframes[activeIndex - 1]?.time ?? -1
                      const max = track.keyframes[activeIndex + 1]?.time ?? Infinity
                      if (Number.isFinite(t) && t >= 0 && t <= motion.duration && t > min && t < max) {
                        updateKey({ time: t })
                        seek(t)
                      }
                    }}
                  />
                  <small className="motion-field-sub">{(key.time / 1000).toFixed(2)}s</small>
                </label>

                <label className="motion-field">
                  Value {PROPERTY_META[track.property].unit}
                  <input
                    aria-label="Keyframe value"
                    type="number"
                    step={PROPERTY_META[track.property].step}
                    min={PROPERTY_META[track.property].min}
                    max={PROPERTY_META[track.property].max}
                    value={key.value}
                    onChange={event => {
                      const val = event.currentTarget.valueAsNumber
                      const meta = PROPERTY_META[track.property]
                      if (Number.isFinite(val) && val >= meta.min && val <= meta.max) {
                        updateKey({ value: val })
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="motion-capture-btn"
                    title="Capture current layer design value into this keyframe"
                    onClick={handleCaptureCurrentValue}
                  >
                    Capture Canvas
                  </button>
                </label>
              </div>

              {/* Slider for intuitive value tweaking */}
              <div className="motion-value-slider-wrap">
                <input
                  type="range"
                  className="motion-value-slider"
                  min={PROPERTY_META[track.property].min}
                  max={PROPERTY_META[track.property].max}
                  step={PROPERTY_META[track.property].step}
                  value={key.value}
                  onChange={e => {
                    const val = Number(e.target.value)
                    updateKey({ value: val })
                  }}
                />
              </div>

              {activeIndex < track.keyframes.length - 1 ? (
                <EasingEditor
                  value={key.easing}
                  onChange={updateEasing}
                  onBegin={begin}
                  onEnd={end}
                />
              ) : (
                <div className="motion-end-hint">
                  <strong>End keyframe</strong>
                  <p>Select an earlier diamond to configure its outgoing curve easing.</p>
                </div>
              )}
            </>
          ) : (
            <div className="motion-inspector-empty">
              <SlidersHorizontal size={22} />
              <strong>Keyframe Inspector</strong>
              <span>Select a keyframe diamond on the timeline to shape its timing, value, and Bézier / spring curves.</span>
              <div className="motion-shortcuts-card">
                <div className="motion-shortcut-row">
                  <kbd>Space</kbd>
                  <span>Play / Pause</span>
                </div>
                <div className="motion-shortcut-row">
                  <kbd>Home</kbd>
                  <span>Rewind to 0s</span>
                </div>
                <div className="motion-shortcut-row">
                  <kbd>← / →</kbd>
                  <span>Step 1 frame</span>
                </div>
                <div className="motion-shortcut-row">
                  <kbd>[ / ]</kbd>
                  <span>Jump keyframe</span>
                </div>
                <div className="motion-shortcut-row">
                  <kbd>Shift + Drag</kbd>
                  <span>1ms precision</span>
                </div>
              </div>
            </div>
          )}
        </aside>
      </div>

      {exportOpen && (
        <div className="motion-export" role="dialog" aria-label="Export motion code">
          <div className="motion-export-header">
            <strong>Motion Sequencer → Code Export</strong>
            <select
              aria-label="Motion export format"
              value={format}
              onChange={event => setFormat(event.target.value as ExportFormat)}
            >
              <option value="lottie">Lottie Animation (Bodymovin .json)</option>
              <option value="animated-svg">Animated Vector SVG (.svg)</option>
              <option value="framer">Framer Motion (React)</option>
              <option value="css">CSS Keyframes (@keyframes)</option>
              <option value="waapi">Web Animations API (WAAPI)</option>
              <option value="json">Motion Document (JSON)</option>
            </select>
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(code)
                  setNotice('Code copied to clipboard.')
                } catch {
                  setNotice('Clipboard unavailable. Select the code or download it.')
                }
              }}
            >
              {notice === 'Code copied to clipboard.' ? <Check size={13} /> : <Copy size={13} />}
              Copy
            </button>
            <button
              type="button"
              onClick={() => {
                const ext = format === 'lottie' || format === 'json' ? 'json' : format === 'animated-svg' ? 'svg' : format === 'framer' ? 'tsx' : format === 'css' ? 'css' : 'ts'
                const mime = format === 'lottie' || format === 'json' ? 'application/json' : format === 'animated-svg' ? 'image/svg+xml' : 'text/plain'
                downloadFile(new Blob([code], { type: mime }), `paper-motion.${ext}`)
              }}
            >
              <Download size={13} />
              Download
            </button>
            <button type="button" aria-label="Close motion export" onClick={() => setExportOpen(false)}>
              <X size={14} />
            </button>
          </div>
          <p>
            Spring dynamics and cubic Bézier curves baked at 120 Hz. Position, rotation, scale, opacity, and WebGL shader uniforms modulate across time on a shared timeline.
          </p>
          <textarea readOnly aria-label="Exported motion code" value={code} spellCheck={false} />
          <span role="status">{notice}</span>
        </div>
      )}
    </section>
  )
}
