import type { Bounds, Point } from '../canvas/types.ts'

export interface PolygonPoint extends Point {
  readonly x: number
  readonly y: number
}

export type PolygonRing = readonly Point[]

export interface PolygonGeometry {
  readonly outer: PolygonRing
  readonly holes: readonly PolygonRing[]
}

const point = (x: number, y: number): Point => ({ x, y })
const format = (n: number) => String(Number(n.toFixed(4)))

/**
 * Generates an equilateral / regular polygon with specified number of sides.
 */
export function createRegularPolygon(options: {
  sides: number
  radius: number
  cx?: number
  cy?: number
  rotation?: number
}): { points: Point[]; d: string; bounds: Bounds } {
  const sides = Math.max(3, Math.round(options.sides))
  const radius = Math.max(0.1, options.radius)
  const cx = options.cx ?? radius
  const cy = options.cy ?? radius
  const rotRad = ((options.rotation ?? 0) - 90) * (Math.PI / 180)

  const points: Point[] = []
  for (let i = 0; i < sides; i++) {
    const angle = rotRad + (i * 2 * Math.PI) / sides
    points.push(point(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)))
  }

  const d = polygonToPathData(points, true)
  const bounds = polygonBounds(points)
  return { points, d, bounds }
}

/**
 * Generates a star polygon with alternating outer and inner vertices.
 */
export function createStarPolygon(options: {
  points: number
  outerRadius: number
  innerRadius: number
  cx?: number
  cy?: number
  rotation?: number
}): { points: Point[]; d: string; bounds: Bounds } {
  const numPoints = Math.max(3, Math.round(options.points))
  const outerR = Math.max(0.2, options.outerRadius)
  const innerR = Math.max(0.1, options.innerRadius)
  const cx = options.cx ?? outerR
  const cy = options.cy ?? outerR
  const rotRad = ((options.rotation ?? 0) - 90) * (Math.PI / 180)

  const points: Point[] = []
  const totalVertices = numPoints * 2
  for (let i = 0; i < totalVertices; i++) {
    const r = i % 2 === 0 ? outerR : innerR
    const angle = rotRad + (i * Math.PI) / numPoints
    points.push(point(cx + r * Math.cos(angle), cy + r * Math.sin(angle)))
  }

  const d = polygonToPathData(points, true)
  const bounds = polygonBounds(points)
  return { points, d, bounds }
}

/**
 * Converts a list of 2D polygon vertices into an SVG path data string.
 */
export function polygonToPathData(vertices: readonly Point[], closed = true): string {
  if (!vertices || vertices.length === 0) return ''
  const start = vertices[0]
  let d = `M ${format(start.x)} ${format(start.y)}`
  for (let i = 1; i < vertices.length; i++) {
    d += ` L ${format(vertices[i].x)} ${format(vertices[i].y)}`
  }
  if (closed) d += ' Z'
  return d
}

/**
 * Calculates the bounding box of a set of 2D points.
 */
export function polygonBounds(points: readonly Point[]): Bounds {
  if (!points || points.length === 0) return { x: 0, y: 0, width: 0, height: 0 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  return {
    x: minX,
    y: minY,
    width: Math.max(0.01, maxX - minX),
    height: Math.max(0.01, maxY - minY),
  }
}

/**
 * Computes signed area of a 2D polygon using the Shoelace formula (surveyor's formula).
 * Positive = Counter-Clockwise (standard Cartesian), Negative = Clockwise.
 */
export function polygonSignedArea(points: readonly Point[]): number {
  if (!points || points.length < 3) return 0
  let area = 0
  const n = points.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    area += points[i].x * points[j].y - points[j].x * points[i].y
  }
  return area / 2
}

/**
 * Computes absolute area of a 2D polygon.
 */
export function polygonArea(points: readonly Point[]): number {
  return Math.abs(polygonSignedArea(points))
}

/**
 * Computes the perimeter (total edge length) of a polygon.
 */
export function polygonPerimeter(points: readonly Point[], closed = true): number {
  if (!points || points.length < 2) return 0
  let len = 0
  const count = closed ? points.length : points.length - 1
  for (let i = 0; i < count; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    len += Math.hypot(b.x - a.x, b.y - a.y)
  }
  return len
}

/**
 * Computes the geometric centroid (center of mass) of a 2D polygon.
 */
export function polygonCentroid(points: readonly Point[]): Point {
  if (!points || points.length === 0) return { x: 0, y: 0 }
  if (points.length === 1) return { ...points[0] }
  if (points.length === 2) return point((points[0].x + points[1].x) / 2, (points[0].y + points[1].y) / 2)

  let cx = 0
  let cy = 0
  let signedArea = 0
  const n = points.length
  for (let i = 0; i < n; i++) {
    const a = points[i]
    const b = points[(i + 1) % n]
    const factor = a.x * b.y - b.x * a.y
    signedArea += factor
    cx += (a.x + b.x) * factor
    cy += (a.y + b.y) * factor
  }
  signedArea /= 2

  if (Math.abs(signedArea) < 1e-9) {
    const bounds = polygonBounds(points)
    return point(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  }

  return point(cx / (6 * signedArea), cy / (6 * signedArea))
}

/**
 * Tests whether a point is inside a polygon using ray-casting algorithm (winding or evenodd).
 */
export function isPointInPolygon(
  p: Point,
  polygon: readonly Point[],
  fillRule: 'nonzero' | 'evenodd' = 'nonzero'
): boolean {
  if (!polygon || polygon.length < 3) return false
  const bounds = polygonBounds(polygon)
  if (p.x < bounds.x || p.x > bounds.x + bounds.width || p.y < bounds.y || p.y > bounds.y + bounds.height) {
    return false
  }

  let winding = 0
  const n = polygon.length
  for (let i = 0; i < n; i++) {
    const a = polygon[i]
    const b = polygon[(i + 1) % n]
    if (a.y <= p.y) {
      if (b.y > p.y) {
        // Upward crossing
        const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
        if (cross > 0) winding++
      }
    } else {
      if (b.y <= p.y) {
        // Downward crossing
        const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
        if (cross < 0) winding--
      }
    }
  }

  return fillRule === 'evenodd' ? Math.abs(winding) % 2 === 1 : winding !== 0
}

/**
 * Simplifies a polygon by removing collinear or near-identical consecutive vertices.
 */
export function simplifyPolygon(points: readonly Point[], tolerance = 0.5): Point[] {
  if (points.length <= 2) return [...points]
  const result: Point[] = [points[0]]

  for (let i = 1; i < points.length; i++) {
    const prev = result[result.length - 1]
    const curr = points[i]
    if (Math.hypot(curr.x - prev.x, curr.y - prev.y) > tolerance) {
      result.push(curr)
    }
  }

  // Remove collinear points along straight lines
  if (result.length > 2) {
    const filtered: Point[] = [result[0]]
    for (let i = 1; i < result.length - 1; i++) {
      const p0 = filtered[filtered.length - 1]
      const p1 = result[i]
      const p2 = result[i + 1]
      const cross = (p1.x - p0.x) * (p2.y - p0.y) - (p1.y - p0.y) * (p2.x - p0.x)
      if (Math.abs(cross) > 1e-4) {
        filtered.push(p1)
      }
    }
    filtered.push(result[result.length - 1])
    return filtered
  }

  return result
}

/**
 * Decomposes a multi-contour SVG path into discrete polygon rings.
 * Approximates Bézier curves with adaptive subdivision for high-fidelity geometric analysis.
 */
export function pathDataToPolygonRings(d: string, curveTolerance = 1.0): Point[][] {
  if (!d || !d.trim()) return []
  // Split on M or m to get contours
  const commands = d.match(/[a-df-z][^a-df-z]*/gi) ?? []
  const rings: Point[][] = []
  let currentRing: Point[] = []
  let cursor = point(0, 0)

  for (const cmd of commands) {
    const type = cmd[0]
    const args = cmd.slice(1).trim().split(/[\s,]+/).filter(Boolean).map(Number)

    if (type === 'M' || type === 'm') {
      if (currentRing.length > 2) rings.push(currentRing)
      currentRing = []
      const x = type === 'M' ? args[0] : cursor.x + args[0]
      const y = type === 'M' ? args[1] : cursor.y + args[1]
      cursor = point(x, y)
      currentRing.push(cursor)
      // Any extra pairs in M/m are treated as L/l
      for (let i = 2; i < args.length; i += 2) {
        const lx = type === 'M' ? args[i] : cursor.x + args[i]
        const ly = type === 'M' ? args[i + 1] : cursor.y + args[i + 1]
        cursor = point(lx, ly)
        currentRing.push(cursor)
      }
    } else if (type === 'L' || type === 'l') {
      for (let i = 0; i < args.length; i += 2) {
        const x = type === 'L' ? args[i] : cursor.x + args[i]
        const y = type === 'L' ? args[i + 1] : cursor.y + args[i + 1]
        cursor = point(x, y)
        currentRing.push(cursor)
      }
    } else if (type === 'H' || type === 'h') {
      for (let i = 0; i < args.length; i++) {
        const x = type === 'H' ? args[i] : cursor.x + args[i]
        cursor = point(x, cursor.y)
        currentRing.push(cursor)
      }
    } else if (type === 'V' || type === 'v') {
      for (let i = 0; i < args.length; i++) {
        const y = type === 'V' ? args[i] : cursor.y + args[i]
        cursor = point(cursor.x, y)
        currentRing.push(cursor)
      }
    } else if (type === 'C' || type === 'c') {
      for (let i = 0; i < args.length; i += 6) {
        const rel = type === 'c'
        const c1 = point(rel ? cursor.x + args[i] : args[i], rel ? cursor.y + args[i + 1] : args[i + 1])
        const c2 = point(rel ? cursor.x + args[i + 2] : args[i + 2], rel ? cursor.y + args[i + 3] : args[i + 3])
        const end = point(rel ? cursor.x + args[i + 4] : args[i + 4], rel ? cursor.y + args[i + 5] : args[i + 5])

        // Sample cubic bezier curve
        const steps = Math.max(6, Math.ceil(Math.hypot(end.x - cursor.x, end.y - cursor.y) / (curveTolerance * 4)))
        for (let s = 1; s <= steps; s++) {
          const t = s / steps
          const u = 1 - t
          const px = u ** 3 * cursor.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t ** 3 * end.x
          const py = u ** 3 * cursor.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t ** 3 * end.y
          currentRing.push(point(px, py))
        }
        cursor = end
      }
    } else if (type === 'Q' || type === 'q') {
      for (let i = 0; i < args.length; i += 4) {
        const rel = type === 'q'
        const c = point(rel ? cursor.x + args[i] : args[i], rel ? cursor.y + args[i + 1] : args[i + 1])
        const end = point(rel ? cursor.x + args[i + 2] : args[i + 2], rel ? cursor.y + args[i + 3] : args[i + 3])

        const steps = Math.max(4, Math.ceil(Math.hypot(end.x - cursor.x, end.y - cursor.y) / (curveTolerance * 4)))
        for (let s = 1; s <= steps; s++) {
          const t = s / steps
          const u = 1 - t
          const px = u * u * cursor.x + 2 * u * t * c.x + t * t * end.x
          const py = u * u * cursor.y + 2 * u * t * c.y + t * t * end.y
          currentRing.push(point(px, py))
        }
        cursor = end
      }
    } else if (type === 'Z' || type === 'z') {
      if (currentRing.length > 2) {
        rings.push(currentRing)
      }
      currentRing = []
    }
  }

  if (currentRing.length > 2) rings.push(currentRing)
  return rings
}
