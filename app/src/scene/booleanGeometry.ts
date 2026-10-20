import type { Point, Bounds } from '../canvas/types.ts'
import { parsePath } from './pathGeometry.ts'
import type { PathContour } from './pathGeometry.ts'
import type { BooleanCompound, BooleanOperation, PathElement, SceneElement, VectorElement } from './types.ts'
import { expandPathOutline } from './outlineExpansion.ts'

export const BOOLEAN_OPERATIONS = ['union', 'subtract', 'intersect', 'exclude'] as const
export const isVector = (node: SceneElement): node is VectorElement => ['rectangle', 'ellipse', 'path'].includes(node.type)

export function sameVectorGeometry(a: VectorElement, b: VectorElement): boolean {
  if (a.type !== b.type || a.x !== b.x || a.y !== b.y || a.width !== b.width || a.height !== b.height || a.rotation !== b.rotation) return false
  if (a.type === 'path' && b.type === 'path') return a.d === b.d && a.fillRule === b.fillRule && a.viewBox.every((value, index) => value === b.viewBox[index])
  if (a.style.stroke?.width !== b.style.stroke?.width) return false
  return a.type !== 'rectangle' || b.type !== 'rectangle' || a.cornerRadius === b.cornerRadius
}

type Curve = readonly [Point, Point, Point, Point]
type WindingSpan = { curve: Curve; start: number; end: number; y0: number; y1: number }
type Shape = { curves: Curve[]; bounds: Bounds; spans: WindingSpan[]; fillRule: 'nonzero' | 'evenodd' }
const K = 0.5522847498307936
const point = (x: number, y: number): Point => ({ x, y })
const lerp = (a: Point, b: Point, t: number) => point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x
const sub = (a: Point, b: Point) => point(a.x - b.x, a.y - b.y)
const line = (a: Point, b: Point): Curve => [a, lerp(a, b, 1 / 3), lerp(a, b, 2 / 3), b]
const reverse = (c: Curve): Curve => [c[3], c[2], c[1], c[0]]
const at = (c: Curve, t: number) => {
  const u = 1 - t, a = u ** 3, b = 3 * u * u * t, d = 3 * u * t * t, e = t ** 3
  return point(a * c[0].x + b * c[1].x + d * c[2].x + e * c[3].x, a * c[0].y + b * c[1].y + d * c[2].y + e * c[3].y)
}
const tangent = (c: Curve, t: number) => {
  const a = sub(c[1], c[0]), b = sub(c[2], c[1]), d = sub(c[3], c[2])
  return point(3 * ((1 - t) ** 2 * a.x + 2 * t * (1 - t) * b.x + t ** 2 * d.x), 3 * ((1 - t) ** 2 * a.y + 2 * t * (1 - t) * b.y + t ** 2 * d.y))
}
function split(c: Curve, t: number): [Curve, Curve] {
  const a = lerp(c[0], c[1], t), b = lerp(c[1], c[2], t), d = lerp(c[2], c[3], t)
  const e = lerp(a, b, t), f = lerp(b, d, t), g = lerp(e, f, t)
  return [[c[0], a, e, g], [g, f, d, c[3]]]
}
function slice(c: Curve, start: number, end: number): Curve {
  const left = end < 1 ? split(c, end)[0] : c
  return start > 0 ? split(left, start / end)[1] : left
}
function contoursToCurves(contours: readonly PathContour[]): Curve[] {
  return contours.flatMap(({ anchors }) => anchors.map((a, index): Curve => {
    const b = anchors[(index + 1) % anchors.length]
    const aOut = a.out ?? (a.curveMode === 'quadratic' && a.quadApex ? point(a.x + (2 / 3) * (a.quadApex.x - a.x), a.y + (2 / 3) * (a.quadApex.y - a.y)) : undefined)
    const bIn = b.in ?? (a.curveMode === 'quadratic' && a.quadApex ? point(b.x + (2 / 3) * (a.quadApex.x - b.x), b.y + (2 / 3) * (a.quadApex.y - b.y)) : undefined)
    return aOut || bIn ? [a, aOut ?? a, bIn ?? b, b] : line(a, b)
  })).filter(c => c.some(p => distance(p, c[0]) > 1e-10))
}

/** SVG fill geometry, including implicit closure of open contours and center rotation. */
function shapeFor(node: VectorElement): Shape {
  let curves: Curve[]
  if (node.type === 'path') curves = contoursToCurves(vectorToContours(node))
  else {
    const inset = Math.min(node.style.stroke?.width ? node.style.stroke.width / 2 : 0, node.width / 2, node.height / 2)
    const w = node.width - 2 * inset, h = node.height - 2 * inset
    const rx = node.type === 'ellipse' ? w / 2 : Math.min(node.cornerRadius, w / 2)
    const ry = node.type === 'ellipse' ? h / 2 : Math.min(node.cornerRadius, h / 2)
    const x = inset, y = inset
    const a = point(x + rx, y), b = point(x + w - rx, y), c = point(x + w, y + ry), d = point(x + w, y + h - ry)
    const e = point(x + w - rx, y + h), f = point(x + rx, y + h), g = point(x, y + h - ry), j = point(x, y + ry)
    curves = [line(a, b), [b, point(b.x + rx * K, b.y), point(c.x, c.y - ry * K), c], line(c, d), [d, point(d.x, d.y + ry * K), point(e.x + rx * K, e.y), e], line(e, f), [f, point(f.x - rx * K, f.y), point(g.x, g.y + ry * K), g], line(g, j), [j, point(j.x, j.y - ry * K), point(a.x - rx * K, a.y), a]]
  }
  const angle = node.rotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle)
  const transform = (p: Point) => {
    const x = (node.type === 'path' ? (p.x - node.viewBox[0]) * node.width / node.viewBox[2] : p.x) - node.width / 2
    const y = (node.type === 'path' ? (p.y - node.viewBox[1]) * node.height / node.viewBox[3] : p.y) - node.height / 2
    return point(node.x + node.width / 2 + cos * x - sin * y, node.y + node.height / 2 + sin * x + cos * y)
  }
  curves = curves.map(c => c.map(transform) as unknown as Curve).filter(c => c.some(p => distance(p, c[0]) > 1e-10))
  const spans = curves.flatMap(curve => {
    const cuts = [0, ...extrema(curve, 'y').sort((a, b) => a - b), 1]
    return cuts.slice(1).map((end, index) => ({ curve, start: cuts[index], end, y0: at(curve, cuts[index]).y, y1: at(curve, end).y }))
  })
  return { curves, bounds: boundsOf(curves), spans, fillRule: node.type === 'path' ? node.fillRule : 'nonzero' }
}

function extrema(c: Curve, axis: 'x' | 'y'): number[] {
  const [p, q, r, s] = c.map(p => p[axis])
  const a = -p + 3 * q - 3 * r + s, b = 2 * (p - 2 * q + r), d = q - p
  if (Math.abs(a) < 1e-14) return Math.abs(b) < 1e-14 ? [] : [-d / b].filter(t => t > 0 && t < 1)
  const disc = b * b - 4 * a * d
  return disc < 0 ? [] : [(-b - Math.sqrt(disc)) / (2 * a), (-b + Math.sqrt(disc)) / (2 * a)].filter(t => t > 0 && t < 1)
}
function boundsOf(curves: readonly Curve[], exact = false): Bounds {
  const ps = curves.flatMap(c => exact ? [c[0], c[3], ...extrema(c, 'x').map(t => at(c, t)), ...extrema(c, 'y').map(t => at(c, t))] : [...c])
  if (!ps.length) return { x: 0, y: 0, width: 1, height: 1 }
  let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity
  for (const p of ps) { x = Math.min(x, p.x); y = Math.min(y, p.y); right = Math.max(right, p.x); bottom = Math.max(bottom, p.y) }
  return { x, y, width: right - x, height: bottom - y }
}
const overlaps = (a: Bounds, b: Bounds) => a.x <= b.x + b.width + 1e-8 && b.x <= a.x + a.width + 1e-8 && a.y <= b.y + b.height + 1e-8 && b.y <= a.y + a.height + 1e-8
const flatness = (c: Curve) => {
  const chord = sub(c[3], c[0]), length = Math.hypot(chord.x, chord.y)
  return length < 1e-12 ? Math.max(distance(c[0], c[1]), distance(c[0], c[2])) : Math.max(Math.abs(cross(sub(c[1], c[0]), chord)), Math.abs(cross(sub(c[2], c[0]), chord))) / length
}
const sameCurve = (a: Curve, b: Curve) => a.every((p, i) => distance(p, b[i]) < 1e-8) || a.every((p, i) => distance(p, b[3 - i]) < 1e-8) ||
  (flatness(a) < 1e-10 && flatness(b) < 1e-10 && ((distance(a[0], b[0]) < 1e-8 && distance(a[3], b[3]) < 1e-8) || (distance(a[0], b[3]) < 1e-8 && distance(a[3], b[0]) < 1e-8)))

/** Locate endpoints on monotone spans, including curves with multiple roots. */
function pointTimes(c: Curve, p: Point): number[] {
  const bounds = boundsOf([c]), axis = bounds.width >= bounds.height ? 'x' : 'y'
  const spans = [0, ...extrema(c, axis).sort((a, b) => a - b), 1], times: number[] = []
  const add = (t: number) => { if (distance(at(c, t), p) < 1e-8 && !times.some(u => Math.abs(u - t) < 1e-8)) times.push(t) }
  for (let i = 1; i < spans.length; i++) {
    let lo = spans[i - 1], hi = spans[i]
    const start = at(c, lo)[axis], end = at(c, hi)[axis]
    add(lo); add(hi)
    if (p[axis] < Math.min(start, end) || p[axis] > Math.max(start, end)) continue
    for (let j = 0; j < 50; j++) {
      const mid = (lo + hi) / 2
      if ((at(c, mid)[axis] < p[axis]) === (end > start)) lo = mid
      else hi = mid
    }
    add((lo + hi) / 2)
  }
  return times
}

/** A shared cubic can be stored as one segment in one path and several in another. */
function sharedSpan(a: Curve, b: Curve): [number, number][] | null {
  const endpoints: [number, number][] = [
    ...pointTimes(a, b[0]).map(t => [t, 0] as [number, number]),
    ...pointTimes(a, b[3]).map(t => [t, 1] as [number, number]),
    ...pointTimes(b, a[0]).map(u => [0, u] as [number, number]),
    ...pointTimes(b, a[3]).map(u => [1, u] as [number, number]),
  ]
  for (let i = 0; i < endpoints.length; i++) for (let j = i + 1; j < endpoints.length; j++) {
    const [t, u] = endpoints[i], [v, w] = endpoints[j]
    if (Math.abs(t - v) < 1e-8 || Math.abs(u - w) < 1e-8) continue
    if (sameCurve(slice(a, Math.min(t, v), Math.max(t, v)), slice(b, Math.min(u, w), Math.max(u, w)))) return [endpoints[i], endpoints[j]]
  }
  return null
}

/** Solve the two distinct parameters of a cubic loop analytically. */
function selfIntersection(c: Curve): number[] {
  const a = point(-c[0].x + 3 * c[1].x - 3 * c[2].x + c[3].x, -c[0].y + 3 * c[1].y - 3 * c[2].y + c[3].y)
  const b = point(3 * c[0].x - 6 * c[1].x + 3 * c[2].x, 3 * c[0].y - 6 * c[1].y + 3 * c[2].y)
  const d = point(3 * (c[1].x - c[0].x), 3 * (c[1].y - c[0].y))
  const det = cross(a, b)
  if (Math.abs(det) < 1e-12) return []
  const sum = -cross(a, d) / det, q = -cross(d, b) / det, discriminant = 4 * q - 3 * sum * sum
  if (discriminant <= 1e-12) return []
  const root = Math.sqrt(discriminant), t = (sum - root) / 2, u = (sum + root) / 2
  return t > 0 && u < 1 ? [t, u] : []
}

/** Subdivide only intersecting bounds, then refine roots on the original cubics. */
function intersections(a: Curve, b: Curve): [number, number][] {
  if (!overlaps(boundsOf([a]), boundsOf([b])) || sameCurve(a, b)) return []
  const shared = sharedSpan(a, b)
  if (shared) return shared
  const hits: [number, number][] = []
  let visits = 0
  const refine = (t: number, u: number) => {
    for (let i = 0; i < 12; i++) {
      const delta = sub(at(b, u), at(a, t)), da = tangent(a, t), db = tangent(b, u), det = cross(da, db)
      if (Math.abs(det) < 1e-14) break
      const dt = cross(delta, db) / det, du = cross(delta, da) / det
      if (t + dt < -1e-6 || t + dt > 1 + 1e-6 || u + du < -1e-6 || u + du > 1 + 1e-6) break
      t += dt; u += du
      if (Math.abs(dt) + Math.abs(du) < 1e-12) break
    }
    if (distance(at(a, t), at(b, u)) < 2e-6 && !hits.some(([v, w]) => Math.abs(v - t) < 1e-7 && Math.abs(w - u) < 1e-7)) hits.push([Math.max(0, Math.min(1, t)), Math.max(0, Math.min(1, u))])
  }
  const visit = (ca: Curve, cb: Curve, ta: number, tb: number, ua: number, ub: number, depth: number) => {
    if (++visits > 50000) throw new Error('These paths are too complex to combine. Simplify them and try again.')
    const ba = boundsOf([ca]), bb = boundsOf([cb])
    if (!overlaps(ba, bb)) return
    const fa = flatness(ca), fb = flatness(cb)
    if ((fa < 1e-5 && fb < 1e-5) || depth > 40) {
      const r = sub(ca[3], ca[0]), s = sub(cb[3], cb[0]), delta = sub(cb[0], ca[0]), det = cross(r, s)
      if (Math.abs(det) > 1e-18) {
        const t = cross(delta, s) / det, u = cross(delta, r) / det
        if (t >= -1e-7 && t <= 1 + 1e-7 && u >= -1e-7 && u <= 1 + 1e-7) refine(ta + (tb - ta) * t, ua + (ub - ua) * u)
      } else if (Math.abs(cross(delta, r)) < 1e-8 * Math.max(1, distance(ca[0], ca[3]))) {
        // Shared straight edges need both overlap endpoints as split positions.
        // Collinear cubics need not use linear parameterization. Solve the
        // endpoint parameters instead of treating chord distance as t.
        for (const [p, u] of [[cb[0], 0], [cb[3], 1]] as const)
          for (const t of pointTimes(ca, p)) refine(ta + (tb - ta) * t, ua + (ub - ua) * u)
        for (const [p, t] of [[ca[0], 0], [ca[3], 1]] as const)
          for (const u of pointTimes(cb, p)) refine(ta + (tb - ta) * t, ua + (ub - ua) * u)
      }
      return
    }
    if (Math.max(ba.width, ba.height) >= Math.max(bb.width, bb.height)) { const [left, right] = split(ca, .5), mid = (ta + tb) / 2; visit(left, cb, ta, mid, ua, ub, depth + 1); visit(right, cb, mid, tb, ua, ub, depth + 1) }
    else { const [left, right] = split(cb, .5), mid = (ua + ub) / 2; visit(ca, left, ta, tb, ua, mid, depth + 1); visit(ca, right, ta, tb, mid, ub, depth + 1) }
  }
  visit(a, b, 0, 1, 0, 1, 0)
  return hits
}

/** Winding via monotone cubic spans avoids polygon approximation near curved edges. */
function contains(shape: Shape, p: Point): boolean {
  const bounds = shape.bounds
  if (p.x < bounds.x || p.x > bounds.x + bounds.width || p.y < bounds.y || p.y > bounds.y + bounds.height) return false
  let winding = 0
  for (const { curve, start, end, y0, y1 } of shape.spans) {
    let lo = start, hi = end
    if ((y0 <= p.y && y1 <= p.y) || (y0 > p.y && y1 > p.y)) continue
    const up = y1 > y0
    for (let j = 0; j < 45; j++) { const mid = (lo + hi) / 2; if ((at(curve, mid).y < p.y) === up) lo = mid; else hi = mid }
    if (at(curve, (lo + hi) / 2).x > p.x) winding += up ? 1 : -1
  }
  return shape.fillRule === 'evenodd' ? Math.abs(winding) % 2 === 1 : winding !== 0
}

const hitShapes = new WeakMap<VectorElement, Shape>()
/** Cache winding spans on immutable nodes; pointer moves do no path parsing. */
export function vectorContainsPoint(node: VectorElement, parentPoint: Point): boolean {
  let shape = hitShapes.get(node)
  if (!shape) { shape = shapeFor(node); hitShapes.set(node, shape) }
  return contains(shape, parentPoint)
}
function combinedInside(shapes: Shape[], operation: BooleanOperation, p: Point): boolean {
  if (operation === 'union') return shapes.some(shape => contains(shape, p))
  if (operation === 'intersect') return shapes.every(shape => contains(shape, p))
  if (operation === 'subtract') return contains(shapes[0], p) && !shapes.some((shape, index) => index > 0 && contains(shape, p))
  let inside = false
  for (const shape of shapes) if (contains(shape, p)) inside = !inside
  return inside
}
const format = (n: number) => String(Number(n.toFixed(8)))
const pair = (p: Point) => `${format(p.x)} ${format(p.y)}`
function serializeCurves(curves: Curve[]): string {
  const remaining = new Set(curves), contours: string[] = []
  while (remaining.size) {
    const first = remaining.values().next().value!, start = first[0]
    let curve = first, d = `M ${pair(start)}`, count = 0
    while (true) {
      remaining.delete(curve)
      d += flatness(curve) < 1e-10 ? ` L ${pair(curve[3])}` : ` C ${pair(curve[1])} ${pair(curve[2])} ${pair(curve[3])}`
      if (distance(curve[3], start) < 3e-6) break
      const end = curve[3], incoming = tangent(curve, 1)
      const candidates = [...remaining].filter(c => distance(c[0], end) < 3e-6)
      candidates.sort((a, b) => {
        const turn = (c: Curve) => { const out = tangent(c, 0); return Math.atan2(cross(incoming, out), incoming.x * out.x + incoming.y * out.y) }
        return turn(b) - turn(a)
      })
      if (!candidates.length || ++count > curves.length) throw new Error('The path outline could not be closed. Check the source geometry.')
      curve = candidates[0]
    }
    contours.push(d + ' Z')
  }
  return contours.join(' ')
}

export interface BooleanResult { d: string; viewBox: readonly [number, number, number, number]; bounds: Bounds; fillRule: 'nonzero' | 'evenodd' }

/**
 * Converts any vector element (path, rectangle, ellipse) into editable sub-path anchors.
 */
export function vectorToContours(node: VectorElement): PathContour[] {
  if (node.type === 'path') {
    if (node.nodes && node.nodes.length > 0) {
      return node.nodes.map(c => ({
        closed: c.closed,
        anchors: c.anchors.map(a => ({
          ...a,
          ...(a.in ? { in: { ...a.in } } : {}),
          ...(a.out ? { out: { ...a.out } } : {}),
          ...(a.quadApex ? { quadApex: { ...a.quadApex } } : {}),
        })),
      }))
    }
    return parsePath(node.d)
  }

  const w = node.width, h = node.height
  if (node.type === 'ellipse') {
    const rx = w / 2, ry = h / 2, cx = rx, cy = ry
    const kx = rx * K, ky = ry * K
    return [{
      closed: true,
      anchors: [
        { x: cx, y: 0, in: { x: cx - kx, y: 0 }, out: { x: cx + kx, y: 0 }, handleType: 'mirrored' },
        { x: w, y: cy, in: { x: w, y: cy - ky }, out: { x: w, y: cy + ky }, handleType: 'mirrored' },
        { x: cx, y: h, in: { x: cx + kx, y: h }, out: { x: cx - kx, y: h }, handleType: 'mirrored' },
        { x: 0, y: cy, in: { x: 0, y: cy + ky }, out: { x: 0, y: cy - ky }, handleType: 'mirrored' },
      ],
    }]
  }

  // Rectangle
  const r = Math.min(Math.max(0, node.cornerRadius), w / 2, h / 2)
  if (r < 1e-4) {
    return [{
      closed: true,
      anchors: [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ],
    }]
  }

  const kr = r * K
  return [{
    closed: true,
    anchors: [
      { x: r, y: 0 },
      { x: w - r, y: 0, out: { x: w - r + kr, y: 0 }, handleType: 'disconnected' },
      { x: w, y: r, in: { x: w, y: r - kr }, handleType: 'disconnected' },
      { x: w, y: h - r, out: { x: w, y: h - r + kr }, handleType: 'disconnected' },
      { x: w - r, y: h, in: { x: w - r + kr, y: h }, handleType: 'disconnected' },
      { x: r, y: h, out: { x: r - kr, y: h }, handleType: 'disconnected' },
      { x: 0, y: h - r, in: { x: 0, y: h - r + kr }, handleType: 'disconnected' },
      { x: 0, y: r, out: { x: 0, y: r - kr }, in: { x: r - kr, y: 0 }, handleType: 'disconnected' },
    ],
  }]
}

/**
 * Recursively searches for an operand by ID at any depth within a compound shape.
 */
export function findCompoundOperand(compound: BooleanCompound, operandId: string): VectorElement | undefined {
  for (const op of compound.operands) {
    if (op.id === operandId) return op
    if (op.type === 'path' && op.boolean) {
      const found = findCompoundOperand(op.boolean, operandId)
      if (found) return found
    }
  }
  return undefined
}

/**
 * Recursively searches for the direct parent BooleanCompound that contains the specified operandId.
 */
export function findCompoundParent(
  compound: BooleanCompound,
  operandId: string
): BooleanCompound | undefined {
  for (const op of compound.operands) {
    if (op.id === operandId) return compound
    if (op.type === 'path' && op.boolean) {
      const parent = findCompoundParent(op.boolean, operandId)
      if (parent) return parent
    }
  }
  return undefined
}

export interface ComputeBooleanOptions {
  fillRule?: 'nonzero' | 'evenodd'
  expandStrokes?: boolean
}

/**
 * Evaluates a single vector operand to a BooleanResult contour without combining.
 * Useful when only one operand is active (e.g. other operands are muted).
 */
export function evaluateSingleOperand(node: VectorElement, options?: ComputeBooleanOptions): BooleanResult {
  const evaluated = node.type === 'path' && node.boolean ? evaluateVectorElement(node) : node
  const shape = shapeFor(evaluated)
  const d = sourcePathData(shape.curves)
  const raw = boundsOf(shape.curves, true)
  const bounds = { ...raw, width: Math.max(0.01, raw.width), height: Math.max(0.01, raw.height) }
  const fillRule = options?.fillRule ?? shape.fillRule
  return { d, bounds, viewBox: [bounds.x, bounds.y, bounds.width, bounds.height], fillRule }
}

/**
 * Recursively evaluates a compound vector shape hierarchy.
 * If an operand is itself a compound shape, it is evaluated first so that
 * live edits at any depth propagate immediately to root compound outlines.
 */
export function evaluateVectorElement(node: VectorElement, depth = 0): VectorElement {
  if (depth > 32 || node.type !== 'path' || !node.boolean) return node
  const muted = new Set(node.boolean.mutedOperandIds ?? [])
  const activeOperands = node.boolean.operands.filter(op => !muted.has(op.id))
  const operandsToEvaluate = activeOperands.length >= 1 ? activeOperands : node.boolean.operands
  const evaluatedOperands = operandsToEvaluate.map(op => evaluateVectorElement(op, depth + 1))
  const result = evaluatedOperands.length === 1
    ? evaluateSingleOperand(evaluatedOperands[0])
    : computeBoolean(evaluatedOperands, node.boolean.operation)
  return {
    ...node,
    ...result.bounds,
    d: result.d,
    viewBox: result.viewBox,
    fillRule: result.fillRule,
    boolean: {
      ...node.boolean,
      operands: node.boolean.operands.map(op => evaluateVectorElement(op, depth + 1)),
    },
  }
}

/**
 * Live evaluation of compound shape hierarchy down to root result.
 */
export function evaluateCompoundHierarchy(compound: BooleanCompound, options?: ComputeBooleanOptions): BooleanResult {
  const muted = new Set(compound.mutedOperandIds ?? [])
  const activeOperands = compound.operands.filter(op => !muted.has(op.id))
  const operandsToEvaluate = activeOperands.length >= 1 ? activeOperands : compound.operands
  const evaluatedOperands = operandsToEvaluate.map(op => evaluateVectorElement(op))
  return evaluatedOperands.length === 1
    ? evaluateSingleOperand(evaluatedOperands[0], options)
    : computeBoolean(evaluatedOperands, compound.operation, options)
}

/** Preserve cubic segments and holes; only intersection parameters are numerical. */
export function computeBoolean(
  operands: readonly VectorElement[],
  operation: BooleanOperation,
  options?: ComputeBooleanOptions
): BooleanResult {
  if (!BOOLEAN_OPERATIONS.includes(operation) || operands.length < 2) throw new Error('Choose a boolean operation and at least two vector shapes.')
  let processedOperands = operands
  if (options?.expandStrokes) {
    processedOperands = operands.map(op => {
      if (op.style.stroke?.width && (!op.style.fill || op.style.fill === null)) {
        if (op.type === 'path') {
          const expanded = expandPathOutline(op.d, { strokeWidth: op.style.stroke.width })
          return {
            ...op,
            d: expanded.d,
            viewBox: expanded.viewBox,
            width: expanded.bounds.width,
            height: expanded.bounds.height,
            style: { ...op.style, fill: op.style.stroke.color, stroke: null },
          }
        }
      }
      return op
    })
  }
  const evaluatedOperands = processedOperands.map(op => op.type === 'path' && op.boolean ? evaluateVectorElement(op) : op)
  const shapes = evaluatedOperands.map(shapeFor)
  if (shapes.reduce((count, shape) => count + shape.curves.length, 0) > 2000) throw new Error('These paths have too many segments. Simplify them and try again.')
  // Split loops and extrema before intersection search, so every collinear
  // span is monotone even when its controls double back beyond its endpoints.
  const curves = shapes.flatMap(shape => shape.curves).flatMap(c => {
    const cuts = [0, ...selfIntersection(c), ...extrema(c, 'x'), ...extrema(c, 'y'), 1].sort((a, b) => a - b).filter((t, i, list) => !i || t - list[i - 1] > 1e-8)
    return cuts.slice(1).map((end, i) => slice(c, cuts[i], end))
  })
  const times = curves.map(() => [0, 1])
  // Sweep cached control bounds to avoid comparing distant segments.
  const ordered = curves.map((curve, index) => ({ curve, index, bounds: boundsOf([curve]) })).sort((a, b) => a.bounds.x - b.bounds.x)
  for (let i = 0; i < ordered.length; i++) for (let j = i + 1; j < ordered.length; j++) {
    const a = ordered[i], b = ordered[j]
    if (b.bounds.x > a.bounds.x + a.bounds.width + 1e-8) break
    if (!overlaps(a.bounds, b.bounds)) continue
    for (const [t, u] of intersections(a.curve, b.curve)) { times[a.index].push(t); times[b.index].push(u) }
  }
  const kept: Curve[] = []
  curves.forEach((curve, index) => {
    const cuts = times[index].sort((a, b) => a - b).filter((t, i, list) => !i || t - list[i - 1] > 1e-8)
    for (let i = 1; i < cuts.length; i++) {
      const piece = slice(curve, cuts[i - 1], cuts[i]), mid = at(piece, .5), direction = tangent(piece, .5), length = Math.hypot(direction.x, direction.y)
      if (length < 1e-9) continue
      const epsilon = Math.min(1e-5, length * 1e-4), normal = point(-direction.y / length * epsilon, direction.x / length * epsilon)
      const left = combinedInside(shapes, operation, point(mid.x + normal.x, mid.y + normal.y))
      const right = combinedInside(shapes, operation, point(mid.x - normal.x, mid.y - normal.y))
      if (left !== right && !kept.some(c => sameCurve(c, piece))) kept.push(left ? piece : reverse(piece))
    }
  })
  const raw = boundsOf(kept.length ? kept : curves, true)
  const bounds = { ...raw, width: Math.max(.01, raw.width), height: Math.max(.01, raw.height) }
  const fillRule = options?.fillRule ?? (operands.some(op => op.type === 'path' && op.fillRule === 'evenodd') ? 'evenodd' : 'nonzero')
  return { d: serializeCurves(kept), bounds, viewBox: [bounds.x, bounds.y, bounds.width, bounds.height], fillRule }
}

/** Recompute source geometry without changing its existing mapping into the scene. */
export function refreshBooleanElement(node: PathElement, compound: BooleanCompound): PathElement {
  const muted = new Set(compound.mutedOperandIds ?? [])
  const activeOperands = compound.operands.filter(op => !muted.has(op.id))
  const operandsToEvaluate = activeOperands.length >= 1 ? activeOperands : compound.operands
  const evaluatedOperands = operandsToEvaluate.map(op => evaluateVectorElement(op))
  const result = evaluatedOperands.length === 1
    ? evaluateSingleOperand(evaluatedOperands[0])
    : computeBoolean(evaluatedOperands, compound.operation)
  const allEvaluatedOperands = compound.operands.map(op => evaluateVectorElement(op))
  const [vx, vy, vw, vh] = node.viewBox, sx = node.width / vw, sy = node.height / vh
  const width = result.bounds.width * sx, height = result.bounds.height * sy
  const dx = (result.bounds.x + result.bounds.width / 2 - vx) * sx - node.width / 2
  const dy = (result.bounds.y + result.bounds.height / 2 - vy) * sy - node.height / 2
  const radians = node.rotation * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians)
  return { ...node, d: result.d, viewBox: result.viewBox, fillRule: result.fillRule, boolean: { ...compound, operands: allEvaluatedOperands },
    x: node.x + node.width / 2 + cos * dx - sin * dy - width / 2,
    y: node.y + node.height / 2 + sin * dx + cos * dy - height / 2, width, height,
  }
}

/** Flatten a source through a compound's viewBox transform when releasing a skew. */
export function transformedSource(source: VectorElement, compound: Extract<VectorElement, { type: 'path' }>): { d: string; bounds: Bounds; viewBox: readonly [number, number, number, number] } {
  const shape = shapeFor(source), [vx, vy, vw, vh] = compound.viewBox
  const angle = compound.rotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle)
  const map = (p: Point) => {
    const x = (p.x - vx) * compound.width / vw - compound.width / 2, y = (p.y - vy) * compound.height / vh - compound.height / 2
    return point(compound.x + compound.width / 2 + cos * x - sin * y, compound.y + compound.height / 2 + sin * x + cos * y)
  }
  const curves = shape.curves.map(c => c.map(map) as unknown as Curve)
  const d = sourcePathData(curves)
  const raw = boundsOf(curves, true), bounds = { ...raw, width: Math.max(.01, raw.width), height: Math.max(.01, raw.height) }
  return { d: d.trim(), bounds, viewBox: [bounds.x, bounds.y, bounds.width, bounds.height] }
}

function sourcePathData(curves: readonly Curve[]): string {
  // Keep original contour order and winding, including open paths' implicit closure.
  let d = '', cursor: Point | undefined, start: Point | undefined
  for (const c of curves) {
    if (!cursor || distance(cursor, c[0]) > 1e-8) { if (cursor) d += ' Z'; start = c[0]; d += ` M ${pair(c[0])}` }
    d += flatness(c) < 1e-10 ? ` L ${pair(c[3])}` : ` C ${pair(c[1])} ${pair(c[2])} ${pair(c[3])}`
    cursor = c[3]
    if (start && distance(cursor, start) < 1e-8) { d += ' Z'; cursor = undefined }
  }
  if (cursor) d += ' Z'
  return d.trim()
}

/** Fill outline in parent coordinates, preserving source winding and subpaths. */
export function vectorPathData(node: VectorElement): string {
  return sourcePathData(shapeFor(node).curves)
}
