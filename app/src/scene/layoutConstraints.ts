import type { ElementGeometry, HorizontalConstraint, LayoutConstraints, SceneElement, VerticalConstraint } from './types.ts'
import { withElementGeometry } from './elements.ts'

export const DEFAULT_CONSTRAINTS: LayoutConstraints = Object.freeze({
  horizontal: 'left',
  vertical: 'top',
})

export const HORIZONTAL_CONSTRAINTS: readonly HorizontalConstraint[] = [
  'left',
  'right',
  'left-right',
  'center',
  'scale',
] as const

export const VERTICAL_CONSTRAINTS: readonly VerticalConstraint[] = [
  'top',
  'bottom',
  'top-bottom',
  'center',
  'scale',
] as const

export interface FrameDimensions {
  readonly width: number
  readonly height: number
}

/**
 * Computes repositioned and resized child geometry inside a resized container frame
 * according to the child's horizontal and vertical layout pinning constraints.
 */
export function applyConstraintsToChild(
  child: SceneElement,
  fromFrame: FrameDimensions,
  toFrame: FrameDimensions,
): ElementGeometry {
  const constraints = child.constraints ?? DEFAULT_CONSTRAINTS
  const dW = toFrame.width - fromFrame.width
  const dH = toFrame.height - fromFrame.height

  let x = child.x
  let width = child.width

  switch (constraints.horizontal) {
    case 'left':
      // Maintain distance to left edge (local x is relative to frame origin)
      x = child.x
      width = child.width
      break

    case 'right': {
      // Maintain distance to right edge
      x = child.x + dW
      width = child.width
      break
    }

    case 'left-right': {
      // Stretch horizontally: preserve distance to both left and right edges
      const rightDistance = fromFrame.width - (child.x + child.width)
      x = child.x
      width = Math.max(1, toFrame.width - x - rightDistance)
      break
    }

    case 'center': {
      // Maintain relative horizontal center alignment
      x = child.x + dW * 0.5
      width = child.width
      break
    }

    case 'scale': {
      // Scale position and width proportionally
      if (fromFrame.width > 0) {
        const scaleX = toFrame.width / fromFrame.width
        x = child.x * scaleX
        width = Math.max(1, child.width * scaleX)
      }
      break
    }
  }

  let y = child.y
  let height = child.height

  switch (constraints.vertical) {
    case 'top':
      // Maintain distance to top edge
      y = child.y
      height = child.height
      break

    case 'bottom': {
      // Maintain distance to bottom edge
      y = child.y + dH
      height = child.height
      break
    }

    case 'top-bottom': {
      // Stretch vertically: preserve distance to both top and bottom edges
      const bottomDistance = fromFrame.height - (child.y + child.height)
      y = child.y
      height = Math.max(1, toFrame.height - y - bottomDistance)
      break
    }

    case 'center': {
      // Maintain relative vertical center alignment
      y = child.y + dH * 0.5
      height = child.height
      break
    }

    case 'scale': {
      // Scale position and height proportionally
      if (fromFrame.height > 0) {
        const scaleY = toFrame.height / fromFrame.height
        y = child.y * scaleY
        height = Math.max(1, child.height * scaleY)
      }
      break
    }
  }

  return {
    x: Math.round(x * 1000) / 1000,
    y: Math.round(y * 1000) / 1000,
    width: Math.max(1, Math.round(width * 1000) / 1000),
    height: Math.max(1, Math.round(height * 1000) / 1000),
    rotation: child.rotation,
  }
}

/**
 * Recursively updates nested children of a container frame when its dimensions change,
 * taking into account initial positions from an active transaction snapshot to prevent drift.
 */
export function applyConstraintsToChildren(
  elements: Record<string, SceneElement>,
  frameId: string,
  fromFrame: FrameDimensions,
  toFrame: FrameDimensions,
  initialElements?: Record<string, SceneElement>,
): Record<string, SceneElement> {
  const frame = elements[frameId]
  if (!frame || frame.type !== 'frame' || !frame.children || frame.children.length === 0) {
    return elements
  }

  // If container frame has auto-layout enabled, flex reflow controls children flow instead
  if (frame.layout) {
    return elements
  }

  let nextElements = { ...elements }

  for (const childId of frame.children) {
    const child = nextElements[childId]
    if (!child) continue

    // Use initial transaction snapshot for the baseline child geometry if available
    const baselineChild = initialElements?.[childId] ?? child
    const baselineFrame = initialElements?.[frameId] ?? fromFrame

    const updatedGeometry = applyConstraintsToChild(baselineChild, baselineFrame, toFrame)

    const updatedChild = withElementGeometry(child, updatedGeometry)
    nextElements[childId] = updatedChild

    // Recursively apply constraints if child is a nested frame whose dimensions changed
    if (
      updatedChild.type === 'frame' &&
      updatedChild.children &&
      updatedChild.children.length > 0 &&
      !updatedChild.layout &&
      (updatedChild.width !== child.width || updatedChild.height !== child.height)
    ) {
      const childFrom: FrameDimensions = {
        width: baselineChild.width,
        height: baselineChild.height,
      }
      const childTo: FrameDimensions = {
        width: updatedChild.width,
        height: updatedChild.height,
      }
      nextElements = applyConstraintsToChildren(
        nextElements,
        childId,
        childFrom,
        childTo,
        initialElements,
      )
    }
  }

  return nextElements
}
