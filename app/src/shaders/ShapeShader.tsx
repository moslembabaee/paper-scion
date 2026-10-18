import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import type { SceneElement } from '../scene/types'
import { textMarkup } from '../scene/textMarkup'
import { ShaderSurface } from './ShaderSurface'

const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!)

export function ShapeShader({ node, textPathD = '', clipPathId }: { node: SceneElement; textPathD?: string; clipPathId?: string }) {
  const { type, width, height } = node
  const textNode = node.type === 'text' ? node : undefined
  const textSvg = useMemo(() => {
    if (!textNode) return ''
    const resolved = textNode.textOnPath?.enabled ? { ...textNode, textOnPath: { ...textNode.textOnPath, pathId: null, preset: 'custom' as const, pathData: textPathD, reverse: false, side: 'left' as const } } : textNode
    const context = document.createElement('canvas').getContext('2d')
    if (context) context.font = `${textNode.variableAxes?.wght ?? textNode.fontWeight} ${textNode.fontSize}px ${textNode.fontFamily}`
    return textMarkup(resolved, 'white', context ? text => context.measureText(text).width : undefined)
  }, [textNode, textPathD])
  const d = node.type === 'path' ? node.d : ''
  const fillRule = node.type === 'path' ? node.fillRule : 'nonzero'
  const viewBox = node.type === 'path' ? node.viewBox.join(' ') : `0 0 ${width} ${height}`
  const mask = useMemo(() => {
    if (type !== 'path' && type !== 'text') return undefined
    const content = type === 'path' ? `<path fill="white" fill-rule="${fillRule}" d="${escape(d)}"/>` : textSvg
    return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}" preserveAspectRatio="none">${content}</svg>`)}")`
  }, [type, width, height, viewBox, fillRule, d, textSvg])
  if (!node.style.shader) return null
  const style: CSSProperties = {
    borderRadius: node.type === 'ellipse' ? '50%' : 'cornerRadius' in node ? node.cornerRadius : undefined,
    maskImage: clipPathId ? undefined : mask, maskSize: '100% 100%', maskRepeat: 'no-repeat',
    clipPath: clipPathId ? `url(#${clipPathId})` : undefined,
  }
  const shadow = node.type !== 'frame' && node.type !== 'image' && !node.style.effects?.some(effect => effect.enabled) ? node.style.shadow : null
  return <div className="shape-shader-wrap" style={{ filter: shadow ? `drop-shadow(${shadow.x}px ${shadow.y}px ${shadow.blur / 2}px ${shadow.color})` : undefined }}>
    <div className="shader-base-paint" style={{ ...style, background: node.style.fill ?? undefined }}>
      {node.type === 'image' && <img src={node.src} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: node.fit }} />}
    </div>
    <ShaderSurface paint={node.style.shader} style={style} />
  </div>
}
