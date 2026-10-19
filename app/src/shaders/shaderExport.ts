import type { ShaderPaint } from './types.ts'
import { meshUniforms } from './mesh.ts'
import { meshFragmentShader } from './meshFragment.ts'
import { gradientUniforms } from './gradient.ts'
import { gradientFragmentShader } from './gradientFragment.ts'
import { exportPipelineReact, exportPipelineGLSL, exportPipelineUniforms } from './pipeline/pipelineExport.ts'
import { exportMeshCSS, exportMeshSVG } from './meshExport.ts'
import { exportProceduralNoiseReact } from './noise/noiseExport.ts'
import { exportMaterialReact } from './materials/materialExport.ts'
import { exportGlassmorphismReact, exportLiquidChromeReact } from './refractive/refractiveExport.ts'
import { exportFluidReact } from './fluid/fluidExport.ts'
import { exportParticleReact } from './particle/particleExport.ts'
import { exportGenerativeReact } from './generative/generativeExport.ts'
import type { GlassmorphismPaint, LiquidChromePaint } from './refractive/types.ts'

export { exportPipelineReact, exportPipelineGLSL, exportPipelineUniforms, exportMeshCSS, exportMeshSVG }

/** Self-contained React source: no Paper app imports or missing shader assets. */
export function exportMeshReact(paint: Extract<ShaderPaint, { kind: 'mesh-gradient' }>): string {
  const style = { width: '100%', height: '100%', opacity: paint.composite?.opacity ?? 1, mixBlendMode: paint.composite?.blendMode ?? 'normal' }
  if (!paint.mesh) return `import { MeshGradient } from '@paper-design/shaders-react';\n\nexport default function Material() {\n  return <MeshGradient {...${JSON.stringify({ ...paint.params, speed: paint.animated ? paint.speed : 0, frame: paint.frame, scale: paint.scale, rotation: paint.rotation, offsetX: paint.offsetX, offsetY: paint.offsetY, style }, null, 2)}} />;\n}\n`
  return `import { ShaderMount } from '@paper-design/shaders-react';\n\nconst fragmentShader = \`${meshFragmentShader}\`;\nconst uniforms = ${JSON.stringify(meshUniforms(paint), null, 2)};\n\n// Place inside a parent with an explicit height.\nexport default function Material() {\n  return (\n    <ShaderMount\n      fragmentShader={fragmentShader}\n      uniforms={uniforms}\n      speed={${paint.animated ? paint.speed : 0}}\n      frame={${paint.frame}}\n      minPixelRatio={1}\n      maxPixelCount={1500000}\n      style={${JSON.stringify(style)}}\n    />\n  );\n}\n`
}

export function exportGradientReact(paint: Extract<ShaderPaint, { kind: 'multi-stop-gradient' }>): string {
  const style = { width: '100%', height: '100%', opacity: paint.composite?.opacity ?? 1, mixBlendMode: paint.composite?.blendMode ?? 'normal' }
  return `import { ShaderMount } from '@paper-design/shaders-react';\n\nconst fragmentShader = \`${gradientFragmentShader}\`;\nconst uniforms = ${JSON.stringify(gradientUniforms(paint), null, 2)};\n\n// Place inside a parent with an explicit height.\nexport default function Material() {\n  return (\n    <ShaderMount\n      fragmentShader={fragmentShader}\n      uniforms={uniforms}\n      speed={${paint.animated ? paint.speed : 0}}\n      frame={${paint.frame}}\n      minPixelRatio={1}\n      maxPixelCount={1500000}\n      style={${JSON.stringify(style)}}\n    />\n  );\n}\n`
}

export function exportCatalogShaderReact(paint: ShaderPaint): string {
  const componentMap: Record<string, string> = {
    'dot-orbit': 'DotOrbit',
    'grain-gradient': 'GrainGradient',
    'neuro-noise': 'NeuroNoise',
    gooey: 'Metaballs',
    dithering: 'Dithering',
    'perlin-noise': 'PerlinNoise',
    'liquid-distortion': 'Warp',
  }
  const componentName = componentMap[paint.kind]
  if (componentName) {
    const style = { width: '100%', height: '100%', opacity: paint.composite?.opacity ?? 1, mixBlendMode: paint.composite?.blendMode ?? 'normal' }
    return `import { ${componentName} } from '@paper-design/shaders-react';\n\nexport default function Material() {\n  return (\n    <${componentName}\n      {...${JSON.stringify({ ...paint.params, speed: paint.animated ? paint.speed : 0, frame: paint.frame, scale: paint.scale, rotation: paint.rotation, offsetX: paint.offsetX, offsetY: paint.offsetY, style }, null, 2)}}\n    />\n  );\n}\n`
  }
  return `// Shader export for ${paint.kind}\nexport default function Material() { return null; }\n`
}

export function exportShaderSource(paint: ShaderPaint): string {
  if (paint.kind === 'mesh-gradient') return exportMeshReact(paint)
  if (paint.kind === 'multi-stop-gradient') return exportGradientReact(paint)
  if (paint.kind === 'multi-pass') return exportPipelineReact(paint)
  if (paint.kind === 'procedural-noise') return exportProceduralNoiseReact(paint)
  if (paint.kind === 'shader-material') return exportMaterialReact(paint)
  if (paint.kind === 'glassmorphism') return exportGlassmorphismReact(paint as GlassmorphismPaint)
  if (paint.kind === 'liquid-chrome') return exportLiquidChromeReact(paint as LiquidChromePaint)
  if (paint.kind === 'fluid-simulation') return exportFluidReact(paint)
  if (paint.kind === 'particle-simulation') return exportParticleReact(paint)
  if (paint.kind === 'generative-material') return exportGenerativeReact(paint)
  return exportCatalogShaderReact(paint)
}
