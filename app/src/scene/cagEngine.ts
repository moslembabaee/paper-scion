import type { Bounds, Point } from '../canvas/types.ts'
import {
  computeBoolean,
  vectorPathData,
  type BooleanResult,
} from './booleanGeometry.ts'
import { parsePath, pathBounds } from './pathGeometry.ts'
import { optimizeSvgBezierData } from './bezierOptimization.ts'
import { adaptiveSubdividePath, type AdaptiveSubdivisionOptions } from './adaptiveSubdivision.ts'
import type {
  BooleanOperation,
  PathElement,
  SceneElement,
  VectorElement,
} from './types.ts'

/**
 * Constructive Area Geometry (CAG) Operations.
 * CAG is the 2D planar vector equivalent of 3D Constructive Solid Geometry (CSG).
 */
export type CAGOperation = 'union' | 'difference' | 'intersection' | 'exclusion'

export interface CAGOperationMetadata {
  readonly operation: CAGOperation
  readonly booleanOp: BooleanOperation
  readonly name: string
  readonly altName: string
  readonly symbol: string
  readonly hint: string
  readonly mathFormula: string
}

export const CAG_OPERATIONS: readonly CAGOperationMetadata[] = [
  {
    operation: 'union',
    booleanOp: 'union',
    name: 'Union',
    altName: 'Union',
    symbol: '∪',
    hint: 'Merge all overlapping vector areas into a single combined volume',
    mathFormula: 'A ∪ B',
  },
  {
    operation: 'difference',
    booleanOp: 'subtract',
    name: 'Difference',
    altName: 'Subtract',
    symbol: '∖',
    hint: 'Subtract subsequent cutting shapes from the primary base shape',
    mathFormula: 'A \\ B',
  },
  {
    operation: 'intersection',
    booleanOp: 'intersect',
    name: 'Intersection',
    altName: 'Intersect',
    symbol: '∩',
    hint: 'Retain only the mutually overlapping volume common to all shapes',
    mathFormula: 'A ∩ B',
  },
  {
    operation: 'exclusion',
    booleanOp: 'exclude',
    name: 'Exclusion',
    altName: 'Exclude',
    symbol: '⊕',
    hint: 'Retain non-overlapping regions; exclude even-overlapping intersections',
    mathFormula: 'A ⊕ B',
  },
]

export function toBooleanOperation(op: CAGOperation): BooleanOperation {
  switch (op) {
    case 'union':
      return 'union'
    case 'difference':
      return 'subtract'
    case 'intersection':
      return 'intersect'
    case 'exclusion':
      return 'exclude'
  }
}

export function fromBooleanOperation(op: BooleanOperation): CAGOperation {
  switch (op) {
    case 'union':
      return 'union'
    case 'subtract':
      return 'difference'
    case 'intersect':
      return 'intersection'
    case 'exclude':
      return 'exclusion'
  }
}

export interface CAGOptions {
  /** If true, runs adaptive bezier subdivision on inputs to resolve tight curves */
  adaptiveSubdivision?: boolean
  subdivisionOptions?: AdaptiveSubdivisionOptions
  /** Optimization tolerance for resulting bezier curves */
  tolerance?: number
  /** Precision decimal places for SVG output (default: 4) */
  precision?: number
  /** Clean up redundant collinear and flat bezier segments */
  cleanGeometry?: boolean
}

export interface CAGGeometryMetrics {
  /** Exact numerical area (px²) calculated via Gauss-Legendre quadrature along cubic beziers */
  readonly area: number
  /** Total contour perimeter length (px) */
  readonly perimeter: number
  /** Total number of subpath contours */
  readonly contourCount: number
  /** Number of closed contours */
  readonly closedContourCount: number
  /** Calculated centroid (center of mass) of the 2D area */
  readonly centroid: Point
  /** Bounding box of the geometry */
  readonly bounds: Bounds
}

export interface CAGResult extends BooleanResult {
  readonly operation: CAGOperation
  readonly metrics: CAGGeometryMetrics
  readonly cleanD: string
}

/**
 * 5-point Gauss-Legendre quadrature weights and evaluation abscissae.
 * Exact for polynomials up to degree 9 (integrand x*dy - y*dx has degree 5).
 */
const GL_X = [-0.906179845938664, -0.538469310105683, 0, 0.538469310105683, 0.906179845938664]
const GL_W = [0.236926885056189, 0.478628670499366, 0.568888888888889, 0.478628670499366, 0.236926885056189]

/**
 * Computes exact signed area enclosed by an SVG path using Green's Theorem.
 * Machine-precision evaluation for linear and cubic bezier contours.
 */
export function calculatePathArea(d: string): number {
  if (!d || !d.trim()) return 0
  const contours = parsePath(d)
  let total = 0

  for (const { anchors, closed } of contours) {
    if (anchors.length < 2) continue
    const count = closed ? anchors.length : anchors.length - 1
    for (let i = 0; i < count; i++) {
      const a = anchors[i]
      const b = anchors[(i + 1) % anchors.length]
      if (!a.out && !b.in) {
        // Straight line segment integration: (x1*y2 - y1*x2) / 2
        total += (a.x * b.y - a.y * b.x) / 2
        continue
      }

      const c = [a, a.out ?? a, b.in ?? b, b] as const
      for (let j = 0; j < 5; j++) {
        const t = (GL_X[j] + 1) / 2
        const u = 1 - t
        const vx = u ** 3 * c[0].x + 3 * u * u * t * c[1].x + 3 * u * t * t * c[2].x + t ** 3 * c[3].x
        const vy = u ** 3 * c[0].y + 3 * u * u * t * c[1].y + 3 * u * t * t * c[2].y + t ** 3 * c[3].y
        const dx = 3 * u * u * (c[1].x - c[0].x) + 6 * u * t * (c[2].x - c[1].x) + 3 * t * t * (c[3].x - c[2].x)
        const dy = 3 * u * u * (c[1].y - c[0].y) + 6 * u * t * (c[2].y - c[1].y) + 3 * t * t * (c[3].y - c[2].y)
        total += GL_W[j] * (vx * dy - vy * dx) / 4
      }
    }
  }

  return Math.abs(total)
}

/**
 * Computes perimeter / total arc length of all contours in an SVG path.
 */
export function calculatePathPerimeter(d: string): number {
  if (!d || !d.trim()) return 0
  const contours = parsePath(d)
  let totalPerimeter = 0

  for (const { anchors, closed } of contours) {
    if (anchors.length < 2) continue
    const count = closed ? anchors.length : anchors.length - 1
    for (let i = 0; i < count; i++) {
      const a = anchors[i]
      const b = anchors[(i + 1) % anchors.length]
      if (!a.out && !b.in) {
        totalPerimeter += Math.hypot(b.x - a.x, b.y - a.y)
        continue
      }

      const c = [a, a.out ?? a, b.in ?? b, b] as const
      let segmentLength = 0
      for (let j = 0; j < 5; j++) {
        const t = (GL_X[j] + 1) / 2
        const u = 1 - t
        const dx = 3 * u * u * (c[1].x - c[0].x) + 6 * u * t * (c[2].x - c[1].x) + 3 * t * t * (c[3].x - c[2].x)
        const dy = 3 * u * u * (c[1].y - c[0].y) + 6 * u * t * (c[2].y - c[1].y) + 3 * t * t * (c[3].y - c[2].y)
        segmentLength += GL_W[j] * Math.hypot(dx, dy) / 2
      }
      totalPerimeter += segmentLength
    }
  }

  return totalPerimeter
}

/**
 * Computes the 2D area centroid (center of mass) of an SVG path.
 */
export function calculatePathCentroid(d: string): Point {
  if (!d || !d.trim()) return { x: 0, y: 0 }
  const contours = parsePath(d)
  let totalArea = 0
  let cxSum = 0
  let cySum = 0

  for (const { anchors, closed } of contours) {
    if (anchors.length < 2) continue
    const count = closed ? anchors.length : anchors.length - 1
    for (let i = 0; i < count; i++) {
      const a = anchors[i]
      const b = anchors[(i + 1) % anchors.length]
      if (!a.out && !b.in) {
        const cross = a.x * b.y - a.y * b.x
        totalArea += cross / 2
        cxSum += (a.x + b.x) * cross / 6
        cySum += (a.y + b.y) * cross / 6
        continue
      }

      const c = [a, a.out ?? a, b.in ?? b, b] as const
      for (let j = 0; j < 5; j++) {
        const t = (GL_X[j] + 1) / 2
        const u = 1 - t
        const vx = u ** 3 * c[0].x + 3 * u * u * t * c[1].x + 3 * u * t * t * c[2].x + t ** 3 * c[3].x
        const vy = u ** 3 * c[0].y + 3 * u * u * t * c[1].y + 3 * u * t * t * c[2].y + t ** 3 * c[3].y
        const dx = 3 * u * u * (c[1].x - c[0].x) + 6 * u * t * (c[2].x - c[1].x) + 3 * t * t * (c[3].x - c[2].x)
        const dy = 3 * u * u * (c[1].y - c[0].y) + 6 * u * t * (c[2].y - c[1].y) + 3 * t * t * (c[3].y - c[2].y)
        const dArea = GL_W[j] * (vx * dy - vy * dx) / 4
        totalArea += dArea
        cxSum += vx * dArea / 3
        cySum += vy * dArea / 3
      }
    }
  }

  if (Math.abs(totalArea) < 1e-9) {
    const bounds = pathBounds(contours)
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
  }

  return {
    x: cxSum / totalArea,
    y: cySum / totalArea,
  }
}

/**
 * Computes full geometry metrics for any SVG path data string.
 */
export function extractCAGMetrics(d: string): CAGGeometryMetrics {
  const contours = parsePath(d)
  const bounds = pathBounds(contours)
  const area = calculatePathArea(d)
  const perimeter = calculatePathPerimeter(d)
  const centroid = calculatePathCentroid(d)
  const closedContourCount = contours.filter(c => c.closed).length

  return {
    area,
    perimeter,
    contourCount: contours.length,
    closedContourCount,
    centroid,
    bounds,
  }
}

/**
 * Cleans and normalizes SVG path geometry:
 * - Collapses consecutive identical points
 * - Simplifies collinear straight sections into clean lines
 * - Re-quantizes precision to prevent numerical drift
 * - Optimizes bezier curve representations
 */
export function cleanSvgPathGeometry(
  d: string,
  options: { precision?: number; tolerance?: number } = {}
): string {
  if (!d || !d.trim()) return ''
  const precision = options.precision ?? 4
  const tolerance = options.tolerance ?? 1e-5

  // First apply the robust bezier optimization engine
  const optimized = optimizeSvgBezierData(d, {
    precision,
    tolerance,
  })

  return optimized
}

/**
 * Evaluates Constructive Area Geometry boolean operation across a list of vector operands.
 */
export function evaluateCAG(
  operands: readonly VectorElement[],
  operation: CAGOperation,
  options: CAGOptions = {}
): CAGResult {
  if (operands.length < 2) {
    throw new Error('Select at least two vector shapes to perform CAG boolean operations.')
  }

  let processedOperands = operands

  if (options.adaptiveSubdivision) {
    processedOperands = operands.map(op => {
      if (op.type === 'path') {
        const subdividedD = adaptiveSubdividePath(op.d, options.subdivisionOptions)
        return { ...op, d: subdividedD }
      }
      return op
    })
  }

  const boolOp = toBooleanOperation(operation)
  const result = computeBoolean(processedOperands, boolOp)

  const cleanD = cleanSvgPathGeometry(result.d, {
    precision: options.precision ?? 4,
    tolerance: options.tolerance ?? 1e-6,
  })

  const metrics = extractCAGMetrics(cleanD || result.d)

  return {
    ...result,
    d: cleanD || result.d,
    cleanD: cleanD || result.d,
    operation,
    metrics,
  }
}

/**
 * Creates a synthetic vector path element from raw SVG path data.
 */
export function createSyntheticVectorPath(
  d: string,
  id = 'cag-synthetic-operand',
  name = 'Operand'
): PathElement {
  const parsed = parsePath(d)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const contour of parsed) {
    for (const anchor of contour.anchors) {
      minX = Math.min(minX, anchor.x, anchor.in?.x ?? anchor.x, anchor.out?.x ?? anchor.x)
      minY = Math.min(minY, anchor.y, anchor.in?.y ?? anchor.y, anchor.out?.y ?? anchor.y)
      maxX = Math.max(maxX, anchor.x, anchor.in?.x ?? anchor.x, anchor.out?.x ?? anchor.x)
      maxY = Math.max(maxY, anchor.y, anchor.in?.y ?? anchor.y, anchor.out?.y ?? anchor.y)
    }
  }
  if (!Number.isFinite(minX)) {
    minX = 0
    minY = 0
    maxX = 100
    maxY = 100
  }
  const width = Math.max(0.1, maxX - minX)
  const height = Math.max(0.1, maxY - minY)

  return {
    id,
    name,
    type: 'path',
    parentId: null,
    zIndex: 0,
    visible: true,
    locked: false,
    x: minX,
    y: minY,
    width,
    height,
    rotation: 0,
    d,
    viewBox: [minX, minY, width, height],
    fillRule: 'nonzero',
    style: { fill: '#81adec', stroke: null, opacity: 1, shadow: null },
  }
}

/**
 * Evaluates CAG boolean operation between two raw SVG path data strings.
 */
export function evaluatePathCAG(
  baseD: string,
  cutterD: string,
  operation: CAGOperation,
  options: CAGOptions = {}
): CAGResult {
  const baseEl = createSyntheticVectorPath(baseD, 'cag-base', 'Base')
  const cutterEl = createSyntheticVectorPath(cutterD, 'cag-cutter', 'Cutter')
  return evaluateCAG([baseEl, cutterEl], operation, options)
}

/**
 * Hierarchy node representation of a Non-Destructive CAG Compound Shape.
 */
export interface CAGHierarchyNode {
  readonly id: string
  readonly name: string
  readonly type: 'compound' | 'primitive'
  readonly operation?: CAGOperation
  readonly bounds: Bounds
  readonly operandCount: number
  readonly children: readonly CAGHierarchyNode[]
  readonly element: VectorElement
  readonly depth: number
}

/**
 * Inspects a compound element and builds a complete non-destructive hierarchy tree.
 */
export function buildCAGHierarchyTree(element: VectorElement, depth = 0): CAGHierarchyNode {
  const isCompound = element.type === 'path' && !!element.boolean
  const bounds: Bounds = {
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
  }

  if (!isCompound) {
    return {
      id: element.id,
      name: element.name,
      type: 'primitive',
      bounds,
      operandCount: 1,
      children: [],
      element,
      depth,
    }
  }

  const compound = element.boolean!
  const children = compound.operands.map(op => buildCAGHierarchyTree(op, depth + 1))

  return {
    id: element.id,
    name: element.name,
    type: 'compound',
    operation: fromBooleanOperation(compound.operation),
    bounds,
    operandCount: compound.operands.length,
    children,
    element,
    depth,
  }
}

/**
 * Recursively counts the total number of underlying source vector primitives
 * preserved inside a compound shape hierarchy.
 */
export function countUnderlyingSources(element: VectorElement): number {
  if (element.type !== 'path' || !element.boolean) return 1
  return element.boolean.operands.reduce((sum, op) => sum + countUnderlyingSources(op), 0)
}

/**
 * Checks whether two vector elements or path bounding boxes have overlapping extents.
 */
export function doVectorShapesOverlap(a: VectorElement, b: VectorElement): boolean {
  const ra = {
    minX: a.x,
    minY: a.y,
    maxX: a.x + a.width,
    maxY: a.y + a.height,
  }
  const rb = {
    minX: b.x,
    minY: b.y,
    maxX: b.x + b.width,
    maxY: b.y + b.height,
  }

  return (
    ra.minX <= rb.maxX + 1e-8 &&
    rb.minX <= ra.maxX + 1e-8 &&
    ra.minY <= rb.maxY + 1e-8 &&
    rb.minY <= ra.maxY + 1e-8
  )
}

/**
 * Export options for clean SVG path geometry.
 */
export interface CleanSVGExportOptions {
  /** If true, returns a full standalone <svg> document; otherwise returns <path> element */
  standalone?: boolean
  /** Include CSS styling attributes (fill, stroke, fill-rule) */
  includeStyling?: boolean
  /** Precision decimal places */
  precision?: number
  /** Fill color override */
  fill?: string
  /** Stroke color override */
  stroke?: string
  /** Stroke width override */
  strokeWidth?: number
}

/**
 * Exports clean, production-grade SVG geometry from a CAG compound or result.
 */
export function exportCleanSVGGeometry(
  elementOrResult: PathElement | CAGResult,
  options: CleanSVGExportOptions = {}
): string {
  const d = 'cleanD' in elementOrResult ? elementOrResult.cleanD : cleanSvgPathGeometry(elementOrResult.d, { precision: options.precision ?? 4 })
  const viewBox = 'viewBox' in elementOrResult ? elementOrResult.viewBox : [0, 0, 100, 100] as const
  const fillRule = elementOrResult.fillRule ?? 'nonzero'

  const fill = options.fill ?? ('style' in elementOrResult ? elementOrResult.style.fill ?? '#81adec' : '#81adec')
  const stroke = options.stroke ?? ('style' in elementOrResult ? elementOrResult.style.stroke?.color ?? 'none' : 'none')
  const strokeWidth = options.strokeWidth ?? ('style' in elementOrResult ? elementOrResult.style.stroke?.width ?? 0 : 0)

  const strokeAttr = stroke && stroke !== 'none' ? ` stroke="${stroke}" stroke-width="${strokeWidth}"` : ''
  const pathMarkup = `<path d="${d}" fill="${fill}" fill-rule="${fillRule}"${strokeAttr}/>`

  if (!options.standalone) {
    return pathMarkup
  }

  const [vx, vy, vw, vh] = viewBox
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}" width="${vw}" height="${vh}">`,
    `  ${pathMarkup}`,
    `</svg>`,
  ].join('\n')
}

/**
 * Generates an SVG <clipPath> definition containing the compound shape's precise path geometry.
 */
export function generateCompoundClipPath(
  element: PathElement,
  options: { clipPathId?: string; precision?: number } = {}
): string {
  const clipId = options.clipPathId || `clip-${element.id}`
  const d = cleanSvgPathGeometry(element.d, { precision: options.precision ?? 4 })
  const fillRule = element.fillRule ?? 'nonzero'
  return `<clipPath id="${clipId}" clipPathUnits="userSpaceOnUse">\n  <path d="${d}" fill-rule="${fillRule}" clip-rule="${fillRule}"/>\n</clipPath>`
}

/**
 * Generates an SVG <mask> definition containing the compound shape's filled geometry.
 */
export function generateCompoundSVGMask(
  element: PathElement,
  options: { maskId?: string; precision?: number } = {}
): string {
  const maskId = options.maskId || `mask-${element.id}`
  const d = cleanSvgPathGeometry(element.d, { precision: options.precision ?? 4 })
  const fillRule = element.fillRule ?? 'nonzero'
  return `<mask id="${maskId}" maskUnits="userSpaceOnUse">\n  <path d="${d}" fill="#ffffff" fill-rule="${fillRule}"/>\n</mask>`
}

/**
 * Generates a non-destructive SVG group hierarchy representing the compound shape
 * and all nested sub-operands, tagged with metadata for inspection and re-import.
 */
export function generateCompoundHierarchyMarkup(
  element: PathElement,
  options: { precision?: number; indent?: string } = {}
): string {
  const indent = options.indent ?? ''
  const subIndent = indent + '  '
  const precision = options.precision ?? 4

  if (!element.boolean) {
    const d = cleanSvgPathGeometry(element.d, { precision })
    return `${indent}<path id="${element.id}" d="${d}" fill="${element.style.fill ?? '#81adec'}" fill-rule="${element.fillRule}"/>`
  }

  const { operation, operands, mutedOperandIds = [] } = element.boolean
  const mutedSet = new Set(mutedOperandIds)
  const lines: string[] = []

  lines.push(`${indent}<g id="${element.id}" data-type="compound" data-boolean-op="${operation}">`)
  lines.push(`${subIndent}<!-- Compound Result Outline -->`)
  const resultD = cleanSvgPathGeometry(element.d, { precision })
  lines.push(`${subIndent}<path d="${resultD}" fill="${element.style.fill ?? '#81adec'}" fill-rule="${element.fillRule}"/>`)
  lines.push(`${subIndent}<!-- Non-Destructive Source Hierarchy (${operands.length} operands) -->`)
  lines.push(`${subIndent}<g data-role="sources" style="display:none">`)

  for (const op of operands) {
    const isMuted = mutedSet.has(op.id)
    if (op.type === 'path' && op.boolean) {
      lines.push(generateCompoundHierarchyMarkup(op, { precision, indent: subIndent + '  ' }))
    } else {
      const opD = cleanSvgPathGeometry(vectorPathData(op), { precision })
      lines.push(`${subIndent}  <path id="${op.id}" data-name="${op.name}" data-muted="${isMuted}" d="${opD}"/>`)
    }
  }

  lines.push(`${subIndent}</g>`)
  lines.push(`${indent}</g>`)

  return lines.join('\n')
}

/**
 * Generates a complete standalone SVG document where the compound shape
 * acts as an SVG clipping path bounding a target or background element.
 */
export function generateClippedSVGExport(
  compound: PathElement,
  targetElement?: SceneElement,
  options: CleanSVGExportOptions = {}
): string {
  const clipId = `clip-${compound.id}`
  const clipPathXml = generateCompoundClipPath(compound, { clipPathId: clipId, precision: options.precision ?? 4 })
  const [vx, vy, vw, vh] = compound.viewBox

  let targetContent = ''
  if (targetElement) {
    if (targetElement.type === 'rectangle' || targetElement.type === 'ellipse' || targetElement.type === 'path') {
      const targetD = cleanSvgPathGeometry(vectorPathData(targetElement), { precision: options.precision ?? 4 })
      targetContent = `<path d="${targetD}" fill="${targetElement.style.fill ?? '#81adec'}"/>`
    } else {
      targetContent = `<rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="#81adec"/>`
    }
  } else {
    targetContent = `<rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="${options.fill ?? compound.style.fill ?? '#81adec'}"/>`
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}" width="${vw}" height="${vh}">`,
    `  <defs>`,
    `    ${clipPathXml}`,
    `  </defs>`,
    `  <g clip-path="url(#${clipId})">`,
    `    ${targetContent}`,
    `  </g>`,
    `</svg>`,
  ].join('\n')
}

/**
 * Generates modern CSS clip-path value using SVG path definition.
 */
export function generateCssClipPath(
  element: PathElement,
  options: { precision?: number } = {}
): string {
  const d = cleanSvgPathGeometry(element.d, { precision: options.precision ?? 4 })
  return `path('${d}')`
}

/**
 * Clips a vector element directly with a compound path using Constructive Area Geometry.
 */
export function clipPathWithCompound(
  target: VectorElement,
  clipCompound: PathElement,
  mode: 'intersect' | 'subtract' = 'intersect'
): BooleanResult {
  const boolOp: BooleanOperation = mode === 'intersect' ? 'intersect' : 'subtract'
  return computeBoolean([target, clipCompound], boolOp)
}

/**
 * Sutherland-Hodgman convex polygon clipping math algorithm.
 * Clips a subject polygon by a convex clipping polygon.
 */
export function computePolygonClipping(
  subjectPolygon: readonly Point[],
  clipPolygon: readonly Point[]
): Point[] {
  if (subjectPolygon.length < 3 || clipPolygon.length < 3) return []

  let outputList = [...subjectPolygon]

  const isInside = (p: Point, cp1: Point, cp2: Point): boolean => {
    return (cp2.x - cp1.x) * (p.y - cp1.y) - (cp2.y - cp1.y) * (p.x - cp1.x) >= -1e-9
  }

  const lineIntersection = (s: Point, e: Point, cp1: Point, cp2: Point): Point => {
    const dcx = cp1.x - cp2.x
    const dcy = cp1.y - cp2.y
    const dpx = s.x - e.x
    const dpy = s.y - e.y
    const n1 = cp1.x * cp2.y - cp1.y * cp2.x
    const n2 = s.x * e.y - s.y * e.x
    const denom = dcx * dpy - dcy * dpx
    if (Math.abs(denom) < 1e-12) return s
    return {
      x: (n1 * dpx - n2 * dcx) / denom,
      y: (n1 * dpy - n2 * dcy) / denom,
    }
  }

  for (let i = 0; i < clipPolygon.length; i++) {
    const cp1 = clipPolygon[i]
    const cp2 = clipPolygon[(i + 1) % clipPolygon.length]
    const inputList = outputList
    outputList = []
    if (inputList.length === 0) break

    let s = inputList[inputList.length - 1]
    for (const p of inputList) {
      if (isInside(p, cp1, cp2)) {
        if (!isInside(s, cp1, cp2)) {
          outputList.push(lineIntersection(s, p, cp1, cp2))
        }
        outputList.push(p)
      } else if (isInside(s, cp1, cp2)) {
        outputList.push(lineIntersection(s, p, cp1, cp2))
      }
      s = p
    }
  }

  return outputList
}

