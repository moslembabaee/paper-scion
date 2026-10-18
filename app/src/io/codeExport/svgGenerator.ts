import type { SceneSnapshot } from '../../scene/types'
import { exportSVG } from '../svg'
import {
  exportAnimatedSVGFromKineticText,
  exportAnimatedSVGFromMotion,
  exportAnimatedSVGFromScene,
  type AnimatedSvgOptions,
} from '../animatedSvgExport'
import type { CodeExportTarget, GeneratedCodeBundle, SvgExportOptions, ExportFileEntry } from './types'

/**
 * Formats XML / SVG markup with 2-space indentation and clean newlines.
 */
function formatXml(xml: string): string {
  let formatted = ''
  let indent = 0
  const reg = /(>)(<)(\/*)/g
  const clean = xml.replace(reg, '$1\r\n$2$3')
  const lines = clean.split('\r\n')

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    if (trimmed.startsWith('</')) {
      indent = Math.max(0, indent - 1)
    }

    formatted += '  '.repeat(indent) + trimmed + '\n'

    if (
      trimmed.startsWith('<') &&
      !trimmed.startsWith('</') &&
      !trimmed.endsWith('/>') &&
      !trimmed.startsWith('<?') &&
      !trimmed.startsWith('<!--') &&
      !trimmed.includes('</')
    ) {
      indent++
    }
  }

  return formatted.trim()
}

/**
 * Generates standalone SVG code (Static or 60fps Animated).
 */
export function generateSvgExport(
  state: SceneSnapshot,
  target: CodeExportTarget,
  options: SvgExportOptions,
): GeneratedCodeBundle {
  const isAnimated = options.mode === 'animated'
  const animOptions: AnimatedSvgOptions = {
    fps: options.fps,
    duration: options.duration,
    loop: options.loop,
    background: options.background === 'dark' ? 'cream' : options.background,
    mode: options.animMode,
    scope: target.type === 'canvas' ? 'canvas' : 'selection',
    pretty: options.pretty,
  }

  let svgContent = ''
  let hasAnimation = false

  try {
    if (isAnimated) {
      const selectedNode = target.node ?? (target.nodes && target.nodes.length === 1 ? target.nodes[0] : undefined)

      if (selectedNode?.type === 'text' && selectedNode.kinetic?.enabled) {
        svgContent = exportAnimatedSVGFromKineticText(selectedNode, animOptions)
        hasAnimation = true
      } else if (state.motion?.tracks && state.motion.tracks.some(t => t.enabled)) {
        svgContent = exportAnimatedSVGFromMotion(state.motion, state.elements, target.bounds, animOptions)
        hasAnimation = true
      } else {
        svgContent = exportAnimatedSVGFromScene(state, animOptions)
        hasAnimation = true
      }
    } else {
      svgContent = exportSVG(state, {
        scope: target.type === 'canvas' ? 'canvas' : 'selection',
        scale: 1,
        background: options.background === 'cream' ? 'cream' : 'transparent',
      })
    }
  } catch (_err) {
    // Fallback if bounds or selection are empty
    svgContent = exportSVG(state, {
      scope: 'canvas',
      scale: 1,
      background: options.background === 'cream' ? 'cream' : 'transparent',
    })
  }

  // Handle dark background theme if selected
  if (options.background === 'dark') {
    if (svgContent.includes('fill="#edebe1"')) {
      svgContent = svgContent.replace(/fill="#edebe1"/g, 'fill="#080808"')
    } else if (!svgContent.includes('fill="#080808"')) {
      // Inject dark background rect right after defs or svg tag
      const rect = `<rect width="100%" height="100%" fill="#080808" />`
      if (svgContent.includes('</defs>')) {
        svgContent = svgContent.replace('</defs>', `</defs>\n  ${rect}`)
      } else {
        svgContent = svgContent.replace(/(<svg[^>]*>)/, `$1\n  ${rect}`)
      }
    }
  }

  // Ensure standard XML declaration
  if (!svgContent.startsWith('<?xml')) {
    svgContent = `<?xml version="1.0" encoding="UTF-8"?>\n${svgContent}`
  }

  if (options.pretty) {
    // Keep internal keyframes and paths intact while formatting structure
    // formatXml is clean for well-formed SVG tags
    svgContent = formatXml(svgContent)
  }

  const filename = `${target.name.toLowerCase().replace(/[^a-z0-9_-]/g, '-') || 'paper-vector'}${isAnimated ? '-animated' : ''}.svg`

  const files: ExportFileEntry[] = [
    {
      name: filename,
      content: svgContent,
      language: 'xml',
      description: isAnimated ? 'Standalone 60fps Animated SVG Vector' : 'Standalone Production SVG Vector',
      isPrimary: true,
    },
  ]

  const lineCount = svgContent.split('\n').length

  return {
    format: 'svg',
    target,
    primaryFile: files[0],
    files,
    stats: {
      lines: lineCount,
      chars: svgContent.length,
      fileCount: 1,
      nodeCount: target.childCount ?? (target.nodes?.length || 1),
      hasShader: Boolean(target.hasShader),
      hasAnimation,
      summary: `${isAnimated ? 'Animated 60fps' : 'Static'} SVG · ${Math.round(target.bounds.width)}×${Math.round(target.bounds.height)} px · ${lineCount} lines`,
    },
  }
}
