import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Play, RotateCcw } from 'lucide-react'
import type { BezierCurve } from '../prototype/types.ts'
import { SPRING_LIMITS, SPRING_PRESETS, springDuration, springProgress } from '../prototype/spring.ts'
import { computeSpringMetrics, easingProgress, MOTION_BEZIER_PRESETS } from './model.ts'
import type { MotionEasing } from './types.ts'

export const EasingEditor = memo(function EasingEditor({
  value,
  onChange,
  onBegin,
  onEnd,
}: {
  value: MotionEasing
  onChange: (easing: MotionEasing) => void
  onBegin: () => void
  onEnd: () => void
}) {
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<number | null>(null)
  const curve: BezierCurve = value.kind === 'bezier' ? value.curve : MOTION_BEZIER_PRESETS['ease-out'].curve

  const [puckPos, setPuckPos] = useState(1)
  const [testingBounce, setTestingBounce] = useState(false)
  const bounceTimer = useRef<number | null>(null)

  const path = useMemo(() => {
    return Array.from({ length: 181 }, (_, i) => {
      const p = i / 180
      const e = easingProgress(p, value)
      const x = 24 + p * 192
      const y = 140 - e * 96
      return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`
    }).join(' ')
  }, [value])

  const springMetrics = useMemo(() => {
    if (value.kind !== 'spring') return null
    return computeSpringMetrics(value.spring)
  }, [value])

  const peakPoint = useMemo(() => {
    if (value.kind !== 'spring' || !springMetrics || springMetrics.peakOvershootPercent <= 0) return null
    let maxE = 1
    let maxP = 0
    for (let i = 0; i <= 180; i++) {
      const p = i / 180
      const e = easingProgress(p, value)
      if (e > maxE) {
        maxE = e
        maxP = p
      }
    }
    if (maxE <= 1.005) return null
    return {
      x: 24 + maxP * 192,
      y: 140 - maxE * 96,
      overshoot: ((maxE - 1) * 100).toFixed(1),
    }
  }, [value, springMetrics])

  const setCoordinate = (index: number, num: number) => {
    const next = [...curve] as [number, number, number, number]
    const min = index % 2 ? -2 : 0
    const max = index % 2 ? 3 : 1
    next[index] = Number(Math.max(min, Math.min(max, num)).toFixed(3))
    onChange({ kind: 'bezier', curve: next })
  }

  const flipCurve = () => {
    const next: BezierCurve = [
      Number((1 - curve[2]).toFixed(3)),
      Number((1 - curve[3]).toFixed(3)),
      Number((1 - curve[0]).toFixed(3)),
      Number((1 - curve[1]).toFixed(3)),
    ]
    onChange({ kind: 'bezier', curve: next })
  }

  const triggerBounce = useCallback(() => {
    if (value.kind !== 'spring') return
    if (bounceTimer.current) cancelAnimationFrame(bounceTimer.current)
    setTestingBounce(true)
    setPuckPos(0)
    const duration = springDuration(value.spring)
    const start = performance.now()

    const tick = (now: number) => {
      const elapsed = now - start
      const p = Math.min(1, elapsed / duration)
      const val = springProgress(p, value.spring, duration)
      setPuckPos(val)
      if (p < 1) {
        bounceTimer.current = requestAnimationFrame(tick)
      } else {
        setTestingBounce(false)
        setPuckPos(1)
        bounceTimer.current = null
      }
    }
    bounceTimer.current = requestAnimationFrame(tick)
  }, [value])

  useEffect(() => {
    return () => {
      if (bounceTimer.current) cancelAnimationFrame(bounceTimer.current)
    }
  }, [])

  return (
    <div className="motion-easing-editor">
      <div className="motion-easing-tabs" role="group" aria-label="Segment easing type">
        <button
          type="button"
          aria-pressed={value.kind === 'bezier'}
          onClick={() => onChange({ kind: 'bezier', curve })}
        >
          Cubic Bézier
        </button>
        <button
          type="button"
          aria-pressed={value.kind === 'spring'}
          onClick={() => onChange({ kind: 'spring', spring: SPRING_PRESETS.bouncy.spring })}
        >
          Spring Physics
        </button>
      </div>

      <svg
        ref={svg}
        className="motion-curve"
        viewBox="0 0 240 184"
        aria-label={value.kind === 'spring' ? 'Motion spring response' : 'Interactive cubic Bézier graph'}
        role="group"
        onPointerMove={event => {
          if (drag.current === null || !svg.current) return
          const matrix = svg.current.getScreenCTM()?.inverse()
          if (!matrix) return
          const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix)
          const next = [...curve] as [number, number, number, number]
          next[drag.current * 2] = Number(Math.max(0, Math.min(1, (point.x - 24) / 192)).toFixed(3))
          next[drag.current * 2 + 1] = Number(Math.max(-2, Math.min(3, (140 - point.y) / 96)).toFixed(3))
          onChange({ kind: 'bezier', curve: next })
        }}
        onPointerUp={() => {
          if (drag.current !== null) {
            drag.current = null
            onEnd()
          }
        }}
        onPointerCancel={() => {
          if (drag.current !== null) {
            drag.current = null
            onEnd()
          }
        }}
        onLostPointerCapture={() => {
          if (drag.current !== null) {
            drag.current = null
            onEnd()
          }
        }}
      >
        <defs>
          <pattern id="motion-curve-grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M24 0H0V24" fill="none" stroke="currentColor" strokeWidth=".6" />
          </pattern>
          <clipPath id="motion-curve-clip">
            <rect x="8" y="2" width="224" height="176" />
          </clipPath>
        </defs>

        <rect x="24" y="20" width="192" height="144" fill="url(#motion-curve-grid)" className="motion-graph-grid" />
        <path d="M24 44H216M24 140H216M24 140L216 44" className="motion-graph-guide" />
        <path
          d={path}
          className={`motion-graph-line ${value.kind === 'spring' ? 'is-spring' : 'is-bezier'}`}
          clipPath="url(#motion-curve-clip)"
        />

        {value.kind === 'bezier' && (
          <>
            <path
              d={`M24 140L${(24 + curve[0] * 192).toFixed(1)} ${(140 - curve[1] * 96).toFixed(1)}M216 44L${(24 + curve[2] * 192).toFixed(1)} ${(140 - curve[3] * 96).toFixed(1)}`}
              className="motion-graph-handle-line"
            />
            {[0, 1].map(index => (
              <circle
                key={index}
                cx={(24 + curve[index * 2] * 192).toFixed(1)}
                cy={(140 - curve[index * 2 + 1] * 96).toFixed(1)}
                r="6"
                className="motion-graph-handle"
                tabIndex={0}
                role="button"
                aria-label={`Bézier control point ${index + 1}; arrow keys adjust, Shift for fine adjustment`}
                onPointerDown={event => {
                  event.preventDefault()
                  svg.current?.setPointerCapture(event.pointerId)
                  drag.current = index
                  onBegin()
                }}
                onKeyDown={event => {
                  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
                  event.preventDefault()
                  const vertical = event.key === 'ArrowUp' || event.key === 'ArrowDown'
                  const coord = index * 2 + (vertical ? 1 : 0)
                  const step = (event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 1) * (event.shiftKey ? 0.01 : 0.05)
                  setCoordinate(coord, curve[coord] + step)
                }}
              />
            ))}
          </>
        )}

        {value.kind === 'spring' && peakPoint && (
          <g className="motion-spring-peak-marker">
            <circle cx={peakPoint.x.toFixed(1)} cy={peakPoint.y.toFixed(1)} r="3.5" className="motion-spring-peak-dot" />
            <text x={Math.min(200, peakPoint.x + 5).toFixed(1)} y={Math.max(12, peakPoint.y - 4).toFixed(1)} className="motion-spring-peak-text">
              +{peakPoint.overshoot}%
            </text>
          </g>
        )}

        <circle cx="24" cy="140" r="3" className="motion-graph-end" />
        <circle cx="216" cy="44" r="3" className="motion-graph-end" />
        <text x="24" y="180">0%</text>
        <text x="184" y="180">TIME → 100%</text>
        <text x="218" y="47" className="motion-target-label">1.0</text>
        <text x="218" y="143" className="motion-target-label">0.0</text>
      </svg>

      {value.kind === 'bezier' ? (
        <>
          <div className="motion-field-row">
            <label className="motion-field">
              Preset
              <select
                aria-label="Motion Bézier preset"
                value={
                  Object.entries(MOTION_BEZIER_PRESETS).find(([, p]) =>
                    p.curve.every((v, i) => Math.abs(v - curve[i]) < 0.001)
                  )?.[0] ?? 'custom'
                }
                onChange={event => {
                  const preset = MOTION_BEZIER_PRESETS[event.target.value]
                  if (preset) onChange({ kind: 'bezier', curve: [...preset.curve] as BezierCurve })
                }}
              >
                <option value="custom">Custom Curve</option>
                {Object.entries(MOTION_BEZIER_PRESETS).map(([key, p]) => (
                  <option key={key} value={key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="motion-button-secondary"
              title="Invert curve direction"
              onClick={flipCurve}
            >
              Flip
            </button>
          </div>

          <div className="motion-quick-presets" role="group" aria-label="Bézier quick presets">
            {(['linear', 'ease-out', 'snappy', 'cinematic', 'overshoot', 'bounce'] as const).map(key => {
              const p = MOTION_BEZIER_PRESETS[key]
              if (!p) return null
              const isSelected = p.curve.every((v, i) => Math.abs(v - curve[i]) < 0.001)
              return (
                <button
                  key={key}
                  type="button"
                  className={`motion-preset-pill ${isSelected ? 'is-active' : ''}`}
                  onClick={() => onChange({ kind: 'bezier', curve: [...p.curve] as BezierCurve })}
                >
                  {p.label}
                </button>
              )
            })}
          </div>

          <div className="motion-bezier-fields">
            {(['x1', 'y1', 'x2', 'y2'] as const).map((label, i) => (
              <label className="motion-field" key={label}>
                {label}
                <input
                  type="number"
                  aria-label={`Motion Bézier ${label}`}
                  min={i % 2 ? -2 : 0}
                  max={i % 2 ? 3 : 1}
                  step="0.01"
                  value={curve[i]}
                  onChange={event => {
                    if (Number.isFinite(event.currentTarget.valueAsNumber)) {
                      setCoordinate(i, event.currentTarget.valueAsNumber)
                    }
                  }}
                />
              </label>
            ))}
          </div>
          <p className="motion-hint">Drag handles or use arrow keys · Y values overshoot for springy feel</p>
        </>
      ) : (
        <>
          <div className="motion-field-row">
            <label className="motion-field">
              Preset Feel
              <select
                aria-label="Motion spring preset"
                value={
                  Object.entries(SPRING_PRESETS).find(([, preset]) =>
                    Object.keys(SPRING_LIMITS).every(
                      key => preset.spring[key as keyof typeof preset.spring] === value.spring[key as keyof typeof value.spring]
                    )
                  )?.[0] ?? 'custom'
                }
                onChange={event => {
                  const preset = SPRING_PRESETS[event.target.value as keyof typeof SPRING_PRESETS]
                  if (preset) onChange({ kind: 'spring', spring: preset.spring })
                }}
              >
                <option value="custom">
                  Custom Feel
                </option>
                {Object.entries(SPRING_PRESETS).map(([key, preset]) => (
                  <option value={key} key={key}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="motion-button-secondary"
              title="Reset to default spring feel"
              onClick={() => onChange({ kind: 'spring', spring: SPRING_PRESETS.bouncy.spring })}
            >
              Reset
            </button>
          </div>

          <div className="motion-quick-presets" role="group" aria-label="Spring quick presets">
            {Object.entries(SPRING_PRESETS).map(([key, preset]) => {
              const isSelected = Object.keys(SPRING_LIMITS).every(
                k => preset.spring[k as keyof typeof preset.spring] === value.spring[k as keyof typeof value.spring]
              )
              return (
                <button
                  key={key}
                  type="button"
                  className={`motion-preset-pill ${isSelected ? 'is-active' : ''}`}
                  onClick={() => onChange({ kind: 'spring', spring: preset.spring })}
                >
                  {preset.label}
                </button>
              )
            })}
          </div>

          <div className="motion-physics-fields">
            {(Object.keys(SPRING_LIMITS) as (keyof typeof value.spring)[]).map(key => {
              const [min, max] = SPRING_LIMITS[key]
              const step = key === 'mass' ? 0.1 : 1
              return (
                <div key={key} className="motion-spring-field-item">
                  <label className="motion-field">
                    <div className="motion-spring-label-header">
                      <span className="motion-spring-param-title">{key}</span>
                      <span className="motion-spring-param-unit">
                        {key === 'stiffness' ? 'N/m' : key === 'damping' ? 'N·s/m' : 'kg'}
                      </span>
                    </div>
                    <input
                      type="number"
                      aria-label={`Motion spring ${key}`}
                      min={min}
                      max={max}
                      step={step}
                      value={value.spring[key]}
                      onChange={event => {
                        const n = event.currentTarget.valueAsNumber
                        if (Number.isFinite(n) && n >= min && n <= max) {
                          onChange({ kind: 'spring', spring: { ...value.spring, [key]: n } })
                        }
                      }}
                    />
                  </label>
                  <input
                    type="range"
                    className="motion-spring-slider"
                    aria-label={`Motion spring ${key} slider`}
                    min={min}
                    max={max}
                    step={step}
                    value={value.spring[key]}
                    onPointerDown={event => {
                      event.currentTarget.setPointerCapture(event.pointerId)
                      onBegin()
                    }}
                    onPointerUp={onEnd}
                    onPointerCancel={onEnd}
                    onLostPointerCapture={onEnd}
                    onChange={event => {
                      const n = Number(event.target.value)
                      if (Number.isFinite(n) && n >= min && n <= max) {
                        onChange({ kind: 'spring', spring: { ...value.spring, [key]: n } })
                      }
                    }}
                  />
                </div>
              )
            })}
          </div>

          {springMetrics && (
            <div className="motion-spring-telemetry">
              <div className="motion-telemetry-col">
                <span className="motion-telemetry-label">Damping (ζ)</span>
                <span className="motion-telemetry-val">{springMetrics.dampingRatio}</span>
                <small className="motion-telemetry-desc">
                  {springMetrics.classification === 'underdamped'
                    ? 'Underdamped'
                    : springMetrics.classification === 'overdamped'
                    ? 'Overdamped'
                    : 'Critical'}
                </small>
              </div>
              <div className="motion-telemetry-col">
                <span className="motion-telemetry-label">Settle Time</span>
                <span className="motion-telemetry-val">{springMetrics.settleTimeMs} ms</span>
                <small className="motion-telemetry-desc">Natural quiet</small>
              </div>
              <div className="motion-telemetry-col">
                <span className="motion-telemetry-label">Overshoot</span>
                <span className="motion-telemetry-val">
                  {springMetrics.peakOvershootPercent > 0 ? `+${springMetrics.peakOvershootPercent}%` : '0%'}
                </span>
                <small className="motion-telemetry-desc">
                  {springMetrics.peakOvershootPercent > 0 ? 'Oscillating' : 'Direct'}
                </small>
              </div>
            </div>
          )}

          <div className="motion-bounce-tester">
            <div className="motion-bounce-track">
              <div
                className="motion-bounce-puck"
                style={{
                  left: `${Math.max(0, Math.min(100, puckPos * 100))}%`,
                }}
              />
              <div className="motion-bounce-target-line" title="Resting target (100%)" />
            </div>
            <button
              type="button"
              className="motion-bounce-btn"
              onClick={triggerBounce}
              title="Test dynamic spring response simulation"
            >
              {testingBounce ? <RotateCcw size={10} className="is-spinning" /> : <Play size={10} fill="currentColor" />}
              Test Bounce
            </button>
          </div>
        </>
      )}
    </div>
  )
})
