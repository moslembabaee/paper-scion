import type { Bounds } from '../canvas/types.ts'
import { cascadeOffset } from '../scene/kineticGeometry.ts'
import type {
  FrameElement,
  PathElement,
  RectangleElement,
  SceneElement,
  SceneSnapshot,
  TextElement,
} from '../scene/types.ts'
import { trackValue } from '../motion/model.ts'
import type { MotionDocument } from '../motion/types.ts'
import { prepareMorph, interpolateMorph } from '../morph/interpolate.ts'
import { parseMorphTarget } from '../morph/normalize.ts'
import type { MorphConfig, MorphTarget } from '../morph/types.ts'
import { exportBounds, exportRoots, xml } from './svg.ts'
import { optimizeSVGPath } from './pathOptimize.ts'

export interface AnimatedSvgOptions {
  readonly fps?: number
  readonly duration?: number // in seconds
  readonly loop?: boolean
  readonly background?: 'transparent' | 'cream'
  readonly mode?: 'smil' | 'css' | 'both'
  readonly scope?: 'selection' | 'canvas'
  readonly precision?: number
  readonly pretty?: boolean
  readonly name?: string
}

const num = (v: number, decimals = 3): string => {
  const factor = 10 ** decimals
  const rounded = Math.round(v * factor) / factor
  return String(rounded)
}

/** Render basic vector shape markup */
function renderStaticShape(element: SceneElement, inset = 0): string {
  const { stroke } = element.style
  const strokeWidth = stroke?.width ?? 0
  const strokeAttr = stroke && stroke.color && stroke.color !== 'none' && strokeWidth > 0
    ? `stroke="${xml(stroke.color)}" stroke-width="${num(strokeWidth)}" stroke-dasharray="${stroke.dash?.map(d => num(d)).join(' ') ?? ''}" stroke-linecap="round" stroke-linejoin="round"`
    : ''

  const fill = element.style.fill ?? 'none'
  const fillAttr = `fill="${xml(fill)}"`

  if (element.type === 'rectangle') {
    const rect = element as RectangleElement
    const rx = rect.cornerRadius ? Math.min(rect.cornerRadius, rect.width / 2, rect.height / 2) : 0
    return `<rect x="${num(inset)}" y="${num(inset)}" width="${num(Math.max(0, rect.width - inset * 2))}" height="${num(Math.max(0, rect.height - inset * 2))}" rx="${num(rx)}" ${fillAttr} ${strokeAttr} />`
  }

  if (element.type === 'ellipse') {
    const cx = element.width / 2
    const cy = element.height / 2
    const rx = Math.max(0, cx - inset)
    const ry = Math.max(0, cy - inset)
    return `<ellipse cx="${num(cx)}" cy="${num(cy)}" rx="${num(rx)}" ry="${num(ry)}" ${fillAttr} ${strokeAttr} />`
  }

  if (element.type === 'path') {
    const path = element as PathElement
    const fillRule = path.fillRule ?? 'nonzero'
    const [vx, vy, vw, vh] = path.viewBox || [0, 0, path.width || 1, path.height || 1]
    const sx = path.width / (vw || 1)
    const sy = path.height / (vh || 1)
    const transform = sx !== 1 || sy !== 1 || vx !== 0 || vy !== 0
      ? `transform="matrix(${num(sx)} 0 0 ${num(sy)} ${num(-vx * sx)} ${num(-vy * sy)})"`
      : ''
    return `<path d="${xml(optimizeSVGPath(path.d))}" fill-rule="${fillRule}" ${fillAttr} ${strokeAttr} ${transform} />`
  }

  if (element.type === 'frame') {
    const frame = element as FrameElement
    const rx = frame.cornerRadius || 0
    return `<rect x="${num(inset)}" y="${num(inset)}" width="${num(Math.max(0, frame.width - inset * 2))}" height="${num(Math.max(0, frame.height - inset * 2))}" rx="${num(rx)}" ${fillAttr} ${strokeAttr} />`
  }

  if (element.type === 'text') {
    const text = element as TextElement
    return `<text x="0" y="${num(text.fontSize * 0.8)}" font-family="${xml(text.fontFamily)}" font-size="${num(text.fontSize)}" font-weight="${xml(String(text.fontWeight))}" ${fillAttr} ${strokeAttr}>${xml(text.text)}</text>`
  }

  return ''
}

/** Export Path Morph animation (Target A -> Target B) to optimized self-contained Animated SVG */
export function exportAnimatedSVGFromMorph(
  targetA: MorphTarget,
  targetB: MorphTarget,
  config: MorphConfig,
  options: AnimatedSvgOptions = {},
): string {
  const prepared = prepareMorph(parseMorphTarget(targetA), parseMorphTarget(targetB), config)
  const isPingPong = config.playbackMode === 'pingpong'
  const isOnce = config.playbackMode === 'once'
  const fps = options.fps ?? 30
  const durationSec = Math.max(0.1, config.duration / 1000)
  const cycleDurSec = durationSec * (isPingPong ? 2 : 1)
  const frameCount = Math.max(10, Math.min(120, Math.round(fps * cycleDurSec)))

  const times: number[] = []
  const paths: string[] = []

  for (let i = 0; i <= frameCount; i++) {
    const t = i / frameCount
    const progress = isPingPong ? (t <= 0.5 ? t * 2 : 2 - t * 2) : t
    times.push(Number(t.toFixed(4)))
    paths.push(optimizeSVGPath(interpolateMorph(prepared, progress, config).d))
  }

  const [vx, vy, vw, vh] = targetA.viewBox || [0, 0, 120, 120]
  const mode = options.mode ?? 'both'
  const repeatCount = isOnce ? '1' : 'indefinite'
  const fillRule = targetA.fillRule ?? 'nonzero'
  const fillColor = targetA.color ?? '#81adec'

  const animationId = `paper-morph-${Math.random().toString(36).slice(2, 8)}`

  let cssBlock = ''
  if (mode === 'css' || mode === 'both') {
    const keyframeLines = paths.map((d, idx) => {
      const pct = (times[idx] * 100).toFixed(2)
      return `    ${pct}% { d: path('${d}'); }`
    }).join('\n')

    cssBlock = `
  <style>
    @keyframes ${animationId} {
${keyframeLines}
    }
    .${animationId} {
      animation: ${animationId} ${num(cycleDurSec)}s linear ${isOnce ? 'forwards' : 'infinite'};
    }
  </style>`
  }

  let smilBlock = ''
  if (mode === 'smil' || mode === 'both') {
    smilBlock = `
    <animate
      attributeName="d"
      dur="${num(cycleDurSec)}s"
      repeatCount="${repeatCount}"
      fill="freeze"
      calcMode="linear"
      keyTimes="${times.join(';')}"
      values="${paths.join(';')}"
    />`
  }

  const classAttr = (mode === 'css' || mode === 'both') ? ` class="${animationId}"` : ''
  const background = options.background === 'cream'
    ? `\n  <rect x="${num(vx)}" y="${num(vy)}" width="${num(vw)}" height="${num(vh)}" fill="#edebe1" />`
    : ''

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${num(vx)} ${num(vy)} ${num(vw)} ${num(vh)}" width="${num(vw)}" height="${num(vh)}">
  <defs>${cssBlock}
  </defs>${background}
  <path
    fill="${xml(fillColor)}"
    fill-rule="${fillRule}"
    d="${paths[0]}"${classAttr}
  >${smilBlock}
  </path>
</svg>
`
}

/** Export Spring Physics Motion Document to optimized self-contained Animated SVG */
export function exportAnimatedSVGFromMotion(
  motion: MotionDocument,
  elements: Readonly<Record<string, SceneElement>>,
  bounds?: Bounds,
  options: AnimatedSvgOptions = {},
): string {
  const activeTracks = motion.tracks.filter(t => t.enabled && elements[t.elementId])
  const targetElementIds = [...new Set(activeTracks.map(t => t.elementId))]

  // Compute bounding box if not provided
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  targetElementIds.forEach(id => {
    const el = elements[id]
    if (el) {
      minX = Math.min(minX, el.x)
      minY = Math.min(minY, el.y)
      maxX = Math.max(maxX, el.x + el.width)
      maxY = Math.max(maxY, el.y + el.height)
    }
  })

  const effectiveBounds: Bounds = bounds ?? {
    x: Number.isFinite(minX) ? minX : 0,
    y: Number.isFinite(minY) ? minY : 0,
    width: Number.isFinite(maxX) && maxX > minX ? maxX - minX : 800,
    height: Number.isFinite(maxY) && maxY > minY ? maxY - minY : 600,
  }

  const fps = options.fps ?? motion.fps ?? 60
  const durationMs = Math.max(100, motion.duration || 2000)
  const durationSec = durationMs / 1000
  const totalFrames = Math.max(10, Math.round(durationSec * fps))
  const dt = durationMs / totalFrames
  const isLoop = options.loop ?? motion.loop ?? true
  const repeatCount = isLoop ? 'infinite' : 'forwards'

  const cssKeyframes: string[] = []
  const elementMarkups: string[] = []

  targetElementIds.forEach((id, index) => {
    const el = elements[id]
    if (!el || !el.visible) return

    const elTracks = activeTracks.filter(t => t.elementId === id)
    const animClass = `paper-anim-${index + 1}`

    const trackX = elTracks.find(t => t.property === 'x')
    const trackY = elTracks.find(t => t.property === 'y')
    const trackRot = elTracks.find(t => t.property === 'rotation')
    const trackScale = elTracks.find(t => t.property === 'scale')
    const trackOpacity = elTracks.find(t => t.property === 'opacity')

    const baseX = el.x - effectiveBounds.x
    const baseY = el.y - effectiveBounds.y
    const baseRot = el.rotation || 0
    const baseOpacity = el.style.opacity ?? 1

    const keyframeSteps: string[] = []

    for (let f = 0; f <= totalFrames; f++) {
      const pct = ((f / totalFrames) * 100).toFixed(2)
      const timeMs = f * dt

      const curX = baseX + (trackX ? trackValue(trackX, timeMs) : 0)
      const curY = baseY + (trackY ? trackValue(trackY, timeMs) : 0)
      const curRot = baseRot + (trackRot ? trackValue(trackRot, timeMs) : 0)
      const curScale = trackScale ? trackValue(trackScale, timeMs) : 1
      const curOpacity = baseOpacity * (trackOpacity ? trackValue(trackOpacity, timeMs) : 1)

      const transforms: string[] = []
      transforms.push(`translate(${num(curX)}px, ${num(curY)}px)`)
      if (curRot !== 0) transforms.push(`rotate(${num(curRot)}deg)`)
      if (curScale !== 1) transforms.push(`scale(${num(curScale)})`)

      keyframeSteps.push(`    ${pct}% { transform: ${transforms.join(' ')}; opacity: ${num(curOpacity)}; }`)
    }

    cssKeyframes.push(`  @keyframes ${animClass} {\n${keyframeSteps.join('\n')}\n  }`)
    cssKeyframes.push(`  .${animClass} {
    animation: ${animClass} ${num(durationSec)}s linear ${repeatCount};
    transform-origin: center center;
    transform-box: fill-box;
  }`)

    const innerShape = renderStaticShape(el)
    elementMarkups.push(`  <g id="layer-${xml(id)}" class="${animClass}">
    <title>${xml(el.name)}</title>
    ${innerShape}
  </g>`)
  })

  const background = options.background === 'cream'
    ? `\n  <rect x="0" y="0" width="${num(effectiveBounds.width)}" height="${num(effectiveBounds.height)}" fill="#edebe1" />`
    : ''

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${num(effectiveBounds.width)} ${num(effectiveBounds.height)}" width="${num(effectiveBounds.width)}" height="${num(effectiveBounds.height)}">
  <defs>
    <style>
${cssKeyframes.join('\n\n')}
    </style>
  </defs>${background}
${elementMarkups.join('\n')}
</svg>
`
}

/** Export Kinetic Typography to optimized self-contained Animated SVG */
export function exportAnimatedSVGFromKineticText(
  node: TextElement,
  options: AnimatedSvgOptions = {},
): string {
  const kinetic = node.kinetic
  const text = node.text || ''
  const characters = Array.from(text)

  const fps = options.fps ?? 60
  const durationSec = kinetic?.duration ?? 2.4
  const totalFrames = Math.max(10, Math.round(durationSec * fps))
  const isLoop = options.loop ?? true
  const repeatCount = isLoop ? 'infinite' : 'forwards'

  const bounds: Bounds = {
    x: node.x,
    y: node.y,
    width: Math.max(120, node.width),
    height: Math.max(60, node.height),
  }

  const charAdvance = node.fontSize * 0.58
  const baseStartX = 10
  const baseStartY = node.fontSize * 0.85
  const fill = node.style.fill ?? '#81adec'

  const cssKeyframes: string[] = []
  const charMarkups: string[] = []

  characters.forEach((char, index) => {
    if (char === ' ') {
      return
    }

    const charClass = `paper-kinetic-char-${index}`
    const charBaseX = baseStartX + index * charAdvance
    const charBaseY = baseStartY

    const keyframeSteps: string[] = []

    for (let f = 0; f <= totalFrames; f++) {
      const pct = ((f / totalFrames) * 100).toFixed(2)
      const progress = f / totalFrames
      const currentPhase = ((kinetic?.phase ?? 0) + progress) % 1
      const offset = cascadeOffset(
        kinetic ? { ...kinetic, enabled: true, playing: true, phase: currentPhase, duration: durationSec } : undefined,
        index,
        characters.length,
      )

      const transforms: string[] = []
      transforms.push(`translate(${num(charBaseX)}px, ${num(charBaseY + offset.y)}px)`)
      if (offset.angle) transforms.push(`rotate(${num(offset.angle)}deg)`)
      if (offset.scale && offset.scale !== 1) transforms.push(`scale(${num(offset.scale)})`)

      const opacity = node.style.opacity ?? 1

      keyframeSteps.push(`    ${pct}% { transform: ${transforms.join(' ')}; opacity: ${num(opacity)}; }`)
    }

    cssKeyframes.push(`  @keyframes ${charClass} {\n${keyframeSteps.join('\n')}\n  }`)
    cssKeyframes.push(`  .${charClass} {
    animation: ${charClass} ${num(durationSec)}s linear ${repeatCount};
    transform-origin: center center;
    transform-box: fill-box;
  }`)

    charMarkups.push(`  <text class="${charClass}" font-family="${xml(node.fontFamily)}" font-size="${num(node.fontSize)}" font-weight="${xml(String(node.fontWeight))}" fill="${xml(fill)}">${xml(char)}</text>`)
  })

  const background = options.background === 'cream'
    ? `\n  <rect x="0" y="0" width="${num(bounds.width)}" height="${num(bounds.height)}" fill="#edebe1" />`
    : ''

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${num(bounds.width)} ${num(bounds.height)}" width="${num(bounds.width)}" height="${num(bounds.height)}">
  <defs>
    <style>
${cssKeyframes.join('\n\n')}
    </style>
  </defs>${background}
${charMarkups.join('\n')}
</svg>
`
}

/** Export full scene with vector shapes, motion timelines, and kinetic typography to self-contained Animated SVG */
export function exportAnimatedSVGFromScene(
  state: SceneSnapshot,
  options: AnimatedSvgOptions = {},
): string {
  const scope = options.scope ?? (state.selection.length ? 'selection' : 'canvas')
  const bounds = exportBounds(state, scope)
  if (!bounds) throw new Error('There are no visible layers to export.')

  const fps = options.fps ?? state.motion?.fps ?? 60
  const durationMs = (options.duration ? options.duration * 1000 : state.motion?.duration) ?? 2400
  const durationSec = durationMs / 1000
  const totalFrames = Math.max(10, Math.round(durationSec * fps))
  const dt = durationMs / totalFrames
  const isLoop = options.loop ?? state.motion?.loop ?? true
  const repeatCount = isLoop ? 'infinite' : 'forwards'

  const rootIds = exportRoots(state, scope)
  const motionTracks = state.motion?.tracks ?? []

  const cssKeyframes: string[] = []
  const renderedElements: string[] = []
  let animIndex = 1

  const visit = (id: string, parentOffset: { x: number; y: number } = { x: bounds.x, y: bounds.y }) => {
    const el = state.elements[id]
    if (!el || !el.visible) return

    // Kinetic typography element
    if (el.type === 'text' && el.kinetic?.enabled) {
      const text = el.text || ''
      const characters = Array.from(text)
      const charAdvance = el.fontSize * 0.58
      const baseStartX = el.x - bounds.x
      const baseStartY = el.y - bounds.y + el.fontSize * 0.85
      const fill = el.style.fill ?? '#81adec'

      const charItems: string[] = []

      characters.forEach((char, cIdx) => {
        if (char === ' ') return
        const charClass = `paper-scene-kinetic-${animIndex++}`
        const charX = baseStartX + cIdx * charAdvance
        const charY = baseStartY

        const keyframeSteps: string[] = []
        for (let f = 0; f <= totalFrames; f++) {
          const pct = ((f / totalFrames) * 100).toFixed(2)
          const progress = f / totalFrames
          const currentPhase = ((el.kinetic?.phase ?? 0) + progress) % 1
          const offset = cascadeOffset(
            el.kinetic ? { ...el.kinetic, enabled: true, playing: true, phase: currentPhase, duration: durationSec } : undefined,
            cIdx,
            characters.length,
          )

          const transforms: string[] = []
          transforms.push(`translate(${num(charX)}px, ${num(charY + offset.y)}px)`)
          if (offset.angle) transforms.push(`rotate(${num(offset.angle)}deg)`)
          if (offset.scale && offset.scale !== 1) transforms.push(`scale(${num(offset.scale)})`)
          const opacity = el.style.opacity ?? 1

          keyframeSteps.push(`    ${pct}% { transform: ${transforms.join(' ')}; opacity: ${num(opacity)}; }`)
        }

        cssKeyframes.push(`  @keyframes ${charClass} {\n${keyframeSteps.join('\n')}\n  }`)
        cssKeyframes.push(`  .${charClass} {
    animation: ${charClass} ${num(durationSec)}s linear ${repeatCount};
    transform-origin: center center;
    transform-box: fill-box;
  }`)

        charItems.push(`    <text class="${charClass}" font-family="${xml(el.fontFamily)}" font-size="${num(el.fontSize)}" font-weight="${xml(String(el.fontWeight))}" fill="${xml(fill)}">${xml(char)}</text>`)
      })

      renderedElements.push(`  <g id="layer-${xml(id)}" data-kinetic="true">\n${charItems.join('\n')}\n  </g>`)
      return
    }

    const elTracks = motionTracks.filter(t => t.elementId === id && t.enabled)
    const hasMotion = elTracks.length > 0

    const baseX = el.x - parentOffset.x
    const baseY = el.y - parentOffset.y
    const baseRot = el.rotation || 0
    const baseOpacity = el.style.opacity ?? 1

    let classAttr = ''
    let styleAttr = ''
    let transformAttr = ''

    if (hasMotion) {
      const animClass = `paper-scene-anim-${animIndex++}`
      classAttr = ` class="${animClass}"`

      const trackX = elTracks.find(t => t.property === 'x')
      const trackY = elTracks.find(t => t.property === 'y')
      const trackRot = elTracks.find(t => t.property === 'rotation')
      const trackScale = elTracks.find(t => t.property === 'scale')
      const trackOpacity = elTracks.find(t => t.property === 'opacity')

      const keyframeSteps: string[] = []

      for (let f = 0; f <= totalFrames; f++) {
        const pct = ((f / totalFrames) * 100).toFixed(2)
        const timeMs = f * dt

        const curX = baseX + (trackX ? trackValue(trackX, timeMs) : 0)
        const curY = baseY + (trackY ? trackValue(trackY, timeMs) : 0)
        const curRot = baseRot + (trackRot ? trackValue(trackRot, timeMs) : 0)
        const curScale = trackScale ? trackValue(trackScale, timeMs) : 1
        const curOpacity = baseOpacity * (trackOpacity ? trackValue(trackOpacity, timeMs) : 1)

        const transforms: string[] = []
        transforms.push(`translate(${num(curX)}px, ${num(curY)}px)`)
        if (curRot !== 0) transforms.push(`rotate(${num(curRot)}deg)`)
        if (curScale !== 1) transforms.push(`scale(${num(curScale)})`)

        keyframeSteps.push(`    ${pct}% { transform: ${transforms.join(' ')}; opacity: ${num(curOpacity)}; }`)
      }

      cssKeyframes.push(`  @keyframes ${animClass} {\n${keyframeSteps.join('\n')}\n  }`)
      cssKeyframes.push(`  .${animClass} {
    animation: ${animClass} ${num(durationSec)}s linear ${repeatCount};
    transform-origin: center center;
    transform-box: fill-box;
  }`)
    } else {
      const transforms: string[] = []
      transforms.push(`translate(${num(baseX)}px, ${num(baseY)}px)`)
      if (baseRot !== 0) transforms.push(`rotate(${num(baseRot)}deg)`)
      transformAttr = ` transform="${transforms.join(' ')}"`
      if (baseOpacity !== 1) styleAttr = ` opacity="${num(baseOpacity)}"`
    }

    const shape = renderStaticShape(el)
    let childrenContent = ''

    if (el.type === 'frame' && el.children && el.children.length > 0) {
      // Children positions are relative to this frame
      for (const childId of el.children) {
        visit(childId, { x: el.x, y: el.y })
      }
    }

    renderedElements.push(`  <g id="layer-${xml(id)}"${classAttr}${transformAttr}${styleAttr}>
    <title>${xml(el.name)}</title>
    ${shape}${childrenContent}
  </g>`)
  }

  rootIds.forEach(id => visit(id))

  const background = options.background === 'cream'
    ? `\n  <rect x="0" y="0" width="${num(bounds.width)}" height="${num(bounds.height)}" fill="#edebe1" />`
    : ''

  const styles = cssKeyframes.length > 0
    ? `\n  <defs>\n    <style>\n${cssKeyframes.join('\n\n')}\n    </style>\n  </defs>`
    : ''

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${num(bounds.width)} ${num(bounds.height)}" width="${num(bounds.width)}" height="${num(bounds.height)}">${styles}${background}
${renderedElements.join('\n')}
</svg>
`
}
