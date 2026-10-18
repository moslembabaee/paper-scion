import type { Font, FontAxis } from '../vendor/fontkit.mjs'
import { applyTextTransform, compileTypographyStyles } from './typography.ts'
import type { TextElement } from './types.ts'

// Only parse a font once. Bounded because documents may contain many embedded fonts.
const fonts = new Map<string, Promise<Font>>()
const instances = new WeakMap<Font, Map<string, Font>>()
export function loadOutlineFont(source: string): Promise<Font> {
  const cached = fonts.get(source)
  if (cached) return cached
  const pending = import('../vendor/fontkit.mjs').then(({ create }) => {
    const encoded = source.split(',')[1]
    if (!encoded) throw new Error('Import a local font before converting text.')
    const font = create(Uint8Array.from(atob(encoded), char => char.charCodeAt(0)))
    if (!font.layout) throw new Error('Font collections are not supported. Import a single font.')
    return font
  })
  fonts.set(source, pending)
  if (fonts.size > 8) fonts.delete(fonts.keys().next().value!)
  pending.catch(() => { if (fonts.get(source) === pending) fonts.delete(source) })
  return pending
}

export async function readFontAxes(source: string): Promise<Record<string, FontAxis>> {
  return (await loadOutlineFont(source)).variationAxes
}

export function fontInstance(font: Font, node: TextElement): Font {
  const supported = font.variationAxes
  const requested = { wght: node.fontWeight, opsz: node.fontSize, ...node.variableAxes }
  const axes = Object.fromEntries(Object.entries(requested).filter(([tag]) => supported[tag]).map(([tag, value]) => [tag, Math.max(supported[tag].min, Math.min(supported[tag].max, value!))]))
  if (!Object.keys(supported).length) return font
  const key = JSON.stringify(axes)
  let cache = instances.get(font)
  if (!cache) { cache = new Map(); instances.set(font, cache) }
  const cached = cache.get(key)
  if (cached) return cached
  const instance = font.getVariation(axes)
  // Fontkit cannot instantiate variations from compressed WOFF containers reliably.
  // Never silently bake default outlines when a requested variation is unavailable.
  try { if (!Number.isFinite(instance.unitsPerEm)) throw new Error('Invalid font metrics') }
  catch { throw new Error('For variable outlines, import the original TTF or OTF font. Compressed WOFF variations cannot be traced.') }
  cache.set(key, instance)
  if (cache.size > 12) cache.delete(cache.keys().next().value!)
  return instance
}

export interface ShapedGlyph { d: string; advance: number; dx: number; dy: number }
export interface ShapedLine { glyphs: ShapedGlyph[]; width: number }
export interface ShapedText { lines: ShapedLine[]; baseline: number }

/** Preserve OpenType shaping, ligatures and combining marks as glyph runs. */
export function shapeText(base: Font, node: TextElement): ShapedText {
  const font = fontInstance(base, node)
  const scale = node.fontSize / font.unitsPerEm
  const styles = compileTypographyStyles(node)
  const spacing = Number.parseFloat(String(styles.letterSpacing ?? 0)) + (node.textOnPath?.enabled ? node.textOnPath.spacing ?? 0 : 0)
  const features = { ...node.openTypeFeatures, ...(node.fontKerning === 'none' ? { kern: false } : {}) }
  const shape = (text: string): ShapedLine => {
    if (!text) return { glyphs: [], width: 0 }
    const run = font.layout(text, features)
    if (run.glyphs.some(glyph => glyph.id === 0)) throw new Error('This font is missing a glyph. Import a font covering all characters in this text.')
    const glyphs = run.glyphs.map((glyph, index) => ({ d: glyph.path.toSVG(), advance: run.positions[index].xAdvance * scale + (index < run.glyphs.length - 1 ? spacing : 0), dx: run.positions[index].xOffset * scale, dy: -run.positions[index].yOffset * scale }))
    return { glyphs, width: glyphs.reduce((sum, glyph) => sum + glyph.advance, 0) }
  }
  const text = applyTextTransform(node.text, node.textTransform)
  const width = (text: string) => {
    if (!text) return 0
    const run = font.layout(text, features)
    return run.positions.reduce((sum, position) => sum + position.xAdvance * scale, 0) + Math.max(0, run.glyphs.length - 1) * spacing
  }
  const baseline = (node.fontSize * node.lineHeight - (font.ascent - font.descent) * scale) / 2 + font.ascent * scale
  if (node.textOnPath?.enabled) return { lines: [shape(text.replace(/\n/g, ' '))], baseline }
  const lines: ShapedLine[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const char of paragraph) {
      if (line && width(line + char) > node.width) {
        const space = line.lastIndexOf(' ')
        if (space > 0) { lines.push(shape(line.slice(0, space + 1))); line = line.slice(space + 1) }
        else { lines.push(shape(line)); line = '' }
      }
      line += char
    }
    lines.push(shape(line))
  }
  return { lines, baseline }
}
