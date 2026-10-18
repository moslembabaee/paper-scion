export * from './lottieExport.ts'
export * from './animatedSvgExport.ts'

export type AnimationExportFormat = 'lottie' | 'animated-svg'

export interface UnifiedAnimationExportOptions {
  readonly format: AnimationExportFormat
  readonly fps?: number
  readonly duration?: number
  readonly loop?: boolean
  readonly background?: 'transparent' | 'cream'
  readonly name?: string
  readonly pretty?: boolean
}
