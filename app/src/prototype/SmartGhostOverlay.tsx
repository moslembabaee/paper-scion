import type { ReactElement } from 'react'
import { computeMorphTrajectories, type ScreenDiff } from './smartAnimate'

export interface SmartGhostOverlayProps {
  readonly screenDiff: ScreenDiff
  readonly width: number
  readonly height: number
}

/** Render SVG ghost outlines and motion trajectories for Smart Animate inspect mode */
export function SmartGhostOverlay({ screenDiff, width, height }: SmartGhostOverlayProps): ReactElement {
  return (
    <svg
      className="smart-ghost-overlay"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-label="Smart Animate Ghost Outlines and Trajectories"
    >
      <defs>
        <marker id="smart-ghost-arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="4" markerHeight="4" orient="auto">
          <path d="M 0 0 L 6 3 L 0 6 Z" fill="#81adec" opacity="0.6" />
        </marker>
      </defs>
      {screenDiff.matched.map(pair => {
        const trajectories = computeMorphTrajectories(pair, 6)
        const fromD = pair.geometryDiff.fromD
        const toD = pair.geometryDiff.toD
        return (
          <g key={pair.to.id} data-ghost-pair={pair.to.id}>
            {/* Source ghost outline */}
            {fromD && (
              <g transform={`translate(${pair.from.x}, ${pair.from.y}) rotate(${pair.from.rotation}, ${pair.from.width / 2}, ${pair.from.height / 2})`}>
                <path className="ghost-path-source" d={fromD} />
              </g>
            )}
            {/* Target ghost outline */}
            {toD && (
              <g transform={`translate(${pair.to.x}, ${pair.to.y}) rotate(${pair.to.rotation}, ${pair.to.width / 2}, ${pair.to.height / 2})`}>
                <path className="ghost-path-target" d={toD} />
              </g>
            )}
            {/* Trajectory lines connecting corresponding control points */}
            {trajectories.map((traj, idx) => (
              <path
                key={idx}
                className="ghost-trajectory-line"
                d={traj.path}
                markerEnd="url(#smart-ghost-arrow)"
              />
            ))}
            {/* Centroid trajectory line if no contour trajectories */}
            {trajectories.length === 0 && (
              <line
                className="ghost-trajectory-line"
                x1={pair.from.x + pair.from.width / 2}
                y1={pair.from.y + pair.from.height / 2}
                x2={pair.to.x + pair.to.width / 2}
                y2={pair.to.y + pair.to.height / 2}
                markerEnd="url(#smart-ghost-arrow)"
              />
            )}
          </g>
        )
      })}
    </svg>
  )
}
