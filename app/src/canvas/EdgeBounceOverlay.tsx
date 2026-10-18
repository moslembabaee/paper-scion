import { useEffect, useState } from 'react'
import type { ViewportController } from './ViewportController.ts'
import type { EdgeBounceState } from './types.ts'

interface EdgeBounceOverlayProps {
  controller: ViewportController
}

const EMPTY_BOUNCE: EdgeBounceState = {
  active: false,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  zoomMin: 0,
  zoomMax: 0,
}

export function EdgeBounceOverlay({ controller }: EdgeBounceOverlayProps) {
  const [bounce, setBounce] = useState<EdgeBounceState>(EMPTY_BOUNCE)

  useEffect(() => {
    return controller.subscribePhysics((telemetry) => {
      setBounce(telemetry.bounceState)
    })
  }, [controller])

  if (!bounce.active && bounce.top === 0 && bounce.right === 0 && bounce.bottom === 0 && bounce.left === 0 && bounce.zoomMin === 0 && bounce.zoomMax === 0) {
    return null
  }

  const zoomIntensity = Math.max(bounce.zoomMin, bounce.zoomMax)

  return (
    <div
      className="viewport-edge-bounce"
      data-testid="viewport-edge-bounce"
      aria-hidden="true"
    >
      {bounce.top > 0 && (
        <div
          className="edge-bounce-top"
          style={{
            opacity: Math.min(1, bounce.top * 1.5),
            transform: `scaleY(${1 + bounce.top * 2.5})`,
          }}
        />
      )}
      {bounce.bottom > 0 && (
        <div
          className="edge-bounce-bottom"
          style={{
            opacity: Math.min(1, bounce.bottom * 1.5),
            transform: `scaleY(${1 + bounce.bottom * 2.5})`,
          }}
        />
      )}
      {bounce.left > 0 && (
        <div
          className="edge-bounce-left"
          style={{
            opacity: Math.min(1, bounce.left * 1.5),
            transform: `scaleX(${1 + bounce.left * 2.5})`,
          }}
        />
      )}
      {bounce.right > 0 && (
        <div
          className="edge-bounce-right"
          style={{
            opacity: Math.min(1, bounce.right * 1.5),
            transform: `scaleX(${1 + bounce.right * 2.5})`,
          }}
        />
      )}
      {zoomIntensity > 0 && (
        <div
          className="edge-bounce-zoom-vignette"
          style={{
            opacity: Math.min(0.8, zoomIntensity * 0.8),
            boxShadow: `inset 0 0 ${Math.round(20 + zoomIntensity * 40)}px rgba(129, 173, 236, ${Math.min(0.35, zoomIntensity * 0.4)})`,
          }}
        />
      )}
    </div>
  )
}
