import test from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import { SceneStore } from '../src/scene/store.ts'
import { parsePath } from '../src/scene/pathGeometry.ts'
import { getWorldMatrix } from '../src/scene/geometry.ts'
import {
  compileFontVariationSettings,
  compileFontFeatureSettings,
  compileTypographyStyles,
  exportVariableFontCSS,
  clampAxisValue,
  getAxisMeta,
  interpolateVariableAxes,
  PRIMARY_OPENTYPE_TAGS,
  OPENTYPE_RECIPES,
  computeTextOpticalMetrics,
  getOpticalBounds,
  calculatePairwiseKerning,
  resolveTextPathD,
  reversePathD,
  textAnchorForPath,
  textPathOffset,
} from '../src/scene/typography.ts'
import { sceneToSVG, exportBounds } from '../src/io/svg.ts'
import { buildCSSProps, buildReactComponent } from '../src/tokens/codegen.ts'
import { updateTextCurve } from '../src/scene/textPathEditing.ts'

const textScene = () => {
  const store = new SceneStore()
  store.add('text', { id: 'text', text: 'A < B & C', width: 360, height: 120 })
  return store
}
const getText = store => store.getSnapshot().elements.text
const world = (m, p) => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] })

test('axis settings retain precision and case-sensitive extended tags', () => {
  const value = compileFontVariationSettings({ wght: 620, wdth: 85, slnt: -12.5, opsz: 32, grad: 10, CASL: .5, "x'y;": 1 })
  assert.match(value, /'GRAD' 10/)
  assert.match(value, /'CASL' 0.5/)
  assert.match(value, /'slnt' -12.5/)
  assert.doesNotMatch(value, /x'y/)
  const node = { ...getText(textScene()), variableAxes: { wght: 620, opsz: 32 } }
  assert.equal(compileTypographyStyles(node).fontWeight, 620)
  assert.equal(compileTypographyStyles(node).fontOpticalSizing, 'none')
  assert.match(compileFontVariationSettings({ wght: 620.25, wdth: 85.75 }), /'wght' 620.25, 'wdth' 85.75/)
})

test('path alignment overrides paragraph alignment and has useful default offsets', () => {
  assert.equal(textAnchorForPath('start', 'center'), 'start')
  assert.equal(textAnchorForPath('end', 'center'), 'end')
  assert.equal(textPathOffset({ ...getText(textScene()), textOnPath: { enabled: true, align: 'center' } }), 50)
})

test('reversal swaps cubic controls and preserves the seam of closed curves', () => {
  const reversed = parsePath(reversePathD('M0 0 C10 20 30 40 50 60'))[0].anchors
  assert.deepEqual({ x: reversed[0].x, y: reversed[0].y }, { x: 50, y: 60 })
  assert.deepEqual(reversed[0].out, { x: 30, y: 40 })
  assert.deepEqual(reversed[1].in, { x: 10, y: 20 })
  const closed = parsePath(reversePathD('M0 0 L100 0 L100 100 Z'))[0]
  assert.equal(closed.closed, true)
  assert.deepEqual({ x: closed.anchors[0].x, y: closed.anchors[0].y }, { x: 0, y: 0 })
})

test('linked curves respect viewBox scaling, nested transforms, moves and edits', () => {
  const store = textScene()
  store.add('frame', { id: 'frame', x: 500, y: 220, width: 600, height: 400, rotation: 25 })
  store.add('path', { id: 'curve', parentId: 'frame', x: 30, y: 40, width: 300, height: 100, rotation: -15, viewBox: [10, 20, 100, 50], d: 'M10 20 C30 10 90 40 110 70' })
  store.update('text', 'text', { x: 120, y: 80, rotation: 30, textOnPath: { enabled: true, pathId: 'curve' } })
  const verify = () => {
    const state = store.getSnapshot(), start = parsePath(resolveTextPathD(getText(store), state.elements))[0].anchors[0]
    const actual = world(getWorldMatrix(state, 'text'), start)
    const expected = world(getWorldMatrix(state, 'curve'), { x: 0, y: 0 })
    assert.ok(Math.hypot(actual.x - expected.x, actual.y - expected.y) < .001)
  }
  verify()
  const before = resolveTextPathD(getText(store), store.getSnapshot().elements)
  store.update('frame', 'frame', { x: 600 })
  verify()
  assert.notEqual(resolveTextPathD(getText(store), store.getSnapshot().elements), before)
  store.update('curve', 'path', { d: 'M10 20 Q50 100 110 70' })
  assert.match(resolveTextPathD(getText(store), store.getSnapshot().elements), / C /)
})

test('presets override stale custom data; missing targets fall back safely', () => {
  const node = { ...getText(textScene()), textOnPath: { enabled: true, preset: 'arc', pathData: 'M0 0 L1 1', pathId: 'missing' } }
  assert.match(resolveTextPathD(node, {}), / Q /)
  node.textOnPath.preset = 'custom'
  assert.equal(resolveTextPathD(node, {}), 'M0 0 L1 1')
})

test('typography is immutable, undoable, persisted, and rejects malformed paths atomically', () => {
  const store = textScene(), axes = { wght: 700, wdth: 80 }, path = { enabled: true, preset: 'wave' }
  store.update('text', 'text', { variableAxes: axes, textOnPath: path })
  axes.wght = 200
  path.enabled = false
  assert.equal(getText(store).variableAxes.wght, 700)
  assert.equal(getText(store).textOnPath.enabled, true)
  const restored = new SceneStore()
  restored.load(JSON.parse(JSON.stringify(store.toJSON())))
  assert.deepEqual(getText(restored), getText(store))
  store.undo()
  assert.equal(getText(store).variableAxes, undefined)
  store.redo()
  assert.equal(getText(store).variableAxes.wght, 700)
  const before = store.getSnapshot()
  assert.throws(() => store.update('text', 'text', { textOnPath: { enabled: true, preset: 'custom', pathData: 'bad path' } }))
  assert.equal(store.getSnapshot(), before)
})

test('SVG and JSX preserve paths, typography, escaping and unique IDs', () => {
  const store = textScene()
  store.update('text', 'text', { variableAxes: { wght: 650, wdth: 80 }, textOnPath: { enabled: true, preset: 'wave', align: 'center', spacing: 2 } })
  store.add('text', { id: 'other', textOnPath: { enabled: true, preset: 'arc' } })
  store.select(['text', 'other'])
  const svg = sceneToSVG(store.getSnapshot(), { scope: 'selection', scale: 1, background: 'transparent' })
  assert.equal((svg.match(/<textPath /g) ?? []).length, 2)
  assert.match(svg, /A &lt; B &amp; C/)
  assert.match(svg, /startOffset="50%"/)
  assert.match(svg, /font-variation-settings/)
  const ids = [...svg.matchAll(/<path id="([^"]+)"/g)].map(match => match[1])
  assert.equal(new Set(ids).size, 2)
  assert.ok(buildCSSProps(getText(store)).some(prop => prop.property === 'font-variation-settings' && prop.value.includes('650')))
  const code = buildReactComponent(getText(store), [], undefined, store.getSnapshot().elements)
  assert.match(code, /useId\(\)/)
  assert.match(code, /<textPath/)
  assert.deepEqual(ts.createSourceFile('Text.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX).parseDiagnostics, [])
})

test('exporting linked text includes the curve outside its original text box', () => {
  const store = textScene()
  store.add('path', { id: 'far', x: 1000, width: 300, height: 100, d: 'M0 0 L300 100', viewBox: [0, 0, 300, 100] })
  store.update('text', 'text', { textOnPath: { enabled: true, pathId: 'far' } })
  store.select(['text'])
  const bounds = exportBounds(store.getSnapshot(), 'selection')
  assert.ok(bounds.x + bounds.width > 1300)
})

test('editing variable axes releases an inherited typography preset', () => {
  const store = textScene()
  const node = getText(store)
  const preset = store.addSharedStyle({ name: 'Variable headline', kind: 'typography', value: { fontFamily: node.fontFamily, fontSize: node.fontSize, fontWeight: node.fontWeight, lineHeight: node.lineHeight, letterSpacing: node.letterSpacing, textAlign: node.textAlign, variableAxes: { wdth: 80 } } })
  store.bindSharedStyle('text', 'typography', preset.id)
  store.update('text', 'text', { variableAxes: { wdth: 120 } })
  assert.equal(getText(store).variableAxes.wdth, 120)
  assert.equal(getText(store).sharedStyleBindings?.typography, undefined)
})

test('malformed linked geometry uses the preset while a path edit is incomplete', () => {
  const store = textScene()
  store.add('path', { id: 'draft', d: 'M0 0 C' })
  store.update('text', 'text', { textOnPath: { enabled: true, pathId: 'draft', preset: 'arc' } })
  assert.match(resolveTextPathD(getText(store), store.getSnapshot().elements), / Q /)
})

test('direct deformation becomes a custom curve, retains flow options, and undoes as one gesture', () => {
  const store = textScene()
  store.update('text', 'text', { textOnPath: { enabled: true, preset: 'arc', offset: 50, align: 'center', reverse: true, spacing: 2 } })
  const before = getText(store), count = store.getHistorySnapshot().undoCount
  store.beginTransaction('Deform text curve')
  updateTextCurve(store, 'text', 'M0 30 C60 0 160 90 240 30')
  updateTextCurve(store, 'text', 'M0 30 C60 10 160 90 240 30')
  store.endTransaction()
  assert.equal(store.getHistorySnapshot().undoCount, count + 1)
  assert.deepEqual(getText(store).textOnPath, { ...before.textOnPath, preset: 'custom', pathId: null, pathData: 'M0 30 C60 10 160 90 240 30' })
  store.undo()
  assert.deepEqual(getText(store), before)
  store.redo()
  assert.equal(getText(store).textOnPath.preset, 'custom')
  const committed = getText(store)
  store.beginTransaction('Deform text curve')
  updateTextCurve(store, 'text', 'M0 30 L240 30')
  store.cancelTransaction()
  assert.deepEqual(getText(store), committed)
})

test('editing a linked baseline preserves placement and updates all followers, respecting locks', () => {
  const store = textScene()
  store.add('frame', { id: 'frame', x: 400, y: 120, rotation: 15 })
  store.add('path', { id: 'curve', parentId: 'frame', x: 20, y: 40, width: 300, height: 100, rotation: -20, viewBox: [0, 0, 300, 100], d: 'M0 30 L240 30' })
  store.update('text', 'text', { textOnPath: { enabled: true, pathId: 'curve' } })
  store.add('text', { id: 'follower', textOnPath: { enabled: true, pathId: 'curve' } })
  const original = store.getSnapshot().elements.curve
  const before = resolveTextPathD(getText(store), store.getSnapshot().elements)
  const followerBefore = resolveTextPathD(store.getSnapshot().elements.follower, store.getSnapshot().elements)
  assert.equal(updateTextCurve(store, 'text', 'M0 30 C60 10 160 90 240 30'), true)
  const state = store.getSnapshot()
  assert.deepEqual(state.elements.curve, { ...original, d: 'M0 30 C60 10 160 90 240 30' })
  assert.notEqual(resolveTextPathD(getText(store), state.elements), before)
  assert.notEqual(resolveTextPathD(state.elements.follower, state.elements), followerBefore)
  assert.equal(getText(store).textOnPath.pathId, 'curve')
  store.setLocked('frame', true)
  const locked = store.getSnapshot()
  assert.equal(updateTextCurve(store, 'text', 'M0 0 L100 100'), false)
  assert.equal(store.getSnapshot(), locked)
  assert.equal(updateTextCurve(store, 'missing', 'M0 0 L100 100'), false)
})

test('variable font axis sliders (wght, wdth, slnt, opsz) compile, clamp, interpolate and export', () => {
  // Clamping
  assert.equal(clampAxisValue('wght', 1500), 1000)
  assert.equal(clampAxisValue('wght', -10), 1)
  assert.equal(clampAxisValue('wdth', 300), 200)
  assert.equal(clampAxisValue('wdth', 5), 25)
  assert.equal(clampAxisValue('slnt', -120), -90)
  assert.equal(clampAxisValue('slnt', 120), 90)
  assert.equal(clampAxisValue('opsz', 200), 144)
  assert.equal(clampAxisValue('opsz', 2), 6)

  // Meta lookup
  const wghtMeta = getAxisMeta('wght')
  assert.equal(wghtMeta.tag, 'wght')
  assert.equal(wghtMeta.min, 1)
  assert.equal(wghtMeta.max, 1000)

  const customMeta = getAxisMeta('ABCD')
  assert.equal(customMeta.tag, 'ABCD')
  assert.equal(customMeta.min, 0)
  assert.equal(customMeta.max, 1000)

  // Interpolation
  const fromAxes = { wght: 300, wdth: 80, slnt: 0, opsz: 14 }
  const toAxes = { wght: 700, wdth: 120, slnt: -10, opsz: 32 }
  const midAxes = interpolateVariableAxes(fromAxes, toAxes, 0.5)
  assert.equal(midAxes.wght, 500)
  assert.equal(midAxes.wdth, 100)
  assert.equal(midAxes.slnt, -5)
  assert.equal(midAxes.opsz, 23)

  // Typography styles compilation
  const store = textScene()
  const baseNode = getText(store)
  const node = {
    ...baseNode,
    fontWeight: 600,
    variableAxes: { wght: 650, wdth: 125, slnt: -14, opsz: 28 },
    openTypeFeatures: { liga: true, calt: true },
  }
  const styles = compileTypographyStyles(node)
  assert.equal(styles.fontWeight, 650)
  assert.equal(styles.fontStretch, '125%')
  assert.equal(styles.fontStyle, 'oblique -14deg')
  assert.equal(styles.fontOpticalSizing, 'none')
  assert.match(styles.fontVariationSettings, /'wght' 650/)
  assert.match(styles.fontVariationSettings, /'wdth' 125/)
  assert.match(styles.fontVariationSettings, /'slnt' -14/)
  assert.match(styles.fontVariationSettings, /'opsz' 28/)

  // Export to CSS
  const css = exportVariableFontCSS(node, { format: 'css' })
  assert.match(css, /font-variation-settings: 'wght' 650, 'wdth' 125, 'slnt' -14, 'opsz' 28/)
  assert.match(css, /font-stretch: 125%/)
  assert.match(css, /font-style: oblique -14deg/)
  assert.match(css, /font-feature-settings: "liga" 1, "calt" 1/)

  // Export to React
  const reactCode = exportVariableFontCSS(node, { format: 'react' })
  assert.match(reactCode, /"fontStretch": "125%"/)
  assert.match(reactCode, /"fontStyle": "oblique -14deg"/)
  assert.match(reactCode, /"fontFeatureSettings": "\\"liga\\" 1, \\"calt\\" 1"/)
})

test('OpenType feature flag toggles (liga, calt, frac, tnum) generate valid CSS and recipes', () => {
  // Primary features list
  assert.deepEqual(PRIMARY_OPENTYPE_TAGS, ['liga', 'calt', 'frac', 'tnum'])

  // Feature settings compilation
  const allOn = compileFontFeatureSettings({ liga: true, calt: true, frac: true, tnum: true })
  assert.match(allOn, /"liga" 1/)
  assert.match(allOn, /"calt" 1/)
  assert.match(allOn, /"frac" 1/)
  assert.match(allOn, /"tnum" 1/)

  const disabled = compileFontFeatureSettings({ liga: false, calt: false })
  assert.match(disabled, /"liga" 0/)
  assert.match(disabled, /"calt" 0/)

  // Filtering invalid tags
  const sanitized = compileFontFeatureSettings({ liga: true, 'invalid-tag-length': true, '123;drop': true })
  assert.equal(sanitized, '"liga" 1')

  // CSS variant mapping
  const store = textScene()
  const baseNode = getText(store)
  const node = {
    ...baseNode,
    openTypeFeatures: { liga: true, calt: true, frac: true, tnum: true },
  }
  const styles = compileTypographyStyles(node)
  assert.match(styles.fontVariantNumeric, /tabular-nums/)
  assert.match(styles.fontVariantNumeric, /diagonal-fractions/)
  assert.match(styles.fontVariantLigatures, /common-ligatures/)
  assert.match(styles.fontVariantLigatures, /contextual/)

  // OpenType Recipes verification
  const tabularRecipe = OPENTYPE_RECIPES.find(r => r.id === 'tabular-data')
  assert.ok(tabularRecipe)
  assert.equal(tabularRecipe.features.tnum, true)
  assert.equal(tabularRecipe.features.frac, true)
  assert.equal(tabularRecipe.features.zero, true)

  const defaultRecipe = OPENTYPE_RECIPES.find(r => r.id === 'default')
  assert.ok(defaultRecipe)
  assert.equal(defaultRecipe.features.liga, true)
  assert.equal(defaultRecipe.features.calt, true)
})

test('glyph-level optical metrics calculate bounds, alignment offsets, tabular digits and pairwise kerning', () => {
  const store = textScene()
  const baseNode = getText(store)

  // Standard metrics
  const textElement = {
    ...baseNode,
    text: 'AV 1234',
    width: 400,
    fontSize: 24,
    lineHeight: 1.5,
    variableAxes: { wght: 500, wdth: 100, slnt: -10, opsz: 24 },
    openTypeFeatures: { tnum: true },
    fontKerning: 'optical',
    opticalKerning: 10,
    textAlign: 'left',
  }
  const metrics = computeTextOpticalMetrics(textElement)
  assert.equal(metrics.lineCount, 1)
  assert.equal(metrics.characterCount, 7)
  assert.equal(metrics.slantAngle, -10)
  assert.equal(metrics.opticalSize, 24)
  assert.ok(metrics.capHeight > 0)
  assert.ok(metrics.xHeight > 0)
  assert.ok(metrics.baseline > 0)
  assert.ok(metrics.descent > 0)

  // Pairwise kerning detected for 'AV'
  assert.ok(metrics.kerningPairCount >= 1)
  const avKerning = calculatePairwiseKerning('A', 'V', 10, 24)
  assert.ok(avKerning < 0, 'AV pair should have negative kerning delta')

  // Text alignment offsets: left vs center vs right
  const leftMetrics = computeTextOpticalMetrics({ ...textElement, textAlign: 'left' })
  assert.equal(leftMetrics.lines[0].lineOffset, 0)
  assert.equal(leftMetrics.lines[0].glyphs[0].x, 0)

  const centerMetrics = computeTextOpticalMetrics({ ...textElement, textAlign: 'center' })
  const expectedCenterOffset = Math.max(0, (400 - centerMetrics.lines[0].width) / 2)
  assert.equal(centerMetrics.lines[0].lineOffset, Number(expectedCenterOffset.toFixed(2)))
  assert.equal(centerMetrics.lines[0].glyphs[0].x, Number(expectedCenterOffset.toFixed(2)))

  const rightMetrics = computeTextOpticalMetrics({ ...textElement, textAlign: 'right' })
  const expectedRightOffset = Math.max(0, 400 - rightMetrics.lines[0].width)
  assert.equal(rightMetrics.lines[0].lineOffset, Number(expectedRightOffset.toFixed(2)))
  assert.equal(rightMetrics.lines[0].glyphs[0].x, Number(expectedRightOffset.toFixed(2)))

  // Optical bounds
  const bounds = getOpticalBounds(leftMetrics)
  assert.ok(bounds.width > 0)
  assert.ok(bounds.height > 0)
  assert.ok(bounds.y >= 0)
})

test('store updates, history, undo/redo, and serialization preserve variable axes, OpenType features, and optical metrics', () => {
  const store = textScene()
  const axes = { wght: 750, wdth: 120, slnt: -8, opsz: 36 }
  const features = { liga: true, calt: true, frac: true, tnum: true }

  store.update('text', 'text', {
    variableAxes: axes,
    openTypeFeatures: features,
    showOpticalMetrics: true,
    opticalMarginAlignment: true,
  })

  const state1 = store.getSnapshot().elements.text
  assert.deepEqual(state1.variableAxes, axes)
  assert.deepEqual(state1.openTypeFeatures, features)
  assert.equal(state1.showOpticalMetrics, true)
  assert.equal(state1.opticalMarginAlignment, true)

  // Verify immutability: mutating local object does not mutate store state
  axes.wght = 100
  features.liga = false
  assert.equal(store.getSnapshot().elements.text.variableAxes.wght, 750)
  assert.equal(store.getSnapshot().elements.text.openTypeFeatures.liga, true)

  // Serialization roundtrip
  const restored = new SceneStore()
  restored.load(JSON.parse(JSON.stringify(store.toJSON())))
  const restoredText = restored.getSnapshot().elements.text
  assert.deepEqual(restoredText.variableAxes, { wght: 750, wdth: 120, slnt: -8, opsz: 36 })
  assert.deepEqual(restoredText.openTypeFeatures, { liga: true, calt: true, frac: true, tnum: true })
  assert.equal(restoredText.showOpticalMetrics, true)
  assert.equal(restoredText.opticalMarginAlignment, true)

  // Undo / Redo
  store.undo()
  assert.equal(store.getSnapshot().elements.text.variableAxes, undefined)
  assert.equal(store.getSnapshot().elements.text.showOpticalMetrics, undefined)

  store.redo()
  assert.equal(store.getSnapshot().elements.text.variableAxes.wght, 750)
  assert.equal(store.getSnapshot().elements.text.showOpticalMetrics, true)

  // Rejection of invalid variable axes and features
  assert.throws(() => store.update('text', 'text', { variableAxes: { bad_tag_length: 500 } }))
  assert.throws(() => store.update('text', 'text', { openTypeFeatures: { 'too_long': true } }))
  assert.throws(() => store.update('text', 'text', { showOpticalMetrics: 'not_a_bool' }))
})
