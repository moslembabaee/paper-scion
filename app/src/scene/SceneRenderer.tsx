import { effectFilterMarkup } from '../tokens/effects'
import { memo, useId, useMemo, useSyncExternalStore } from 'react'
import type { CSSProperties } from 'react'
import type { SceneStore } from './store'
import type { BooleanOperation, SceneElement } from './types'
import { useScene } from './useScene'
import { ShapeShader } from '../shaders/ShapeShader'
import { frameMask, maskPathData, maskFillRule, isVectorMask, isAlphaMask, isLuminanceMask, isMaskInverted, isMaskIsolated } from './maskGeometry'
import { compileTypographyStyles, embeddedFontCSS, resolveTextPathD, textPathOffset } from './typography'
import { createCurvePath } from './textOnPath'
import { textMarkup } from './textMarkup'
import { KineticText } from './KineticText'
import { OpticalMetricsOverlay } from './OpticalMetricsOverlay'
import { gradientToCSS, gradientToShaderPaint } from '../shaders/gradient'
import type { ShaderPaint } from '../shaders/types'
import './scene.css'

interface NodeProps { store: SceneStore; id: string; interactive: boolean; inheritedLocked?: boolean; presentationRoot?: boolean; presentation?: boolean }

const BOOLEAN_OP_SYMBOLS: Record<BooleanOperation, { symbol: string; label: string }> = {
  union: { symbol: '∪', label: 'Union' },
  subtract: { symbol: '∖', label: 'Subtract' },
  intersect: { symbol: '∩', label: 'Intersect' },
  exclude: { symbol: '⊕', label: 'Exclude' },
}

/** Render in the operands' parent space so nested frame transforms and masks apply. */
function BooleanCanvasPreview({ store, parentId }: { store: SceneStore; parentId: string | null }) {
  const read = () => { const preview = store.getBooleanPreview(); return preview?.node.parentId === parentId ? preview : null }
  const preview = useSyncExternalStore(store.subscribeBooleanPreview, read, read)
  if (!preview) return null
  const { node, operation } = preview
  const opInfo = BOOLEAN_OP_SYMBOLS[operation]
  return <div className="boolean-canvas-preview" data-testid="boolean-canvas-preview" data-operation={operation} style={{ left: node.x, top: node.y, width: node.width, height: node.height, transform: `rotate(${node.rotation}deg)` }} aria-hidden="true">
    <div className="boolean-preview-indicator-badge" data-testid="boolean-preview-badge">
      <span className="indicator-symbol">{opInfo.symbol}</span>
      <span>{opInfo.label} Preview</span>
    </div>
    <svg viewBox={node.viewBox.join(' ')} preserveAspectRatio="none"><path d={node.d} fillRule={node.fillRule} vectorEffect="non-scaling-stroke" /></svg>
  </div>
}

function Paint({ node, pathD, paintId, activeShader }: { node: SceneElement; pathD: string; paintId: string; activeShader?: ShaderPaint | null }) {
  const { fill: solidFill, stroke, shader } = node.style
  const shadow = node.style.effects?.some(effect => effect.enabled) ? null : node.style.shadow
  const gradient = node.style.gradient && node.style.gradient.enabled !== false ? node.style.gradient : null
  const isShaderActive = !!(shader || activeShader)
  const gradId = `gradient-${paintId}`
  const rad = gradient ? (gradient.angle * Math.PI) / 180 : 0
  const spreadHalf = gradient ? gradient.spread * 0.5 : 0.5
  const svgGradientDefs = gradient && !isShaderActive && (gradient.type === 'linear' || gradient.type === 'radial') ? (
    <defs>
      {gradient.type === 'linear' ? (
        <linearGradient
          id={gradId}
          x1={`${((gradient.origin.x - Math.cos(rad) * spreadHalf) * 100).toFixed(2)}%`}
          y1={`${((gradient.origin.y - Math.sin(rad) * spreadHalf) * 100).toFixed(2)}%`}
          x2={`${((gradient.origin.x + Math.cos(rad) * spreadHalf) * 100).toFixed(2)}%`}
          y2={`${((gradient.origin.y + Math.sin(rad) * spreadHalf) * 100).toFixed(2)}%`}
        >
          {gradient.stops.map(s => (
            <stop key={s.id} offset={`${(s.offset * 100).toFixed(2)}%`} stopColor={s.color} stopOpacity={s.opacity ?? 1} />
          ))}
        </linearGradient>
      ) : (
        <radialGradient
          id={gradId}
          cx={`${(gradient.origin.x * 100).toFixed(2)}%`}
          cy={`${(gradient.origin.y * 100).toFixed(2)}%`}
          r={`${(gradient.spread * 50).toFixed(2)}%`}
          fx={`${((gradient.origin.x + Math.cos(rad) * gradient.focalLength * 0.25) * 100).toFixed(2)}%`}
          fy={`${((gradient.origin.y + Math.sin(rad) * gradient.focalLength * 0.25) * 100).toFixed(2)}%`}
        >
          {gradient.stops.map(s => (
            <stop key={s.id} offset={`${(s.offset * 100).toFixed(2)}%`} stopColor={s.color} stopOpacity={s.opacity ?? 1} />
          ))}
        </radialGradient>
      )}
    </defs>
  ) : null

  const fill = isShaderActive ? null : gradient ? `url(#${gradId})` : solidFill
  const shadowStyle = shadow ? { filter: `drop-shadow(${shadow.x}px ${shadow.y}px ${shadow.blur / 2}px ${shadow.color})` } : undefined
  if (node.type === 'frame') return null
  if (node.type === 'text') {
    if (node.kinetic?.enabled) return <KineticText node={node} pathD={pathD} />
    if (node.textOnPath?.enabled) {
      const pathNode = { ...node, textOnPath: { ...node.textOnPath, pathId: null, preset: 'custom' as const, pathData: pathD, reverse: false, side: 'left' as const } }
      return <svg className="scene-text-on-path" viewBox={`0 0 ${node.width} ${node.height}`} preserveAspectRatio="none" style={shadowStyle} role="img" aria-label={node.text}>
        {svgGradientDefs}
        <g stroke={stroke?.color ?? 'none'} strokeWidth={stroke?.width ?? 0} dangerouslySetInnerHTML={{ __html: textMarkup(pathNode, fill ?? 'none', undefined, undefined, undefined, paintId) }} />
      </svg>
    }
    const textGradStyle: CSSProperties = gradient && !isShaderActive ? {
      background: gradientToCSS(gradient),
      WebkitBackgroundClip: 'text',
      WebkitTextFillColor: 'transparent',
      color: 'transparent',
    } : { color: fill ?? 'transparent' }
    return <div className="scene-text" style={{ ...shadowStyle, ...compileTypographyStyles(node), ...textGradStyle, WebkitTextStroke: stroke ? `${stroke.width}px ${stroke.color}` : undefined }}>{node.text}</div>
  }
  if (node.type === 'image') {
    return <div className="scene-image" style={{ background: fill ?? undefined, borderRadius: node.cornerRadius, boxShadow: shadow ? `${shadow.x}px ${shadow.y}px ${shadow.blur}px ${shadow.color}` : undefined }}>
      <img src={node.src} alt={node.alt} draggable={false} style={{ objectFit: node.fit, borderRadius: node.cornerRadius, visibility: shader ? 'hidden' : undefined }} />
      {stroke && <div className="scene-image-border" style={{ border: `${stroke.width}px ${stroke.dash.length ? 'dashed' : 'solid'} ${stroke.color}`, borderRadius: node.cornerRadius }} />}
    </div>
  }
  const paint = { fill: fill ?? 'none', stroke: stroke?.color ?? 'none', strokeWidth: stroke?.width ?? 0, strokeDasharray: stroke?.dash.join(' '), strokeLinejoin: 'round' as const }
  const inset = (stroke?.width ?? 0) / 2
  const viewBox = node.type === 'path' ? node.viewBox.join(' ') : `0 0 ${node.width} ${node.height}`
  return <svg className="scene-vector" viewBox={viewBox} preserveAspectRatio="none" style={shadowStyle} aria-hidden="true">
    {svgGradientDefs}
    {node.type === 'rectangle' && <rect x={inset} y={inset} width={Math.max(0, node.width - inset * 2)} height={Math.max(0, node.height - inset * 2)} rx={node.cornerRadius} {...paint} />}
    {node.type === 'ellipse' && <ellipse cx={node.width / 2} cy={node.height / 2} rx={Math.max(0, node.width / 2 - inset)} ry={Math.max(0, node.height / 2 - inset)} {...paint} />}
    {node.type === 'path' && <path d={node.d} fillRule={node.fillRule} {...paint} />}
  </svg>
}

const SceneNode = memo(function SceneNode({ store, id, interactive, inheritedLocked = false, presentationRoot = false, presentation = false }: NodeProps) {
  const effectId = useId().replace(/:/g, "")
  const node = useScene(store, state => state.elements[id])
  const pathD = useScene(store, state => {
    const text = state.elements[id]
    return text?.type === 'text' && text.textOnPath?.enabled ? resolveTextPathD(text, state.elements) : ''
  })
  const mask = useScene(store, state => { const frame = state.elements[id]; return frame?.type === 'frame' ? frameMask(state.elements, frame) : undefined })
  const maskSelected = useScene(store, state => !!mask && state.selection.includes(mask.id))
  const selected = useScene(store, state => state.selection.includes(id))
  const previewSource = useSyncExternalStore(store.subscribeBooleanPreview, () => !presentation && !!store.getBooleanPreview()?.sourceIds.includes(id), () => false)
  const effects = node?.style.effects
  const effectMarkup = useMemo(() => effects ? effectFilterMarkup(effects, effectId) : '', [effects, effectId])
  if (!node || !node.visible) return null
  const locked = inheritedLocked || node.locked
  const isFrame = node.type === 'frame'
  const style: CSSProperties = {
    left: presentationRoot ? 0 : node.x, top: presentationRoot ? 0 : node.y, width: node.width, height: node.height,
    zIndex: presentationRoot ? 0 : node.zIndex, transform: !presentationRoot && node.rotation ? `rotate(${node.rotation}deg)` : undefined,
    pointerEvents: interactive && (presentation || !locked) ? 'auto' : 'none',
    opacity: previewSource ? .2 : undefined,
  }
  const hasEffects = node.style.effects?.some(effect => effect.enabled)
  const gradient = node.style.gradient && node.style.gradient.enabled !== false ? node.style.gradient : null
  const activeShader = node.style.shader ?? (gradient && (gradient.linkToShader || gradient.type === 'angular') ? gradientToShaderPaint(gradient) : null)
  const frameStyle: CSSProperties | undefined = isFrame ? {
    background: activeShader ? undefined : gradient ? gradientToCSS(gradient) : node.style.fill ?? undefined, borderRadius: node.cornerRadius,
    overflow: node.clipContent && !presentationRoot ? 'hidden' : 'visible',
    boxShadow: !hasEffects && node.style.shadow ? `${node.style.shadow.x}px ${node.style.shadow.y}px ${node.style.shadow.blur}px ${node.style.shadow.color}` : (node.style.fill === null && !gradient) ? 'none' : undefined,
  } : undefined
  return <div className={`scene-node ${isFrame ? 'scene-frame' : ''} ${selected ? 'is-selected' : ''}`} style={style} data-element-id={id} data-element-type={node.type} data-component-kind={node.component?.kind} data-component-master={node.component?.kind === 'instance' ? node.component.masterId : undefined} data-boolean-operation={node.type === 'path' ? node.boolean?.operation : undefined} aria-label={node.name}>
    {isFrame && node.parentId === null && !presentation && <div className="artboard-label">{node.name}<span>{node.width} × {node.height}</span></div>}
    {hasEffects && <svg width="0" height="0" style={{ position: 'absolute', pointerEvents: 'none' }} aria-hidden="true"><defs dangerouslySetInnerHTML={{ __html: effectMarkup }} /></svg>}
    <div className="scene-content" style={{ ...frameStyle, opacity: node.style.opacity, filter: hasEffects ? `url(#${effectId})` : undefined }}>
      {node.type === 'text' && node.fontSource && <style>{embeddedFontCSS(node)}</style>}
      {activeShader && !(node.type === 'text' && node.kinetic?.enabled) && <ShapeShader node={{ ...node, style: { ...node.style, shader: activeShader } }} textPathD={pathD} />}
      <Paint node={node} pathD={pathD} paintId={`${effectId}-text`} activeShader={activeShader} />
      {node.type === 'text' && !presentation && node.showOpticalMetrics && (
        <OpticalMetricsOverlay node={node} />
      )}
      {selected && !presentation && node.type === 'text' && node.textOnPath?.enabled && (() => {
        const curve = pathD ? createCurvePath(pathD) : null
        const offsetPx = node.textOnPath?.offsetMode === 'pixels'
          ? (node.textOnPath.offset ?? 0)
          : curve ? curve.length * (textPathOffset(node) / 100) : 0
        const offsetPt = curve && curve.length > 0 ? curve.at(offsetPx) : null
        return (
          <svg className="scene-text-path-guide" viewBox={`0 0 ${node.width} ${node.height}`} preserveAspectRatio="none" aria-hidden="true">
            <path d={pathD} fill="none" stroke="#81adec" strokeWidth="1" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
            {offsetPt && (
              <circle cx={offsetPt.x} cy={offsetPt.y} r="3.5" fill="#81adec" stroke="#080808" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            )}
          </svg>
        )
      })()}
      {isFrame && mask && (
        <svg width="0" height="0" className="scene-mask-defs" aria-hidden="true" style={{ position: 'absolute', pointerEvents: 'none' }}>
          <defs>
            {isVectorMask(mask) && !isMaskInverted(mask) ? (
              <clipPath id={`${effectId}-mask`} clipPathUnits="userSpaceOnUse">
                <path d={maskPathData(mask)} clipRule={maskFillRule(mask)} />
              </clipPath>
            ) : (
              <>
                {mask.style.gradient?.stops && mask.style.gradient.stops.length >= 2 && (
                  mask.style.gradient.type === 'radial' ? (
                    <radialGradient
                      id={`${effectId}-mask-grad`}
                      cx={`${((mask.style.gradient.origin?.x ?? 0.5) * 100).toFixed(1)}%`}
                      cy={`${((mask.style.gradient.origin?.y ?? 0.5) * 100).toFixed(1)}%`}
                      r={`${((mask.style.gradient.spread ?? 1) * 50).toFixed(1)}%`}
                    >
                      {mask.style.gradient.stops.map((s, idx) => (
                        <stop key={s.id || idx} offset={`${(s.offset * 100).toFixed(1)}%`} stopColor={s.color} stopOpacity={s.opacity ?? 1} />
                      ))}
                    </radialGradient>
                  ) : (
                    <linearGradient
                      id={`${effectId}-mask-grad`}
                      x1={`${(50 - Math.cos(((mask.style.gradient.angle ?? 0) * Math.PI) / 180) * 50).toFixed(1)}%`}
                      y1={`${(50 - Math.sin(((mask.style.gradient.angle ?? 0) * Math.PI) / 180) * 50).toFixed(1)}%`}
                      x2={`${(50 + Math.cos(((mask.style.gradient.angle ?? 0) * Math.PI) / 180) * 50).toFixed(1)}%`}
                      y2={`${(50 + Math.sin(((mask.style.gradient.angle ?? 0) * Math.PI) / 180) * 50).toFixed(1)}%`}
                    >
                      {mask.style.gradient.stops.map((s, idx) => (
                        <stop key={s.id || idx} offset={`${(s.offset * 100).toFixed(1)}%`} stopColor={s.color} stopOpacity={s.opacity ?? 1} />
                      ))}
                    </linearGradient>
                  )
                )}
                {isLuminanceMask(mask) && (
                  <filter id={`${effectId}-lum-filter`} x="0%" y="0%" width="100%" height="100%">
                    {isMaskInverted(mask) && (
                      <feComponentTransfer>
                        <feFuncR type="linear" slope="-1" intercept="1" />
                        <feFuncG type="linear" slope="-1" intercept="1" />
                        <feFuncB type="linear" slope="-1" intercept="1" />
                      </feComponentTransfer>
                    )}
                    {(mask.mask?.luminanceThreshold ?? 0.5) !== 0.5 && (
                      <feComponentTransfer>
                        <feFuncR type="linear" slope={1 / Math.max(0.01, 1 - (mask.mask?.luminanceThreshold ?? 0.5))} intercept={-(mask.mask?.luminanceThreshold ?? 0.5) / Math.max(0.01, 1 - (mask.mask?.luminanceThreshold ?? 0.5))} />
                        <feFuncG type="linear" slope={1 / Math.max(0.01, 1 - (mask.mask?.luminanceThreshold ?? 0.5))} intercept={-(mask.mask?.luminanceThreshold ?? 0.5) / Math.max(0.01, 1 - (mask.mask?.luminanceThreshold ?? 0.5))} />
                        <feFuncB type="linear" slope={1 / Math.max(0.01, 1 - (mask.mask?.luminanceThreshold ?? 0.5))} intercept={-(mask.mask?.luminanceThreshold ?? 0.5) / Math.max(0.01, 1 - (mask.mask?.luminanceThreshold ?? 0.5))} />
                      </feComponentTransfer>
                    )}
                  </filter>
                )}
                <mask
                  id={`${effectId}-mask`}
                  maskUnits="userSpaceOnUse"
                  maskContentUnits="userSpaceOnUse"
                  x="0"
                  y="0"
                  width={node.width}
                  height={node.height}
                >
                  {(isVectorMask(mask) && isMaskInverted(mask)) || (isAlphaMask(mask) && isMaskInverted(mask)) ? (
                    <>
                      <rect x="0" y="0" width={node.width} height={node.height} fill="#ffffff" />
                      <path
                        d={maskPathData(mask)}
                        fill="#000000"
                        fillRule={maskFillRule(mask)}
                        opacity={mask.style.opacity ?? 1}
                      />
                    </>
                  ) : isAlphaMask(mask) ? (
                    <path
                      d={maskPathData(mask)}
                      fill={mask.style.gradient ? `url(#${effectId}-mask-grad)` : '#ffffff'}
                      fillRule={maskFillRule(mask)}
                      opacity={mask.style.opacity ?? 1}
                    />
                  ) : (
                    /* Luminance mask */
                    <path
                      d={maskPathData(mask)}
                      fill={mask.style.gradient ? `url(#${effectId}-mask-grad)` : (mask.style.fill ?? '#ffffff')}
                      fillRule={maskFillRule(mask)}
                      opacity={mask.style.opacity ?? 1}
                      filter={`url(#${effectId}-lum-filter)`}
                    />
                  )}
                </mask>
              </>
            )}
          </defs>
        </svg>
      )}
      {isFrame && (
        <div
          className={`scene-children ${mask && isMaskIsolated(mask) ? 'is-mask-isolated' : ''}`}
          data-mask-source={mask?.id}
          data-mask-mode={mask?.mask?.mode ?? 'vector'}
          data-mask-inverted={mask ? String(isMaskInverted(mask)) : undefined}
          data-mask-isolated={mask ? String(isMaskIsolated(mask)) : undefined}
          style={{
            clipPath: mask && isVectorMask(mask) && !isMaskInverted(mask) ? `url(#${effectId}-mask)` : undefined,
            mask: mask && (!isVectorMask(mask) || isMaskInverted(mask)) ? `url(#${effectId}-mask)` : undefined,
            WebkitMask: mask && (!isVectorMask(mask) || isMaskInverted(mask)) ? `url(#${effectId}-mask)` : undefined,
          }}
        >
          {node.children.filter(childId => childId !== mask?.id).map(childId => (
            <SceneNode key={childId} store={store} id={childId} interactive={interactive} inheritedLocked={locked} presentation={presentation} />
          ))}
          {!presentation && <BooleanCanvasPreview store={store} parentId={id} />}
        </div>
      )}
      {isFrame && mask && !presentation && (mask.mask?.showOutline || maskSelected || isMaskIsolated(mask)) && (
        <svg className={`scene-mask-outline ${isMaskIsolated(mask) ? 'is-isolated' : ''}`} viewBox={`0 0 ${node.width} ${node.height}`} preserveAspectRatio="none" aria-hidden="true">
          {isMaskIsolated(mask) && (
            <path d={maskPathData(mask)} fill="#81adec" fillOpacity="0.14" vectorEffect="non-scaling-stroke" />
          )}
          <path d={maskPathData(mask)} fill="none" stroke="#81adec" strokeWidth={isMaskIsolated(mask) ? "1.5" : "1"} strokeDasharray={isMaskIsolated(mask) ? "5 3" : "4 3"} vectorEffect="non-scaling-stroke" />
        </svg>
      )}
      {isFrame && node.style.stroke && <div className="scene-frame-border" style={{ border: `${node.style.stroke.width}px ${node.style.stroke.dash.length ? 'dashed' : 'solid'} ${node.style.stroke.color}`, borderRadius: node.cornerRadius }} />}
    </div>
  </div>
})

export const SceneRenderer = memo(function SceneRenderer({ store, interactive = true, frameId }: { store: SceneStore; interactive?: boolean; frameId?: string }) {
  const rootIds = useScene(store, state => state.rootIds)
  if (frameId) return <SceneNode store={store} id={frameId} interactive={interactive} presentation presentationRoot />
  return <>{rootIds.map(id => <SceneNode key={id} store={store} id={id} interactive={interactive} />)}<BooleanCanvasPreview store={store} parentId={null} /></>
})
