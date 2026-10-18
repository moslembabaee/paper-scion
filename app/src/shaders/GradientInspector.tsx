import { useState, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import {
  ArrowLeftRight,
  Circle,
  Compass,
  Cpu,
  Layers,
  Plus,
  RotateCw,
  Sparkles,
  Target,
  Trash2,
} from 'lucide-react'
import type { GradientPaint, GradientType } from '../scene/types'
import {
  GRADIENT_PRESETS,
  addGradientStop,
  freezeGradient,
  gradientToCSS,
  removeGradientStop,
  reverseGradientStops,
  updateGradientStop,
} from './gradient'
import {
  setActiveGradientStopId,
  useActiveGradientStopId,
} from './gradientState'

interface GradientInspectorProps {
  gradient: GradientPaint
  onChange: (gradient: GradientPaint) => void
  onLinkToShader?: (linked: boolean) => void
  onGestureStart?: () => boolean | void
  onGestureEnd?: (cancel: boolean) => void
  showShaderLinkToggle?: boolean
}

export function GradientInspector({
  gradient,
  onChange,
  onLinkToShader,
  onGestureStart,
  onGestureEnd,
  showShaderLinkToggle = true,
}: GradientInspectorProps) {
  const activeStopId = useActiveGradientStopId()
  const [hexInput, setHexInput] = useState('')
  const trackRef = useRef<HTMLDivElement>(null)
  const isDraggingStop = useRef<string | null>(null)

  const activeStop = gradient.stops.find(s => s.id === activeStopId) ?? gradient.stops[0]

  const update = (next: GradientPaint) => {
    onChange(freezeGradient(next))
  }

  const setType = (type: GradientType) => {
    update({
      ...gradient,
      type,
    })
  }

  const handleTrackPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !trackRef.current) return
    const rect = trackRef.current.getBoundingClientRect()
    const offset = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const { gradient: nextGrad, newStopId } = addGradientStop(gradient, offset)
    update(nextGrad)
    setActiveGradientStopId(newStopId)
  }

  const handleStopMarkerPointerDown = (e: ReactPointerEvent<HTMLButtonElement>, stopId: string) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setActiveGradientStopId(stopId)
    isDraggingStop.current = stopId
    onGestureStart?.()
  }

  const handleStopMarkerPointerMove = (e: ReactPointerEvent<HTMLButtonElement>, stopId: string) => {
    if (isDraggingStop.current !== stopId || !trackRef.current) return
    const rect = trackRef.current.getBoundingClientRect()
    const offset = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    update(updateGradientStop(gradient, stopId, { offset: Number(offset.toFixed(3)) }))
  }

  const handleStopMarkerPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (isDraggingStop.current) {
      isDraggingStop.current = null
      try { e.currentTarget.releasePointerCapture(e.pointerId) } catch {}
      onGestureEnd?.(false)
    }
  }

  return (
    <div className="gradient-inspector" data-testid="gradient-inspector">
      {/* Type Selector Tabs */}
      <div className="gradient-type-tabs" role="group" aria-label="Gradient Type">
        <button
          type="button"
          className={`gradient-type-tab ${gradient.type === 'linear' ? 'active' : ''}`}
          aria-pressed={gradient.type === 'linear'}
          onClick={() => setType('linear')}
        >
          <Layers size={12} />
          <span>Linear</span>
        </button>
        <button
          type="button"
          className={`gradient-type-tab ${gradient.type === 'radial' ? 'active' : ''}`}
          aria-pressed={gradient.type === 'radial'}
          onClick={() => setType('radial')}
        >
          <Circle size={12} />
          <span>Radial</span>
        </button>
        <button
          type="button"
          className={`gradient-type-tab ${gradient.type === 'angular' ? 'active' : ''}`}
          aria-pressed={gradient.type === 'angular'}
          onClick={() => setType('angular')}
        >
          <Compass size={12} />
          <span>Angular</span>
        </button>
      </div>

      {/* Preset Chips */}
      <div className="gradient-presets-strip">
        <span className="gradient-subheading">Craft Presets</span>
        <div className="gradient-preset-chips">
          {GRADIENT_PRESETS.map(preset => (
            <button
              key={preset.id}
              type="button"
              className="gradient-preset-chip"
              title={preset.name}
              onClick={() => {
                update({
                  ...gradient,
                  type: preset.type,
                  angle: preset.angle,
                  stops: preset.stops.map((s, idx) => ({
                    id: `stop-${idx}-${Date.now()}`,
                    offset: s.offset,
                    color: s.color,
                    opacity: 1,
                  })),
                })
              }}
            >
              <span
                className="gradient-preset-swatch"
                style={{
                  background: `linear-gradient(90deg, ${preset.stops.map(s => `${s.color} ${(s.offset * 100).toFixed(0)}%`).join(', ')})`,
                }}
              />
              <span className="gradient-preset-name">{preset.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Interactive Stop Bar Track */}
      <div className="gradient-track-section">
        <div className="gradient-track-header">
          <span className="gradient-subheading">Color Stops</span>
          <span className="gradient-stops-counter">{gradient.stops.length} / 16</span>
        </div>

        <div
          ref={trackRef}
          className="gradient-track-bar"
          style={{
            background: gradientToCSS({ ...gradient, type: 'linear', angle: 90 }),
          }}
          title="Click to add color stop"
          onPointerDown={handleTrackPointerDown}
        >
          {gradient.stops.map((stop, idx) => {
            const isSelected = stop.id === activeStop.id
            return (
              <button
                key={stop.id}
                type="button"
                className={`gradient-track-pin ${isSelected ? 'selected' : ''}`}
                style={{
                  left: `${(stop.offset * 100).toFixed(2)}%`,
                  backgroundColor: stop.color,
                }}
                aria-label={`Stop ${idx + 1}: ${stop.color} at ${Math.round(stop.offset * 100)}%`}
                onPointerDown={e => handleStopMarkerPointerDown(e, stop.id)}
                onPointerMove={e => handleStopMarkerPointerMove(e, stop.id)}
                onPointerUp={handleStopMarkerPointerUp}
              >
                <span className="gradient-pin-caret" />
              </button>
            )
          })}
        </div>
      </div>

      {/* Selected Color Stop Controls */}
      {activeStop && (
        <div className="gradient-active-stop-card">
          <div className="gradient-stop-card-row">
            <label className="gradient-color-field" title="Color swatch">
              <input
                type="color"
                aria-label="Stop color picker"
                value={activeStop.color.slice(0, 7)}
                onChange={e => {
                  update(updateGradientStop(gradient, activeStop.id, { color: e.target.value }))
                }}
              />
              <span className="gradient-swatch-box" style={{ background: activeStop.color }} />
            </label>

            <input
              type="text"
              className="gradient-hex-input"
              aria-label="Stop hex code"
              value={hexInput || activeStop.color.toUpperCase()}
              onFocus={() => setHexInput(activeStop.color.toUpperCase())}
              onChange={e => setHexInput(e.target.value)}
              onBlur={() => {
                if (/^#[\da-f]{6}$/i.test(hexInput)) {
                  update(updateGradientStop(gradient, activeStop.id, { color: hexInput.toLowerCase() }))
                }
                setHexInput('')
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') e.currentTarget.blur()
              }}
            />

            <div className="gradient-stop-actions">
              {gradient.stops.length < 16 && (
                <button
                  type="button"
                  className="quiet-button gradient-action-btn"
                  title="Add stop"
                  aria-label="Add stop"
                  onClick={() => {
                    const offset = Math.min(1, activeStop.offset + 0.1)
                    const { gradient: nextGrad, newStopId } = addGradientStop(gradient, offset)
                    update(nextGrad)
                    setActiveGradientStopId(newStopId)
                  }}
                >
                  <Plus size={13} />
                </button>
              )}
              {gradient.stops.length > 2 && (
                <button
                  type="button"
                  className="quiet-button gradient-action-btn"
                  title="Remove stop"
                  aria-label="Remove stop"
                  onClick={() => {
                    update(removeGradientStop(gradient, activeStop.id))
                    const remaining = gradient.stops.filter(s => s.id !== activeStop.id)
                    if (remaining.length > 0) setActiveGradientStopId(remaining[0].id)
                  }}
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          </div>

          <div className="gradient-slider-row">
            <span className="gradient-field-label">Offset</span>
            <input
              type="range"
              aria-label="Stop offset slider"
              min={0}
              max={100}
              step={1}
              value={Math.round(activeStop.offset * 100)}
              onChange={e => {
                update(updateGradientStop(gradient, activeStop.id, { offset: e.target.valueAsNumber / 100 }))
              }}
            />
            <span className="gradient-value-display">{Math.round(activeStop.offset * 100)}%</span>
          </div>

          <div className="gradient-slider-row">
            <span className="gradient-field-label">Opacity</span>
            <input
              type="range"
              aria-label="Stop opacity slider"
              min={0}
              max={100}
              step={1}
              value={Math.round((activeStop.opacity ?? 1) * 100)}
              onChange={e => {
                update(updateGradientStop(gradient, activeStop.id, { opacity: e.target.valueAsNumber / 100 }))
              }}
            />
            <span className="gradient-value-display">{Math.round((activeStop.opacity ?? 1) * 100)}%</span>
          </div>
        </div>
      )}

      {/* Angle, Focal & Spread Sliders */}
      <div className="gradient-geometry-section">
        <div className="gradient-slider-row">
          <div className="gradient-label-with-icon">
            <RotateCw size={11} />
            <span className="gradient-field-label">Angle</span>
          </div>
          <input
            type="range"
            aria-label="Gradient angle slider"
            min={0}
            max={360}
            step={1}
            value={Math.round(gradient.angle)}
            onChange={e => {
              update({ ...gradient, angle: e.target.valueAsNumber })
            }}
          />
          <span className="gradient-value-display">{Math.round(gradient.angle)}°</span>
          <button
            type="button"
            className="quiet-button gradient-reverse-btn"
            title="Reverse stops"
            aria-label="Reverse stops"
            onClick={() => update(reverseGradientStops(gradient))}
          >
            <ArrowLeftRight size={12} />
          </button>
        </div>

        <div className="gradient-slider-row">
          <div className="gradient-label-with-icon">
            <Sparkles size={11} />
            <span className="gradient-field-label">Spread</span>
          </div>
          <input
            type="range"
            aria-label="Gradient spread slider"
            min={10}
            max={300}
            step={5}
            value={Math.round(gradient.spread * 100)}
            onChange={e => {
              update({ ...gradient, spread: e.target.valueAsNumber / 100 })
            }}
          />
          <span className="gradient-value-display">{(gradient.spread * 100).toFixed(0)}%</span>
        </div>

        {gradient.type === 'radial' && (
          <div className="gradient-slider-row">
            <div className="gradient-label-with-icon">
              <Target size={11} />
              <span className="gradient-field-label">Focal point</span>
            </div>
            <input
              type="range"
              aria-label="Gradient focal length slider"
              min={0}
              max={200}
              step={5}
              value={Math.round(gradient.focalLength * 100)}
              onChange={e => {
                update({ ...gradient, focalLength: e.target.valueAsNumber / 100 })
              }}
            />
            <span className="gradient-value-display">{gradient.focalLength.toFixed(2)}</span>
          </div>
        )}

        {/* Center / Origin X and Y */}
        <div className="gradient-grid-2col">
          <div className="gradient-slider-row mini">
            <span className="gradient-field-label">Center X</span>
            <input
              type="range"
              aria-label="Center X slider"
              min={0}
              max={100}
              step={1}
              value={Math.round(gradient.origin.x * 100)}
              onChange={e => {
                update({
                  ...gradient,
                  origin: { ...gradient.origin, x: e.target.valueAsNumber / 100 },
                })
              }}
            />
            <span className="gradient-value-display">{Math.round(gradient.origin.x * 100)}%</span>
          </div>
          <div className="gradient-slider-row mini">
            <span className="gradient-field-label">Center Y</span>
            <input
              type="range"
              aria-label="Center Y slider"
              min={0}
              max={100}
              step={1}
              value={Math.round(gradient.origin.y * 100)}
              onChange={e => {
                update({
                  ...gradient,
                  origin: { ...gradient.origin, y: e.target.valueAsNumber / 100 },
                })
              }}
            />
            <span className="gradient-value-display">{Math.round(gradient.origin.y * 100)}%</span>
          </div>
        </div>

        {/* Dither & Smoothness */}
        <div className="gradient-grid-2col">
          <div className="gradient-slider-row mini" title="Anti-banding noise filter">
            <span className="gradient-field-label">Dither</span>
            <input
              type="range"
              aria-label="Dither slider"
              min={0}
              max={100}
              step={5}
              value={Math.round((gradient.dither ?? 0.25) * 100)}
              onChange={e => {
                update({
                  ...gradient,
                  dither: e.target.valueAsNumber / 100,
                })
              }}
            />
            <span className="gradient-value-display">{Math.round((gradient.dither ?? 0.25) * 100)}%</span>
          </div>
          <div className="gradient-slider-row mini" title="Hermite S-curve interpolation">
            <span className="gradient-field-label">Smooth</span>
            <input
              type="range"
              aria-label="Smoothness slider"
              min={0}
              max={100}
              step={5}
              value={Math.round((gradient.smoothness ?? 0.5) * 100)}
              onChange={e => {
                update({
                  ...gradient,
                  smoothness: e.target.valueAsNumber / 100,
                })
              }}
            />
            <span className="gradient-value-display">{Math.round((gradient.smoothness ?? 0.5) * 100)}%</span>
          </div>
        </div>
      </div>

      {/* Link into Paper WebGL Shaders Toggle */}
      {showShaderLinkToggle && (
        <div className="gradient-shader-link-section">
          <button
            type="button"
            className={`gradient-shader-link-btn ${gradient.linkToShader ? 'active' : ''}`}
            aria-pressed={!!gradient.linkToShader}
            onClick={() => {
              const nextLinked = !gradient.linkToShader
              update({ ...gradient, linkToShader: nextLinked })
              onLinkToShader?.(nextLinked)
            }}
          >
            <Cpu size={13} />
            <div className="gradient-shader-link-text">
              <span className="gradient-shader-link-title">Paper WebGL Shader</span>
              <span className="gradient-shader-link-desc">Hardware 300 ES GPU rendering & motion</span>
            </div>
            <span className={`gradient-link-badge ${gradient.linkToShader ? 'linked' : ''}`}>
              {gradient.linkToShader ? 'LINKED' : 'VECTOR'}
            </span>
          </button>
        </div>
      )}
    </div>
  )
}
