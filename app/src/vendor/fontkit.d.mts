/** Minimal public Fontkit API used by Paper; implementation is vendored for offline builds. */
export interface FontAxis { name: string; min: number; max: number; default: number }
export interface FontGlyph { id: number; path: { toSVG(): string }; codePoints: number[] }
export interface FontRun {
  glyphs: FontGlyph[]
  positions: { xAdvance: number; yAdvance: number; xOffset: number; yOffset: number }[]
}
export interface Font {
  familyName: string
  unitsPerEm: number
  ascent: number
  descent: number
  variationAxes: Record<string, FontAxis>
  getVariation(axes: Record<string, number>): Font
  layout(text: string, features?: Record<string, boolean>): FontRun
}
export function create(data: Uint8Array): Font
