import type { BezierCurve, SpringParameters } from '../prototype/types.ts'

export type MotionTransformProperty =
  | 'x'
  | 'y'
  | 'rotation'
  | 'scale'
  | 'scaleX'
  | 'scaleY'
  | 'skewX'
  | 'skewY'
  | 'opacity'
  | 'cornerRadius'

export type MotionShaderProperty =
  | 'shaderSpeed'
  | 'shaderScale'
  | 'shaderRotation'
  | 'shaderOffsetX'
  | 'shaderOffsetY'
  | 'shaderOpacity'

export type MotionPathProperty =
  | 'pathShape'
  | 'pathMorphProgress'
  | 'pathTrimStart'
  | 'pathTrimEnd'
  | 'pathTrimOffset'
  | 'pathStrokeWidth'
  | 'pathDashOffset'

export type MotionTypographyProperty =
  | 'fontWeight'
  | 'fontWidth'
  | 'fontSlant'
  | 'fontOpticalSize'
  | 'fontSize'
  | 'letterSpacing'
  | 'lineHeight'
  | 'textPathOffset'
  | 'kineticPhase'
  | 'kineticAmplitude'
  | 'kineticRotation'
  | 'kineticStagger'
  | 'kineticWeightModulation'
  | 'kineticSlantModulation'
  | 'kineticScaleModulation'

/** Translations and rotation are offsets from the design; scale is a multiplier; shader parameters modulate material uniforms; path parameters modulate vector shapes & strokes; typography modulates variable axes and kinetics. */
export type MotionProperty =
  | MotionTransformProperty
  | MotionShaderProperty
  | MotionTypographyProperty
  | MotionPathProperty

export type MotionEasing = { readonly kind: 'bezier'; readonly curve: BezierCurve } | { readonly kind: 'spring'; readonly spring: SpringParameters }
export interface MotionKeyframe {
  readonly id: string
  readonly time: number
  readonly value: number
  /** Optional SVG path data outline when keyframing vector path shapes */
  readonly pathData?: string
  /** Optional shape preset name (e.g. 'star5', 'heart', 'shield', 'circle') */
  readonly shapePreset?: string
  /** Outgoing segment easing. The final keyframe retains it for later edits. */
  readonly easing: MotionEasing
}
export interface MotionTrack {
  readonly id: string
  readonly elementId: string
  readonly property: MotionProperty
  readonly enabled: boolean
  readonly keyframes: readonly MotionKeyframe[]
}
export interface MotionDocument {
  readonly duration: number
  readonly tracks: readonly MotionTrack[]
  readonly loop?: boolean
  readonly fps?: number
}
