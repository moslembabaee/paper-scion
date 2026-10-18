import type { VectorElement } from './types.ts'
import type { BooleanResult } from './booleanGeometry.ts'
import {
  evaluateCAG,
  evaluatePathCAG,
  createSyntheticVectorPath,
  toBooleanOperation,
  fromBooleanOperation,
  CAG_OPERATIONS,
  type CAGOperation,
  type CAGOptions,
  type CAGGeometryMetrics,
  type CAGHierarchyNode,
  type CAGResult,
  calculatePathArea,
  calculatePathPerimeter,
  calculatePathCentroid,
  extractCAGMetrics,
  buildCAGHierarchyTree,
  countUnderlyingSources,
  doVectorShapesOverlap,
  cleanSvgPathGeometry,
  exportCleanSVGGeometry,
  generateCompoundClipPath,
  generateCompoundSVGMask,
  generateCompoundHierarchyMarkup,
  generateClippedSVGExport,
  generateCssClipPath,
  clipPathWithCompound,
  computePolygonClipping,
} from './cagEngine.ts'

export type CSGOperation = CAGOperation

export const CSG_OPERATIONS = CAG_OPERATIONS.map(op => ({
  operation: op.operation,
  name: op.name,
  hint: op.hint,
  symbol: op.symbol,
}))

export type CSGOptions = CAGOptions

export {
  toBooleanOperation,
  fromBooleanOperation,
  createSyntheticVectorPath,
  calculatePathArea,
  calculatePathPerimeter,
  calculatePathCentroid,
  extractCAGMetrics,
  buildCAGHierarchyTree,
  countUnderlyingSources,
  doVectorShapesOverlap,
  cleanSvgPathGeometry,
  exportCleanSVGGeometry,
  generateCompoundClipPath,
  generateCompoundSVGMask,
  generateCompoundHierarchyMarkup,
  generateClippedSVGExport,
  generateCssClipPath,
  clipPathWithCompound,
  computePolygonClipping,
  type CAGGeometryMetrics,
  type CAGHierarchyNode,
  type CAGResult,
}

/**
 * Evaluates live Constructive Solid / Area Geometry between two vector elements.
 */
export function computeLayerCSG(
  base: VectorElement,
  operand: VectorElement,
  operation: CSGOperation,
  options: CSGOptions = {}
): BooleanResult {
  return evaluateCAG([base, operand], operation, options)
}

/**
 * Evaluates live Constructive Solid / Area Geometry between two raw SVG path data strings.
 */
export function computePathCSG(
  baseD: string,
  operandD: string,
  operation: CSGOperation,
  options: CSGOptions = {}
): BooleanResult {
  return evaluatePathCAG(baseD, operandD, operation, options)
}

