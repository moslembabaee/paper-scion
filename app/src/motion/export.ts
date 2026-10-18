import type { SceneElement } from '../scene/types.ts'
import { sampleTimes, trackValue } from './model.ts'
import type { MotionDocument, MotionProperty } from './types.ts'
import { exportLottieFromMotion } from '../io/lottieExport.ts'
import { exportAnimatedSVGFromMotion } from '../io/animatedSvgExport.ts'

const round = (n: number) => Number(n.toFixed(5))

const fmProperty = (property: MotionProperty) => {
  if (property === 'rotation') return 'rotate'
  if (property === 'shaderOpacity') return '--shader-opacity'
  if (property === 'shaderScale') return '--shader-scale'
  if (property === 'shaderRotation') return '--shader-rotation'
  if (property === 'shaderOffsetX') return '--shader-offset-x'
  if (property === 'shaderOffsetY') return '--shader-offset-y'
  if (property === 'shaderSpeed') return '--shader-speed'
  if (property === 'kineticPhase') return '--kinetic-phase'
  if (property === 'kineticAmplitude') return '--cascade-amplitude'
  if (property === 'kineticRotation') return '--cascade-rotation'
  return property
}

export type ExportFormat = 'framer' | 'css' | 'waapi' | 'json' | 'lottie' | 'animated-svg'

/** Bake easing into shared samples so multiple springs, delays and segments retain their timing. */
export function exportMotion(
  motion: MotionDocument,
  elements: Readonly<Record<string, SceneElement>>,
  format: ExportFormat,
): string {
  if (format === 'json') {
    return JSON.stringify(motion, null, 2)
  }

  if (format === 'lottie') {
    return exportLottieFromMotion(motion, elements, undefined, { pretty: true })
  }

  if (format === 'animated-svg') {
    return exportAnimatedSVGFromMotion(motion, elements, undefined, { loop: motion.loop, background: 'transparent' })
  }

  const tracks = motion.tracks.filter(track => track.enabled && elements[track.elementId])
  if (!tracks.length) {
    return format === 'css'
      ? '/* Add an enabled motion track to export. */'
      : '// Add an enabled motion track to export.'
  }

  const ids = [...new Set(tracks.map(track => track.elementId))]
  const header = 'Paper motion · easing baked at 120 Hz to preserve spring overshoot and segment timing.'

  if (format === 'framer') {
    return `import { motion } from "framer-motion";\n\n// ${header}\n// Wrap your existing layer content in the matching motion.div.\n${ids
      .map((id, index) => {
        const group = tracks.filter(track => track.elementId === id)
        const times = sampleTimes(motion, group)
        const animate = Object.fromEntries(
          group.map(track => [fmProperty(track.property), times.map(time => round(trackValue(track, time)))])
        )
        const initial = Object.fromEntries(
          group.map(track => [fmProperty(track.property), round(trackValue(track, 0))])
        )
        const transition = {
          duration: round(motion.duration / 1000),
          times: times.map(time => round(time / motion.duration)),
          ease: 'linear',
          ...(motion.loop ? { repeat: 'Infinity' } : {}),
        }
        // JSX expects a numeric repeat count; JSON cannot represent Infinity.
        const transitionCode = JSON.stringify(transition).replace('"repeat":"Infinity"', '"repeat":Infinity')
        const springNotes = group
          .filter(t => t.keyframes.some(k => k.easing.kind === 'spring'))
          .map(t => {
            const firstSpring = t.keyframes.find(k => k.easing.kind === 'spring')
            if (!firstSpring || firstSpring.easing.kind !== 'spring') return ''
            const sp = firstSpring.easing.spring
            return `// Track "${t.property}": Spring { stiffness: ${sp.stiffness}, damping: ${sp.damping}, mass: ${sp.mass} }\n// Alternative native transition: { type: "spring", stiffness: ${sp.stiffness}, damping: ${sp.damping}, mass: ${sp.mass} }`
          })
          .filter(Boolean)
          .join('\n')
        const noteBlock = springNotes ? `${springNotes}\n` : ''
        return `\n// Layer ${JSON.stringify(id)}\n${noteBlock}export function MotionLayer${index + 1}() {\n  return <motion.div\n    initial={${JSON.stringify(initial)}}\n    animate={${JSON.stringify(animate)}}\n    transition={${transitionCode}}\n  />;\n}`
      })
      .join('\n')}\n`
  }

  if (format === 'waapi') {
    return `// ${header}\n// Web Animations API sequencer snippet\n${ids
      .map((id, index) => {
        const group = tracks.filter(track => track.elementId === id)
        const times = sampleTimes(motion, group)
        const keyframes = times.map(time => {
          const offset = round(time / motion.duration)
          const values = Object.fromEntries(group.map(track => [track.property, round(trackValue(track, time))]))
          const frame: Record<string, string | number> = { offset }
          if ('x' in values || 'y' in values) frame.transform = `translate(${values.x ?? 0}px, ${values.y ?? 0}px)`
          if ('rotation' in values) frame.transform = `${frame.transform ? `${frame.transform} ` : ''}rotate(${values.rotation}deg)`
          if ('scale' in values) frame.transform = `${frame.transform ? `${frame.transform} ` : ''}scale(${values.scale})`
          if ('opacity' in values) frame.opacity = values.opacity
          if ('shaderOpacity' in values) frame['--shader-opacity'] = String(values.shaderOpacity)
          if ('shaderScale' in values) frame['--shader-scale'] = String(values.shaderScale)
          if ('shaderRotation' in values) frame['--shader-rotation'] = `${values.shaderRotation}deg`
          if ('shaderOffsetX' in values) frame['--shader-offset-x'] = String(values.shaderOffsetX)
          if ('shaderOffsetY' in values) frame['--shader-offset-y'] = String(values.shaderOffsetY)
          if ('shaderSpeed' in values) frame['--shader-speed'] = String(values.shaderSpeed)
          if ('fontWeight' in values) frame.fontWeight = String(values.fontWeight)
          if ('fontWidth' in values) frame.fontStretch = `${values.fontWidth}%`
          if ('fontSize' in values) frame.fontSize = `${values.fontSize}px`
          if ('letterSpacing' in values) frame.letterSpacing = `${values.letterSpacing}px`
          if ('lineHeight' in values) frame.lineHeight = String(values.lineHeight)
          if ('kineticPhase' in values) frame['--kinetic-phase'] = String(values.kineticPhase)
          if ('kineticAmplitude' in values) frame['--cascade-amplitude'] = `${values.kineticAmplitude}px`
          if ('kineticRotation' in values) frame['--cascade-rotation'] = `${values.kineticRotation}deg`
          return frame
        })
        return `\n// Layer ${JSON.stringify(id)}\nexport function animateLayer${index + 1}(element: HTMLElement) {\n  return element.animate(\n    ${JSON.stringify(keyframes, null, 2)},\n    {\n      duration: ${motion.duration},\n      fill: 'both',\n      easing: 'linear',\n      iterations: ${motion.loop ? 'Infinity' : '1'},\n    }\n  );\n}`
      })
      .join('\n')}\n`
  }

  return `/* ${header} */\n/* Apply each class to its existing layer; transforms are relative to the design. */\n${ids
    .map((id, index) => {
      const group = tracks.filter(track => track.elementId === id)
      const times = sampleTimes(motion, group)
      const name = `paper-motion-${index + 1}`
      const percentageMap = new Map<number, string>()
      for (const time of times) {
        const pct = round((time / motion.duration) * 100)
        const values = Object.fromEntries(group.map(track => [track.property, round(trackValue(track, time))]))
        const declarations: string[] = []
        if ('x' in values || 'y' in values) declarations.push(`translate: ${values.x ?? 0}px ${values.y ?? 0}px`)
        if ('rotation' in values) declarations.push(`rotate: ${values.rotation}deg`)
        if ('scale' in values) declarations.push(`scale: ${values.scale}`)
        if ('opacity' in values) declarations.push(`opacity: ${values.opacity}`)
        if ('shaderOpacity' in values) declarations.push(`--shader-opacity: ${values.shaderOpacity}`)
        if ('shaderScale' in values) declarations.push(`--shader-scale: ${values.shaderScale}`)
        if ('shaderRotation' in values) declarations.push(`--shader-rotation: ${values.shaderRotation}deg`)
        if ('shaderOffsetX' in values) declarations.push(`--shader-offset-x: ${values.shaderOffsetX}`)
        if ('shaderOffsetY' in values) declarations.push(`--shader-offset-y: ${values.shaderOffsetY}`)
        if ('shaderSpeed' in values) declarations.push(`--shader-speed: ${values.shaderSpeed}`)
        if ('fontWeight' in values) declarations.push(`font-weight: ${values.fontWeight}`)
        if ('fontWidth' in values) declarations.push(`font-stretch: ${values.fontWidth}%`)
        if ('fontSize' in values) declarations.push(`font-size: ${values.fontSize}px`)
        if ('letterSpacing' in values) declarations.push(`letter-spacing: ${values.letterSpacing}px`)
        if ('lineHeight' in values) declarations.push(`line-height: ${values.lineHeight}`)
        if ('kineticPhase' in values) declarations.push(`--kinetic-phase: ${values.kineticPhase}`)
        if ('kineticAmplitude' in values) declarations.push(`--cascade-amplitude: ${values.kineticAmplitude}px`)
        if ('kineticRotation' in values) declarations.push(`--cascade-rotation: ${values.kineticRotation}deg`)
        percentageMap.set(pct, `  ${pct}% { ${declarations.join('; ')}; }`)
      }
      const frames = Array.from(percentageMap.values())
      const iter = motion.loop ? 'infinite' : 'both'
      const springNotes = group
        .filter(t => t.keyframes.some(k => k.easing.kind === 'spring'))
        .map(t => {
          const firstSpring = t.keyframes.find(k => k.easing.kind === 'spring')
          if (!firstSpring || firstSpring.easing.kind !== 'spring') return ''
          const sp = firstSpring.easing.spring
          return `/* Track "${t.property}": Spring { stiffness: ${sp.stiffness}, damping: ${sp.damping}, mass: ${sp.mass} } */`
        })
        .filter(Boolean)
        .join('\n')
      const noteBlock = springNotes ? `${springNotes}\n` : ''
      return `\n/* Layer ${JSON.stringify(id).replaceAll('*/', '* /')} */\n${noteBlock}.${name} { animation: ${name} ${motion.duration}ms linear ${iter}; }\n@keyframes ${name} {\n${frames.join('\n')}\n}\n@media (prefers-reduced-motion: reduce) {\n  .${name} { animation-duration: 1ms; }\n}`
    })
    .join('\n')}\n`
}
