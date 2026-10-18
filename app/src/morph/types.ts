import type { Point } from '../canvas/types.ts'
import type { PathNodes } from '../scene/pathGeometry.ts'

/** Represents a single cubic Bezier curve segment [p0, p1, p2, p3] */
export interface CubicSegment {
  readonly p0: Point // Start anchor
  readonly p1: Point // First control point (outgoing from p0)
  readonly p2: Point // Second control point (incoming to p3)
  readonly p3: Point // End anchor
}

/** Normalized contour composed purely of cubic Bezier segments */
export interface CubicContour {
  readonly segments: readonly CubicSegment[]
  readonly closed: boolean
  readonly arcLength: number
  readonly segmentLengths: readonly number[]
  readonly centroid: Point
  readonly area: number
  readonly isClockwise: boolean
  readonly bounds: {
    readonly minX: number
    readonly minY: number
    readonly maxX: number
    readonly maxY: number
    readonly width: number
    readonly height: number
  }
}

/** Normalized vector shape consisting of one or more cubic contours */
export interface NormalizedShape {
  readonly contours: readonly CubicContour[]
  readonly totalSegments: number
  readonly totalArcLength: number
  readonly bounds: {
    readonly minX: number
    readonly minY: number
    readonly maxX: number
    readonly maxY: number
    readonly width: number
    readonly height: number
  }
  readonly centroid: Point
}

/** Morph target input configuration */
export interface MorphTarget {
  readonly id: string
  readonly name: string
  readonly d: string
  readonly viewBox: readonly [number, number, number, number]
  readonly fillRule?: 'nonzero' | 'evenodd'
  readonly color?: string
  readonly nodes?: readonly PathNodes[]
}

/** Point count equalization strategy */
export type EqualizationStrategy = 'adaptive-arclength' | 'curvature' | 'uniform'

/** Interpolation trajectory calculation mode */
export type InterpolationMode = 'cartesian' | 'polar' | 'blended'

/** Trajectory alignment strategy for finding optimal correspondence */
export type AlignmentStrategy = 'auto-distance' | 'manual-shift' | 'none'

/** Supported easing curve identifiers */
export type MorphEasing =
  | 'linear'
  | 'easeInOutCubic'
  | 'easeInQuad'
  | 'easeOutQuad'
  | 'easeInOutQuad'
  | 'anticipate'
  | 'easeOutBack'
  | 'spring'
  | 'elastic'
  | 'bounce'

/** Comprehensive configuration for the morphing engine */
export interface MorphConfig {
  /** Target number of segments/points per contour (or 'auto') */
  readonly pointCount: number
  /** Subdivision algorithm */
  readonly equalizationStrategy: EqualizationStrategy
  /** Trajectory alignment method to prevent shape twisting */
  readonly alignmentStrategy: AlignmentStrategy
  /** Manual circular shift offset (when alignmentStrategy === 'manual-shift') */
  readonly manualShiftOffset: number
  /** Whether to automatically match winding direction */
  readonly autoMatchWinding: boolean
  /** Interpolation mode */
  readonly interpolationMode: InterpolationMode
  /** Blend factor between Cartesian (0) and Polar (1) when mode is 'blended' */
  readonly polarBlend: number
  /** Playback duration in milliseconds */
  readonly duration: number
  /** Easing function for progress interpolation */
  readonly easing: MorphEasing
  /** Playback mode */
  readonly playbackMode: 'loop' | 'pingpong' | 'once'
  /** Visualization flags */
  readonly showTrajectories: boolean
  readonly showAnchors: boolean
  readonly showGhostA: boolean
  readonly showGhostB: boolean
  readonly showCentroid: boolean
}

/** Point correspondence line connecting matching anchors between shapes */
export interface TrajectoryLine {
  readonly from: Point
  readonly to: Point
  readonly current: Point
  readonly index: number
  readonly distance: number
}

/** Computed result of a morph interpolation at a specific progress t */
export interface MorphResult {
  /** Computed interpolated SVG path string `d` */
  readonly d: string
  /** Normalized and equalized source shape (Target A) */
  readonly shapeA: NormalizedShape
  /** Normalized, equalized, and aligned target shape (Target B) */
  readonly shapeB: NormalizedShape
  /** Interpolated shape at progress t */
  readonly interpolatedShape: NormalizedShape
  /** Point-to-point trajectory correspondence lines */
  readonly trajectories: readonly TrajectoryLine[]
  /** Total deformation distance metric (sum of vertex displacement) */
  readonly trajectoryStrain: number
  /** Progress value after easing applied */
  readonly easedProgress: number
  /** Raw progress in [0, 1] */
  readonly rawProgress: number
}

/** Morph preset configuration */
export interface MorphPreset {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly targetA: MorphTarget
  readonly targetB: MorphTarget
  readonly config?: Partial<MorphConfig>
}

/** Code export formats */
export type MorphExportFormat =
  | 'svg-smil'
  | 'svg-static'
  | 'react-framer'
  | 'css-keyframes'
  | 'waapi'
