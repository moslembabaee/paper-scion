import { memo } from 'react'
import type { Camera } from '../canvas/types'
import type { SnapGuide } from './snapEngine'

export const SnapGuides = memo(function SnapGuides({
  guides,
  camera,
}: {
  guides: readonly SnapGuide[]
  camera: Camera
}) {
  if (!guides.length) return null

  return (
    <svg className="snap-guides-svg" aria-hidden="true">
      <defs>
        {/* Subtle glow filter for high-contrast alignment lines on any canvas theme */}
        <filter id="guide-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="0" stdDeviation="0.75" floodColor="#81adec" floodOpacity="0.35" />
        </filter>
      </defs>

      {guides.map((guide, i) => {
        const horizontal = guide.axis === 'h'
        const value = guide.value * camera.zoom + (horizontal ? camera.y : camera.x)
        const start = guide.span[0] * camera.zoom + (horizontal ? camera.x : camera.y)
        const end = guide.span[1] * camera.zoom + (horizontal ? camera.x : camera.y)
        const x1 = horizontal ? start : value
        const y1 = horizontal ? value : start
        const x2 = horizontal ? end : value
        const y2 = horizontal ? end : value

        const isDistance = guide.distance !== undefined
        const isCenter = guide.kind === 'center'
        const isDimension = guide.kind === 'dimension'

        // Screen center of the guide
        const midX = (x1 + x2) / 2
        const midY = (y1 + y2) / 2

        // Optional gap highlight rect
        let gapRectScreen: { x: number; y: number; w: number; h: number } | null = null
        if (guide.gapRect && camera.zoom > 0.2) {
          gapRectScreen = {
            x: guide.gapRect.x * camera.zoom + camera.x,
            y: guide.gapRect.y * camera.zoom + camera.y,
            w: guide.gapRect.width * camera.zoom,
            h: guide.gapRect.height * camera.zoom,
          }
        }

        return (
          <g
            key={`${guide.axis}-${guide.value}-${i}`}
            className={`snap-guide-group snap-guide-${guide.kind ?? (isDistance ? 'distribution' : 'alignment')}`}
            data-guide={isDistance ? 'distance' : isCenter ? 'center' : 'alignment'}
          >
            {/* Gap subtle background tint for equidistant distribution */}
            {gapRectScreen && (
              <rect
                className="snap-guide-gap-rect"
                x={gapRectScreen.x}
                y={gapRectScreen.y}
                width={gapRectScreen.w}
                height={gapRectScreen.h}
                rx="2"
              />
            )}

            {/* Main guide line */}
            <line
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              className={`snap-guide-line ${isCenter ? 'snap-guide-line-center' : ''}`}
              strokeDasharray={isDistance ? undefined : isCenter ? '3 3' : '3 2'}
            />

            {/* Center markers (crosshairs) if center-aligned */}
            {isCenter && guide.centerMarkers?.map((marker, mIdx) => {
              const mx = marker.x * camera.zoom + camera.x
              const my = marker.y * camera.zoom + camera.y
              return (
                <g key={`center-${mIdx}`} className="snap-guide-center-crosshair">
                  <line x1={mx - 4} y1={my} x2={mx + 4} y2={my} />
                  <line x1={mx} y1={my - 4} x2={mx} y2={my + 4} />
                  <circle cx={mx} cy={my} r="1.5" />
                </g>
              )
            })}

            {/* Distance distribution ticks and floating pill badge */}
            {isDistance && (
              <>
                {/* End ticks */}
                <path
                  className="snap-guide-tick"
                  d={
                    horizontal
                      ? `M${x1} ${y1 - 4}v8 M${x2} ${y2 - 4}v8`
                      : `M${x1 - 4} ${y1}h8 M${x2 - 4} ${y2}h8`
                  }
                />

                {/* Floating distance pill badge */}
                {(() => {
                  const dist = guide.distance
                  if (dist === undefined) return null
                  const distVal = Number(dist.toFixed(1))
                  const label = `${distVal}`
                  const textWidth = Math.max(26, label.length * 6.5 + 10)
                  const badgeHeight = 16
                  const badgeX = horizontal ? midX - textWidth / 2 : midX + 6
                  const badgeY = horizontal ? midY - badgeHeight - 4 : midY - badgeHeight / 2

                  return (
                    <g className="snap-guide-pill" transform={`translate(${badgeX}, ${badgeY})`}>
                      <rect
                        width={textWidth}
                        height={badgeHeight}
                        rx="3"
                        className="snap-pill-bg"
                      />
                      <text
                        x={textWidth / 2}
                        y={badgeHeight / 2 + 3.5}
                        textAnchor="middle"
                        className="snap-pill-text"
                      >
                        {label}
                      </text>
                    </g>
                  )
                })()}
              </>
            )}

            {/* Dimension or grid label if present */}
            {((isDimension || guide.kind === 'grid') && guide.label) ? (
              <g className="snap-guide-pill" transform={`translate(${horizontal ? midX - 25 : midX + 8}, ${horizontal ? midY - 18 : midY - 8})`}>
                <rect width={Math.max(36, guide.label.length * 6.5 + 12)} height={16} rx="3" className="snap-pill-bg" />
                <text x={Math.max(36, guide.label.length * 6.5 + 12) / 2} y={11.5} textAnchor="middle" className="snap-pill-text">
                  {guide.label}
                </text>
              </g>
            ) : null}
          </g>
        )
      })}
    </svg>
  )
})
