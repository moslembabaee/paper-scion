import { memo } from 'react'
import type { HorizontalConstraint, LayoutConstraints, SceneElement, VerticalConstraint } from './types'
import type { SceneStore } from './store'
import { DEFAULT_CONSTRAINTS } from './layoutConstraints'
import './constraints.css'

interface Props {
  node: SceneElement
  parent?: SceneElement
  store: SceneStore
}

export const ConstraintsInspector = memo(function ConstraintsInspector({ node, parent, store }: Props) {
  // Only display constraints when element is within a frame that does not use auto-layout
  if (!parent || parent.type !== 'frame' || parent.layout) {
    return null
  }

  const constraints = node.constraints ?? DEFAULT_CONSTRAINTS
  const horizontal = constraints.horizontal
  const vertical = constraints.vertical

  const update = (patch: Partial<LayoutConstraints>) => {
    store.setLayoutConstraints(node.id, {
      horizontal: patch.horizontal ?? horizontal,
      vertical: patch.vertical ?? vertical,
    })
  }

  const isLeftPinned = horizontal === 'left' || horizontal === 'left-right'
  const isRightPinned = horizontal === 'right' || horizontal === 'left-right'
  const isTopPinned = vertical === 'top' || vertical === 'top-bottom'
  const isBottomPinned = vertical === 'bottom' || vertical === 'top-bottom'
  const isCenter = horizontal === 'center' || vertical === 'center'

  const toggleLeft = () => {
    if (isLeftPinned) {
      update({ horizontal: horizontal === 'left-right' ? 'right' : 'center' })
    } else {
      update({ horizontal: horizontal === 'right' ? 'left-right' : 'left' })
    }
  }

  const toggleRight = () => {
    if (isRightPinned) {
      update({ horizontal: horizontal === 'left-right' ? 'left' : 'center' })
    } else {
      update({ horizontal: horizontal === 'left' ? 'left-right' : 'right' })
    }
  }

  const toggleTop = () => {
    if (isTopPinned) {
      update({ vertical: vertical === 'top-bottom' ? 'bottom' : 'center' })
    } else {
      update({ vertical: vertical === 'bottom' ? 'top-bottom' : 'top' })
    }
  }

  const toggleBottom = () => {
    if (isBottomPinned) {
      update({ vertical: vertical === 'top-bottom' ? 'top' : 'center' })
    } else {
      update({ vertical: vertical === 'top' ? 'top-bottom' : 'bottom' })
    }
  }

  return (
    <div className="inspector-section constraints-inspector" data-testid="constraints-inspector">
      <div className="constraints-heading">
        <span className="section-caption">CONSTRAINTS</span>
        <span className="layout-hint" style={{ margin: 0, fontSize: 9 }}>
          in {parent.name}
        </span>
      </div>

      <div className="constraints-body">
        {/* 2D Pinning Interactive Box */}
        <div
          className="constraints-box-widget"
          aria-label="Interactive layout constraints pinning widget"
          role="group"
        >
          {/* Top pin */}
          <button
            type="button"
            className={`constraints-pin pin-top ${isTopPinned ? 'active' : ''}`}
            aria-label={`Pin to top (currently ${isTopPinned ? 'active' : 'inactive'})`}
            aria-pressed={isTopPinned}
            onClick={toggleTop}
          />
          {/* Bottom pin */}
          <button
            type="button"
            className={`constraints-pin pin-bottom ${isBottomPinned ? 'active' : ''}`}
            aria-label={`Pin to bottom (currently ${isBottomPinned ? 'active' : 'inactive'})`}
            aria-pressed={isBottomPinned}
            onClick={toggleBottom}
          />
          {/* Left pin */}
          <button
            type="button"
            className={`constraints-pin pin-left ${isLeftPinned ? 'active' : ''}`}
            aria-label={`Pin to left (currently ${isLeftPinned ? 'active' : 'inactive'})`}
            aria-pressed={isLeftPinned}
            onClick={toggleLeft}
          />
          {/* Right pin */}
          <button
            type="button"
            className={`constraints-pin pin-right ${isRightPinned ? 'active' : ''}`}
            aria-label={`Pin to right (currently ${isRightPinned ? 'active' : 'inactive'})`}
            aria-pressed={isRightPinned}
            onClick={toggleRight}
          />

          {/* Inner representation */}
          <div className={`constraints-box-inner ${isCenter ? 'center-active' : ''}`}>
            <span className={`constraints-center-dot ${isCenter ? 'active' : ''}`} />
          </div>
        </div>

        {/* Dropdowns */}
        <div className="constraints-controls">
          <label className="property-select">
            <span>Horizontal</span>
            <select
              aria-label="Horizontal constraint"
              value={horizontal}
              onChange={event => update({ horizontal: event.currentTarget.value as HorizontalConstraint })}
            >
              <option value="left">Left</option>
              <option value="right">Right</option>
              <option value="left-right">Left &amp; Right</option>
              <option value="center">Center</option>
              <option value="scale">Scale</option>
            </select>
          </label>

          <label className="property-select">
            <span>Vertical</span>
            <select
              aria-label="Vertical constraint"
              value={vertical}
              onChange={event => update({ vertical: event.currentTarget.value as VerticalConstraint })}
            >
              <option value="top">Top</option>
              <option value="bottom">Bottom</option>
              <option value="top-bottom">Top &amp; Bottom</option>
              <option value="center">Center</option>
              <option value="scale">Scale</option>
            </select>
          </label>
        </div>
      </div>

      <p className="layout-hint">
        {horizontal === 'scale' || vertical === 'scale'
          ? 'Scales position and dimensions proportionally as container frame resizes.'
          : horizontal === 'left-right' || vertical === 'top-bottom'
            ? 'Stretches across parent frame while preserving fixed margin distances.'
            : horizontal === 'center' || vertical === 'center'
              ? 'Maintains relative centering inside the parent frame.'
              : `Pins position to ${vertical} and ${horizontal} edges of ${parent.name}.`}
      </p>
    </div>
  )
})
