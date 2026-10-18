import { useState, useEffect } from 'react'
import type { KeyboardEvent } from 'react'
import {
  adjustSpacing,
  layoutGapBands,
  layoutHandleCursor,
  layoutHandles,
  spacingValue,
} from './layoutHandles'
import type { SpacingProperty } from './layoutHandles'
import type { SceneStore } from './store'
import type { FrameElement, SceneSnapshot } from './types'
import './autoLayout.css'

export function AutoLayoutHandles({
  frame,
  state,
  store,
  zoom,
  rotation,
  active,
}: {
  frame: FrameElement
  state: SceneSnapshot
  store: SceneStore
  zoom: number
  rotation: number
  active: SpacingProperty | null
}) {
  const [hoveredProperty, setHoveredProperty] = useState<SpacingProperty | null>(null)
  const [isAltHeld, setIsAltHeld] = useState(false)
  const [isShiftHeld, setIsShiftHeld] = useState(false)

  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Alt') setIsAltHeld(true)
      if (e.key === 'Shift') setIsShiftHeld(true)
    }
    const handleKeyUp = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Alt') setIsAltHeld(false)
      if (e.key === 'Shift') setIsShiftHeld(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

  if (!frame.layout || store.isLocked(frame.id) || !store.isVisible(frame.id)) return null
  const padding = frame.layout.padding
  const layout = frame.layout

  const keydown = (event: KeyboardEvent, property: SpacingProperty) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return
    if (event.ctrlKey || event.metaKey || event.altKey) return
    event.preventDefault()
    event.stopPropagation()
    const current = store.getSnapshot().elements[frame.id]
    if (current?.type !== 'frame' || !current.layout || store.isLocked(current.id)) return
    const value = spacingValue(current.layout, property)
    const step = event.shiftKey ? 8 : 1
    const next = event.key === 'Home' ? 0 : value + (event.key === 'ArrowRight' || event.key === 'ArrowUp' ? step : -step)
    if (Math.max(0, next) === value) return
    store.update(current.id, 'frame', { layout: adjustSpacing(current.layout, property, next) })
  }

  const contentWidth = Math.max(0, frame.width - padding.left - padding.right)
  const contentHeight = Math.max(0, frame.height - padding.top - padding.bottom)

  const isSymmetric = (side: keyof typeof padding) => {
    if (!isAltHeld) return false
    if ((active === 'top' && side === 'bottom') || (active === 'bottom' && side === 'top')) return true
    if ((active === 'left' && side === 'right') || (active === 'right' && side === 'left')) return true
    if ((hoveredProperty === 'top' && side === 'bottom') || (hoveredProperty === 'bottom' && side === 'top')) return true
    if ((hoveredProperty === 'left' && side === 'right') || (hoveredProperty === 'right' && side === 'left')) return true
    return false
  }

  const gapBands = layoutGapBands(frame, state.elements)
  const isAdjusting = active !== null

  return (
    <div
      className="layout-affordances"
      data-adjusting={isAdjusting}
      data-hovering={hoveredProperty !== null}
      data-testid="auto-layout-handles"
    >
      {/* Inner content box outline */}
      <div
        className="layout-content-outline"
        style={{
          left: padding.left * zoom,
          top: padding.top * zoom,
          width: contentWidth * zoom,
          height: contentHeight * zoom,
        }}
      >
        <span className="layout-corner top-left" />
        <span className="layout-corner top-right" />
        <span className="layout-corner bottom-left" />
        <span className="layout-corner bottom-right" />
      </div>

      {/* Directional padding highlight bands with interactive affordances */}
      {/* Top band */}
      {(padding.top > 0 || active === 'top' || hoveredProperty === 'top') && (
        <div
          className={`layout-padding-band band-top ${active === 'top' ? 'is-active' : ''} ${isSymmetric('top') ? 'is-symmetric' : ''}`}
          data-property="top"
          data-axis="y"
          data-sign="1"
          data-empty={padding.top === 0}
          style={{
            left: 0,
            top: 0,
            width: frame.width * zoom,
            height: Math.max(padding.top > 0 ? padding.top * zoom : 4, 0),
          }}
        >
          {(active === 'top' || isSymmetric('top') || hoveredProperty === 'top') && (
            <div className="layout-dimension-ruler ruler-vertical" style={{ left: (frame.width * 0.38) * zoom }}>
              <div className="layout-ruler-line" style={{ height: Math.max(1, padding.top * zoom) }} />
              <div className="layout-ruler-tick tick-start" />
              <div className="layout-ruler-tick tick-end" style={{ top: padding.top * zoom }} />
              <div className="layout-ruler-badge" style={{ top: (padding.top * zoom) / 2 }}>
                <span>{padding.top}px</span>
                {isSymmetric('top') && <span className="ruler-modifier">SYM</span>}
                {isShiftHeld && <span className="ruler-modifier">8PX</span>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Bottom band */}
      {(padding.bottom > 0 || active === 'bottom' || hoveredProperty === 'bottom') && (
        <div
          className={`layout-padding-band band-bottom ${active === 'bottom' ? 'is-active' : ''} ${isSymmetric('bottom') ? 'is-symmetric' : ''}`}
          data-property="bottom"
          data-axis="y"
          data-sign="-1"
          data-empty={padding.bottom === 0}
          style={{
            left: 0,
            top: (frame.height - (padding.bottom > 0 ? padding.bottom : 4 / zoom)) * zoom,
            width: frame.width * zoom,
            height: Math.max(padding.bottom > 0 ? padding.bottom * zoom : 4, 0),
          }}
        >
          {(active === 'bottom' || isSymmetric('bottom') || hoveredProperty === 'bottom') && (
            <div className="layout-dimension-ruler ruler-vertical" style={{ left: (frame.width * 0.62) * zoom }}>
              <div className="layout-ruler-line" style={{ height: Math.max(1, padding.bottom * zoom) }} />
              <div className="layout-ruler-tick tick-start" />
              <div className="layout-ruler-tick tick-end" style={{ top: padding.bottom * zoom }} />
              <div className="layout-ruler-badge" style={{ top: (padding.bottom * zoom) / 2 }}>
                <span>{padding.bottom}px</span>
                {isSymmetric('bottom') && <span className="ruler-modifier">SYM</span>}
                {isShiftHeld && <span className="ruler-modifier">8PX</span>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Left band */}
      {(padding.left > 0 || active === 'left' || hoveredProperty === 'left') && (
        <div
          className={`layout-padding-band band-left ${active === 'left' ? 'is-active' : ''} ${isSymmetric('left') ? 'is-symmetric' : ''}`}
          data-property="left"
          data-axis="x"
          data-sign="1"
          data-empty={padding.left === 0}
          style={{
            left: 0,
            top: padding.top * zoom,
            width: Math.max(padding.left > 0 ? padding.left * zoom : 4, 0),
            height: contentHeight * zoom,
          }}
        >
          {(active === 'left' || isSymmetric('left') || hoveredProperty === 'left') && (
            <div className="layout-dimension-ruler ruler-horizontal" style={{ top: (contentHeight * 0.62) * zoom }}>
              <div className="layout-ruler-line" style={{ width: Math.max(1, padding.left * zoom) }} />
              <div className="layout-ruler-tick tick-start" />
              <div className="layout-ruler-tick tick-end" style={{ left: padding.left * zoom }} />
              <div className="layout-ruler-badge" style={{ left: (padding.left * zoom) / 2 }}>
                <span>{padding.left}px</span>
                {isSymmetric('left') && <span className="ruler-modifier">SYM</span>}
                {isShiftHeld && <span className="ruler-modifier">8PX</span>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Right band */}
      {(padding.right > 0 || active === 'right' || hoveredProperty === 'right') && (
        <div
          className={`layout-padding-band band-right ${active === 'right' ? 'is-active' : ''} ${isSymmetric('right') ? 'is-symmetric' : ''}`}
          data-property="right"
          data-axis="x"
          data-sign="-1"
          data-empty={padding.right === 0}
          style={{
            left: (frame.width - (padding.right > 0 ? padding.right : 4 / zoom)) * zoom,
            top: padding.top * zoom,
            width: Math.max(padding.right > 0 ? padding.right * zoom : 4, 0),
            height: contentHeight * zoom,
          }}
        >
          {(active === 'right' || isSymmetric('right') || hoveredProperty === 'right') && (
            <div className="layout-dimension-ruler ruler-horizontal" style={{ top: (contentHeight * 0.38) * zoom }}>
              <div className="layout-ruler-line" style={{ width: Math.max(1, padding.right * zoom) }} />
              <div className="layout-ruler-tick tick-start" />
              <div className="layout-ruler-tick tick-end" style={{ left: padding.right * zoom }} />
              <div className="layout-ruler-badge" style={{ left: (padding.right * zoom) / 2 }}>
                <span>{padding.right}px</span>
                {isSymmetric('right') && <span className="ruler-modifier">SYM</span>}
                {isShiftHeld && <span className="ruler-modifier">8PX</span>}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Interactive Gap Visualizer Bands between items */}
      {gapBands.map((band) => {
        const isCurrentActive = active === 'gap'
        const isCurrentHovered = hoveredProperty === 'gap'
        return (
          <div
            key={band.id}
            className={`layout-gap-band ${isCurrentActive ? 'is-active' : ''} ${isCurrentHovered ? 'is-hovered' : ''}`}
            data-layout-handle={band.id}
            data-property="gap"
            data-axis={band.axis}
            data-sign={band.sign}
            style={{
              left: band.x * zoom,
              top: band.y * zoom,
              width: band.width * zoom,
              height: band.height * zoom,
              cursor: layoutHandleCursor(band.axis, rotation),
            }}
            onPointerEnter={() => setHoveredProperty('gap')}
            onPointerLeave={() => setHoveredProperty(null)}
          >
            {(isCurrentActive || isCurrentHovered) && (
              <div className="layout-gap-badge">
                <span>{Math.round(layout.gap)}px</span>
              </div>
            )}
          </div>
        )
      })}

      {/* Primary Spacing Handles */}
      {layoutHandles(frame, state.elements).map((handle) => {
        const value = spacingValue(layout, handle.property)
        const label = handle.property === 'gap' ? 'Gap' : `Padding ${handle.property}`
        const isHandleActive = active === handle.property
        return (
          <div
            key={handle.id}
            className={`layout-spacing-handle is-${handle.axis}`}
            data-layout-handle={handle.id}
            data-property={handle.property}
            data-axis={handle.axis}
            data-sign={handle.sign}
            data-active={isHandleActive}
            data-value={`${label} ${Number(value.toFixed(2))}`}
            data-testid={`layout-handle-${handle.id}`}
            role="slider"
            aria-label={label}
            aria-valuemin={0}
            aria-valuenow={value}
            aria-valuetext={`${value} pixels`}
            aria-orientation={handle.axis === 'x' ? 'horizontal' : 'vertical'}
            tabIndex={0}
            title={`${label}: ${value} px · Drag to adjust · Shift: 8px · Alt: symmetric · Double-click: 0px`}
            style={{
              left: handle.x * zoom,
              top: handle.y * zoom,
              cursor: layoutHandleCursor(handle.axis, rotation),
            }}
            onPointerEnter={() => setHoveredProperty(handle.property)}
            onPointerLeave={() => setHoveredProperty(null)}
            onKeyDown={(event) => keydown(event, handle.property)}
            onDoubleClick={(event) => {
              event.stopPropagation()
              const current = store.getSnapshot().elements[frame.id]
              if (current?.type !== 'frame' || !current.layout || store.isLocked(current.id)) return
              if (event.altKey && handle.property !== 'gap') {
                const p = current.layout.padding
                const patch =
                  handle.property === 'top' || handle.property === 'bottom'
                    ? { top: 0, bottom: 0 }
                    : { left: 0, right: 0 }
                store.update(current.id, 'frame', {
                  layout: { ...current.layout, padding: { ...p, ...patch } },
                })
              } else {
                store.update(current.id, 'frame', {
                  layout: adjustSpacing(current.layout, handle.property, 0),
                })
              }
            }}
          >
            <span className="layout-handle-grip" />
          </div>
        )
      })}
    </div>
  )
}
