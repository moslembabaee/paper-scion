import type { Bounds, Point } from '../canvas/types.ts'
import { cascadeOffset } from '../scene/kineticGeometry.ts'
import { parsePath } from '../scene/pathGeometry.ts'
import type { PathContour } from '../scene/pathGeometry.ts'
import type {
  FrameElement,
  PathElement,
  RectangleElement,
  SceneElement,
  SceneSnapshot,
  TextElement,
} from '../scene/types.ts'
import { trackValue } from '../motion/model.ts'
import type { MotionDocument, MotionTrack } from '../motion/types.ts'
import { prepareMorph, interpolateMorph } from '../morph/interpolate.ts'
import { parseMorphTarget } from '../morph/normalize.ts'
import type { MorphConfig, MorphTarget } from '../morph/types.ts'
import { exportBounds, exportRoots } from './svg.ts'

// --- Lottie Specification Types (Bodymovin v5.5+) ---

export interface LottieKeyframe<T> {
  readonly t: number
  readonly s: T
  readonly e?: T
  readonly i?: { readonly x: number | number[]; readonly y: number | number[] }
  readonly o?: { readonly x: number | number[]; readonly y: number | number[] }
}

export type LottieProp<T> =
  | { readonly a: 0; readonly k: T }
  | { readonly a: 1; readonly k: readonly LottieKeyframe<T>[] }

export interface LottiePathData {
  readonly c: boolean
  readonly v: readonly [number, number][]
  readonly i: readonly [number, number][]
  readonly o: readonly [number, number][]
}

export interface LottieTransform {
  readonly a: LottieProp<[number, number, number]>
  readonly p: LottieProp<[number, number, number]>
  readonly s: LottieProp<[number, number, number]>
  readonly r: LottieProp<number>
  readonly o: LottieProp<number>
  readonly sk?: LottieProp<number>
  readonly sa?: LottieProp<number>
}

export interface LottieShapeTransform {
  readonly ty: 'tr'
  readonly nm?: string
  readonly p: LottieProp<[number, number]>
  readonly a: LottieProp<[number, number]>
  readonly s: LottieProp<[number, number]>
  readonly r: LottieProp<number>
  readonly o: LottieProp<number>
  readonly sk: LottieProp<number>
  readonly sa: LottieProp<number>
}

export interface LottiePathShape {
  readonly ty: 'sh'
  readonly nm?: string
  readonly ks: LottieProp<LottiePathData>
  readonly hd?: boolean
}

export interface LottieRectShape {
  readonly ty: 'rc'
  readonly nm?: string
  readonly p: LottieProp<[number, number]>
  readonly s: LottieProp<[number, number]>
  readonly r: LottieProp<number>
  readonly hd?: boolean
}

export interface LottieEllipseShape {
  readonly ty: 'el'
  readonly nm?: string
  readonly p: LottieProp<[number, number]>
  readonly s: LottieProp<[number, number]>
  readonly hd?: boolean
}

export interface LottieFill {
  readonly ty: 'fl'
  readonly nm?: string
  readonly c: LottieProp<[number, number, number, number]>
  readonly o: LottieProp<number>
  readonly r: 1 | 2 // 1: nonzero, 2: evenodd
  readonly hd?: boolean
}

export interface LottieStroke {
  readonly ty: 'st'
  readonly nm?: string
  readonly c: LottieProp<[number, number, number, number]>
  readonly o: LottieProp<number>
  readonly w: LottieProp<number>
  readonly lc?: 1 | 2 | 3 // 1: butt, 2: round, 3: projecting
  readonly lj?: 1 | 2 | 3 // 1: miter, 2: round, 3: bevel
  readonly ml?: number
  readonly d?: readonly { readonly n: string; readonly v: LottieProp<number> }[]
  readonly hd?: boolean
}

export interface LottieShapeGroup {
  readonly ty: 'gr'
  readonly nm?: string
  readonly it: readonly (LottieShapeItem | LottieShapeTransform)[]
  readonly hd?: boolean
}

export type LottieShapeItem =
  | LottiePathShape
  | LottieRectShape
  | LottieEllipseShape
  | LottieFill
  | LottieStroke
  | LottieShapeGroup

export interface LottieLayer {
  readonly ddd: 0 | 1
  readonly ind: number
  readonly ty: number // 4: shape, 3: null, 0: precomp
  readonly nm: string
  readonly parent?: number
  readonly sr: number
  readonly ks: LottieTransform
  readonly ao: 0 | 1
  readonly shapes: readonly (LottieShapeItem | LottieShapeTransform)[]
  readonly ip: number
  readonly op: number
  readonly st: number
  readonly bm: number
}

export interface LottieAnimation {
  readonly v: string
  readonly fr: number
  readonly ip: number
  readonly op: number
  readonly w: number
  readonly h: number
  readonly nm: string
  readonly ddd: 0 | 1
  readonly assets: readonly unknown[]
  readonly layers: readonly LottieLayer[]
  readonly markers?: readonly unknown[]
}

// --- Utilities ---

const round = (n: number, decimals = 3): number => {
  const factor = 10 ** decimals
  return Math.round(n * factor) / factor
}

export function parseColorToLottieRgba(color: string | null | undefined): [number, number, number, number] {
  if (!color || color === 'none' || color === 'transparent') {
    return [0, 0, 0, 0]
  }
  const clean = color.trim().toLowerCase()
  if (clean.startsWith('#')) {
    const hex = clean.slice(1)
    if (hex.length === 3 || hex.length === 4) {
      const r = parseInt(hex[0] + hex[0], 16) / 255
      const g = parseInt(hex[1] + hex[1], 16) / 255
      const b = parseInt(hex[2] + hex[2], 16) / 255
      const a = hex.length === 4 ? parseInt(hex[3] + hex[3], 16) / 255 : 1
      return [round(r), round(g), round(b), round(a)]
    }
    if (hex.length >= 6) {
      const r = parseInt(hex.slice(0, 2), 16) / 255
      const g = parseInt(hex.slice(2, 4), 16) / 255
      const b = parseInt(hex.slice(4, 6), 16) / 255
      const a = hex.length >= 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1
      return [round(r), round(g), round(b), round(a)]
    }
  }
  const rgbMatch = clean.match(/^rgba?\s*\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/)
  if (rgbMatch) {
    const r = Math.min(255, Math.max(0, parseFloat(rgbMatch[1]))) / 255
    const g = Math.min(255, Math.max(0, parseFloat(rgbMatch[2]))) / 255
    const b = Math.min(255, Math.max(0, parseFloat(rgbMatch[3]))) / 255
    const a = rgbMatch[4] !== undefined ? Math.min(1, Math.max(0, parseFloat(rgbMatch[4]))) : 1
    return [round(r), round(g), round(b), round(a)]
  }
  if (clean === 'black') return [0, 0, 0, 1]
  if (clean === 'white') return [1, 1, 1, 1]
  // Default Paper blue accent (#81adec)
  return [129 / 255, 173 / 255, 236 / 255, 1]
}

/** Convert a list of SVG PathContours to Lottie Bezier Path data */
export function contoursToLottiePathData(
  contours: readonly PathContour[],
  transformPoint?: (p: Point) => Point,
): LottiePathData[] {
  return contours.map(contour => {
    const anchors = contour.anchors
    const v: [number, number][] = []
    const i: [number, number][] = []
    const o: [number, number][] = []

    for (let k = 0; k < anchors.length; k++) {
      const anchor = anchors[k]
      const pt = transformPoint ? transformPoint(anchor) : anchor
      v.push([round(pt.x), round(pt.y)])

      if (anchor.in) {
        const inPt = transformPoint ? transformPoint(anchor.in) : anchor.in
        i.push([round(inPt.x - pt.x), round(inPt.y - pt.y)])
      } else {
        i.push([0, 0])
      }

      if (anchor.out) {
        const outPt = transformPoint ? transformPoint(anchor.out) : anchor.out
        o.push([round(outPt.x - pt.x), round(outPt.y - pt.y)])
      } else {
        o.push([0, 0])
      }
    }

    return {
      c: contour.closed,
      v,
      i,
      o,
    }
  })
}

/** Parse an SVG path d attribute into Lottie Path Data array, respecting viewBox scaling */
export function pathToLottiePathData(
  d: string,
  viewBox?: readonly [number, number, number, number],
  targetSize?: { width: number; height: number },
): LottiePathData[] {
  if (!d || !d.trim()) return []
  const contours = parsePath(d)
  if (!viewBox || !targetSize) {
    return contoursToLottiePathData(contours)
  }
  const [vx, vy, vw, vh] = viewBox
  const sx = targetSize.width / (vw || 1)
  const sy = targetSize.height / (vh || 1)
  const mapPoint = (p: Point): Point => ({
    x: (p.x - vx) * sx,
    y: (p.y - vy) * sy,
  })
  return contoursToLottiePathData(contours, mapPoint)
}

function defaultShapeTransform(): LottieShapeTransform {
  return {
    ty: 'tr',
    p: { a: 0, k: [0, 0] },
    a: { a: 0, k: [0, 0] },
    s: { a: 0, k: [100, 100] },
    r: { a: 0, k: 0 },
    o: { a: 0, k: 100 },
    sk: { a: 0, k: 0 },
    sa: { a: 0, k: 0 },
  }
}

// --- Compilers ---

export interface LottieExportOptions {
  readonly scope?: 'selection' | 'canvas' | 'artboards' | 'layers'
  readonly fps?: number
  readonly duration?: number // seconds
  readonly loop?: boolean
  readonly name?: string
  readonly pretty?: boolean
}

/** Compile vector styling (fill, stroke) into Lottie shape items */
function compileElementStyles(
  element: SceneElement,
  fillRule: 'nonzero' | 'evenodd' = 'nonzero',
): (LottieFill | LottieStroke)[] {
  const items: (LottieFill | LottieStroke)[] = []
  const { fill, stroke } = element.style

  if (fill && fill !== 'none' && fill !== 'transparent') {
    const rgba = parseColorToLottieRgba(fill)
    items.push({
      ty: 'fl',
      nm: 'Fill',
      c: { a: 0, k: [rgba[0], rgba[1], rgba[2], 1] },
      o: { a: 0, k: round(rgba[3] * 100) },
      r: fillRule === 'evenodd' ? 2 : 1,
    })
  }

  if (stroke && stroke.color && stroke.color !== 'none' && stroke.width > 0) {
    const rgba = parseColorToLottieRgba(stroke.color)
    const strokeItem: LottieStroke = {
      ty: 'st',
      nm: 'Stroke',
      c: { a: 0, k: [rgba[0], rgba[1], rgba[2], 1] },
      o: { a: 0, k: round(rgba[3] * 100) },
      w: { a: 0, k: round(stroke.width) },
      lc: 2, // round cap
      lj: 2, // round join
      ml: 4,
    }
    if (stroke.dash && stroke.dash.length > 0) {
      const dashes: { n: string; v: LottieProp<number> }[] = []
      if (stroke.dash[0] !== undefined) {
        dashes.push({ n: 'd', v: { a: 0, k: round(stroke.dash[0]) } })
      }
      if (stroke.dash[1] !== undefined) {
        dashes.push({ n: 'g', v: { a: 0, k: round(stroke.dash[1]) } })
      }
      ;(strokeItem as { d?: readonly { n: string; v: LottieProp<number> }[] }).d = dashes
    }
    items.push(strokeItem)
  }

  return items
}

/** Build a Lottie shape group for a vector element */
function compileElementShapes(element: SceneElement): LottieShapeGroup {
  const items: (LottieShapeItem | LottieShapeTransform)[] = []
  let fillRule: 'nonzero' | 'evenodd' = 'nonzero'

  if (element.type === 'rectangle') {
    const rect = element as RectangleElement
    if (rect.cornerRadius && rect.cornerRadius > 0) {
      const cr = Math.min(rect.cornerRadius, rect.width / 2, rect.height / 2)
      items.push({
        ty: 'rc',
        nm: 'Rectangle',
        p: { a: 0, k: [round(rect.width / 2), round(rect.height / 2)] },
        s: { a: 0, k: [round(rect.width), round(rect.height)] },
        r: { a: 0, k: round(cr) },
      })
    } else {
      items.push({
        ty: 'rc',
        nm: 'Rectangle',
        p: { a: 0, k: [round(rect.width / 2), round(rect.height / 2)] },
        s: { a: 0, k: [round(rect.width), round(rect.height)] },
        r: { a: 0, k: 0 },
      })
    }
  } else if (element.type === 'ellipse') {
    items.push({
      ty: 'el',
      nm: 'Ellipse',
      p: { a: 0, k: [round(element.width / 2), round(element.height / 2)] },
      s: { a: 0, k: [round(element.width), round(element.height)] },
    })
  } else if (element.type === 'path') {
    const path = element as PathElement
    fillRule = path.fillRule ?? 'nonzero'
    const pathDatas = pathToLottiePathData(path.d, path.viewBox, {
      width: path.width,
      height: path.height,
    })
    for (let i = 0; i < pathDatas.length; i++) {
      items.push({
        ty: 'sh',
        nm: `Path ${i + 1}`,
        ks: { a: 0, k: pathDatas[i] },
      })
    }
  } else if (element.type === 'frame') {
    const frame = element as FrameElement
    if (frame.cornerRadius > 0) {
      items.push({
        ty: 'rc',
        nm: 'Frame Bounds',
        p: { a: 0, k: [round(frame.width / 2), round(frame.height / 2)] },
        s: { a: 0, k: [round(frame.width), round(frame.height)] },
        r: { a: 0, k: round(frame.cornerRadius) },
      })
    } else {
      items.push({
        ty: 'rc',
        nm: 'Frame Bounds',
        p: { a: 0, k: [round(frame.width / 2), round(frame.height / 2)] },
        s: { a: 0, k: [round(frame.width), round(frame.height)] },
        r: { a: 0, k: 0 },
      })
    }
  }

  items.push(...compileElementStyles(element, fillRule))
  items.push(defaultShapeTransform())

  return {
    ty: 'gr',
    nm: element.name || 'Vector Group',
    it: items,
  }
}

/** Compile spring physics motion timelines into Lottie layer transform keyframes */
function compileMotionTransform(
  element: SceneElement,
  elementTracks: readonly MotionTrack[],
  durationMs: number,
  fps: number,
  originOffset: { x: number; y: number },
): LottieTransform {
  const totalFrames = Math.max(1, Math.round((durationMs / 1000) * fps))
  const dt = durationMs / totalFrames

  const trackX = elementTracks.find(t => t.property === 'x' && t.enabled)
  const trackY = elementTracks.find(t => t.property === 'y' && t.enabled)
  const trackRot = elementTracks.find(t => t.property === 'rotation' && t.enabled)
  const trackScale = elementTracks.find(t => t.property === 'scale' && t.enabled)
  const trackOpacity = elementTracks.find(t => t.property === 'opacity' && t.enabled)

  const baseX = element.x - originOffset.x
  const baseY = element.y - originOffset.y
  const baseRot = element.rotation || 0
  const baseOpacity = (element.style.opacity ?? 1) * 100

  // Position
  let p: LottieProp<[number, number, number]>
  if (trackX || trackY) {
    const keyframes: LottieKeyframe<[number, number, number]>[] = []
    for (let f = 0; f <= totalFrames; f++) {
      const timeMs = f * dt
      const x = baseX + (trackX ? trackValue(trackX, timeMs) : 0)
      const y = baseY + (trackY ? trackValue(trackY, timeMs) : 0)
      keyframes.push({
        t: f,
        s: [round(x), round(y), 0],
        i: { x: 0.833, y: 0.833 },
        o: { x: 0.167, y: 0.167 },
      })
    }
    p = { a: 1, k: keyframes }
  } else {
    p = { a: 0, k: [round(baseX), round(baseY), 0] }
  }

  // Rotation
  let r: LottieProp<number>
  if (trackRot) {
    const keyframes: LottieKeyframe<number>[] = []
    for (let f = 0; f <= totalFrames; f++) {
      const timeMs = f * dt
      const rot = baseRot + trackValue(trackRot, timeMs)
      keyframes.push({
        t: f,
        s: round(rot),
        i: { x: 0.833, y: 0.833 },
        o: { x: 0.167, y: 0.167 },
      })
    }
    r = { a: 1, k: keyframes }
  } else {
    r = { a: 0, k: round(baseRot) }
  }

  // Scale
  let s: LottieProp<[number, number, number]>
  if (trackScale) {
    const keyframes: LottieKeyframe<[number, number, number]>[] = []
    for (let f = 0; f <= totalFrames; f++) {
      const timeMs = f * dt
      const sc = trackValue(trackScale, timeMs) * 100
      keyframes.push({
        t: f,
        s: [round(sc), round(sc), 100],
        i: { x: 0.833, y: 0.833 },
        o: { x: 0.167, y: 0.167 },
      })
    }
    s = { a: 1, k: keyframes }
  } else {
    s = { a: 0, k: [100, 100, 100] }
  }

  // Opacity
  let o: LottieProp<number>
  if (trackOpacity) {
    const keyframes: LottieKeyframe<number>[] = []
    for (let f = 0; f <= totalFrames; f++) {
      const timeMs = f * dt
      const op = trackValue(trackOpacity, timeMs) * 100
      keyframes.push({
        t: f,
        s: round(op),
        i: { x: 0.833, y: 0.833 },
        o: { x: 0.167, y: 0.167 },
      })
    }
    o = { a: 1, k: keyframes }
  } else {
    o = { a: 0, k: round(baseOpacity) }
  }

  return {
    a: { a: 0, k: [0, 0, 0] },
    p,
    s,
    r,
    o,
  }
}

/** Compile kinetic text characters into Lottie shape layers with wave stagger */
function compileKineticTextLayers(
  node: TextElement,
  startInd: number,
  totalFrames: number,
  durationSec: number,
  originOffset: { x: number; y: number },
): LottieLayer[] {
  const kinetic = node.kinetic
  if (!kinetic || !kinetic.enabled) return []

  const text = node.text || ''
  const characters = Array.from(text)
  if (!characters.length) return []

  const layers: LottieLayer[] = []
  const charAdvance = node.fontSize * 0.58
  const baseStartX = node.x - originOffset.x
  const baseStartY = node.y - originOffset.y + node.fontSize * 0.8
  const fillRgba = parseColorToLottieRgba(node.style.fill ?? '#81adec')

  characters.forEach((char, index) => {
    if (char === ' ') return
    const charBaseX = baseStartX + index * charAdvance
    const charBaseY = baseStartY

    // Build position, rotation, and scale keyframes over totalFrames
    const pKeyframes: LottieKeyframe<[number, number, number]>[] = []
    const rKeyframes: LottieKeyframe<number>[] = []
    const sKeyframes: LottieKeyframe<[number, number, number]>[] = []

    for (let f = 0; f <= totalFrames; f++) {
      const progress = f / totalFrames
      const currentPhase = ((kinetic.phase ?? 0) + progress) % 1
      const offset = cascadeOffset(
        { ...kinetic, phase: currentPhase, duration: durationSec },
        index,
        characters.length,
      )

      pKeyframes.push({
        t: f,
        s: [round(charBaseX), round(charBaseY + offset.y), 0],
        i: { x: 0.833, y: 0.833 },
        o: { x: 0.167, y: 0.167 },
      })
      rKeyframes.push({
        t: f,
        s: round(offset.angle),
        i: { x: 0.833, y: 0.833 },
        o: { x: 0.167, y: 0.167 },
      })
      const sc = (offset.scale ?? 1) * 100
      sKeyframes.push({
        t: f,
        s: [round(sc), round(sc), 100],
        i: { x: 0.833, y: 0.833 },
        o: { x: 0.167, y: 0.167 },
      })
    }

    // Glyph representation in Lottie: a rounded character block or path contour
    const glyphW = round(charAdvance * 0.8)
    const glyphH = round(node.fontSize * 0.85)

    const shapeGroup: LottieShapeGroup = {
      ty: 'gr',
      nm: `Glyph ${char}`,
      it: [
        {
          ty: 'rc',
          nm: 'Char Bounds',
          p: { a: 0, k: [round(glyphW / 2), round(-glyphH / 2)] },
          s: { a: 0, k: [glyphW, glyphH] },
          r: { a: 0, k: round(Math.max(2, glyphW * 0.15)) },
        },
        {
          ty: 'fl',
          nm: 'Fill',
          c: { a: 0, k: [fillRgba[0], fillRgba[1], fillRgba[2], 1] },
          o: { a: 0, k: round(fillRgba[3] * 100) },
          r: 1,
        },
        defaultShapeTransform(),
      ],
    }

    layers.push({
      ddd: 0,
      ind: startInd + layers.length,
      ty: 4,
      nm: `${node.name || 'Text'}_Char_${index}_${char}`,
      sr: 1,
      ks: {
        a: { a: 0, k: [0, 0, 0] },
        p: { a: 1, k: pKeyframes },
        s: { a: 1, k: sKeyframes },
        r: { a: 1, k: rKeyframes },
        o: { a: 0, k: round((node.style.opacity ?? 1) * 100) },
      },
      ao: 0,
      shapes: [shapeGroup],
      ip: 0,
      op: totalFrames,
      st: 0,
      bm: 0,
    })
  })

  return layers
}

// --- Main Export Functions ---

/** Export Path Morph animation (Target A -> Target B) to standalone Lottie JSON */
export function exportLottieFromMorph(
  targetA: MorphTarget,
  targetB: MorphTarget,
  config: MorphConfig,
  options: { fps?: number; name?: string; pretty?: boolean } = {},
): string {
  const fps = options.fps ?? 60
  const durationSec = Math.max(0.1, config.duration / 1000)
  const isPingPong = config.playbackMode === 'pingpong'
  const totalFrames = Math.max(2, Math.round(durationSec * fps * (isPingPong ? 2 : 1)))

  const prepared = prepareMorph(parseMorphTarget(targetA), parseMorphTarget(targetB), config)

  const [vx, vy, vw, vh] = targetA.viewBox || [0, 0, 120, 120]
  const width = vw || 120
  const height = vh || 120

  const keyframes: LottieKeyframe<LottiePathData[]>[] = []

  for (let f = 0; f <= totalFrames; f++) {
    const t = f / totalFrames
    const progress = isPingPong ? (t <= 0.5 ? t * 2 : 2 - t * 2) : t
    const result = interpolateMorph(prepared, progress, config)

    // Convert interpolated contours to Lottie path data
    const pathDatas: LottiePathData[] = result.interpolatedShape.contours.map(contour => {
      const segs = contour.segments
      const n = segs.length
      const v: [number, number][] = []
      const i: [number, number][] = []
      const o: [number, number][] = []

      for (let k = 0; k < n; k++) {
        const seg = segs[k]
        const prevSeg = segs[(k - 1 + n) % n]
        v.push([round(seg.p0.x - vx), round(seg.p0.y - vy)])
        o.push([round(seg.p1.x - seg.p0.x), round(seg.p1.y - seg.p0.y)])
        i.push([round(prevSeg.p2.x - seg.p0.x), round(prevSeg.p2.y - seg.p0.y)])
      }

      return {
        c: contour.closed,
        v,
        i,
        o,
      }
    })

    keyframes.push({
      t: f,
      s: pathDatas,
      i: { x: 0.833, y: 0.833 },
      o: { x: 0.167, y: 0.167 },
    })
  }

  const fillRgba = parseColorToLottieRgba(targetA.color ?? '#81adec')

  const shapeItems: (LottieShapeItem | LottieShapeTransform)[] = []
  const contourCount = keyframes[0]?.s.length || 1

  for (let c = 0; c < contourCount; c++) {
    shapeItems.push({
      ty: 'sh',
      nm: contourCount > 1 ? `Morph Path ${c + 1}` : 'Morph Path',
      ks: {
        a: 1,
        k: keyframes.map(kf => ({
          t: kf.t,
          s: kf.s[c],
          i: kf.i,
          o: kf.o,
        })),
      },
    })
  }

  shapeItems.push({
    ty: 'fl',
    nm: 'Fill',
    c: { a: 0, k: [fillRgba[0], fillRgba[1], fillRgba[2], 1] },
    o: { a: 0, k: round(fillRgba[3] * 100) },
    r: targetA.fillRule === 'evenodd' ? 2 : 1,
  })

  shapeItems.push(defaultShapeTransform())

  const layer: LottieLayer = {
    ddd: 0,
    ind: 1,
    ty: 4,
    nm: `${targetA.name} to ${targetB.name} Morph`,
    sr: 1,
    ks: {
      a: { a: 0, k: [0, 0, 0] },
      p: { a: 0, k: [0, 0, 0] },
      s: { a: 0, k: [100, 100, 100] },
      r: { a: 0, k: 0 },
      o: { a: 0, k: 100 },
    },
    ao: 0,
    shapes: [
      {
        ty: 'gr',
        nm: 'Morph Group',
        it: shapeItems,
      },
    ],
    ip: 0,
    op: totalFrames,
    st: 0,
    bm: 0,
  }

  const animation: LottieAnimation = {
    v: '5.7.4',
    fr: fps,
    ip: 0,
    op: totalFrames,
    w: Math.round(width),
    h: Math.round(height),
    nm: options.name || `${targetA.name} Morph`,
    ddd: 0,
    assets: [],
    layers: [layer],
  }

  return serializeLottie(animation, options.pretty)
}

/** Export Spring Physics Motion Document to standalone Lottie JSON */
export function exportLottieFromMotion(
  motion: MotionDocument,
  elements: Readonly<Record<string, SceneElement>>,
  bounds?: Bounds,
  options: { fps?: number; name?: string; pretty?: boolean } = {},
): string {
  const fps = options.fps ?? motion.fps ?? 60
  const durationMs = Math.max(100, motion.duration || 2000)
  const totalFrames = Math.max(1, Math.round((durationMs / 1000) * fps))

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

  const layers: LottieLayer[] = []

  targetElementIds.forEach((id, index) => {
    const el = elements[id]
    if (!el || !el.visible) return

    const elTracks = activeTracks.filter(t => t.elementId === id)
    const shapes = compileElementShapes(el)
    const transform = compileMotionTransform(
      el,
      elTracks,
      durationMs,
      fps,
      { x: effectiveBounds.x, y: effectiveBounds.y },
    )

    layers.push({
      ddd: 0,
      ind: index + 1,
      ty: 4,
      nm: el.name || `Layer ${index + 1}`,
      sr: 1,
      ks: transform,
      ao: 0,
      shapes: [shapes],
      ip: 0,
      op: totalFrames,
      st: 0,
      bm: 0,
    })
  })

  const animation: LottieAnimation = {
    v: '5.7.4',
    fr: fps,
    ip: 0,
    op: totalFrames,
    w: Math.round(effectiveBounds.width),
    h: Math.round(effectiveBounds.height),
    nm: options.name || 'Paper Motion',
    ddd: 0,
    assets: [],
    layers,
  }

  return serializeLottie(animation, options.pretty)
}

/** Export Kinetic Typography to standalone Lottie JSON */
export function exportLottieFromKineticText(
  node: TextElement,
  options: { fps?: number; name?: string; pretty?: boolean } = {},
): string {
  const fps = options.fps ?? 60
  const durationSec = node.kinetic?.duration ?? 2.4
  const totalFrames = Math.max(1, Math.round(durationSec * fps))

  const bounds: Bounds = {
    x: node.x,
    y: node.y,
    width: Math.max(120, node.width),
    height: Math.max(60, node.height),
  }

  const layers = compileKineticTextLayers(
    node,
    1,
    totalFrames,
    durationSec,
    { x: bounds.x, y: bounds.y },
  )

  const animation: LottieAnimation = {
    v: '5.7.4',
    fr: fps,
    ip: 0,
    op: totalFrames,
    w: Math.round(bounds.width),
    h: Math.round(bounds.height),
    nm: options.name || `${node.name || 'Kinetic Text'} Animation`,
    ddd: 0,
    assets: [],
    layers,
  }

  return serializeLottie(animation, options.pretty)
}

/** Export full scene with vector shapes, motion timelines, and kinetic typography to Lottie JSON */
export function exportLottieFromScene(
  state: SceneSnapshot,
  options: LottieExportOptions = {},
): string {
  const scope = options.scope ?? 'selection'
  const bounds = exportBounds(state, scope === 'selection' && state.selection.length ? 'selection' : 'canvas')
  if (!bounds) throw new Error('There are no visible layers to export.')

  const fps = options.fps ?? state.motion?.fps ?? 60
  const durationMs = (options.duration ? options.duration * 1000 : state.motion?.duration) ?? 2400
  const totalFrames = Math.max(1, Math.round((durationMs / 1000) * fps))

  const rootIds = exportRoots(state, scope === 'selection' && state.selection.length ? 'selection' : 'canvas')
  const motionTracks = state.motion?.tracks ?? []

  const layers: LottieLayer[] = []
  let layerIndex = 1

  const visit = (id: string, parentLayerInd?: number) => {
    const el = state.elements[id]
    if (!el || !el.visible) return

    const currentInd = layerIndex++

    // If it's a kinetic text element, export individual character layers
    if (el.type === 'text' && el.kinetic?.enabled) {
      const textLayers = compileKineticTextLayers(
        el,
        currentInd,
        totalFrames,
        (durationMs / 1000),
        { x: bounds.x, y: bounds.y },
      )
      layers.push(...textLayers)
      layerIndex += textLayers.length
      return
    }

    const elTracks = motionTracks.filter(t => t.elementId === id && t.enabled)
    const shapes = compileElementShapes(el)

    const transform = elTracks.length > 0
      ? compileMotionTransform(el, elTracks, durationMs, fps, { x: bounds.x, y: bounds.y })
      : {
          a: { a: 0 as const, k: [0, 0, 0] as [number, number, number] },
          p: { a: 0 as const, k: [round(el.x - bounds.x), round(el.y - bounds.y), 0] as [number, number, number] },
          s: { a: 0 as const, k: [100, 100, 100] as [number, number, number] },
          r: { a: 0 as const, k: round(el.rotation || 0) },
          o: { a: 0 as const, k: round((el.style.opacity ?? 1) * 100) },
        }

    const layer: LottieLayer = {
      ddd: 0,
      ind: currentInd,
      ty: 4,
      nm: el.name || `Layer ${currentInd}`,
      ...(parentLayerInd ? { parent: parentLayerInd } : {}),
      sr: 1,
      ks: transform,
      ao: 0,
      shapes: [shapes],
      ip: 0,
      op: totalFrames,
      st: 0,
      bm: 0,
    }

    layers.push(layer)

    if (el.type === 'frame' && el.children) {
      for (const childId of el.children) {
        visit(childId, currentInd)
      }
    }
  }

  rootIds.forEach(id => visit(id))

  const animation: LottieAnimation = {
    v: '5.7.4',
    fr: fps,
    ip: 0,
    op: totalFrames,
    w: Math.round(bounds.width),
    h: Math.round(bounds.height),
    nm: options.name || 'Paper Production Animation',
    ddd: 0,
    assets: [],
    layers,
  }

  return serializeLottie(animation, options.pretty)
}

/** Serialize Lottie object to JSON string */
export function serializeLottie(animation: LottieAnimation, pretty = false): string {
  return JSON.stringify(animation, null, pretty ? 2 : undefined)
}

export interface LottieValidationResult {
  readonly valid: boolean
  readonly errors: readonly string[]
  readonly stats: {
    readonly layerCount: number
    readonly frameCount: number
    readonly duration: number
    readonly fps: number
    readonly dimensions: readonly [number, number]
  }
}

/** Validate Lottie structure according to Bodymovin specifications and report statistics */
export function validateLottie(json: string | LottieAnimation): LottieValidationResult {
  const anim: LottieAnimation = typeof json === 'string' ? JSON.parse(json) : json
  const errors: string[] = []

  if (!anim.v) errors.push('Missing Lottie version (v)')
  if (typeof anim.fr !== 'number' || anim.fr <= 0) errors.push('Invalid frame rate (fr)')
  if (typeof anim.ip !== 'number') errors.push('Missing in-point (ip)')
  if (typeof anim.op !== 'number' || anim.op < anim.ip) errors.push('Invalid out-point (op)')
  if (typeof anim.w !== 'number' || anim.w <= 0) errors.push('Invalid width (w)')
  if (typeof anim.h !== 'number' || anim.h <= 0) errors.push('Invalid height (h)')
  if (!Array.isArray(anim.layers)) errors.push('Missing layers array')

  const layerCount = anim.layers?.length ?? 0
  const frameCount = (anim.op ?? 0) - (anim.ip ?? 0)
  const fps = anim.fr ?? 60
  const duration = round(frameCount / (fps || 60))

  return {
    valid: errors.length === 0,
    errors,
    stats: {
      layerCount,
      frameCount,
      duration,
      fps,
      dimensions: [anim.w ?? 0, anim.h ?? 0],
    },
  }
}

