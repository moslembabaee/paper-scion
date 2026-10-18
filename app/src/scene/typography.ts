import type { CSSProperties } from 'react'
import { parsePath, serializePath } from './pathGeometry.ts'
import { isVector } from './booleanGeometry.ts'
import { linkedVectorPathD } from './textOnPath.ts'
import { OPTICAL_KERNING_MATRIX } from './opticalMetrics.ts'
import type { SceneStore } from './store.ts'
import type {
  OpenTypeFeatures,
  SceneElement,
  TextElement,
  TextPathPreset,
  TextTransform,
  VariableFontAxes,
} from './types.ts'

export interface VariableAxisMeta {
  readonly tag: string
  readonly label: string
  readonly min: number
  readonly max: number
  readonly step: number
  readonly default: number
  readonly unit?: string
  readonly description?: string
}

export const VARIABLE_AXES_META: Readonly<Record<string, VariableAxisMeta>> = {
  wght: { tag: 'wght', label: 'Weight', min: 1, max: 1000, step: 1, default: 400, description: 'Stroke thickness' },
  WGHT: { tag: 'wght', label: 'Weight', min: 1, max: 1000, step: 1, default: 400, description: 'Stroke thickness' },
  wdth: { tag: 'wdth', label: 'Width', min: 25, max: 200, step: 1, default: 100, unit: '%', description: 'Glyph proportion horizontal scale' },
  WDTH: { tag: 'wdth', label: 'Width', min: 25, max: 200, step: 1, default: 100, unit: '%', description: 'Glyph proportion horizontal scale' },
  slnt: { tag: 'slnt', label: 'Slant', min: -90, max: 90, step: 0.5, default: 0, unit: '°', description: 'Oblique shear angle (-90° to +90°)' },
  SLNT: { tag: 'slnt', label: 'Slant', min: -90, max: 90, step: 0.5, default: 0, unit: '°', description: 'Oblique shear angle (-90° to +90°)' },
  opsz: { tag: 'opsz', label: 'Optical Size', min: 6, max: 144, step: 0.5, default: 16, unit: 'pt', description: 'Stroke weight adjustment for display vs caption' },
  OPSZ: { tag: 'opsz', label: 'Optical Size', min: 6, max: 144, step: 0.5, default: 16, unit: 'pt', description: 'Stroke weight adjustment for display vs caption' },
  grad: { tag: 'GRAD', label: 'Grade', min: -200, max: 200, step: 1, default: 0, description: 'Weight adjustment without changing layout metrics' },
  GRAD: { tag: 'GRAD', label: 'Grade', min: -200, max: 200, step: 1, default: 0, description: 'Weight adjustment without changing layout metrics' },
  casl: { tag: 'CASL', label: 'Casual', min: 0, max: 1, step: 0.05, default: 0, description: 'Informality of stroke terminals' },
  CASL: { tag: 'CASL', label: 'Casual', min: 0, max: 1, step: 0.05, default: 0, description: 'Informality of stroke terminals' },
  crsv: { tag: 'CRSV', label: 'Cursive', min: 0, max: 1, step: 0.05, default: 0, description: 'Continuous script joining' },
  CRSV: { tag: 'CRSV', label: 'Cursive', min: 0, max: 1, step: 0.05, default: 0, description: 'Continuous script joining' },
  ital: { tag: 'ital', label: 'Italic', min: 0, max: 1, step: 0.05, default: 0, description: 'Italic stroke transformation' },
  ITAL: { tag: 'ital', label: 'Italic', min: 0, max: 1, step: 0.05, default: 0, description: 'Italic stroke transformation' },
  fill: { tag: 'FILL', label: 'Fill', min: 0, max: 1, step: 0.05, default: 0, description: 'Variable glyph fill and solid density' },
  FILL: { tag: 'FILL', label: 'Fill', min: 0, max: 1, step: 0.05, default: 0, description: 'Variable glyph fill and solid density' },
  soft: { tag: 'SOFT', label: 'Softness', min: 0, max: 100, step: 1, default: 0, description: 'Corner softness and stroke roundness' },
  SOFT: { tag: 'SOFT', label: 'Softness', min: 0, max: 100, step: 1, default: 0, description: 'Corner softness and stroke roundness' },
  xtra: { tag: 'XTRA', label: 'Counter Width', min: 323, max: 603, step: 1, default: 468, description: 'Parametric counter width' },
  XTRA: { tag: 'XTRA', label: 'Counter Width', min: 323, max: 603, step: 1, default: 468, description: 'Parametric counter width' },
  xopq: { tag: 'XOPQ', label: 'Thick Stroke', min: 27, max: 175, step: 1, default: 85, description: 'Parametric thick stroke width' },
  XOPQ: { tag: 'XOPQ', label: 'Thick Stroke', min: 27, max: 175, step: 1, default: 85, description: 'Parametric thick stroke width' },
  yopq: { tag: 'YOPQ', label: 'Thin Stroke', min: 25, max: 135, step: 1, default: 50, description: 'Parametric thin stroke width' },
  YOPQ: { tag: 'YOPQ', label: 'Thin Stroke', min: 25, max: 135, step: 1, default: 50, description: 'Parametric thin stroke width' },
  hexp: { tag: 'HEXP', label: 'Expansion', min: 0, max: 100, step: 1, default: 0, unit: '%', description: 'Horizontal glyph expansion' },
  HEXP: { tag: 'HEXP', label: 'Expansion', min: 0, max: 100, step: 1, default: 0, unit: '%', description: 'Horizontal glyph expansion' },
  mono: { tag: 'MONO', label: 'Monospace', min: 0, max: 1, step: 0.05, default: 0, description: 'Proportional to monospace character spacing' },
  MONO: { tag: 'MONO', label: 'Monospace', min: 0, max: 1, step: 0.05, default: 0, description: 'Proportional to monospace character spacing' },
  cntr: { tag: 'CNTR', label: 'Contrast', min: 0, max: 100, step: 1, default: 0, description: 'Stroke contrast ratio' },
  CNTR: { tag: 'CNTR', label: 'Contrast', min: 0, max: 100, step: 1, default: 0, description: 'Stroke contrast ratio' },
  flar: { tag: 'FLAR', label: 'Flare', min: 0, max: 100, step: 1, default: 0, description: 'Flared terminal serifs' },
  FLAR: { tag: 'FLAR', label: 'Flare', min: 0, max: 100, step: 1, default: 0, description: 'Flared terminal serifs' },
  volm: { tag: 'VOLM', label: 'Volume', min: 0, max: 100, step: 1, default: 0, description: '3D volume extrusion effect' },
  VOLM: { tag: 'VOLM', label: 'Volume', min: 0, max: 100, step: 1, default: 0, description: '3D volume extrusion effect' },
  trmo: { tag: 'TRMO', label: 'Terminal', min: 0, max: 100, step: 1, default: 0, description: 'Open versus closed stroke terminals' },
  TRMO: { tag: 'TRMO', label: 'Terminal', min: 0, max: 100, step: 1, default: 0, description: 'Open versus closed stroke terminals' },
}

/** Retrieve metadata for a variable font axis with fallback for custom 4-character OpenType tags */
export function getAxisMeta(tag: string): VariableAxisMeta {
  const direct = VARIABLE_AXES_META[tag] ?? VARIABLE_AXES_META[tag.toLowerCase()]
  if (direct) return direct
  const cleanTag = tag.trim()
  return {
    tag: cleanTag.length === 4 ? cleanTag : tag,
    label: cleanTag.toUpperCase(),
    min: 0,
    max: 1000,
    step: 1,
    default: 0,
    description: `Custom OpenType variation axis '${cleanTag}'`,
  }
}

/** Clamp and round a variable font axis value to its allowed bounds and step precision */
export function clampAxisValue(tag: string, val: number): number {
  const meta = getAxisMeta(tag)
  const clamped = Math.max(meta.min, Math.min(meta.max, val))
  return meta.step < 1 ? Number(clamped.toFixed(2)) : Math.round(clamped)
}

export interface VariableAxisPreset {
  readonly name: string
  readonly description: string
  readonly axes: VariableFontAxes
}

export const VARIABLE_AXIS_PRESETS: readonly VariableAxisPreset[] = [
  { name: 'Regular', description: 'Neutral body proportion', axes: { wght: 400, wdth: 100, slnt: 0, opsz: 16 } },
  { name: 'Condensed Bold', description: 'Dense headline punch', axes: { wght: 700, wdth: 75, slnt: 0, opsz: 32 } },
  { name: 'Extended Dynamic', description: 'Wide tracking display', axes: { wght: 600, wdth: 135, slnt: -6, opsz: 40 } },
  { name: 'Editorial Italic', description: 'Graceful oblique voice', axes: { wght: 450, wdth: 95, slnt: -14, opsz: 22 } },
  { name: 'Ultra Light Thin', description: 'Delicate technical clarity', axes: { wght: 150, wdth: 100, slnt: 0, opsz: 12 } },
  { name: 'Poster Black', description: 'Maximum visual impact', axes: { wght: 950, wdth: 115, slnt: 0, opsz: 72 } },
  { name: 'Casual Script', description: 'Warm informal hand-drawn voice', axes: { wght: 520, wdth: 102, slnt: -4, opsz: 24, casl: 0.8, crsv: 0.6 } },
  { name: 'Technical Mono', description: 'Precise engineering cadence', axes: { wght: 450, wdth: 90, slnt: 0, opsz: 12, grad: -25 } },
  { name: 'Display High-Grade', description: 'Rich high-contrast grade emphasis', axes: { wght: 800, wdth: 110, slnt: 0, opsz: 64, grad: 100 } },
  { name: 'Headline Heavy', description: 'Commanding editorial presence', axes: { wght: 850, wdth: 105, slnt: 0, opsz: 48 } },
  { name: 'Compact Semi-Bold', description: 'Space-saving robust interface typography', axes: { wght: 650, wdth: 85, slnt: 0, opsz: 18 } },
  { name: 'Delicate Caption', description: 'Micro-scale high-legibility caption weight', axes: { wght: 320, wdth: 95, slnt: 0, opsz: 8 } },
]

export interface OpenTypeFeatureMeta {
  readonly tag: string
  readonly name: string
  readonly category: 'Ligatures' | 'Numbers' | 'Capitals' | 'Decorative' | 'Stylistic Sets'
  readonly sample: string
  readonly description: string
  readonly default?: boolean
}

export const OPENTYPE_CATALOG: readonly OpenTypeFeatureMeta[] = [
  // Ligatures
  { tag: 'liga', name: 'Standard Ligatures', category: 'Ligatures', sample: 'fi fl ff ffi ffl', description: 'Combines adjacent glyphs (fi, fl, ffi) to prevent visual collisions', default: true },
  { tag: 'dlig', name: 'Discretionary Ligatures', category: 'Ligatures', sample: 'st ct sp', description: 'Ornamental and historic glyph connections for display typography' },
  { tag: 'calt', name: 'Contextual Alternates', category: 'Ligatures', sample: '-> => != <=', description: 'Code arrows and context-sensitive glyph replacements' },
  { tag: 'hlig', name: 'Historical Ligatures', category: 'Ligatures', sample: 'ct st ſi', description: 'Archaic and historic ligature pairs' },

  // Stylistic Sets (ss01 - ss20)
  { tag: 'ss01', name: 'Stylistic Set 1', category: 'Stylistic Sets', sample: 'Single-story a', description: 'Alternate geometric lowercase letters' },
  { tag: 'ss02', name: 'Stylistic Set 2', category: 'Stylistic Sets', sample: 'Single-story g', description: 'Simplified loop letterforms' },
  { tag: 'ss03', name: 'Stylistic Set 3', category: 'Stylistic Sets', sample: 'Curved l', description: 'Legible curved bottom stem for lowercase l' },
  { tag: 'ss04', name: 'Stylistic Set 4', category: 'Stylistic Sets', sample: 'Square punct', description: 'Architectural square dots and punctuation marks' },
  { tag: 'ss05', name: 'Stylistic Set 5', category: 'Stylistic Sets', sample: 'Rounded terminals', description: 'Softened rounded stroke terminals' },
  { tag: 'ss06', name: 'Stylistic Set 6', category: 'Stylistic Sets', sample: 'Simplified &', description: 'Contemporary single-stroke ampersand' },
  { tag: 'ss07', name: 'Stylistic Set 7', category: 'Stylistic Sets', sample: 'Alternate Q', description: 'Extended crossing tail for capital Q' },
  { tag: 'ss08', name: 'Stylistic Set 8', category: 'Stylistic Sets', sample: 'Curved r & y', description: 'Alternate ball terminal r and straight-leg y' },
  { tag: 'ss09', name: 'Stylistic Set 9', category: 'Stylistic Sets', sample: 'Flat-top 3', description: 'Flat horizontal top bar on numeral 3' },
  { tag: 'ss10', name: 'Stylistic Set 10', category: 'Stylistic Sets', sample: 'Open 4', description: 'Unclosed apex glyph on numeral 4' },
  { tag: 'ss11', name: 'Stylistic Set 11', category: 'Stylistic Sets', sample: 'Spurless G', description: 'Clean modern capital G without spur' },
  { tag: 'ss12', name: 'Stylistic Set 12', category: 'Stylistic Sets', sample: 'Alternate 6 & 9', description: 'Straight diagonal stems on 6 and 9' },
  { tag: 'ss13', name: 'Stylistic Set 13', category: 'Stylistic Sets', sample: 'Serifed I', description: 'Top and bottom crossbars on capital I' },
  { tag: 'ss14', name: 'Stylistic Set 14', category: 'Stylistic Sets', sample: 'Crossbar t', description: 'Angled stroke on lowercase t' },
  { tag: 'ss15', name: 'Stylistic Set 15', category: 'Stylistic Sets', sample: 'Circular 0', description: 'Unslashed geometric oval zero' },
  { tag: 'ss16', name: 'Stylistic Set 16', category: 'Stylistic Sets', sample: 'Angled quotes', description: 'Geometric quotation marks' },
  { tag: 'ss17', name: 'Stylistic Set 17', category: 'Stylistic Sets', sample: 'Compact accents', description: 'Low-profile diacritics for tight headlines' },
  { tag: 'ss18', name: 'Stylistic Set 18', category: 'Stylistic Sets', sample: 'Curved brackets', description: 'Flared technical brackets and parentheses' },
  { tag: 'ss19', name: 'Stylistic Set 19', category: 'Stylistic Sets', sample: 'Short dollar $', description: 'Continuous vertical bar on dollar sign' },
  { tag: 'ss20', name: 'Stylistic Set 20', category: 'Stylistic Sets', sample: 'Alternate symbols', description: 'Extended typographic symbol variants' },

  // Numbers & Numerals
  { tag: 'tnum', name: 'Tabular Figures', category: 'Numbers', sample: '$1,420.00', description: 'Uniform digit widths for aligned numerical tables and columns' },
  { tag: 'pnum', name: 'Proportional Figures', category: 'Numbers', sample: '123456', description: 'Proportionally spaced numerals matching natural character rhythm' },
  { tag: 'onum', name: 'Oldstyle Figures', category: 'Numbers', sample: '0123456789', description: 'Varying ascenders and descenders blending into running lowercase' },
  { tag: 'lnum', name: 'Lining Figures', category: 'Numbers', sample: '0123456789', description: 'Uniform height numbers aligning with uppercase baseline' },
  { tag: 'zero', name: 'Slashed Zero', category: 'Numbers', sample: '0 vs O', description: 'Distinct slashed zero to differentiate from capital letter O' },
  { tag: 'frac', name: 'Fractions', category: 'Numbers', sample: '1/2 3/4 7/8', description: 'Converts slashed numbers into true diagonal typographical fractions' },
  { tag: 'ordn', name: 'Ordinals', category: 'Numbers', sample: '1st 2nd 3rd', description: 'Superscript ordinals for dates and rankings' },
  { tag: 'sups', name: 'Superscript', category: 'Numbers', sample: 'x² y³', description: 'True designed superior figures' },
  { tag: 'subs', name: 'Subscript', category: 'Numbers', sample: 'H₂O CO₂', description: 'True designed inferior figures' },

  // Capitals & Letterforms
  { tag: 'smcp', name: 'Small Capitals', category: 'Capitals', sample: 'Small Caps', description: 'Converts lowercase glyphs into proportional small capitals' },
  { tag: 'c2sc', name: 'Capitals to Small Caps', category: 'Capitals', sample: 'ALL CAPS', description: 'Converts uppercase glyphs into matching small capitals' },
  { tag: 'case', name: 'Case-Sensitive Forms', category: 'Capitals', sample: '· [A-Z] ·', description: 'Shifts punctuation positions to vertically align with all-caps' },
  { tag: 'unic', name: 'Unicase', category: 'Capitals', sample: 'AaBbCc', description: 'Blends uppercase and lowercase letterforms into uniform height' },

  // Decorative & Alternates
  { tag: 'swsh', name: 'Swashes', category: 'Decorative', sample: 'K Q R &', description: 'Exaggerated flourishing calligraphic entry/exit strokes' },
  { tag: 'salt', name: 'Stylistic Alternates', category: 'Decorative', sample: 'a g k', description: 'Alternate glyph forms for brand-specific typography' },
  { tag: 'titl', name: 'Titling Alternates', category: 'Decorative', sample: 'TITLING', description: 'Refined glyphs optimized specifically for large display titles' },
]

export interface OpenTypeRecipe {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly features: OpenTypeFeatures
}

export const OPENTYPE_RECIPES: readonly OpenTypeRecipe[] = [
  {
    id: 'default',
    name: 'Default Clean',
    description: 'Standard ligatures and contextual alternates for standard copy',
    features: { liga: true, calt: true },
  },
  {
    id: 'tabular-data',
    name: 'Tabular & Tables',
    description: 'Tabular monospaced figures, slashed zero and true fractions for dashboards and numerical tables',
    features: { tnum: true, zero: true, frac: true, liga: true },
  },
  {
    id: 'editorial',
    name: 'Stylistic & Editorial',
    description: 'Stylistic alternates, discretionary ligatures, and small caps for expressive editorial voice',
    features: { salt: true, dlig: true, smcp: true, liga: true },
  },
  {
    id: 'code-tech',
    name: 'Code & Terminal',
    description: 'Contextual programming arrows, slashed zero, and tabular alignment for technical copy',
    features: { calt: true, zero: true, tnum: true },
  },
  {
    id: 'classic-book',
    name: 'Classic Book',
    description: 'Oldstyle proportional figures and historic ligatures for long-form reading',
    features: { onum: true, pnum: true, liga: true, dlig: true },
  },
  {
    id: 'all-off',
    name: 'Raw / Unstyled',
    description: 'Disable all ligatures and OpenType features for raw glyph reproduction',
    features: { liga: false, calt: false },
  },
]

/** Anchor rich text along any arbitrary vector path in the scene */
export function anchorTextToVectorPath(
  store: SceneStore,
  targetPathId: string,
  customText = 'Vector Aligned Typography'
): TextElement {
  const state = store.getSnapshot()
  const target = state.elements[targetPathId]
  if (!target || !isVector(target)) throw new Error('Target must be a vector node')
  const text = store.add('text', {
    name: `Text on ${target.name}`,
    parentId: target.parentId,
    x: target.x,
    y: target.y,
    width: target.width,
    height: target.height,
    text: customText,
    fontSize: Math.max(14, Math.min(48, Math.round(target.height * 0.28))),
    fontWeight: 500,
    variableAxes: { wght: 500, wdth: 100, slnt: 0, opsz: 24 },
    openTypeFeatures: { liga: true, calt: true },
    textOnPath: {
      enabled: true,
      pathId: target.id,
      preset: 'custom',
      offset: 0,
      offsetMode: 'percent',
      align: 'start',
      side: 'left',
      spacing: 0.5,
    },
  })
  store.select([text.id])
  return text
}

export interface DetectedKerningPair {
  readonly pair: string
  readonly index: number
  readonly deltaEm: number
  readonly deltaPx: number
}

/** Detect all pairwise optical kerning pairs present in a text string */
export function getKerningPairsInText(text: string, strength = 0, fontSize = 16): DetectedKerningPair[] {
  if (!text || text.length < 2) return []
  const factor = 1 + (strength / 50)
  const results: DetectedKerningPair[] = []
  for (let i = 0; i < text.length - 1; i++) {
    const pair = text.slice(i, i + 2)
    const metric = OPTICAL_KERNING_MATRIX[pair] ?? OPTICAL_KERNING_MATRIX[pair.toUpperCase()]
    if (metric !== undefined) {
      const deltaEm = Number((metric * factor).toFixed(3))
      const deltaPx = Number((metric * factor * fontSize).toFixed(2))
      results.push({ pair, index: i, deltaEm, deltaPx })
    }
  }
  return results
}

/** Compute pairwise optical kerning adjustment in em units */
export function calculateOpticalKerningDelta(text: string, strength = 0): number {
  if (!text || text.length < 2) return 0
  let totalDelta = 0
  let pairCount = 0
  for (let i = 0; i < text.length - 1; i++) {
    const pair = text.slice(i, i + 2)
    const metric = OPTICAL_KERNING_MATRIX[pair] ?? OPTICAL_KERNING_MATRIX[pair.toUpperCase()]
    if (metric !== undefined) {
      totalDelta += metric
      pairCount++
    }
  }
  const baseDelta = pairCount > 0 ? totalDelta / text.length : -0.02
  const factor = 1 + (strength / 50)
  return baseDelta * factor
}

/** Apply text transformation */
export function applyTextTransform(text: string, transform?: TextTransform): string {
  if (!transform || transform === 'none') return text
  if (transform === 'uppercase') return text.toUpperCase()
  if (transform === 'lowercase') return text.toLowerCase()
  if (transform === 'capitalize') {
    return text.replace(/\b\w/g, char => char.toUpperCase())
  }
  return text
}

/** Compile CSS font-variation-settings string */
export function compileFontVariationSettings(axes?: VariableFontAxes, fallbackWeight?: number): string | undefined {
  if (!axes && fallbackWeight === undefined) return undefined
  const parts: string[] = []
  const seenTags = new Set<string>()

  // Ensure weight is included
  const weight = axes?.wght ?? fallbackWeight
  if (weight !== undefined && Number.isFinite(weight)) {
    parts.push(`'wght' ${Number(weight.toFixed(2))}`)
    seenTags.add('wght')
    seenTags.add('WGHT')
  }

  // Width
  if (axes?.wdth !== undefined && Number.isFinite(axes.wdth)) {
    parts.push(`'wdth' ${Number(axes.wdth.toFixed(2))}`)
    seenTags.add('wdth')
    seenTags.add('WDTH')
  }

  // Slant
  if (axes?.slnt !== undefined && Number.isFinite(axes.slnt)) {
    parts.push(`'slnt' ${Number(axes.slnt.toFixed(2))}`)
    seenTags.add('slnt')
    seenTags.add('SLNT')
  }

  // Optical size
  if (axes?.opsz !== undefined && Number.isFinite(axes.opsz)) {
    parts.push(`'opsz' ${Number(axes.opsz.toFixed(1))}`)
    seenTags.add('opsz')
    seenTags.add('OPSZ')
  }

  // Extended and custom variation axes (GRAD, CASL, CRSV, ITAL, FILL, SOFT, XTRA, etc.)
  if (axes) {
    for (const [rawTag, val] of Object.entries(axes)) {
      if (['wght', 'wdth', 'slnt', 'opsz'].includes(rawTag.toLowerCase())) continue
      if (seenTags.has(rawTag) || seenTags.has(rawTag.toLowerCase())) continue
      if (val !== undefined && Number.isFinite(val)) {
        const cleanTag = VARIABLE_AXES_META[rawTag]?.tag ?? VARIABLE_AXES_META[rawTag.toLowerCase()]?.tag ?? rawTag
        if (/^[a-zA-Z0-9 ]{4}$/.test(cleanTag)) {
          if (!seenTags.has(cleanTag) && !seenTags.has(cleanTag.toLowerCase())) {
            parts.push(`'${cleanTag}' ${Number(val.toFixed(2))}`)
            seenTags.add(cleanTag)
            seenTags.add(cleanTag.toLowerCase())
            seenTags.add(rawTag)
            seenTags.add(rawTag.toLowerCase())
          }
        }
      }
    }
  }

  return parts.length ? parts.join(', ') : undefined
}

/** Human-readable typographical classification for font weight */
export function getVariableFontWeightName(wght: number): string {
  if (wght < 150) return 'Thin'
  if (wght < 250) return 'Extra Light'
  if (wght < 350) return 'Light'
  if (wght < 450) return 'Regular'
  if (wght < 550) return 'Medium'
  if (wght < 650) return 'Semi Bold'
  if (wght < 750) return 'Bold'
  if (wght < 850) return 'Extra Bold'
  if (wght < 950) return 'Black'
  return 'Extra Black'
}

/** Human-readable typographical classification for font width */
export function getVariableFontWidthName(wdth: number): string {
  if (wdth < 60) return 'Ultra Condensed'
  if (wdth < 75) return 'Extra Condensed'
  if (wdth < 90) return 'Condensed'
  if (wdth < 98) return 'Semi Condensed'
  if (wdth <= 105) return 'Normal'
  if (wdth < 120) return 'Semi Expanded'
  if (wdth < 135) return 'Expanded'
  if (wdth < 160) return 'Extra Expanded'
  return 'Ultra Expanded'
}

/** Linearly interpolate between two variable font axis configurations */
export function interpolateVariableAxes(
  from: VariableFontAxes,
  to: VariableFontAxes,
  t: number
): VariableFontAxes {
  const clampedT = Math.max(0, Math.min(1, t))
  const allKeys = new Set([...Object.keys(from), ...Object.keys(to)])
  const result: Record<string, number> = {}

  for (const key of allKeys) {
    const meta = getAxisMeta(key)
    const valFrom = from[key] ?? (key === 'wght' ? 400 : key === 'wdth' ? 100 : meta.default)
    const valTo = to[key] ?? (key === 'wght' ? 400 : key === 'wdth' ? 100 : meta.default)
    const interpolated = valFrom + (valTo - valFrom) * clampedT
    result[key] = meta.step < 1 ? Number(interpolated.toFixed(2)) : Math.round(interpolated)
  }

  return result as VariableFontAxes
}

export type VariableFontExportFormat = 'css' | 'tailwind' | 'react' | 'keyframes'

export interface VariableFontExportOptions {
  readonly format?: VariableFontExportFormat
  readonly animationName?: string
  readonly duration?: string
  readonly targetAxes?: VariableFontAxes
  readonly selector?: string
}

/** Generate ready-to-use CSS keyframe animation for animated axis transitions */
export function generateVariableFontKeyframes(
  from: VariableFontAxes,
  to: VariableFontAxes,
  name = 'variable-font-breathe',
  duration = '2.4s'
): string {
  const fromFvs = compileFontVariationSettings(from) ?? "'wght' 400"
  const toFvs = compileFontVariationSettings(to) ?? "'wght' 700"
  const fromWeight = from.wght ?? 400
  const toWeight = to.wght ?? 700

  return `@keyframes ${name} {
  0%, 100% {
    font-variation-settings: ${fromFvs};
    font-weight: ${fromWeight};
  }
  50% {
    font-variation-settings: ${toFvs};
    font-weight: ${toWeight};
  }
}

.parametric-typography-animated {
  animation: ${name} ${duration} cubic-bezier(0.4, 0, 0.2, 1) infinite;
  will-change: font-variation-settings;
}`
}

/** Export variable font typography styles to CSS, Tailwind v4, React CSSProperties, or CSS Keyframes */
export function exportVariableFontCSS(
  node: TextElement,
  options: VariableFontExportOptions = {}
): string {
  const {
    format = 'css',
    animationName = 'variable-font-breathe',
    duration = '2.4s',
    targetAxes,
    selector = '.paper-typography',
  } = options

  const axes: VariableFontAxes = {
    wght: node.fontWeight,
    wdth: 100,
    slnt: 0,
    opsz: node.fontSize,
    ...(node.variableAxes ?? {}),
  }
  const fvs = compileFontVariationSettings(axes, node.fontWeight) ?? ''

  switch (format) {
    case 'css': {
      const decls: string[] = [
        `  font-family: ${node.fontFamily};`,
        `  font-size: ${node.fontSize}px;`,
        `  font-variation-settings: ${fvs};`,
        `  font-weight: ${axes.wght ?? node.fontWeight};`,
      ]
      if (axes.wdth && axes.wdth !== 100) {
        decls.push(`  font-stretch: ${axes.wdth}%;`)
      }
      if (axes.slnt && axes.slnt !== 0) {
        decls.push(`  font-style: oblique ${axes.slnt}deg;`)
      }
      if (axes.opsz !== undefined) {
        decls.push(`  font-optical-sizing: none;`)
      }
      if (node.letterSpacing) {
        decls.push(`  letter-spacing: ${node.letterSpacing}px;`)
      }
      if (node.lineHeight) {
        decls.push(`  line-height: ${node.lineHeight};`)
      }
      if (node.textAlign && node.textAlign !== 'left') {
        decls.push(`  text-align: ${node.textAlign};`)
      }
      return `/* Paper Variable Font Typography */\n${selector} {\n${decls.join('\n')}\n}`
    }

    case 'tailwind': {
      const familyName = node.fontFamily.split(',')[0].replace(/['"]/g, '').trim()
      const parts: string[] = [
        `font-['${familyName}']`,
        `text-[${node.fontSize}px]`,
        `[font-variation-settings:'${fvs}']`,
        `font-[${axes.wght ?? node.fontWeight}]`,
      ]
      if (axes.wdth && axes.wdth !== 100) {
        parts.push(`[font-stretch:${axes.wdth}%]`)
      }
      if (axes.slnt && axes.slnt !== 0) {
        parts.push(`[font-style:oblique_${axes.slnt}deg]`)
      }
      if (node.letterSpacing) {
        parts.push(`tracking-[${node.letterSpacing}px]`)
      }
      if (node.lineHeight) {
        parts.push(`leading-[${node.lineHeight}]`)
      }
      return parts.join(' ')
    }

    case 'react': {
      const styleObj: Record<string, unknown> = {
        fontFamily: node.fontFamily,
        fontSize: node.fontSize,
        fontVariationSettings: fvs,
        fontWeight: axes.wght ?? node.fontWeight,
      }
      if (axes.wdth && axes.wdth !== 100) {
        styleObj.fontStretch = `${axes.wdth}%`
      }
      if (axes.slnt && axes.slnt !== 0) {
        styleObj.fontStyle = `oblique ${axes.slnt}deg`
      }
      if (axes.opsz !== undefined) {
        styleObj.fontOpticalSizing = 'none'
      }
      if (node.letterSpacing) {
        styleObj.letterSpacing = `${node.letterSpacing}px`
      }
      if (node.lineHeight) {
        styleObj.lineHeight = node.lineHeight
      }
      if (node.textAlign && node.textAlign !== 'left') {
        styleObj.textAlign = node.textAlign
      }
      return `export const typographyStyle: React.CSSProperties = ${JSON.stringify(styleObj, null, 2)};`
    }

    case 'keyframes': {
      const fallbackTarget: VariableFontAxes = targetAxes ?? {
        ...axes,
        wght: (axes.wght ?? 400) > 550 ? Math.max(100, (axes.wght ?? 400) - 400) : Math.min(900, (axes.wght ?? 400) + 400),
        wdth: (axes.wdth ?? 100) > 105 ? Math.max(60, (axes.wdth ?? 100) - 35) : Math.min(150, (axes.wdth ?? 100) + 35),
        slnt: (axes.slnt ?? 0) === 0 ? -12 : 0,
      }
      return generateVariableFontKeyframes(axes, fallbackTarget, animationName, duration)
    }
  }
}

/** Compile CSS font-feature-settings string */
export function compileFontFeatureSettings(features?: OpenTypeFeatures): string | undefined {
  if (!features) return undefined
  const parts: string[] = []
  for (const [tag, active] of Object.entries(features)) {
    if (active === true) {
      parts.push(`"${tag}" 1`)
    } else if (active === false) {
      parts.push(`"${tag}" 0`)
    }
  }
  return parts.length ? parts.join(', ') : undefined
}

/** Compile full inline CSSProperties for a TextElement */
export function compileTypographyStyles(node: TextElement): CSSProperties {
  const variation = compileFontVariationSettings(node.variableAxes, node.fontWeight)
  const features = compileFontFeatureSettings(node.openTypeFeatures)

  let effectiveSpacing = node.letterSpacing
  if (node.fontKerning === 'optical') {
    const opticalDeltaEm = calculateOpticalKerningDelta(node.text, node.opticalKerning ?? 0)
    effectiveSpacing += opticalDeltaEm * node.fontSize
  }

  const styles: CSSProperties = {
    fontFamily: node.fontFamily,
    fontSize: node.fontSize,
    fontWeight: node.variableAxes?.wght ?? node.fontWeight,
    lineHeight: node.lineHeight,
    letterSpacing: effectiveSpacing !== 0 ? `${effectiveSpacing}px` : undefined,
    textAlign: node.textAlign,
    fontOpticalSizing: node.variableAxes?.opsz === undefined ? 'auto' : 'none',
    textTransform: node.textTransform && node.textTransform !== 'none' ? node.textTransform : undefined,
  }

  // Slant and oblique synthesis for canvas and preview
  if (node.variableAxes?.slnt !== undefined && node.variableAxes.slnt !== 0) {
    styles.fontStyle = `oblique ${node.variableAxes.slnt}deg`
  } else if (node.variableAxes?.ital !== undefined && node.variableAxes.ital > 0.5) {
    styles.fontStyle = 'italic'
  }

  if (variation) {
    styles.fontVariationSettings = variation
  }

  if (features) {
    styles.fontFeatureSettings = features
  }

  // High-level CSS OpenType variant properties for enhanced browser compatibility
  if (node.openTypeFeatures) {
    const ot = node.openTypeFeatures
    const numericParts: string[] = []
    if (ot.tnum) numericParts.push('tabular-nums')
    else if (ot.pnum) numericParts.push('proportional-nums')
    if (ot.lnum) numericParts.push('lining-nums')
    else if (ot.onum) numericParts.push('oldstyle-nums')
    if (ot.frac) numericParts.push('diagonal-fractions')
    if (ot.zero) numericParts.push('slashed-zero')
    if (ot.ordn) numericParts.push('ordinal')
    if (numericParts.length > 0) {
      styles.fontVariantNumeric = numericParts.join(' ')
    }

    if (ot.smcp) {
      styles.fontVariantCaps = 'small-caps'
    } else if (ot.c2sc) {
      styles.fontVariantCaps = 'all-small-caps'
    } else if (ot.unic) {
      styles.fontVariantCaps = 'unicase'
    }

    const ligParts: string[] = []
    if (ot.liga === false) ligParts.push('no-common-ligatures')
    else if (ot.liga === true) ligParts.push('common-ligatures')
    if (ot.dlig) ligParts.push('discretionary-ligatures')
    if (ot.hlig) ligParts.push('historical-ligatures')
    if (ot.calt === false) ligParts.push('no-contextual')
    else if (ot.calt === true) ligParts.push('contextual')
    if (ligParts.length > 0) {
      styles.fontVariantLigatures = ligParts.join(' ')
    }
  }

  if (node.fontKerning) {
    styles.fontKerning = node.fontKerning === 'optical' ? 'normal' : node.fontKerning
  }

  if (node.variableAxes?.wdth && node.variableAxes.wdth !== 100) {
    styles.fontStretch = `${node.variableAxes.wdth}%`
  }

  if (node.opticalMarginAlignment) {
    ;(styles as Record<string, unknown>).hangingPunctuation = 'first last'
  }

  return styles
}

/** Generate mathematical SVG path presets for Text-on-Path deformation */
export function generatePathPreset(preset: TextPathPreset, width: number, height: number): string {
  const w = Math.max(10, width)
  const h = Math.max(10, height)

  switch (preset) {
    case 'arc': {
      // Graceful arched rainbow curve
      const yBase = h * 0.85
      const yPeak = h * 0.15
      return `M 0,${yBase.toFixed(2)} Q ${(w * 0.5).toFixed(2)},${yPeak.toFixed(2)} ${w.toFixed(2)},${yBase.toFixed(2)}`
    }
    case 'circle': {
      // Circular/orbital path centered in bounds
      const cx = w * 0.5
      const cy = h * 0.5
      const r = Math.min(w, h) * 0.42
      return `M ${(cx - r).toFixed(2)},${cy.toFixed(2)} A ${r.toFixed(2)},${r.toFixed(2)} 0 1,1 ${(cx + r).toFixed(2)},${cy.toFixed(2)} A ${r.toFixed(2)},${r.toFixed(2)} 0 1,1 ${(cx - r).toFixed(2)},${cy.toFixed(2)}`
    }
    case 'scurve': {
      // Dynamic S-curve with twin inflection points
      const y1 = h * 0.8
      const y2 = h * 0.2
      return `M 0,${y1.toFixed(2)} C ${(w * 0.35).toFixed(2)},${y1.toFixed(2)} ${(w * 0.65).toFixed(2)},${y2.toFixed(2)} ${w.toFixed(2)},${y2.toFixed(2)}`
    }
    case 'spiral': {
      // Expanding smooth Archimedean spiral
      const cx = w * 0.5
      const cy = h * 0.5
      const maxR = Math.min(w, h) * 0.45
      const turns = 1.5
      const steps = 36
      const points: string[] = []
      for (let i = 0; i <= steps; i++) {
        const theta = (i / steps) * (turns * Math.PI * 2)
        const r = (i / steps) * maxR
        const x = cx + r * Math.cos(theta)
        const y = cy + r * Math.sin(theta)
        points.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(2)},${y.toFixed(2)}`)
      }
      return points.join(' ')
    }
    case 'banner': {
      // Flowing banner ribbon arch
      const yBase = h * 0.72
      const yPeak = h * 0.28
      return `M 0,${yBase.toFixed(2)} Q ${(w * 0.5).toFixed(2)},${yPeak.toFixed(2)} ${w.toFixed(2)},${yBase.toFixed(2)}`
    }
    case 'zigzag': {
      // Sharp dynamic zigzag waveform
      const segs = 6
      const points: string[] = [`M 0,${(h * 0.5).toFixed(2)}`]
      for (let i = 1; i <= segs; i++) {
        const x = (i / segs) * w
        const y = i % 2 === 1 ? h * 0.15 : h * 0.85
        points.push(`L ${x.toFixed(2)},${y.toFixed(2)}`)
      }
      return points.join(' ')
    }
    case 'wave':
    default: {
      // Smooth sinusoidal cubic wave
      const yMid = h * 0.5
      const amp = h * 0.35
      const cp1x = w * 0.16
      const cp1y = yMid - amp
      const cp2x = w * 0.34
      const cp2y = yMid - amp
      const midX = w * 0.5
      const cp3x = w * 0.66
      const cp3y = yMid + amp
      const cp4x = w * 0.84
      const cp4y = yMid + amp
      return `M 0,${yMid.toFixed(2)} C ${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${midX.toFixed(2)},${yMid.toFixed(2)} C ${cp3x.toFixed(2)},${cp3y.toFixed(2)} ${cp4x.toFixed(2)},${cp4y.toFixed(2)} ${w.toFixed(2)},${yMid.toFixed(2)}`
    }
  }
}

/** Reverse SVG path data direction with mathematically exact cubic contour inversion */
export function reversePathD(d: string): string {
  try {
    const contours = parsePath(d)
    if (!contours.length) return d
    const reversed = contours.map(contour => {
      // Keep the seam of a closed contour fixed when changing direction.
      const ordered = contour.closed ? [contour.anchors[0], ...contour.anchors.slice(1).reverse()] : contour.anchors.slice().reverse()
      const reversedAnchors = ordered.map(anchor => ({
        ...anchor,
        in: anchor.out ? { ...anchor.out } : undefined,
        out: anchor.in ? { ...anchor.in } : undefined,
      }))
      return {
        closed: contour.closed,
        anchors: reversedAnchors,
      }
    })
    return serializePath(reversed)
  } catch {
    // Fallback to original path if parsing fails
    return d
  }
}

/** Resolve on every geometry change; no DOM measurements or animation loop needed. */
export function resolveTextPathD(node: TextElement, elements?: Readonly<Record<string, SceneElement>>): string {
  const top = node.textOnPath
  let path = generatePathPreset(top?.preset ?? 'wave', node.width, node.height)
  const target = top?.pathId && elements ? elements[top.pathId] : undefined
  if (target && isVector(target) && elements) {
    try { path = linkedVectorPathD(node, target, elements) }
    catch { /* Keep text visible while the source path is being edited. */ }
  } else if (top?.preset === 'custom' && top.pathData?.trim()) {
    path = top.pathData
  }
  // Reversing the baseline implements the opposite side portably in SVG renderers.
  return Boolean(top?.reverse) !== (top?.side === 'right') ? reversePathD(path) : path
}

export function textAnchorForPath(align?: 'start' | 'center' | 'end' | 'justify', textAlign?: 'left' | 'center' | 'right'): 'start' | 'middle' | 'end' {
  const effective = align ?? (textAlign === 'center' ? 'center' : textAlign === 'right' ? 'end' : 'start')
  return effective === 'center' ? 'middle' : effective === 'justify' ? 'start' : effective
}

export function textPathOffset(node: TextElement): number {
  const anchor = textAnchorForPath(node.textOnPath?.align, node.textAlign)
  return node.textOnPath?.offset ?? (anchor === 'middle' ? 50 : anchor === 'end' ? 100 : 0)
}

/** One set of declarations for canvas, SVG and developer handoff. */
export function typographyCSS(node: TextElement): Record<string, string> {
  return Object.fromEntries(Object.entries(compileTypographyStyles(node))
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => [key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`), `${value}${key === 'fontSize' ? 'px' : ''}`]))
}

/** Embedded fonts use a generated family name so documents never depend on remote services. */
export function embeddedFontCSS(node: TextElement): string {
  if (!node.fontSource || !/^data:font\/(woff2?|ttf|otf);base64,[A-Za-z0-9+/=]+$/.test(node.fontSource)) return ''
  const family = node.fontFamily.replace(/[^a-zA-Z0-9_-]/g, '')
  return `@font-face{font-family:"${family}";src:url("${node.fontSource}");font-weight:1 1000;font-stretch:25% 200%;font-display:swap;}`
}

export {
  calculatePairwiseKerning,
  computeTextOpticalMetrics,
  type GlyphOpticalMetric,
  type LineOpticalMetrics,
  type TextOpticalMetrics,
} from './opticalMetrics.ts'

