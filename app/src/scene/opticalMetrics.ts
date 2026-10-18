import type { TextElement } from './types.ts'

export interface GlyphOpticalMetric {
  readonly char: string
  readonly index: number
  readonly codePoint: string
  readonly x: number // x position along line in px
  readonly y: number // top of optical bounding box in px
  readonly width: number // optical bounding box width in px
  readonly height: number // optical bounding box height in px
  readonly advance: number // character advance in px
  readonly opticalKerningDelta: number // pairwise kerning to next character in px
  readonly leftSideBearing: number // optical LSB in px
  readonly rightSideBearing: number // optical RSB in px
  readonly overhangLeft: number // optical margin left overhang in px
  readonly overhangRight: number // optical margin right overhang in px
  readonly isWhitespace: boolean
}

export interface LineOpticalMetrics {
  readonly lineIndex: number
  readonly text: string
  readonly glyphs: readonly GlyphOpticalMetric[]
  readonly width: number
  readonly height: number
  readonly baseline: number // y coordinate of baseline in px
  readonly capHeight: number // y coordinate of cap height in px
  readonly xHeight: number // y coordinate of x-height in px
  readonly descent: number // y coordinate of descender in px
  readonly opticalMarginLeft: number // optical margin hang offset
  readonly opticalMarginRight: number
}

export interface TextOpticalMetrics {
  readonly lines: readonly LineOpticalMetrics[]
  readonly totalWidth: number
  readonly totalHeight: number
  readonly kerningPairCount: number
  readonly averageKerningDelta: number
  readonly totalKerningDelta: number
  readonly capHeight: number
  readonly xHeight: number
  readonly baseline: number
  readonly descent: number
  readonly ascender: number
  readonly advanceWidth: number
  readonly glyphCount: number
  readonly characterCount: number
  readonly wordCount: number
  readonly lineCount: number
  readonly weightRatio: number
  readonly widthStretchRatio: number
  readonly slantAngle: number
  readonly opticalSize: number
  readonly effectiveLineHeightPx: number
  readonly effectiveTrackingEm: number
}

/** Comprehensive perceptual pairwise optical kerning table (em units) */
export const OPTICAL_KERNING_MATRIX: Readonly<Record<string, number>> = Object.freeze({
  // Uppercase / Uppercase diagonal & open counter collisions
  AV: -0.09, AW: -0.07, AY: -0.09, AT: -0.08, AC: -0.04, AG: -0.04, AO: -0.04, AQ: -0.04,
  VA: -0.09, WA: -0.07, YA: -0.09, TA: -0.08,
  VO: -0.05, WO: -0.04, YO: -0.05, TO: -0.04,
  PA: -0.07, FA: -0.07, LT: -0.07, LV: -0.08, LY: -0.08, LW: -0.07, LA: -0.04,
  KO: -0.04, RO: -0.04, RA: -0.03,

  // Uppercase / Lowercase combinations
  To: -0.065, Ta: -0.06, Te: -0.055, Ti: -0.045, Tr: -0.04, Tu: -0.04, Tw: -0.04, Ty: -0.05,
  Vo: -0.06, Va: -0.06, Ve: -0.055, Vi: -0.04,
  Wo: -0.05, Wa: -0.05, We: -0.045, Wi: -0.035,
  Yo: -0.07, Ya: -0.07, Ye: -0.06, Yu: -0.05,
  Po: -0.035, Fo: -0.04, Lo: -0.03,

  // Lowercase / Lowercase diagonal pairs
  av: -0.04, aw: -0.035, ay: -0.04,
  va: -0.04, vo: -0.035, ve: -0.03,
  wa: -0.035, wo: -0.03, we: -0.03,
  ya: -0.04, yo: -0.035, ye: -0.03,
  ro: -0.025, re: -0.02, ra: -0.02, ry: -0.03,

  // Stem / Punctuation optical tucks
  'T.': -0.10, 'V.': -0.10, 'W.': -0.08, 'Y.': -0.10, 'P.': -0.08, 'F.': -0.08, 'L.': -0.07,
  'T,': -0.10, 'V,': -0.10, 'W,': -0.08, 'Y,': -0.10, 'P,': -0.08, 'F,': -0.08, 'L,': -0.07,
  'r.': -0.06, 'v.': -0.06, 'w.': -0.05, 'y.': -0.06,
  'r,': -0.06, 'v,': -0.06, 'w,': -0.05, 'y,': -0.06,

  // Quotation marks and apostrophes
  "'A": -0.08, "'E": -0.04, "'O": -0.04, "'a": -0.05,
  '"A': -0.08, '"E': -0.04, '"O': -0.04, '"a': -0.05,
  "A'": -0.06, "E'": -0.03, "O'": -0.04, "a'": -0.04,
  'A"': -0.06, 'E"': -0.03, 'O"': -0.04, 'a"': -0.04,

  // Numerical figures
  '11': -0.04, '17': -0.04, '71': -0.05, '1.': -0.05, '4.': -0.04, '7.': -0.06,
})

/** Optical margin overhang factors (proportion of character advance) */
const MARGIN_OVERHANG_FACTORS: Readonly<Record<string, number>> = Object.freeze({
  '"': 0.85, "'": 0.85, '“': 0.90, '”': 0.90, '‘': 0.90, '’': 0.90,
  '-': 0.75, '–': 0.70, '—': 0.65,
  '.': 0.70, ',': 0.70, ':': 0.45, ';': 0.45,
  '(': 0.50, ')': 0.50, '[': 0.50, ']': 0.50,
  T: 0.12, A: 0.10, V: 0.12, W: 0.10, Y: 0.12,
  O: 0.05, C: 0.05, G: 0.05, Q: 0.05,
})

/** Base character width relative to em square */
function getCharacterEmWidth(char: string, isTabular = false): number {
  if (isTabular && char >= '0' && char <= '9') return 0.58
  if (char === ' ') return 0.28
  if ('ijl.:;!|\'"`'.includes(char)) return 0.28
  if ('rtf-–—()[]'.includes(char)) return 0.40
  if ('ceoszk'.includes(char)) return 0.50
  if ('abdghnpquvxy0123456789$'.includes(char)) return 0.56
  if ('ABCDEFGHKNOPQRSTUVXYZ'.includes(char)) return 0.68
  if ('mw'.includes(char)) return 0.80
  if ('MW@%&#'.includes(char)) return 0.88
  return 0.55
}

/** Compute optical pairwise kerning delta between two characters in pixels */
export function calculatePairwiseKerning(
  charA: string,
  charB: string,
  strength = 0,
  fontSize = 16
): number {
  if (!charA || !charB) return 0
  const pair = charA + charB
  const metric = OPTICAL_KERNING_MATRIX[pair] ?? OPTICAL_KERNING_MATRIX[pair.toUpperCase()]
  if (metric === undefined) return 0
  const factor = 1 + (strength / 50)
  return Number((metric * fontSize * factor).toFixed(2))
}

/** Compute glyph-level optical metrics for a TextElement */
export function computeTextOpticalMetrics(node: TextElement): TextOpticalMetrics {
  const fontSize = Math.max(1, node.fontSize)
  const lineHeight = Math.max(0.1, node.lineHeight)
  const lineSpacingPx = fontSize * lineHeight
  const widthScale = (node.variableAxes?.wdth ?? 100) / 100
  const isTabular = Boolean(node.openTypeFeatures?.tnum)
  const kerningStrength = node.opticalKerning ?? 0
  const isOpticalKerning = node.fontKerning === 'optical'
  const trackingPx = node.letterSpacing ?? 0

  const capHeight = fontSize * 0.70
  const xHeight = fontSize * 0.50
  const descent = fontSize * 0.20
  const baselineOffset = (lineSpacingPx - (capHeight + descent)) / 2 + capHeight

  const rawLines = node.text.split('\n')
  const lines: LineOpticalMetrics[] = []
  let maxLineWidth = 0
  let totalPairs = 0
  let sumKerningDelta = 0

  for (let l = 0; l < rawLines.length; l++) {
    const lineText = rawLines[l]
    const chars = Array.from(lineText)
    const glyphs: GlyphOpticalMetric[] = []
    let cursorX = 0

    const baselineY = l * lineSpacingPx + baselineOffset
    const capHeightY = baselineY - capHeight
    const xHeightY = baselineY - xHeight
    const descentY = baselineY + descent

    for (let i = 0; i < chars.length; i++) {
      const char = chars[i]
      const nextChar = i < chars.length - 1 ? chars[i + 1] : undefined
      const isWhitespace = char === ' ' || char === '\t'

      const emWidth = getCharacterEmWidth(char, isTabular) * widthScale
      const advance = isWhitespace ? emWidth * fontSize : emWidth * fontSize + trackingPx

      // Pairwise optical kerning delta to next glyph
      let kerningDelta = 0
      if (nextChar && isOpticalKerning) {
        kerningDelta = calculatePairwiseKerning(char, nextChar, kerningStrength, fontSize)
        if (kerningDelta !== 0) {
          totalPairs++
          sumKerningDelta += kerningDelta
        }
      }

      // Optical sidebearings
      const lsbFactor = 'HBDEDFIKLMNPRUhiklmnpru'.includes(char) ? 0.08 : 'ACGOQSOceos'.includes(char) ? 0.12 : 0.16
      const rsbFactor = 'HBDEDFIKLMNPRUhiklmnpru'.includes(char) ? 0.08 : 'ACGOQSOceos'.includes(char) ? 0.12 : 0.16
      const leftSideBearing = Number((lsbFactor * fontSize * widthScale).toFixed(2))
      const rightSideBearing = Number((rsbFactor * fontSize * widthScale).toFixed(2))

      // Optical margin overhang
      const overhangFactor = MARGIN_OVERHANG_FACTORS[char] ?? 0
      const overhang = Number((overhangFactor * advance).toFixed(2))
      const overhangLeft = i === 0 ? overhang : 0
      const overhangRight = i === chars.length - 1 ? overhang : 0

      // Optical visual bounding box
      const glyphWidth = Math.max(1, advance - leftSideBearing - rightSideBearing)
      const glyphHeight = char >= 'a' && char <= 'z' && !'bdfhkl'.includes(char) && !'gjpqy'.includes(char)
        ? xHeight
        : capHeight

      const glyphY = char >= 'a' && char <= 'z' && !'bdfhkl'.includes(char)
        ? xHeightY
        : capHeightY

      const codePoint = `U+${char.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`

      glyphs.push({
        char,
        index: i,
        codePoint,
        x: Number(cursorX.toFixed(2)),
        y: Number(glyphY.toFixed(2)),
        width: Number(glyphWidth.toFixed(2)),
        height: Number(glyphHeight.toFixed(2)),
        advance: Number(advance.toFixed(2)),
        opticalKerningDelta: kerningDelta,
        leftSideBearing,
        rightSideBearing,
        overhangLeft,
        overhangRight,
        isWhitespace,
      })

      // Advance cursor including optical kerning
      cursorX += advance + kerningDelta
    }

    const lineWidth = Math.max(cursorX, 0)
    if (lineWidth > maxLineWidth) maxLineWidth = lineWidth

    const opticalMarginLeft = glyphs.length > 0 ? glyphs[0].overhangLeft : 0
    const opticalMarginRight = glyphs.length > 0 ? glyphs[glyphs.length - 1].overhangRight : 0

    lines.push({
      lineIndex: l,
      text: lineText,
      glyphs,
      width: Number(lineWidth.toFixed(2)),
      height: Number(lineSpacingPx.toFixed(2)),
      baseline: Number(baselineY.toFixed(2)),
      capHeight: Number(capHeightY.toFixed(2)),
      xHeight: Number(xHeightY.toFixed(2)),
      descent: Number(descentY.toFixed(2)),
      opticalMarginLeft,
      opticalMarginRight,
    })
  }

  const totalHeight = Math.max(lines.length * lineSpacingPx, fontSize)
  const totalGlyphs = lines.reduce((acc, l) => acc + l.glyphs.length, 0)
  const totalWords = node.text.trim().split(/\s+/).filter(Boolean).length
  const weight = node.variableAxes?.wght ?? (typeof node.fontWeight === 'number' ? node.fontWeight : 400)

  return {
    lines,
    totalWidth: Number(maxLineWidth.toFixed(2)),
    totalHeight: Number(totalHeight.toFixed(2)),
    kerningPairCount: totalPairs,
    averageKerningDelta: totalPairs > 0 ? Number((sumKerningDelta / totalPairs).toFixed(2)) : 0,
    totalKerningDelta: Number(sumKerningDelta.toFixed(2)),
    capHeight: Number(capHeight.toFixed(2)),
    xHeight: Number(xHeight.toFixed(2)),
    baseline: Number(baselineOffset.toFixed(2)),
    descent: Number(descent.toFixed(2)),
    ascender: Number((fontSize * 0.75).toFixed(2)),
    advanceWidth: Number(maxLineWidth.toFixed(2)),
    glyphCount: totalGlyphs,
    characterCount: node.text.length,
    wordCount: totalWords,
    lineCount: lines.length,
    weightRatio: Number((weight / 400).toFixed(2)),
    widthStretchRatio: Number(widthScale.toFixed(2)),
    slantAngle: node.variableAxes?.slnt ?? 0,
    opticalSize: node.variableAxes?.opsz ?? fontSize,
    effectiveLineHeightPx: Number(lineSpacingPx.toFixed(2)),
    effectiveTrackingEm: Number((trackingPx / fontSize).toFixed(4)),
  }
}
