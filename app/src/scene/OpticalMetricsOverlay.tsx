import { useMemo } from 'react'
import type { TextElement } from './types'
import { computeTextOpticalMetrics } from './opticalMetrics'

/** Render live on-canvas SVG optical metrics guide lines and bounds */
export function OpticalMetricsOverlay({ node }: { readonly node: TextElement }) {
  const metrics = useMemo(() => computeTextOpticalMetrics(node), [node])

  const slant = metrics.slantAngle ?? 0

  return (
    <svg
      className="scene-optical-metrics-guide"
      data-testid="optical-metrics-overlay"
      data-glyph-count={metrics.glyphCount}
      data-line-count={metrics.lineCount}
      data-slant-angle={slant}
      viewBox={`0 0 ${node.width} ${node.height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        overflow: 'visible',
        pointerEvents: 'none',
        zIndex: 2147483642,
      }}
    >
      <defs>
        <pattern id="paper-optical-hatch" width="4" height="4" patternUnits="userSpaceOnUse">
          <path d="M-1,1 l2,-2 M0,4 l4,-4 M3,5 l2,-2" stroke="#81adec" strokeWidth="0.5" strokeOpacity="0.25" />
        </pattern>
      </defs>

      {metrics.lines.map((line) => {
        const lineOffset = line.lineOffset ?? 0
        const slantTransform = slant !== 0 ? `skewX(${-slant})` : undefined

        return (
          <g key={`line-${line.lineIndex}`}>
            {/* Baseline guide */}
            <line
              x1="0"
              y1={line.baseline}
              x2={node.width}
              y2={line.baseline}
              stroke="#81adec"
              strokeWidth="1"
              strokeDasharray="3 3"
              strokeOpacity="0.75"
              vectorEffect="non-scaling-stroke"
            />

            {/* Cap Height guide */}
            <line
              x1="0"
              y1={line.capHeight}
              x2={node.width}
              y2={line.capHeight}
              stroke="#edebe1"
              strokeWidth="0.75"
              strokeDasharray="2 2"
              strokeOpacity="0.45"
              vectorEffect="non-scaling-stroke"
            />

            {/* X-Height guide */}
            <line
              x1="0"
              y1={line.xHeight}
              x2={node.width}
              y2={line.xHeight}
              stroke="#888888"
              strokeWidth="0.5"
              strokeDasharray="1 3"
              strokeOpacity="0.4"
              vectorEffect="non-scaling-stroke"
            />

            {/* Descender guide */}
            <line
              x1="0"
              y1={line.descent}
              x2={node.width}
              y2={line.descent}
              stroke="#888888"
              strokeWidth="0.5"
              strokeDasharray="2 4"
              strokeOpacity="0.3"
              vectorEffect="non-scaling-stroke"
            />

            {/* Optical margin hanging protrusion line if active */}
            {node.opticalMarginAlignment && line.opticalMarginLeft > 0 && (
              <line
                x1={lineOffset - line.opticalMarginLeft}
                y1={line.capHeight}
                x2={lineOffset - line.opticalMarginLeft}
                y2={line.descent}
                stroke="#81adec"
                strokeWidth="1.2"
                strokeDasharray="2 2"
                vectorEffect="non-scaling-stroke"
              />
            )}

            {/* Glyph optical bounds and pairwise kerning ticks */}
            <g
              transform={slantTransform}
              style={slant !== 0 ? { transformOrigin: `0px ${line.baseline}px` } : undefined}
            >
              {line.glyphs.map((glyph) => {
                if (glyph.isWhitespace) return null

                return (
                  <g key={`glyph-${line.lineIndex}-${glyph.index}`}>
                    <title>{`${glyph.char} (${glyph.codePoint}) · W:${glyph.width}px · Adv:${glyph.advance}px`}</title>
                    {/* Glyph optical box */}
                    <rect
                      x={glyph.x + glyph.leftSideBearing}
                      y={glyph.y}
                      width={glyph.width}
                      height={glyph.height}
                      fill="#81adec"
                      fillOpacity="0.08"
                      stroke="#81adec"
                      strokeWidth="0.75"
                      strokeOpacity="0.35"
                      vectorEffect="non-scaling-stroke"
                      rx="1"
                    />

                    {/* Left sidebearing tick */}
                    <line
                      x1={glyph.x + glyph.leftSideBearing}
                      y1={line.baseline - 3}
                      x2={glyph.x + glyph.leftSideBearing}
                      y2={line.baseline + 3}
                      stroke="#81adec"
                      strokeWidth="1"
                      strokeOpacity="0.6"
                      vectorEffect="non-scaling-stroke"
                    />

                    {/* Right sidebearing tick */}
                    <line
                      x1={glyph.x + glyph.leftSideBearing + glyph.width}
                      y1={line.baseline - 3}
                      x2={glyph.x + glyph.leftSideBearing + glyph.width}
                      y2={line.baseline + 3}
                      stroke="#81adec"
                      strokeWidth="1"
                      strokeOpacity="0.6"
                      vectorEffect="non-scaling-stroke"
                    />

                    {/* Pairwise kerning adjustment indicator */}
                    {glyph.opticalKerningDelta !== 0 && (
                      <g>
                        <line
                          x1={glyph.x + glyph.advance}
                          y1={line.baseline - 6}
                          x2={glyph.x + glyph.advance + glyph.opticalKerningDelta}
                          y2={line.baseline - 6}
                          stroke="#81adec"
                          strokeWidth="1.5"
                          vectorEffect="non-scaling-stroke"
                        />
                        <circle
                          cx={glyph.x + glyph.advance + glyph.opticalKerningDelta}
                          cy={line.baseline - 6}
                          r="1.5"
                          fill="#81adec"
                          vectorEffect="non-scaling-stroke"
                        />
                      </g>
                    )}
                  </g>
                )
              })}
            </g>
          </g>
        )
      })}
    </svg>
  )
}
