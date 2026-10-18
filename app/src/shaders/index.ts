export { createShader, shaderCatalog, shaderKinds, updateShaderParameter, validateShader } from './catalog'
export { ShaderSurface } from './ShaderSurface'
export { ShaderInspector } from './ShaderInspector'
export { exportMeshReact, exportPipelineReact, exportPipelineGLSL, exportPipelineUniforms, exportShaderSource, exportGradientReact } from './shaderExport'
export { MaterialComposer } from './pipeline/MaterialComposer'
export * from './pipeline/types'
export { PIPELINE_PRESETS, createDefaultPipeline, presetKeys } from './pipeline/presets'
export { shaderBlendModes } from './types'
export {
  createDefaultGradient,
  validateGradient,
  freezeGradient,
  gradientToCSS,
  gradientToShaderPaint,
  interpolateGradientColor,
  GRADIENT_PRESETS,
  addGradientStop,
  removeGradientStop,
  updateGradientStop,
  reverseGradientStops,
} from './gradient'
export { GradientCanvasOverlay } from './GradientCanvasOverlay'
export { GradientInspector } from './GradientInspector'
export * from './gradientState'
export * from './materials'
export * from './fluid'
export * from './particle'
export { baseVertexShader, parseColorToRgb } from './fluid'
export type * from './types'
