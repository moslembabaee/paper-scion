import { useId, useMemo } from 'react'
import type { CSSProperties } from 'react'
import type { TextElement } from './types'
import { shapeText } from './fontEngine'
import { cascadeOffset, placeGlyphs } from './kineticGeometry'
import { calculateStaggerDelay } from './glyphDecomposition'
import { useOutlineFont } from './useOutlineFont'
import { compileTypographyStyles } from './typography'
import { ShapeShader } from '../shaders/ShapeShader'

/** Animation stays in the compositor; scene/history never update on animation frames. */
export function KineticText({ node, pathD }: { node: TextElement; pathD: string }) {
  const clipId = useId()
  const loaded = useOutlineFont(node.fontSource)
  const shaped = useMemo(() => {
    if (!loaded?.font) return null
    try { return shapeText(loaded.font, node) } catch { return null }
    // Animation/paint edits do not reshape the glyph run.
  }, [loaded, node.text, node.fontSize, node.fontWeight, node.variableAxes, node.openTypeFeatures, node.fontKerning, node.opticalKerning, node.letterSpacing, node.lineHeight, node.width, node.textTransform, node.textOnPath?.enabled, node.textOnPath?.spacing])
  const layout = useMemo(() => {
    if (!loaded?.font || !shaped) return null
    try { return { glyphs: placeGlyphs(node, shaped, loaded.font.unitsPerEm, pathD) } }
    catch { return null }
  }, [loaded, shaped, node, pathD])
  const k = node.kinetic!

  if (!layout) {
    const chars = Array.from(node.text)
    const charCount = Math.max(1, chars.length)
    const baseAxes = node.variableAxes ?? {}
    const baseWght = baseAxes.wght ?? node.fontWeight ?? 400
    const baseSlnt = baseAxes.slnt ?? 0
    const baseStyles = compileTypographyStyles(node)
    const fill = node.style.fill
    const stroke = node.style.stroke
    const shadow = !node.style.effects?.some(e => e.enabled) ? node.style.shadow : null
    const shadowStyle = shadow ? { filter: `drop-shadow(${shadow.x}px ${shadow.y}px ${shadow.blur / 2}px ${shadow.color})` } : undefined

    return (
      <>
        {node.style.shader && <ShapeShader node={node} textPathD={pathD} />}
        <div
          className="scene-text scene-kinetic-html"
          data-playing={k.playing}
          style={{
            ...shadowStyle,
            ...baseStyles,
            color: node.style.shader ? 'transparent' : fill ?? 'transparent',
            WebkitTextStroke: stroke ? `${stroke.width}px ${stroke.color}` : undefined,
          }}
        >
          {chars.map((char, index) => {
            if (char === '\n') return <br key={index} />
            const offset = cascadeOffset(k, index, charCount)
            const scale = offset.scale ?? 1
            const wghtDelta = offset.weightDelta ?? 0
            const slntDelta = offset.slantDelta ?? 0
            const wdthDelta = offset.widthDelta ?? 0
            const opszDelta = offset.opticalSizeDelta ?? 0
            const delay = calculateStaggerDelay(k.staggerMode, index, charCount, k.stagger)

            let charVariation = baseStyles.fontVariationSettings
            if (wghtDelta !== 0 || slntDelta !== 0 || wdthDelta !== 0 || opszDelta !== 0) {
              const effWght = Math.max(1, Math.min(1000, baseWght + wghtDelta))
              const effSlnt = Math.max(-90, Math.min(90, baseSlnt + slntDelta))
              const effWdth = Math.max(25, Math.min(200, (baseAxes.wdth ?? 100) + wdthDelta))
              const effOpsz = Math.max(6, Math.min(144, (baseAxes.opsz ?? node.fontSize) + opszDelta))
              const parts = [
                `'wght' ${Number(effWght.toFixed(1))}`,
                `'wdth' ${Number(effWdth.toFixed(1))}`,
                `'slnt' ${Number(effSlnt.toFixed(1))}`,
                `'opsz' ${Number(effOpsz.toFixed(1))}`,
              ]
              charVariation = parts.join(', ')
            }

            const charStyle: CSSProperties = {
              display: 'inline-block',
              whiteSpace: 'pre',
              willChange: 'transform',
              '--cascade-amplitude': `${k.amplitude}px`,
              '--cascade-rotation': `${k.rotation}deg`,
              animationDuration: `${k.duration}s`,
              animationDelay: `${-(k.phase * k.duration + delay / 1000)}s`,
              transform: `translate(${offset.x ?? 0}px, ${offset.y}px) rotate(${offset.angle}deg)${scale !== 1 ? ` scale(${scale})` : ''}`,
              ...(charVariation ? { fontVariationSettings: charVariation } : {}),
            } as CSSProperties

            return (
              <span key={index} className="kinetic-glyph-char" data-glyph-index={index} style={charStyle}>
                {char}
              </span>
            )
          })}
        </div>
      </>
    )
  }

  const glyphCount = layout.glyphs.length
  const glyphStyle = (index: number): CSSProperties => {
    const offset = cascadeOffset(k, index, glyphCount)
    const scale = offset.scale ?? 1
    const delay = calculateStaggerDelay(k.staggerMode, index, glyphCount, k.stagger)
    return {
      '--cascade-amplitude': `${k.amplitude}px`,
      '--cascade-rotation': `${k.rotation}deg`,
      animationDuration: `${k.duration}s`,
      animationDelay: `${-(k.phase * k.duration + delay / 1000)}s`,
      transform: `translate(${offset.x ?? 0}px, ${offset.y}px) rotate(${offset.angle}deg)${scale !== 1 ? ` scale(${scale})` : ''}`,
    } as CSSProperties
  }
  return <svg className="scene-text-on-path scene-kinetic-text" viewBox={`0 0 ${node.width} ${node.height}`} preserveAspectRatio="none" role="img" aria-label={node.text}
    data-playing={k.playing} style={{ filter: !node.style.effects?.some(effect => effect.enabled) && node.style.shadow ? `drop-shadow(${node.style.shadow.x}px ${node.style.shadow.y}px ${node.style.shadow.blur / 2}px ${node.style.shadow.color})` : undefined }}>
    {node.style.shader && <>
      <defs><clipPath id={clipId} clipPathUnits="userSpaceOnUse">{layout.glyphs.map(glyph => {
        const base = `translate(${glyph.x}px, ${glyph.y}px) rotate(${glyph.angle}deg)`
        const font = `translate(${glyph.origin + glyph.dx}px, ${glyph.dy}px) scale(${glyph.scale}, ${-glyph.scale})`
        const motion = glyphStyle(glyph.index)
        return <path key={glyph.index} className="kinetic-glyph" d={glyph.d} style={{ ...motion, '--cascade-base': base, '--cascade-font': font, transform: `${base} ${motion.transform} ${font}` } as CSSProperties} />
      })}</clipPath></defs>
      <foreignObject width={node.width} height={node.height}><ShapeShader node={node} clipPathId={clipId} /></foreignObject>
    </>}
    <g fill={node.style.shader ? 'none' : node.style.fill ?? 'none'} stroke={node.style.stroke?.color ?? 'none'} strokeWidth={node.style.stroke?.width ?? 0} strokeDasharray={node.style.stroke?.dash.join(' ')}>
      {layout.glyphs.map(glyph => {
        const style = glyphStyle(glyph.index)
        return <g key={glyph.index} transform={`translate(${glyph.x} ${glyph.y}) rotate(${glyph.angle})`}>
          <g className="kinetic-glyph" style={style}><path d={glyph.d} transform={`translate(${glyph.origin + glyph.dx} ${glyph.dy}) scale(${glyph.scale} ${-glyph.scale})`} strokeWidth={(node.style.stroke?.width ?? 0) / glyph.scale} /></g>
        </g>
      })}
    </g>
  </svg>
}
