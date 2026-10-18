import type { SceneElement, TextElement } from './types.ts'
import { applyTextTransform, compileTypographyStyles, embeddedFontCSS, resolveTextPathD, textAnchorForPath, textPathOffset, typographyCSS } from './typography.ts'

const xml = (value: string): string => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!)
const num = (value: number) => String(Math.round(value * 1e6) / 1e6)

/** Same pre-wrap/word-break model as the canvas, emitted as editable SVG text. */
export function textMarkup(node: TextElement, fill: string, measure?: (text: string, node: TextElement) => number, baseline?: (node: TextElement) => number, elements?: Readonly<Record<string, SceneElement>>, pathId = 'paper-text-path'): string {
  const fontFace = node.fontSource ? `<style>${xml(embeddedFontCSS(node))}</style>` : ''
  const styles = compileTypographyStyles(node)
  const spacing = Number.parseFloat(String(styles.letterSpacing ?? 0))
  const style = xml(Object.entries(typographyCSS(node)).map(([key, value]) => `${key}:${value}`).join(';'))
  const text = applyTextTransform(node.text, node.textTransform)
  if (node.textOnPath?.enabled) {
    const shift = node.textOnPath.baselineShift ? `;baseline-shift:${num(node.textOnPath.baselineShift)}px` : ''
    const justifyAttrs = node.textOnPath.align === 'justify' ? ` lengthAdjust="spacing" textLength="${num(node.width)}"` : ''
    const offsetAttr = node.textOnPath.offsetMode === 'pixels'
      ? `${num(node.textOnPath.offset ?? 0)}px`
      : `${num(textPathOffset(node))}%`
    return `${fontFace}<defs><path id="${xml(pathId)}" d="${xml(resolveTextPathD(node, elements))}"/></defs><text fill="${xml(fill)}" style="${style};letter-spacing:${num(spacing + (node.textOnPath.spacing ?? 0))}px${shift}" text-anchor="${textAnchorForPath(node.textOnPath.align, node.textAlign)}" xml:space="preserve"><textPath href="#${xml(pathId)}" startOffset="${offsetAttr}"${justifyAttrs}>${xml(text.replace(/\n/g, ' '))}</textPath></text>`
  }
  const width = (text: string) => (measure ? measure(text, node) : text.length * node.fontSize * .55) + Math.max(0, text.length - 1) * spacing
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const char of paragraph) {
      if (line && width(line + char) > node.width) {
        const space = line.lastIndexOf(' ')
        if (space > 0) { lines.push(line.slice(0, space + 1)); line = line.slice(space + 1) }
        else { lines.push(line); line = '' }
      }
      line += char
    }
    lines.push(line)
  }
  const x = node.textAlign === 'center' ? node.width / 2 : node.textAlign === 'right' ? node.width : 0
  const anchor = node.textAlign === 'center' ? 'middle' : node.textAlign === 'right' ? 'end' : 'start'
  const y = baseline?.(node) ?? node.fontSize * (.85 + (node.lineHeight - 1) / 2)
  return `${fontFace}<text fill="${xml(fill)}" font-family="${xml(node.fontFamily)}" font-size="${num(node.fontSize)}" font-weight="${node.variableAxes?.wght ?? node.fontWeight}" letter-spacing="${num(spacing)}" style="${style}" text-anchor="${anchor}" xml:space="preserve">${lines.map((line, i) => `<tspan x="${num(x)}" y="${num(y + i * node.fontSize * node.lineHeight)}">${xml(line)}</tspan>`).join('')}</text>`
}

