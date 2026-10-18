import { memo, useRef, useState } from 'react'
import type { SceneStore } from './store'
import type { TextElement, VariableFontAxes } from './types'
import type { SelectionBox } from './selectionGeometry'
import { Sliders, Sparkles, Spline, ChevronDown, ChevronUp, Plus, X, RotateCcw } from 'lucide-react'
import {
  VARIABLE_AXIS_PRESETS,
  getAxisMeta,
} from './typography'
import { DEFAULT_KINETIC } from './kineticGeometry'

interface CanvasTypographyScrubberProps {
  readonly node: TextElement
  readonly store: SceneStore
  readonly camera: { readonly x: number; readonly y: number; readonly zoom: number }
  readonly box: SelectionBox
}

interface DragState {
  readonly pointerId: number
  readonly axis: string
  readonly startX: number
  readonly initialVal: number
}

interface AxisConfig {
  readonly label: string
  readonly min: number
  readonly max: number
  readonly step: number
  readonly defaultVal: number
  readonly unit: string
  readonly sensitivity: number
}

function resolveAxisConfig(axis: string): AxisConfig {
  if (axis === 'offset') {
    return { label: 'PATH', min: 0, max: 100, step: 1, defaultVal: 0, unit: '%', sensitivity: 0.4 }
  }
  if (axis === 'phase') {
    return { label: 'PHASE', min: 0, max: 100, step: 1, defaultVal: 0, unit: '%', sensitivity: 0.4 }
  }
  if (axis === 'ampl') {
    return { label: 'AMPL', min: 0, max: 120, step: 1, defaultVal: 18, unit: 'px', sensitivity: 0.5 }
  }
  if (axis === 'track') {
    return { label: 'TRACK', min: -10, max: 30, step: 0.5, defaultVal: 0, unit: 'px', sensitivity: 0.5 }
  }

  const meta = getAxisMeta(axis)
  let sensitivity = 0.5
  if (meta.step < 0.1) sensitivity = 0.008
  else if (meta.step < 1) sensitivity = 0.06
  else if (meta.max - meta.min > 500) sensitivity = 1.5
  else if (meta.max - meta.min > 150) sensitivity = 0.8

  return {
    label: meta.tag.toUpperCase(),
    min: meta.min,
    max: meta.max,
    step: meta.step,
    defaultVal: meta.default,
    unit: meta.unit ?? '',
    sensitivity,
  }
}

const COMMON_EXTENDED_AXES = [
  { tag: 'grad', label: 'Grade (GRAD)' },
  { tag: 'casl', label: 'Casual (CASL)' },
  { tag: 'crsv', label: 'Cursive (CRSV)' },
  { tag: 'ital', label: 'Italic (ITAL)' },
  { tag: 'soft', label: 'Softness (SOFT)' },
  { tag: 'fill', label: 'Fill (FILL)' },
  { tag: 'xtra', label: 'Counter (XTRA)' },
] as const

export const CanvasTypographyScrubber = memo(function CanvasTypographyScrubber({
  node,
  store,
  camera,
  box,
}: CanvasTypographyScrubberProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [activeAxis, setActiveAxis] = useState<string | null>(null)
  const [dragDelta, setDragDelta] = useState<number>(0)
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [customTagInput, setCustomTagInput] = useState('')
  const dragRef = useRef<DragState | null>(null)

  const axes: VariableFontAxes = {
    wght: node.fontWeight,
    wdth: 100,
    slnt: 0,
    opsz: node.fontSize,
    ...(node.variableAxes ?? {}),
  }

  const getVal = (axis: string): number => {
    if (axis === 'offset') return node.textOnPath?.offset ?? 0
    if (axis === 'phase') return Math.round((node.kinetic?.phase ?? 0) * 100)
    if (axis === 'ampl') return Math.round(node.kinetic?.amplitude ?? 18)
    if (axis === 'track') return node.letterSpacing ?? 0
    const cfg = resolveAxisConfig(axis)
    return axes[axis] ?? cfg.defaultVal
  }

  const applyVal = (axis: string, val: number) => {
    const cfg = resolveAxisConfig(axis)
    const clamped = Math.max(cfg.min, Math.min(cfg.max, val))
    const rounded = cfg.step < 1 ? Number(clamped.toFixed(2)) : Math.round(clamped)

    if (axis === 'offset') {
      if (node.textOnPath) {
        store.update(node.id, 'text', {
          textOnPath: { ...node.textOnPath, offset: Math.round(clamped) },
        })
      }
    } else if (axis === 'phase') {
      if (node.kinetic) {
        store.update(node.id, 'text', {
          kinetic: { ...node.kinetic, phase: Number((clamped / 100).toFixed(3)), playing: false },
        })
      }
    } else if (axis === 'ampl') {
      if (node.kinetic) {
        store.update(node.id, 'text', {
          kinetic: { ...node.kinetic, amplitude: Math.round(clamped) },
        })
      }
    } else if (axis === 'track') {
      store.update(node.id, 'text', { letterSpacing: rounded })
    } else {
      const nextAxes = { ...node.variableAxes, [axis]: rounded }
      store.update(node.id, 'text', {
        variableAxes: nextAxes,
        ...(axis === 'wght' ? { fontWeight: Math.round(clamped) } : {}),
      })
    }
  }

  const addAxis = (tag: string) => {
    const cleanTag = tag.trim()
    if (!/^[a-zA-Z0-9_ ]{4}$/.test(cleanTag)) return
    const meta = getAxisMeta(cleanTag)
    const nextAxes = { ...node.variableAxes, [cleanTag]: meta.default }
    store.update(node.id, 'text', { variableAxes: nextAxes })
    setShowAddMenu(false)
    setCustomTagInput('')
  }

  const removeAxis = (axis: string) => {
    if (['wght', 'wdth', 'slnt', 'opsz'].includes(axis.toLowerCase())) return
    const nextAxes = { ...node.variableAxes }
    delete nextAxes[axis]
    store.update(node.id, 'text', {
      variableAxes: Object.keys(nextAxes).length ? nextAxes : undefined,
    })
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>, axis: string) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()

    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
    const initialVal = getVal(axis)

    dragRef.current = {
      pointerId: event.pointerId,
      axis,
      startX: event.clientX,
      initialVal,
    }
    setActiveAxis(axis)
    setDragDelta(0)
    store.beginTransaction(`Scrub variable font ${axis.toUpperCase()}`)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || event.pointerId !== drag.pointerId) return
    event.preventDefault()
    event.stopPropagation()

    const deltaX = event.clientX - drag.startX
    const speed = event.shiftKey ? 0.2 : event.altKey ? 3.5 : 1
    const cfg = resolveAxisConfig(drag.axis)
    const change = deltaX * cfg.sensitivity * speed
    const nextVal = drag.initialVal + change

    setDragDelta(cfg.step < 1 ? Number(change.toFixed(2)) : Math.round(change))
    applyVal(drag.axis, nextVal)
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || event.pointerId !== drag.pointerId) return
    event.preventDefault()
    event.stopPropagation()

    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // Ignore if capture was lost
    }
    dragRef.current = null
    setActiveAxis(null)
    setDragDelta(0)
    store.endTransaction()
  }

  // Position HUD below the selection box in screen coordinates
  const rad = ((box.rotation ?? 0) * Math.PI) / 180
  const halfH =
    !box.rotation
      ? box.height / 2
      : (Math.abs(Math.sin(rad)) * box.width + Math.abs(Math.cos(rad)) * box.height) / 2
  const screenLeft = (box.x + box.width / 2) * camera.zoom + camera.x
  const screenTop = (box.y + box.height / 2 + halfH) * camera.zoom + camera.y + 14

  // Collect visible axes: core 5 axes (weight, width, slant, optical size, tracking) + any active custom/extended axes on this node
  const coreAxes = ['wght', 'wdth', 'slnt', 'opsz', 'track']
  const extraAxes = Object.keys(node.variableAxes ?? {}).filter(
    k => !['wght', 'wdth', 'slnt', 'opsz', 'track'].includes(k.toLowerCase())
  )
  const visibleAxes: string[] = [...coreAxes, ...extraAxes]
  if (node.textOnPath?.enabled) visibleAxes.push('offset')
  if (node.kinetic?.enabled) visibleAxes.push('phase', 'ampl')

  const isTnumActive = Boolean(node.openTypeFeatures?.tnum)
  const isSaltActive = Boolean(node.openTypeFeatures?.salt)
  const isLigaActive = node.openTypeFeatures?.liga !== false
  const isGuidesActive = Boolean(node.showOpticalMetrics)

  return (
    <div
      className="canvas-typo-scrubber-hud"
      data-testid="canvas-typography-scrubber"
      style={{
        left: screenLeft,
        top: screenTop,
        transform: 'translateX(-50%)',
      }}
      onPointerDown={e => e.stopPropagation()}
    >
      <div className="canvas-typo-scrubber-header">
        <div className="canvas-typo-badge">
          <Sliders size={10} color="#81adec" />
          <span>VARIABLE DYNAMICS</span>
          <button
            type="button"
            className={`canvas-typo-toggle-pill ${node.textOnPath?.enabled ? 'active' : ''}`}
            onClick={() => {
              store.update(node.id, 'text', {
                textOnPath: {
                  enabled: !node.textOnPath?.enabled,
                  preset: node.textOnPath?.preset ?? 'wave',
                  offset: node.textOnPath?.offset ?? 0,
                },
              })
            }}
            title={node.textOnPath?.enabled ? 'Disable text on path' : 'Enable text on Bézier path'}
            aria-label="Toggle text on path"
          >
            <Spline size={9} />
            <span>PATH</span>
          </button>
          <button
            type="button"
            className={`canvas-typo-toggle-pill ${node.kinetic?.enabled ? 'active' : ''}`}
            onClick={() => {
              store.update(node.id, 'text', {
                kinetic: {
                  ...DEFAULT_KINETIC,
                  ...(node.kinetic ?? {}),
                  enabled: !node.kinetic?.enabled,
                },
              })
            }}
            title={node.kinetic?.enabled ? 'Disable kinetic typography' : 'Enable kinetic glyph cascade'}
            aria-label="Toggle kinetic typography"
          >
            <Sparkles size={9} />
            <span>KINETIC</span>
          </button>
          <button
            type="button"
            className={`canvas-typo-toggle-pill ${isTnumActive ? 'active' : ''}`}
            onClick={() => {
              store.update(node.id, 'text', {
                openTypeFeatures: {
                  ...(node.openTypeFeatures ?? {}),
                  tnum: !isTnumActive,
                  ...(isTnumActive ? {} : { pnum: false }),
                },
              })
            }}
            title={isTnumActive ? 'Disable tabular figures' : 'Enable tabular figures (tnum)'}
            aria-label="Toggle tabular figures"
          >
            <span>TNUM</span>
          </button>
          <button
            type="button"
            className={`canvas-typo-toggle-pill ${isSaltActive ? 'active' : ''}`}
            onClick={() => {
              store.update(node.id, 'text', {
                openTypeFeatures: {
                  ...(node.openTypeFeatures ?? {}),
                  salt: !isSaltActive,
                },
              })
            }}
            title={isSaltActive ? 'Disable stylistic alternates' : 'Enable stylistic alternates (salt)'}
            aria-label="Toggle stylistic alternates"
          >
            <span>SALT</span>
          </button>
          <button
            type="button"
            className={`canvas-typo-toggle-pill ${isLigaActive ? 'active' : ''}`}
            onClick={() => {
              store.update(node.id, 'text', {
                openTypeFeatures: {
                  ...(node.openTypeFeatures ?? {}),
                  liga: !isLigaActive,
                },
              })
            }}
            title={isLigaActive ? 'Disable standard ligatures' : 'Enable standard ligatures (liga)'}
            aria-label="Toggle standard ligatures"
          >
            <span>LIGA</span>
          </button>
          <button
            type="button"
            className={`canvas-typo-toggle-pill ${isGuidesActive ? 'active' : ''}`}
            onClick={() => {
              store.update(node.id, 'text', {
                showOpticalMetrics: !isGuidesActive,
              })
            }}
            title={isGuidesActive ? 'Hide optical metrics guides' : 'Show optical metrics guides on canvas'}
            aria-label="Toggle optical metrics guides"
          >
            <span>GUIDES</span>
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {/* Quick Add Custom Axis Button */}
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              className="canvas-typo-toggle-pill"
              onClick={() => setShowAddMenu(prev => !prev)}
              title="Add extended or custom variation axis (GRAD, CASL, CRSV, etc.)"
              aria-label="Add variation axis"
            >
              <Plus size={9} />
              <span>AXIS</span>
            </button>

            {showAddMenu && (
              <div
                className="canvas-typo-menu"
                onPointerDown={e => e.stopPropagation()}
              >
                <div className="canvas-typo-menu-title">Registered OpenType Axes</div>
                {COMMON_EXTENDED_AXES.map(item => {
                  const alreadyActive = node.variableAxes && (node.variableAxes[item.tag] !== undefined || node.variableAxes[item.tag.toUpperCase()] !== undefined)
                  return (
                    <button
                      key={item.tag}
                      type="button"
                      disabled={alreadyActive}
                      className="canvas-typo-menu-item"
                      onClick={() => addAxis(item.tag)}
                    >
                      <span>{item.label}</span>
                      {alreadyActive && <span className="canvas-typo-menu-badge">Active</span>}
                    </button>
                  )
                })}
                <div className="canvas-typo-menu-divider" />
                <div style={{ display: 'flex', gap: 3, padding: '4px 6px' }}>
                  <input
                    type="text"
                    maxLength={4}
                    placeholder="TAG"
                    value={customTagInput}
                    onChange={e => setCustomTagInput(e.target.value.toUpperCase())}
                    className="canvas-typo-menu-input"
                    aria-label="Custom 4-letter tag"
                  />
                  <button
                    type="button"
                    disabled={!/^[A-Z0-9_ ]{4}$/.test(customTagInput)}
                    onClick={() => addAxis(customTagInput)}
                    className="canvas-typo-menu-add-btn"
                  >
                    Add
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Reset axes button */}
          <button
            type="button"
            className="canvas-typo-collapse-btn"
            onClick={() => {
              store.batch(() => {
                store.update(node.id, 'text', {
                  variableAxes: { wght: 400, wdth: 100, slnt: 0, opsz: node.fontSize },
                  fontWeight: 400,
                })
              }, 'Reset variable axes')
            }}
            title="Reset axes to defaults"
            aria-label="Reset axes"
          >
            <RotateCcw size={10} />
          </button>

          <button
            type="button"
            className="canvas-typo-collapse-btn"
            onClick={() => setCollapsed(prev => !prev)}
            title={collapsed ? 'Expand variable axes scrubber' : 'Collapse scrubber'}
            aria-label={collapsed ? 'Expand scrubber' : 'Collapse scrubber'}
          >
            {collapsed ? <ChevronDown size={11} /> : <ChevronUp size={11} />}
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          {/* Quick presets row */}
          <div className="canvas-typo-presets-row" role="toolbar" aria-label="Quick typography presets">
            {VARIABLE_AXIS_PRESETS.map(preset => {
              const isMatch =
                preset.axes.wght === axes.wght &&
                preset.axes.wdth === axes.wdth &&
                preset.axes.slnt === axes.slnt &&
                (preset.axes.opsz === undefined || preset.axes.opsz === axes.opsz)
              return (
                <button
                  key={preset.name}
                  type="button"
                  className={`canvas-typo-preset-chip ${isMatch ? 'active' : ''}`}
                  onClick={() => {
                    store.batch(() => {
                      store.update(node.id, 'text', {
                        variableAxes: { ...preset.axes },
                        fontWeight: preset.axes.wght ?? node.fontWeight,
                      })
                    }, `Apply ${preset.name} preset`)
                  }}
                  title={preset.description}
                >
                  {preset.name}
                </button>
              )
            })}
          </div>

          {/* Interactive Scrub Pills */}
          <div className="canvas-typo-axes-row">
            {visibleAxes.map(axis => {
              const cfg = resolveAxisConfig(axis)
              const val = getVal(axis)
              const isActive = activeAxis === axis
              const percent = Math.max(0, Math.min(100, ((val - cfg.min) / (cfg.max - cfg.min)) * 100))
              const isRemovable = !['wght', 'wdth', 'slnt', 'opsz', 'track', 'offset', 'phase', 'ampl'].includes(axis)

              return (
                <div
                  key={axis}
                  className={`canvas-typo-axis-pill ${isActive ? 'is-scrubbing' : ''}`}
                  onPointerDown={e => handlePointerDown(e, axis)}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                  onDoubleClick={() => applyVal(axis, cfg.defaultVal)}
                  title={`Drag horizontally to scrub ${cfg.label} (${cfg.min}..${cfg.max}${cfg.unit}). Shift for fine, Alt for coarse. Double-click to reset.`}
                  aria-label={`Scrub ${cfg.label}`}
                  role="slider"
                  aria-valuemin={cfg.min}
                  aria-valuemax={cfg.max}
                  aria-valuenow={val}
                >
                  <div className="canvas-typo-pill-gauge" style={{ width: `${percent}%` }} />
                  <div className="canvas-typo-pill-content">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className="canvas-typo-pill-label">{cfg.label}</span>
                      {isRemovable && (
                        <button
                          type="button"
                          className="canvas-typo-pill-close"
                          onClick={e => {
                            e.stopPropagation()
                            removeAxis(axis)
                          }}
                          title={`Remove axis ${cfg.label}`}
                          aria-label={`Remove axis ${cfg.label}`}
                        >
                          <X size={8} />
                        </button>
                      )}
                    </div>
                    <span className="canvas-typo-pill-val">
                      {axis === 'slnt'
                        ? `${Number(val.toFixed(1))}°`
                        : cfg.step < 1
                        ? `${Number(val.toFixed(2))}${cfg.unit}`
                        : `${Math.round(val)}${cfg.unit}`}
                    </span>
                    {isActive && dragDelta !== 0 && (
                      <span className="canvas-typo-pill-delta">
                        {dragDelta > 0 ? `+${dragDelta}` : dragDelta}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
})
