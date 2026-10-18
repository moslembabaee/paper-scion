import type { ViewportController } from '../canvas/ViewportController.ts'
import { downloadFile, fileName } from '../io/project.ts'
import type { SceneStore } from '../scene/store.ts'
import { interpolateMorph, prepareMorph } from './interpolate.ts'
import { parseMorphTarget } from './normalize.ts'
import type { MorphConfig, MorphExportFormat, MorphTarget } from './types.ts'

const xml = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!)
const cycleDuration = (config: MorphConfig) => Math.max(1, config.duration) * (config.playbackMode === 'pingpong' ? 2 : 1)

/** Correspondence is prepared once, so every frame has compatible SVG commands. */
export function sampleMorphFrames(targetA: MorphTarget, targetB: MorphTarget, config: MorphConfig, frameCount = 30): { times: number[]; paths: string[] } {
  const prepared = prepareMorph(parseMorphTarget(targetA), parseMorphTarget(targetB), config)
  const count = Number.isFinite(frameCount) ? Math.max(1, Math.min(120, Math.round(frameCount))) : 30
  const steps = count * (config.playbackMode === 'pingpong' ? 2 : 1)
  const times: number[] = [], paths: string[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const progress = config.playbackMode === 'pingpong' ? (t <= .5 ? t * 2 : 2 - t * 2) : t
    times.push(Number(t.toFixed(6)))
    paths.push(interpolateMorph(prepared, progress, config).d)
  }
  return { times, paths }
}

export function exportAnimatedSVG(targetA: MorphTarget, targetB: MorphTarget, config: MorphConfig, frameCount = 24): string {
  const { times, paths } = sampleMorphFrames(targetA, targetB, config, frameCount)
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="-8 -8 136 136" width="136" height="136">
  <path fill="${xml(targetA.color ?? '#81adec')}" fill-rule="${targetA.fillRule ?? 'nonzero'}" d="${paths[0]}">
    <animate attributeName="d" dur="${cycleDuration(config) / 1000}s"
      repeatCount="${config.playbackMode === 'once' ? '1' : 'indefinite'}" fill="freeze" calcMode="linear"
      keyTimes="${times.join(';')}" values="${paths.join(';')}" />
  </path>
</svg>
`
}

export function exportStaticSVG(d: string, fill = '#81adec', fillRule: 'nonzero' | 'evenodd' = 'nonzero'): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="-8 -8 136 136" width="136" height="136">
  <path fill="${xml(fill)}" fill-rule="${fillRule}" d="${xml(d)}" />
</svg>
`
}

export function exportCSSKeyframes(targetA: MorphTarget, targetB: MorphTarget, config: MorphConfig, frameCount = 24): string {
  const { paths, times } = sampleMorphFrames(targetA, targetB, config, frameCount)
  return `/* Apply to a path in an SVG with viewBox="-8 -8 136 136". */
@keyframes paperMorph {
${paths.map((d, i) => `  ${(times[i] * 100).toFixed(4)}% { d: path('${d}'); }`).join('\n')}
}
.paper-morph-path {
  fill: ${/^#[\da-f]{3,8}$/i.test(targetA.color ?? '') ? targetA.color : '#81adec'};
  fill-rule: ${targetA.fillRule ?? 'nonzero'};
  animation: paperMorph ${cycleDuration(config) / 1000}s linear ${config.playbackMode === 'once' ? '1 forwards' : 'infinite'};
}
`
}

export function exportReactFramer(targetA: MorphTarget, targetB: MorphTarget, config: MorphConfig, frameCount = 24): string {
  const { paths, times } = sampleMorphFrames(targetA, targetB, config, frameCount)
  return `import { motion } from 'framer-motion'

const frames = ${JSON.stringify(paths, null, 2)}

export function MorphedVector() {
  return (
    <svg viewBox="-8 -8 136 136" width={136} height={136}>
      <motion.path fill={${JSON.stringify(targetA.color ?? '#81adec')}} fillRule="${targetA.fillRule ?? 'nonzero'}"
        initial={{ d: frames[0] }} animate={{ d: frames }}
        transition={{ duration: ${cycleDuration(config) / 1000}, times: ${JSON.stringify(times)}, repeat: ${config.playbackMode === 'once' ? 0 : 'Infinity'}, ease: 'linear' }} />
    </svg>
  )
}
`
}

export function exportWAAPI(targetA: MorphTarget, targetB: MorphTarget, config: MorphConfig, frameCount = 24): string {
  const { paths, times } = sampleMorphFrames(targetA, targetB, config, frameCount)
  return `// Apply to #morph-path in an SVG with viewBox="-8 -8 136 136".
const pathElement = document.querySelector('#morph-path')
pathElement.animate(${JSON.stringify(paths.map((d, i) => ({ d: `path('${d}')`, offset: times[i] })), null, 2)}, {
  duration: ${cycleDuration(config)}, iterations: ${config.playbackMode === 'once' ? 1 : 'Infinity'}, easing: 'linear', fill: 'forwards'
})
`
}

export function generateExportCode(format: MorphExportFormat, a: MorphTarget, b: MorphTarget, config: MorphConfig, currentD: string): string {
  switch (format) {
    case 'svg-smil': return exportAnimatedSVG(a, b, config)
    case 'svg-static': return exportStaticSVG(currentD, a.color, a.fillRule)
    case 'css-keyframes': return exportCSSKeyframes(a, b, config)
    case 'react-framer': return exportReactFramer(a, b, config)
    case 'waapi': return exportWAAPI(a, b, config)
  }
}

/** Bake a separate editable vector so both original targets remain available. */
export function applyMorphToCanvas(store: SceneStore, controller: ViewportController, d: string, targetA: MorphTarget): string {
  if (!d) throw new Error('Choose two valid vector paths before baking.')
  const { size } = controller.getSnapshot()
  const center = controller.screenToWorld({ x: size.width / 2, y: size.height / 2 })
  let id = ''
  store.batch(() => {
    const node = store.add('path', {
      d, viewBox: [0, 0, 120, 120], fillRule: targetA.fillRule ?? 'nonzero',
      width: 120, height: 120,
      x: Math.round((center.x - 60) / 24) * 24, y: Math.round((center.y - 60) / 24) * 24,
      name: `${targetA.name} Morph`,
      style: { fill: targetA.color ?? '#81adec', stroke: null, opacity: 1 },
    })
    store.select([node.id])
    id = node.id
  }, 'Insert morphed vector path')
  return id
}

export function downloadMorphSVG(a: MorphTarget, b: MorphTarget, config: MorphConfig, currentD: string, animated = true): void {
  const content = animated ? exportAnimatedSVG(a, b, config) : exportStaticSVG(currentD, a.color, a.fillRule)
  downloadFile(new Blob([content], { type: 'image/svg+xml' }), fileName(`${a.name}-to-${b.name}-morph`, 'svg'))
}
