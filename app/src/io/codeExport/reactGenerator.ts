import type { SceneElement, SceneSnapshot, TextElement, FrameElement, PathElement } from '../../scene/types'
import { buildTailwindClasses, elementToComponentName, buildCSSProps } from '../../tokens/codegen'
import { compileTypographyStyles, embeddedFontCSS, resolveTextPathD, textAnchorForPath, textPathOffset, applyTextTransform } from '../../scene/typography'
import { frameMask, maskPathData, maskFillRule } from '../../scene/maskGeometry'
import { exportShaderSource } from '../../shaders/shaderExport'
import type { CodeExportTarget, GeneratedCodeBundle, ReactExportOptions, ExportFileEntry } from './types'

function sanitizeName(str: string): string {
  const clean = str.replace(/[^a-zA-Z0-9]/g, '')
  if (!clean) return 'Artwork'
  return (/^[0-9]/.test(clean) ? 'Paper' : '') + clean[0].toUpperCase() + clean.slice(1)
}

function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces)
  return text
    .split('\n')
    .map(line => (line.trim() ? pad + line : line))
    .join('\n')
}

/**
 * Builds clean React JSX with recursive hierarchy traversal and production Tailwind styling.
 */
export function generateReactExport(
  state: SceneSnapshot,
  target: CodeExportTarget,
  options: ReactExportOptions,
): GeneratedCodeBundle {
  const tokens = state.tokens ?? []
  const subcomponents: { name: string; code: string }[] = []
  const usedImports = new Set<string>()

  const rootNodes: SceneElement[] = target.nodes && target.nodes.length > 0
    ? [...target.nodes]
    : target.node
    ? [target.node]
    : target.type === 'canvas'
    ? state.rootIds.map(id => state.elements[id]).filter((n): n is SceneElement => Boolean(n && n.visible))
    : []

  const mainComponentName = options.componentName.trim()
    ? sanitizeName(options.componentName)
    : target.node
    ? elementToComponentName(target.node)
    : 'PaperCanvas'

  // Recursive element renderer
  function renderNode(
    node: SceneElement,
    parent?: SceneElement,
    depth = 2,
    asSubcomponent = false,
  ): string {
    const tw = buildTailwindClasses(node, tokens, parent)
    const isTailwind = options.styling === 'tailwind'

    // Extract inline style when styling === 'inline' or for absolute geometry
    const inlineProps = buildCSSProps(node, tokens, parent)
    const styleObj: Record<string, unknown> = {}

    if (!isTailwind) {
      for (const p of inlineProps) {
        const camel = p.property.replace(/-([a-z])/g, (_, g) => g.toUpperCase())
        styleObj[camel] = p.value
      }
    } else {
      // With Tailwind, only geometry not expressible via Tailwind is kept in style
      if (node.rotation !== 0) {
        styleObj.transform = `rotate(${node.rotation}deg)`
      }
      if (node.type === 'text') {
        const textStyles = compileTypographyStyles(node as TextElement)
        const bindings = node.tokenBindings as Record<string, string> | undefined
        for (const [k, v] of Object.entries(textStyles)) {
          if (v !== undefined && !bindings?.[k]) {
            styleObj[k] = v
          }
        }
      }
    }

    const hasStyle = Object.keys(styleObj).length > 0
    const styleAttr = hasStyle ? ` style={${JSON.stringify(styleObj, null, 2).replace(/"([^"]+)":/g, '$1:')}}` : ''
    const classAttr = isTailwind ? ` className="${tw}"` : ''

    // Subcomponent extraction for complex frames
    if (
      options.extractSubcomponents &&
      node.type === 'frame' &&
      depth > 2 &&
      !asSubcomponent &&
      node.children.length > 0
    ) {
      const subName = `${mainComponentName}_${sanitizeName(node.name)}`
      const inner = renderNode(node, parent, 2, true)
      const subCode = options.typescript
        ? `function ${subName}({ className = '', style }: { className?: string; style?: React.CSSProperties }) {\n  return (\n${indent(inner, 4)}\n  );\n}\n`
        : `function ${subName}({ className = '', style }) {\n  return (\n${indent(inner, 4)}\n  );\n}\n`
      subcomponents.push({ name: subName, code: subCode })
      return `<${subName} className="${tw}"${styleAttr} />`
    }

    // Attached shader surface on element
    if (options.includeShader && node.style.shader) {
      usedImports.add("import { ShaderMount } from '@paper-design/shaders-react'")
      const shaderReact = exportShaderSource(node.style.shader)
      const shaderSubName = `${sanitizeName(node.name)}Shader`
      subcomponents.push({
        name: shaderSubName,
        code: `// Attached Shader: ${node.style.shader.kind}\n${shaderReact.replace('export default function Material', `function ${shaderSubName}`)}`,
      })

      return `<div${classAttr}${styleAttr}>\n  <${shaderSubName} />\n</div>`
    }

    // Text Element
    if (node.type === 'text') {
      const t = node as TextElement
      if (t.textOnPath?.enabled) {
        usedImports.add("import { useId } from 'react'")
        const pathD = resolveTextPathD(t, state.elements)
        const styles = {
          ...compileTypographyStyles(t),
          letterSpacing: `${Number.parseFloat(String(compileTypographyStyles(t).letterSpacing ?? 0)) + (t.textOnPath.spacing ?? 0)}px`,
        }
        return `<svg${classAttr}${styleAttr} viewBox="0 0 ${t.width} ${t.height}" overflow="visible">
  ${t.fontSource ? `<style>{${JSON.stringify(embeddedFontCSS(t))}}</style>` : ''}
  <defs><path id="text-path" d={${JSON.stringify(pathD)}} /></defs>
  <text fill={${JSON.stringify(t.style.fill ?? 'currentColor')}} style={${JSON.stringify(styles)}} textAnchor="${textAnchorForPath(t.textOnPath.align, t.textAlign)}">
    <textPath href="#text-path" startOffset="${textPathOffset(t)}%">{${JSON.stringify(applyTextTransform(t.text, t.textTransform).replace(/\n/g, ' '))}}</textPath>
  </text>
</svg>`
      }

      const tag = t.fontSize >= 32 ? 'h2' : t.fontSize >= 22 ? 'h3' : 'p'
      return `<${tag}${classAttr}${styleAttr}>
  ${t.fontSource ? `<style>{${JSON.stringify(embeddedFontCSS(t))}}</style>` : ''}{${JSON.stringify(t.text)}}
</${tag}>`
    }

    // Image Element
    if (node.type === 'image') {
      return `<div${classAttr}${styleAttr}>
  <img
    src={${JSON.stringify(node.src)}}
    alt={${JSON.stringify(node.alt || node.name)}}
    className="w-full h-full object-${node.fit}"
    loading="lazy"
  />
</div>`
    }

    // Path / Vector Element
    if (node.type === 'path') {
      const pathEl = node as PathElement
      const fill = pathEl.style.fill ?? 'none'
      const stroke = pathEl.style.stroke?.color ?? 'none'
      const strokeWidth = pathEl.style.stroke?.width ?? 0
      const strokeDash = pathEl.style.stroke?.dash.length ? ` strokeDasharray="${pathEl.style.stroke.dash.join(' ')}"` : ''

      return `<svg${classAttr}${styleAttr} viewBox="${pathEl.viewBox.join(' ')}" preserveAspectRatio="none" overflow="visible">
  <path
    d={${JSON.stringify(pathEl.d)}}
    fillRule="${pathEl.fillRule}"
    fill={${JSON.stringify(fill)}}
    stroke={${JSON.stringify(stroke)}}
    strokeWidth={${strokeWidth}}${strokeDash}
    strokeLinejoin="round"
  />
</svg>`
    }

    // Ellipse Element
    if (node.type === 'ellipse') {
      return `<div${classAttr}${styleAttr} />`
    }

    // Frame Element with Children
    if (node.type === 'frame') {
      const frameEl = node as FrameElement
      const mask = frameMask(state.elements, frameEl)
      const childrenNodes = frameEl.children
        .map(cid => state.elements[cid])
        .filter((c): c is SceneElement => Boolean(c && c.visible && c.id !== mask?.id))

      let childrenJSX = ''
      if (childrenNodes.length > 0) {
        childrenJSX = childrenNodes
          .map(child => renderNode(child, frameEl, depth + 1))
          .join('\n')
      }

      if (mask) {
        usedImports.add("import { useId } from 'react'")
        return `<div${classAttr}${styleAttr}>
  <svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute' }}>
    <defs>
      <clipPath id="paper-mask" clipPathUnits="userSpaceOnUse">
        <path d={${JSON.stringify(maskPathData(mask))}} clipRule="${maskFillRule(mask)}" />
      </clipPath>
    </defs>
  </svg>
  <div style={{ position: 'absolute', inset: 0, clipPath: 'url(#paper-mask)' }}>
${indent(childrenJSX || '{children}', 4)}
  </div>
</div>`
      }

      if (!childrenJSX) {
        return `<div${classAttr}${styleAttr}>{children}</div>`
      }

      return `<div${classAttr}${styleAttr}>
${indent(childrenJSX, 2)}
</div>`
    }

    // Default Rectangle / Generic Shape
    return `<div${classAttr}${styleAttr} />`
  }

  // Render root content
  let rootContent = ''
  if (rootNodes.length === 1) {
    rootContent = renderNode(rootNodes[0], undefined, 2)
  } else if (rootNodes.length > 1) {
    const isTailwind = options.styling === 'tailwind'
    const wrapperClass = isTailwind ? 'relative w-full h-full min-h-[400px]' : ''
    const wrapperStyle = !isTailwind ? ' style={{ position: "relative", width: "100%", height: "100%", minHeight: "400px" }}' : ''
    const childrenStr = rootNodes.map(n => renderNode(n, undefined, 2)).join('\n')
    rootContent = `<div className="${wrapperClass}"${wrapperStyle}>
${indent(childrenStr, 2)}
</div>`
  } else {
    rootContent = `<div className="w-full h-full flex items-center justify-center text-neutral-400">
  <span>Empty Artwork</span>
</div>`
  }

  // TypeScript vs JavaScript props
  const propsType = options.typescript
    ? `export interface ${mainComponentName}Props {
  readonly className?: string
  readonly style?: React.CSSProperties
  readonly children?: React.ReactNode
  readonly onClick?: () => void
}
`
    : ''

  const funcSig = options.typescript
    ? `export function ${mainComponentName}({
  className = '',
  style,
  children,
  onClick,
}: ${mainComponentNamePropsSignature(mainComponentName)})`
    : `export function ${mainComponentName}({
  className = '',
  style,
  children,
  onClick,
})`

  function mainComponentNamePropsSignature(name: string): string {
    return `${name}Props`
  }

  const subcomponentsBlock = subcomponents.length > 0 ? `\n// Subcomponents\n${subcomponents.map(s => s.code).join('\n')}\n` : ''

  const importsList = [
    "import React from 'react'",
    ...Array.from(usedImports),
  ].join('\n')

  const code = `// ============================================================================
// Generated by Paper (https://paper.design)
// Component: ${mainComponentName}
// Styling: ${options.styling === 'tailwind' ? 'Tailwind CSS v4' : 'React Inline Styles'}
// ============================================================================

${importsList}

${propsType}${subcomponentsBlock}
${funcSig} {
  return (
${indent(rootContent, 4)}
  )
}

export default ${mainComponentName}
`

  const filename = `${mainComponentName}.${options.typescript ? 'tsx' : 'jsx'}`

  const files: ExportFileEntry[] = [
    {
      name: filename,
      content: code,
      language: options.typescript ? 'typescript' : 'javascript',
      description: `Production ${options.typescript ? 'React TSX' : 'React JSX'} Component with Tailwind Styling`,
      isPrimary: true,
    },
  ]

  const lineCount = code.split('\n').length

  return {
    format: 'react',
    target,
    primaryFile: files[0],
    files,
    stats: {
      lines: lineCount,
      chars: code.length,
      fileCount: 1,
      nodeCount: target.childCount ?? (target.nodes?.length || 1),
      hasShader: Boolean(target.hasShader),
      hasAnimation: Boolean(target.hasAnimation),
      summary: `React Component (${mainComponentName}) · ${lineCount} lines · ${options.styling === 'tailwind' ? 'Tailwind CSS' : 'Inline CSS'}`,
    },
  }
}
