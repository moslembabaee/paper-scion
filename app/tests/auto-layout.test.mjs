import test from 'node:test'
import assert from 'node:assert/strict'
import { SceneStore } from '../src/scene/store.ts'
import { DEFAULT_AUTO_LAYOUT, reflowAutoLayout } from '../src/scene/autoLayout.ts'
import { buildCSSProps, buildTailwindClasses, buildReactComponent } from '../src/tokens/codegen.ts'
import { elementSchema, validateSchema, patchSchema } from '../src/mcp/schema.ts'
import { sceneToSVG } from '../src/io/svg.ts'
import { createProject } from '../src/io/project.ts'
import { mutateCanvas } from '../src/mcp/operations.ts'
import { adjustSpacing, dragSpacing, layoutGapBands, layoutHandles, layoutPaddingBands } from '../src/scene/layoutHandles.ts'
import { createAutoLayoutSelection, groupSelection, removeAutoLayoutSelection, ungroupSelection } from '../src/scene/arrange.ts'

const layout = (patch = {}) => ({ ...DEFAULT_AUTO_LAYOUT, padding: { top: 10, right: 20, bottom: 30, left: 40 }, gap: 12, ...patch })
const sizing = (width = 'fixed', height = 'fixed') => ({ width, height })
const node = (store, id) => store.getSnapshot().elements[id]
function scene(direction = 'horizontal') {
  const store = new SceneStore()
  store.add('frame', { id: 'frame', width: 400, height: 240, layout: layout({ direction }) })
  store.add('rectangle', { id: 'a', parentId: 'frame', width: 60, height: 40 })
  store.add('rectangle', { id: 'b', parentId: 'frame', width: 80, height: 60 })
  return store
}
const geometry = n => [n.x, n.y, n.width, n.height]

test('weighted fills redistribute capped space and preserve minima when space is exhausted', () => {
  const store = scene()
  store.update('a', 'rectangle', { sizing: { ...sizing('fill'), flexGrow: 1 } })
  store.update('b', 'rectangle', { sizing: { ...sizing('fill'), flexGrow: 2 } })
  assert.ok(Math.abs(node(store, 'b').width - 2 * node(store, 'a').width) < 1e-9)
  assert.equal(node(store, 'a').width + node(store, 'b').width, 328)
  store.update('a', 'rectangle', { sizing: { ...sizing('fill'), maxWidth: 100 } })
  assert.equal(node(store, 'a').width, 100)
  assert.equal(node(store, 'b').width, 228)
  store.update('a', 'rectangle', { sizing: { ...sizing('fill'), minWidth: 240 } })
  store.update('b', 'rectangle', { sizing: { ...sizing('fill'), maxWidth: 100 } })
  assert.equal(node(store, 'a').width, 240)
  assert.equal(node(store, 'b').width, 88)
  store.update('b', 'rectangle', { sizing: { ...sizing('fill'), minWidth: 100 } })
  store.update('frame', 'frame', { width: 200 })
  assert.equal(node(store, 'a').width, 240)
  assert.equal(node(store, 'b').width, 100)
  assert.equal(node(store, 'b').x, 292)
  const snapshot = store.getSnapshot()
  assert.equal(reflowAutoLayout(snapshot.elements, snapshot.rootIds), snapshot.elements)
})

test('vertical weighted fills and bounded cross-axis fills align within the content box', () => {
  const store = scene('vertical')
  store.update('frame', 'frame', { layout: layout({ direction: 'vertical', align: 'end' }) })
  store.update('a', 'rectangle', { sizing: { ...sizing('fill', 'fill'), maxWidth: 120, flexGrow: 3 } })
  store.update('b', 'rectangle', { sizing: { ...sizing('fill', 'fill'), flexGrow: 1 } })
  assert.deepEqual(geometry(node(store, 'a')), [260, 10, 120, 141])
  assert.deepEqual(geometry(node(store, 'b')), [40, 163, 340, 47])
  store.update('a', 'rectangle', { sizing: { ...sizing('fill', 'fill'), maxHeight: 100, maxWidth: 120, flexGrow: 3 } })
  assert.equal(node(store, 'b').height, 88)
  store.update('frame', 'frame', { height: 340 })
  assert.equal(node(store, 'a').height, 100)
  assert.equal(node(store, 'b').height, 188)
})

test('wrapped fill minima form lines and weighted shares stay local to each line', () => {
  const store = new SceneStore()
  store.add('frame', { id: 'row', width: 300, sizing: sizing('fixed', 'hug'), layout: layout({ wrap: 'wrap', padding: { top: 0, right: 0, bottom: 0, left: 0 } }) })
  store.add('rectangle', { id: 'a', parentId: 'row', height: 30, sizing: { ...sizing('fill'), minWidth: 100, flexGrow: 1 } })
  store.add('rectangle', { id: 'b', parentId: 'row', height: 40, sizing: { ...sizing('fill'), minWidth: 100, flexGrow: 2 } })
  store.add('rectangle', { id: 'c', parentId: 'row', height: 50, sizing: { ...sizing('fill'), minWidth: 100 } })
  assert.deepEqual(geometry(node(store, 'a')), [0, 0, 100, 30])
  assert.deepEqual(geometry(node(store, 'b')), [112, 0, 188, 40])
  assert.deepEqual(geometry(node(store, 'c')), [0, 52, 300, 50])
  assert.equal(node(store, 'row').height, 102)
  store.update('row', 'frame', { width: 200 })
  assert.equal(node(store, 'b').y, 42)
  assert.equal(node(store, 'c').y, 94)
  assert.equal(node(store, 'row').height, 144)
})

test('bounded nested frames remeasure hug text before recursive parent reflow', () => {
  const store = new SceneStore()
  const zero = { top: 0, right: 0, bottom: 0, left: 0 }
  store.add('frame', { id: 'outer', width: 400, sizing: sizing('fixed', 'hug'), layout: layout({ direction: 'vertical', padding: zero }) })
  store.add('frame', { id: 'inner', parentId: 'outer', sizing: { ...sizing('fill', 'hug'), maxWidth: 160 }, layout: layout({ direction: 'vertical', padding: zero }) })
  store.add('text', { id: 'text', parentId: 'inner', fontSize: 20, lineHeight: 1.5, letterSpacing: 0, text: 'Words that flow across a responsive frame.', sizing: sizing('fill', 'hug') })
  assert.equal(node(store, 'text').width, 160)
  assert.equal(node(store, 'outer').height, node(store, 'text').height)
  const height = node(store, 'text').height
  store.update('outer', 'frame', { width: 100 })
  assert.equal(node(store, 'text').width, 100)
  assert.ok(node(store, 'text').height > height)
  assert.equal(node(store, 'outer').height, node(store, 'text').height)
  const snapshot = store.getSnapshot()
  assert.equal(reflowAutoLayout(snapshot.elements, snapshot.rootIds), snapshot.elements)
  store.update('text', 'text', { sizing: { ...sizing('hug', 'hug'), maxWidth: 80 } })
  assert.equal(node(store, 'text').width, 80)
  assert.equal(node(store, 'outer').height, node(store, 'text').height)
})

test('hug bounds wrap lines and minimum frame dimensions participate in alignment', () => {
  const store = scene()
  store.update('frame', 'frame', { sizing: { ...sizing('hug', 'hug'), maxWidth: 180, minHeight: 200 }, layout: layout({ wrap: 'wrap', alignContent: 'end' }) })
  assert.equal(node(store, 'frame').width, 180)
  assert.equal(node(store, 'frame').height, 200)
  assert.equal(node(store, 'a').y, 58)
  assert.equal(node(store, 'b').y, 110)
  const snapshot = store.getSnapshot()
  assert.equal(reflowAutoLayout(snapshot.elements, snapshot.rootIds), snapshot.elements)
})

test('size constraints validate atomically, persist through history and export responsive handoff', () => {
  const store = scene()
  const before = store.getSnapshot()
  for (const constraints of [{ flexGrow: 0 }, { flexGrow: -1 }, { flexGrow: Infinity }, { minWidth: -1 }, { maxHeight: 0 }, { minWidth: 200, maxWidth: 100 }, { minHeight: NaN }]) {
    assert.throws(() => store.update('a', 'rectangle', { sizing: { ...sizing('fill'), ...constraints } }), /Invalid/)
    assert.equal(store.getSnapshot(), before)
  }
  for (const constraints of [{ flexGrow: 0 }, { minHeight: -1 }, { maxWidth: 0 }]) assert.throws(() => validateSchema({ sizing: { ...sizing('fill'), ...constraints } }, patchSchema('rectangle')))
  const constraints = { ...sizing('fill', 'fill'), flexGrow: 2, minWidth: 80, maxWidth: 180, minHeight: 40, maxHeight: 120 }
  store.update('a', 'rectangle', { sizing: constraints })
  const after = store.toJSON()
  store.undo()
  assert.equal(store.getSnapshot(), before)
  store.redo()
  assert.deepEqual(store.toJSON(), after)
  const restored = new SceneStore()
  restored.load(JSON.parse(JSON.stringify(after)))
  assert.deepEqual(restored.toJSON(), after)
  validateSchema(node(store, 'a'), elementSchema)
  assert.ok(Object.isFrozen(node(store, 'a').sizing))
  const css = Object.fromEntries(buildCSSProps(node(store, 'a'), [], node(store, 'frame')).map(p => [p.property, p.value]))
  assert.equal(css.flex, '2 1 0px')
  assert.equal(css['min-width'], '80px')
  assert.equal(css['max-width'], '180px')
  assert.equal(css['min-height'], '40px')
  assert.equal(css['max-height'], '120px')
  const react = buildReactComponent(node(store, 'a'), [], node(store, 'frame'))
  assert.match(react, /flex-\[2_1_0px\]/)
  assert.match(react, /min-w-\[80px\]/)
  assert.match(react, /max-h-\[120px\]/)
})

test('very large finite flex weights share space without overflowing their sum', () => {
  const store = scene()
  store.update('a', 'rectangle', { sizing: { ...sizing('fill'), flexGrow: 1e308 } })
  store.update('b', 'rectangle', { sizing: { ...sizing('fill'), flexGrow: 1e308 } })
  assert.equal(node(store, 'a').width, 164)
  assert.equal(node(store, 'b').width, 164)
})

test('reflow shares immutable non-geometry data and keeps unchanged records intact', () => {
  const store = scene()
  store.update('a', 'rectangle', { sizing: sizing('fill') })
  const a = node(store, 'a'), b = node(store, 'b'), frame = node(store, 'frame')
  store.update('frame', 'frame', { width: 600 })
  assert.equal(node(store, 'a').style, a.style)
  assert.equal(node(store, 'a').sizing, a.sizing)
  assert.equal(node(store, 'b').style, b.style)
  assert.equal(node(store, 'a').parentId, a.parentId)
  assert.ok(Object.isFrozen(node(store, 'a')))
  const snapshot = store.getSnapshot()
  const plain = Object.fromEntries(Object.entries(snapshot.elements).map(([id, n]) => [id, { ...n, style: { ...n.style }, sizing: n.sizing ? { ...n.sizing } : undefined }]))
  plain.frame.width = frame.width
  const reflowed = reflowAutoLayout(plain, snapshot.rootIds)
  assert.ok(Object.isFrozen(reflowed.a.style))
  assert.ok(Object.isFrozen(reflowed.a.sizing))
  assert.equal(plain.a.width, node(store, 'a').width)
})

test('horizontal and vertical flow respect all four independent padding values', () => {
  const row = scene()
  assert.deepEqual(geometry(node(row, 'a')), [40, 10, 60, 40])
  assert.deepEqual(geometry(node(row, 'b')), [112, 10, 80, 60])
  const column = scene('vertical')
  assert.deepEqual(geometry(node(column, 'a')), [40, 10, 60, 40])
  assert.deepEqual(geometry(node(column, 'b')), [40, 62, 80, 60])
  column.update('frame', 'frame', { layout: layout({ direction: 'horizontal', gap: 0 }) })
  assert.equal(node(column, 'b').x, 100)
})

test('main alignment uses remaining space, and space-between retains a minimum gap', () => {
  const store = scene()
  for (const [justify, x1, x2] of [['start', 40, 112], ['center', 134, 206], ['end', 228, 300], ['space-between', 40, 300]]) {
    store.update('frame', 'frame', { layout: layout({ justify, align: 'end' }) })
    assert.equal(node(store, 'a').x, x1)
    assert.equal(node(store, 'b').x, x2)
    assert.equal(node(store, 'a').y, 170)
    assert.equal(node(store, 'b').y, 150)
  }
  store.update('frame', 'frame', { width: 150, layout: layout({ justify: 'space-between', align: 'center' }) })
  assert.equal(node(store, 'b').x, 112)
  assert.equal(node(store, 'a').y, 90)
  store.remove('b')
  assert.equal(node(store, 'a').x, 40)
})

test('fill siblings share available space and respond to parent resizing on both axes', () => {
  const store = scene()
  store.update('a', 'rectangle', { sizing: sizing('fill', 'fill') })
  store.update('b', 'rectangle', { sizing: sizing('fill', 'fixed') })
  assert.deepEqual(geometry(node(store, 'a')), [40, 10, 164, 200])
  assert.deepEqual(geometry(node(store, 'b')), [216, 10, 164, 60])
  store.update('frame', 'frame', { width: 600 })
  assert.equal(node(store, 'a').width, 264)
  store.update('frame', 'frame', { layout: layout({ direction: 'vertical' }) })
  assert.deepEqual(geometry(node(store, 'a')), [40, 10, 540, 128])
  assert.deepEqual(geometry(node(store, 'b')), [40, 150, 540, 60])
  store.update('b', 'rectangle', { sizing: sizing('fill', 'fill') })
  assert.equal(node(store, 'a').height, 94)
  assert.equal(node(store, 'b').height, 94)
})

test('hug wraps visible content, empty padding, and nested frames without iterative growth', () => {
  const store = scene()
  store.update('frame', 'frame', { sizing: sizing('hug', 'hug') })
  assert.deepEqual([node(store, 'frame').width, node(store, 'frame').height], [212, 100])
  store.add('frame', { id: 'outer', layout: layout({ direction: 'vertical' }), sizing: sizing('hug', 'hug') })
  store.reparent('frame', 'outer')
  assert.deepEqual([node(store, 'outer').width, node(store, 'outer').height], [272, 140])
  store.update('a', 'rectangle', { sizing: sizing('fill', 'fill') })
  const snapshot = store.getSnapshot()
  assert.equal(reflowAutoLayout(snapshot.elements, snapshot.rootIds), snapshot.elements)
  store.setVisible('b', false)
  assert.equal(node(store, 'frame').width, 120)
  assert.equal(node(store, 'outer').width, 180)
  assert.equal(node(store, 'b').width, 80)
  store.remove('a')
  assert.deepEqual([node(store, 'frame').width, node(store, 'frame').height], [60, 40])
})

test('nested fill width and hug height remeasure text when the frame narrows or content changes', () => {
  const store = new SceneStore()
  store.add('frame', { id: 'outer', width: 300, sizing: sizing('fixed', 'hug'), layout: layout({ direction: 'vertical', padding: { top: 0, right: 0, bottom: 0, left: 0 } }) })
  store.add('frame', { id: 'inner', parentId: 'outer', sizing: sizing('fill', 'hug'), layout: layout({ direction: 'vertical', padding: { top: 10, right: 10, bottom: 10, left: 10 } }) })
  store.add('text', { id: 'text', parentId: 'inner', fontSize: 20, letterSpacing: 0, lineHeight: 1.5, text: 'Words that flow across a responsive frame.', sizing: sizing('fill', 'hug') })
  const height = node(store, 'outer').height
  store.update('outer', 'frame', { width: 150 })
  assert.equal(node(store, 'inner').width, 150)
  assert.equal(node(store, 'text').width, 130)
  assert.ok(node(store, 'outer').height > height)
  assert.equal(node(store, 'outer').height, node(store, 'text').height + 20)
  store.update('text', 'text', { text: 'Hi' })
  assert.equal(node(store, 'text').height, 30)
  assert.equal(node(store, 'outer').height, 50)
  store.update('text', 'text', { sizing: sizing('hug', 'hug'), text: 'Hi\nThere' })
  assert.equal(node(store, 'text').width, 60)
  assert.equal(node(store, 'text').height, 60)
})

test('reorder, reparent, visibility, deletion, tokens, and locked siblings all reflow atomically', () => {
  const store = scene()
  store.clearHistory()
  let calls = 0
  store.subscribe(() => calls++)
  store.setLocked('b', true)
  store.update('a', 'rectangle', { width: 120 })
  assert.equal(node(store, 'b').x, 172)
  assert.equal(calls, 2)
  store.undo()
  assert.equal(node(store, 'b').x, 112)
  store.redo()
  assert.equal(node(store, 'b').x, 172)
  store.setLocked('b', false)
  store.reorder('b', 0)
  assert.equal(node(store, 'b').x, 40)
  assert.equal(node(store, 'a').x, 132)
  store.setVisible('b', false)
  assert.equal(node(store, 'a').x, 40)
  store.reparent('a', null)
  store.reparent('a', 'frame')
  const token = store.addToken({ type: 'container', name: 'card', value: 60 })
  store.bindToken('a', 'width', token.id)
  store.setVisible('b', true)
  store.updateToken(token.id, { value: 100 })
  assert.equal(node(store, 'a').width, 100)
  store.remove('b')
  assert.equal(node(store, 'a').x, 40)
})

test('layout settings and resulting geometry survive undo/redo, gestures, JSON and MCP validation', () => {
  const store = scene()
  const before = store.toJSON()
  store.beginTransaction('Adjust spacing')
  for (const gap of [20, 30, 40]) store.update('frame', 'frame', { layout: layout({ gap }) })
  store.endTransaction()
  const after = store.toJSON()
  store.undo()
  assert.deepEqual(store.toJSON(), before)
  store.redo()
  assert.deepEqual(store.toJSON(), after)
  store.beginTransaction('Spacing')
  store.update('frame', 'frame', { layout: layout({ gap: 50 }) })
  store.cancelTransaction()
  assert.deepEqual(store.toJSON(), after)
  const restored = new SceneStore()
  restored.load(JSON.parse(JSON.stringify(after)))
  assert.deepEqual(restored.toJSON(), after)
  validateSchema(node(store, 'frame'), elementSchema)
  validateSchema({ layout: layout(), sizing: sizing('hug', 'fill') }, patchSchema('frame'))
  assert.ok(Object.isFrozen(node(store, 'frame').layout.padding))
  const legacy = new SceneStore()
  legacy.add('frame', { id: 'legacy' })
  validateSchema(node(legacy, 'legacy'), elementSchema)
})

test('invalid layout or sizing inputs reject atomically; exhausted fills remain finite', () => {
  const store = scene()
  const before = store.getSnapshot()
  for (const patch of [{ layout: layout({ gap: -1 }) }, { layout: layout({ direction: 'diagonal' }) }, { layout: layout({ justify: 'stretch' }) }, { layout: layout({ align: 'space-between' }) }, { layout: layout({ padding: { top: 0 } }) }, { layout: layout({ padding: { top: NaN, right: 0, bottom: 0, left: 0 } }) }, { sizing: sizing('bad') }, { sizing: null }]) {
    assert.throws(() => store.update('frame', 'frame', patch), /Invalid/)
    assert.equal(store.getSnapshot(), before)
  }
  store.update('frame', 'frame', { width: 70 })
  store.update('a', 'rectangle', { sizing: sizing('fill', 'fixed') })
  assert.equal(node(store, 'a').width, .01)
  assert.ok(Number.isFinite(node(store, 'b').x))
})

test('explicit resizing converts the resized axis to fixed, and removing layout retains positions', () => {
  const store = scene()
  store.update('a', 'rectangle', { sizing: sizing('fill', 'fill') })
  store.update('a', 'rectangle', { width: 150 })
  assert.deepEqual(node(store, 'a').sizing, sizing('fixed', 'fill'))
  const b = node(store, 'b')
  store.update('frame', 'frame', { layout: null })
  store.update('a', 'rectangle', { width: 180 })
  assert.equal(node(store, 'b'), b)
})

test('handoff generates flex settings, relative children, hug and fill rules; SVG uses resolved geometry', () => {
  const store = scene()
  store.update('frame', 'frame', { layout: layout({ justify: 'space-between', align: 'center' }) })
  store.update('a', 'rectangle', { sizing: sizing('fill', 'fill') })
  const frame = node(store, 'frame'), child = node(store, 'a')
  const css = Object.fromEntries(buildCSSProps(frame).map(p => [p.property, p.value]))
  assert.equal(css.display, 'flex')
  assert.equal(css.padding, '10px 20px 30px 40px')
  assert.equal(css['justify-content'], 'space-between')
  const childCSS = Object.fromEntries(buildCSSProps(child, [], frame).map(p => [p.property, p.value]))
  assert.equal(childCSS.position, 'relative')
  assert.equal(childCSS.flex, '1 1 0px')
  assert.equal(childCSS.height, '100%')
  assert.equal(childCSS.left, undefined)
  assert.match(buildTailwindClasses(frame), /flex-row/)
  assert.match(buildReactComponent(child, [], frame), /flex-1/)
  assert.doesNotMatch(buildReactComponent(child, [], frame), /left:|width:|height:/)
  assert.match(sceneToSVG(store.getSnapshot(), { scope: 'canvas', scale: 1, background: null }), /translate\(40 10\)/)
})


test('MCP frame creation retains layout and sizing, and integration edits reflow children', () => {
  const empty = createProject(new SceneStore(), 'Layout study', { x: 0, y: 0, zoom: 1 }, true)
  const created = mutateCanvas(empty, 'create_frame', { id: 'row', layout: layout(), sizing: sizing('fixed', 'hug'), width: 400 })
  assert.deepEqual(created.element.layout, layout())
  assert.equal(created.element.height, 40)
  const child = mutateCanvas(created.project, 'add_shader_shape', { id: 'child', parentId: 'row', shader_kind: 'mesh-gradient', sizing: sizing('fill', 'fixed') })
  assert.equal(child.element.width, 340)
  assert.equal(child.element.x, 40)
  const changed = mutateCanvas(child.project, 'update_element', { element_id: 'row', patch: { width: 600 } })
  assert.equal(changed.project.scene.elements.child.width, 540)
  assert.equal(changed.project.scene.elements.row.height, 160)
})

test('switching to derived sizing detaches dimension tokens, preserving unrelated bindings', () => {
  const store = scene()
  const width = store.addToken({ type: 'container', name: 'wide', value: 160 })
  const color = store.addToken({ type: 'color', name: 'ink', value: '#080808' })
  store.bindToken('a', 'width', width.id)
  store.bindToken('a', 'fill', color.id)
  store.update('a', 'rectangle', { sizing: sizing('fill', 'fixed') })
  assert.equal(node(store, 'a').tokenBindings.width, undefined)
  assert.equal(node(store, 'a').tokenBindings.fill, color.id)
  store.updateToken(width.id, { value: 200 })
  assert.equal(node(store, 'a').width, 248)
  store.undo()
  store.undo()
  assert.equal(node(store, 'a').tokenBindings.width, width.id)
})

test('overflowing layout arithmetic rejects without publishing a partially reflowed scene', () => {
  const store = scene()
  const before = store.getSnapshot()
  assert.throws(() => store.update('frame', 'frame', { sizing: sizing('hug', 'hug'), layout: layout({ padding: { top: 0, right: 1e308, bottom: 0, left: 1e308 } }) }), /Invalid/)
  assert.equal(store.getSnapshot(), before)
})

test('wrapped rows rebreak responsively and hug the height of all visible lines', () => {
  const store = scene()
  store.update('frame', 'frame', { width: 220, sizing: sizing('fixed', 'hug'), layout: layout({ wrap: 'wrap' }) })
  store.add('rectangle', { id: 'c', parentId: 'frame', width: 100, height: 30 })
  assert.deepEqual(geometry(node(store, 'a')), [40, 10, 60, 40])
  assert.deepEqual(geometry(node(store, 'b')), [112, 10, 80, 60])
  assert.deepEqual(geometry(node(store, 'c')), [40, 82, 100, 30])
  assert.equal(node(store, 'frame').height, 142)
  store.update('frame', 'frame', { width: 180 })
  assert.equal(node(store, 'b').y, 62)
  assert.equal(node(store, 'c').y, 134)
  assert.equal(node(store, 'frame').height, 194)
  const snapshot = store.getSnapshot()
  assert.equal(reflowAutoLayout(snapshot.elements, snapshot.rootIds), snapshot.elements)
  store.setVisible('b', false)
  assert.equal(node(store, 'c').y, 62)
  assert.equal(node(store, 'frame').height, 122)
})

test('vertical wrap hugs column widths and wrap reverse reverses the cross axis', () => {
  const store = scene('vertical')
  store.update('frame', 'frame', { height: 170, sizing: sizing('hug', 'fixed'), layout: layout({ direction: 'vertical', wrap: 'wrap' }) })
  store.add('rectangle', { id: 'c', parentId: 'frame', width: 100, height: 30 })
  assert.deepEqual(geometry(node(store, 'b')), [40, 62, 80, 60])
  assert.deepEqual(geometry(node(store, 'c')), [132, 10, 100, 30])
  assert.equal(node(store, 'frame').width, 252)
  store.update('frame', 'frame', { layout: layout({ direction: 'vertical', wrap: 'wrap-reverse' }) })
  assert.deepEqual(geometry(node(store, 'a')), [172, 10, 60, 40])
  assert.deepEqual(geometry(node(store, 'c')), [40, 10, 100, 30])
  const snapshot = store.getSnapshot()
  assert.equal(reflowAutoLayout(snapshot.elements, snapshot.rootIds), snapshot.elements)
})

test('wrapped fill siblings share only their own line and stretch lines shrink with the frame', () => {
  const store = scene()
  store.update('frame', 'frame', { layout: layout({ wrap: 'wrap', alignContent: 'stretch' }) })
  store.add('rectangle', { id: 'c', parentId: 'frame', width: 100, height: 30, sizing: sizing('fill', 'fill') })
  store.add('rectangle', { id: 'd', parentId: 'frame', width: 200, height: 30 })
  assert.equal(node(store, 'c').width, 176)
  assert.equal(node(store, 'c').height, 109)
  assert.equal(node(store, 'd').y, 131)
  store.update('frame', 'frame', { height: 160 })
  assert.equal(node(store, 'c').height, 69)
  assert.equal(node(store, 'd').y, 91)
  store.update('frame', 'frame', { width: 240 })
  assert.equal(node(store, 'c').width, 16)
  assert.equal(node(store, 'd').width, 200)
  const snapshot = store.getSnapshot()
  assert.equal(reflowAutoLayout(snapshot.elements, snapshot.rootIds), snapshot.elements)
})

test('wrapped lines support packing, reverse item alignment, and single-line hug', () => {
  const store = scene()
  store.update('frame', 'frame', { width: 220, layout: layout({ wrap: 'wrap', alignContent: 'space-between', align: 'end' }) })
  store.add('rectangle', { id: 'c', parentId: 'frame', width: 100, height: 30 })
  assert.equal(node(store, 'a').y, 30)
  assert.equal(node(store, 'c').y, 180)
  store.update('frame', 'frame', { layout: layout({ wrap: 'wrap-reverse' }) })
  assert.equal(node(store, 'a').y, 170)
  assert.equal(node(store, 'b').y, 150)
  assert.equal(node(store, 'c').y, 108)
  store.update('frame', 'frame', { sizing: sizing('hug', 'hug') })
  assert.equal(node(store, 'frame').width, 324)
  assert.equal(node(store, 'frame').height, 100)
  assert.equal(node(store, 'c').x, 204)
})

test('wrapped fill width remeasures nested hug text before measuring row heights', () => {
  const store = scene()
  store.update('frame', 'frame', { width: 300, layout: layout({ wrap: 'wrap' }), sizing: sizing('fixed', 'hug') })
  store.add('frame', { id: 'inner', parentId: 'frame', sizing: sizing('fill', 'hug'), layout: layout({ direction: 'vertical', padding: { top: 0, right: 0, bottom: 0, left: 0 } }) })
  store.add('text', { id: 'words', parentId: 'inner', text: 'Responsive text in a nested frame.', fontSize: 20, letterSpacing: 0, lineHeight: 1.5, sizing: sizing('fill', 'hug') })
  assert.equal(node(store, 'words').width, 76)
  assert.equal(node(store, 'inner').height, node(store, 'words').height)
  assert.equal(node(store, 'frame').height, node(store, 'words').height + 40)
  store.update('frame', 'frame', { width: 420 })
  assert.equal(node(store, 'words').width, 196)
  const snapshot = store.getSnapshot()
  assert.equal(reflowAutoLayout(snapshot.elements, snapshot.rootIds), snapshot.elements)
})

test('wrap settings validate atomically, persist, and export to CSS and Tailwind', () => {
  const store = scene()
  for (const patch of [{ wrap: 'bad' }, { alignContent: 'bad' }]) {
    const before = store.getSnapshot()
    assert.throws(() => store.update('frame', 'frame', { layout: layout(patch) }), /Invalid/)
    assert.equal(store.getSnapshot(), before)
    assert.throws(() => validateSchema({ layout: layout(patch) }, patchSchema('frame')))
  }
  store.update('frame', 'frame', { layout: layout({ wrap: 'wrap-reverse', alignContent: 'stretch' }) })
  store.update('a', 'rectangle', { sizing: sizing('fixed', 'fill') })
  const frame = node(store, 'frame')
  validateSchema(frame, elementSchema)
  const restored = new SceneStore()
  restored.load(JSON.parse(JSON.stringify(store.toJSON())))
  assert.deepEqual(restored.toJSON(), store.toJSON())
  const css = Object.fromEntries(buildCSSProps(frame).map(p => [p.property, p.value]))
  assert.equal(css['flex-wrap'], 'wrap-reverse')
  assert.equal(css['align-content'], 'stretch')
  assert.match(buildTailwindClasses(frame), /flex-wrap-reverse/)
  assert.match(buildReactComponent(frame), /content-stretch/)
  const childCSS = Object.fromEntries(buildCSSProps(node(store, 'a'), [], frame).map(p => [p.property, p.value]))
  assert.equal(childCSS.height, 'auto')
  assert.equal(childCSS['align-self'], 'stretch')
})

test('spacing handles distinguish item and line gaps, ignore hidden children, and rotate drag axes', () => {
  const store = scene()
  store.update('frame', 'frame', { width: 220, layout: layout({ wrap: 'wrap' }) })
  store.add('rectangle', { id: 'c', parentId: 'frame', width: 100, height: 30 })
  const snapshot = store.getSnapshot()
  const handles = layoutHandles(node(store, 'frame'), snapshot.elements)
  assert.equal(handles.filter(h => h.property !== 'gap').length, 4)
  assert.deepEqual(handles.find(h => h.id === 'gap-b'), { id: 'gap-b', property: 'gap', axis: 'x', sign: 1, x: 106, y: 35 })
  assert.deepEqual(handles.find(h => h.id === 'line-gap-1'), { id: 'line-gap-1', property: 'gap', axis: 'y', sign: 1, x: 110, y: 76 })
  const initial = layout()
  assert.equal(dragSpacing(initial, 'left', 'x', 1, 90, { x: 0, y: 12 }, false).padding.left, 52)
  assert.equal(dragSpacing(initial, 'right', 'x', -1, 0, { x: 8, y: 0 }, false).padding.right, 12)
  assert.equal(dragSpacing(initial, 'gap', 'x', 1, 0, { x: 7, y: 0 }, true).gap, 16)
  assert.equal(dragSpacing(initial, 'gap', 'x', 1, 0, { x: -100, y: 0 }, false).gap, 0)
  assert.equal(initial.gap, 12)
  assert.equal(adjustSpacing(initial, 'top', 20).padding.right, initial.padding.right)
  store.setVisible('b', false)
  assert.equal(layoutHandles(node(store, 'frame'), store.getSnapshot().elements).some(h => h.id === 'gap-b'), false)
})

test('symmetric padding dragging updates opposite sides together', () => {
  const initial = layout()
  // Drag top handle with symmetric = true: both top and bottom update
  const draggedY = dragSpacing(initial, 'top', 'y', 1, 0, { x: 0, y: 15 }, false, true)
  assert.equal(draggedY.padding.top, 25)
  assert.equal(draggedY.padding.bottom, 25)
  assert.equal(draggedY.padding.left, initial.padding.left)
  assert.equal(draggedY.padding.right, initial.padding.right)

  // Drag left handle with symmetric = true: both left and right update
  const draggedX = dragSpacing(initial, 'left', 'x', 1, 0, { x: 10, y: 0 }, false, true)
  assert.equal(draggedX.padding.left, 50)
  assert.equal(draggedX.padding.right, 50)
  assert.equal(draggedX.padding.top, initial.padding.top)
  assert.equal(draggedX.padding.bottom, initial.padding.bottom)
})

test('createAutoLayoutSelection on single frame infers direction, padding, gap, and reorders children', () => {
  const store = new SceneStore()
  store.add('frame', { id: 'f', x: 0, y: 0, width: 300, height: 200 })
  store.add('rectangle', { id: 'r2', parentId: 'f', x: 150, y: 30, width: 80, height: 50 })
  store.add('rectangle', { id: 'r1', parentId: 'f', x: 20, y: 30, width: 80, height: 50 })
  store.select(['f'])

  createAutoLayoutSelection(store)
  const f = node(store, 'f')
  assert.ok(f.layout)
  assert.equal(f.layout.direction, 'horizontal')
  assert.equal(f.layout.gap, 50) // 150 - (20 + 80)
  assert.equal(f.layout.padding.left, 20)
  assert.equal(f.layout.padding.top, 30)
  assert.equal(f.layout.padding.right, 70) // 300 - (150 + 80)
  assert.equal(f.layout.padding.bottom, 120) // 200 - (30 + 50)
  // Children reordered spatially: r1 first, r2 second
  assert.deepEqual(f.children, ['r1', 'r2'])
})

test('createAutoLayoutSelection wraps multiple canvas elements in hug auto-layout frame', () => {
  const store = new SceneStore()
  store.add('rectangle', { id: 'r1', x: 50, y: 100, width: 60, height: 40 })
  store.add('rectangle', { id: 'r2', x: 140, y: 100, width: 60, height: 40 })
  store.select(['r1', 'r2'])

  const createdId = createAutoLayoutSelection(store)
  assert.ok(createdId)
  const frame = node(store, createdId)
  assert.ok(frame)
  assert.equal(frame.type, 'frame')
  assert.ok(frame.layout)
  assert.equal(frame.layout.direction, 'horizontal')
  assert.equal(frame.layout.gap, 30) // 140 - (50 + 60)
  assert.equal(frame.sizing.width, 'hug')
  assert.equal(frame.sizing.height, 'hug')
  assert.deepEqual(store.getSnapshot().selection, [createdId])
})

test('removeAutoLayoutSelection clears layout and resets fill child sizing to fixed', () => {
  const store = scene()
  store.update('a', 'rectangle', { sizing: sizing('fill', 'fill') })
  store.select(['frame'])
  assert.ok(node(store, 'frame').layout)
  assert.equal(node(store, 'a').sizing.width, 'fill')

  removeAutoLayoutSelection(store)
  assert.equal(node(store, 'frame').layout, null)
  assert.equal(node(store, 'a').sizing.width, 'fixed')
  assert.equal(node(store, 'a').sizing.height, 'fixed')
})

test('groupSelection and ungroupSelection handle hierarchy and convert coordinates', () => {
  const store = new SceneStore()
  store.add('rectangle', { id: 'r1', x: 100, y: 100, width: 50, height: 50 })
  store.add('rectangle', { id: 'r2', x: 200, y: 150, width: 60, height: 40 })
  store.select(['r1', 'r2'])

  const groupId = groupSelection(store)
  assert.ok(groupId)
  const group = node(store, groupId)
  assert.equal(group.x, 100)
  assert.equal(group.y, 100)
  assert.equal(group.width, 160) // (200 + 60) - 100
  assert.equal(group.height, 90) // (150 + 40) - 100
  assert.equal(node(store, 'r1').x, 0)
  assert.equal(node(store, 'r1').y, 0)
  assert.equal(node(store, 'r2').x, 100)
  assert.equal(node(store, 'r2').y, 50)

  // Ungroup restores canvas coordinates
  store.select([groupId])
  const ungroups = ungroupSelection(store)
  assert.deepEqual(ungroups.sort(), ['r1', 'r2'])
  assert.equal(node(store, groupId), undefined)
  assert.equal(node(store, 'r1').x, 100)
  assert.equal(node(store, 'r1').y, 100)
  assert.equal(node(store, 'r2').x, 200)
  assert.equal(node(store, 'r2').y, 150)
})

test('dynamic alignment matrix points in horizontal and vertical flows place children accurately', () => {
  const store = new SceneStore()
  store.add('frame', {
    id: 'frame',
    width: 300,
    height: 200,
    layout: layout({
      direction: 'horizontal',
      padding: { top: 10, right: 10, bottom: 10, left: 10 },
      gap: 10,
      justify: 'center',
      align: 'center',
    }),
  })
  store.add('rectangle', { id: 'c1', parentId: 'frame', width: 50, height: 40 })
  store.add('rectangle', { id: 'c2', parentId: 'frame', width: 50, height: 60 })

  // Horizontal flow: inner width = 280, children width = 100, gap = 10, total = 110. Remaining = 170.
  // Center justify: start at 10 + 170/2 = 95.
  // c1 x = 95, c2 x = 95 + 50 + 10 = 155.
  // Center align: inner height = 180.
  // c1 height 40: (180 - 40)/2 = 70 => y = 10 + 70 = 80.
  // c2 height 60: (180 - 60)/2 = 60 => y = 10 + 60 = 70.
  assert.deepEqual(geometry(node(store, 'c1')), [95, 80, 50, 40])
  assert.deepEqual(geometry(node(store, 'c2')), [155, 70, 50, 60])

  // Change to vertical flow with start justify and end align
  store.update('frame', 'frame', {
    layout: layout({
      direction: 'vertical',
      padding: { top: 10, right: 10, bottom: 10, left: 10 },
      gap: 10,
      justify: 'start',
      align: 'end',
    }),
  })
  // Vertical flow: inner height = 180, inner width = 280.
  // Start justify: y starts at 10.
  // c1 y = 10, c2 y = 10 + 40 + 10 = 60.
  // End align: x = 10 + (280 - child.width).
  // c1 width 50: x = 10 + 230 = 240.
  // c2 width 50: x = 10 + 230 = 240.
  assert.deepEqual(geometry(node(store, 'c1')), [240, 10, 50, 40])
  assert.deepEqual(geometry(node(store, 'c2')), [240, 60, 50, 60])
})

test('nested auto-layout hierarchy with responsive hug and fill constraints reflows synchronously', () => {
  const store = new SceneStore()
  // Card container: vertical, fixed width 320, hug height
  store.add('frame', {
    id: 'card',
    width: 320,
    sizing: sizing('fixed', 'hug'),
    layout: layout({
      direction: 'vertical',
      gap: 12,
      padding: { top: 16, right: 16, bottom: 16, left: 16 },
    }),
  })

  // Header row inside card: horizontal, fill width, hug height
  store.add('frame', {
    id: 'header',
    parentId: 'card',
    sizing: sizing('fill', 'hug'),
    layout: layout({
      direction: 'horizontal',
      gap: 8,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      justify: 'space-between',
      align: 'center',
    }),
  })

  // Title: fill width, fixed height 24
  store.add('rectangle', { id: 'title', parentId: 'header', height: 24, sizing: sizing('fill', 'fixed') })
  // Badge icon: fixed 24x24
  store.add('rectangle', { id: 'badge', parentId: 'header', width: 24, height: 24, sizing: sizing('fixed', 'fixed') })

  // Body content block: fill width, fixed height 80
  store.add('rectangle', { id: 'body', parentId: 'card', height: 80, sizing: sizing('fill', 'fixed') })

  // Card inner width = 320 - 32 = 288.
  // Header should fill card inner width = 288.
  assert.equal(node(store, 'header').width, 288)
  assert.equal(node(store, 'header').x, 16)
  assert.equal(node(store, 'header').y, 16)

  // In header: total width 288, badge is 24, gap is 8. Remaining for title = 288 - 24 - 8 = 256.
  assert.equal(node(store, 'title').width, 256)
  assert.equal(node(store, 'badge').x, 264) // 256 + 8
  assert.equal(node(store, 'body').width, 288)

  // Card height = 16 (pad top) + 24 (header) + 12 (gap) + 80 (body) + 16 (pad bottom) = 148
  assert.equal(node(store, 'card').height, 148)

  // Resize card: width changes from 320 to 400
  store.update('card', 'frame', { width: 400 })
  // New inner width = 400 - 32 = 368
  assert.equal(node(store, 'header').width, 368)
  assert.equal(node(store, 'title').width, 336) // 368 - 24 - 8
  assert.equal(node(store, 'badge').x, 344)
  assert.equal(node(store, 'body').width, 368)
  assert.equal(node(store, 'card').height, 148)
})

test('layoutPaddingBands and layoutGapBands accurately compute on-canvas visual spacing overlays', () => {
  const store = scene()
  const frame = node(store, 'frame')
  const paddingBands = layoutPaddingBands(frame)
  assert.equal(paddingBands.length, 4)
  const topBand = paddingBands.find(b => b.id === 'top')
  const bottomBand = paddingBands.find(b => b.id === 'bottom')
  const leftBand = paddingBands.find(b => b.id === 'left')
  const rightBand = paddingBands.find(b => b.id === 'right')
  assert.equal(topBand.height, 10)
  assert.equal(bottomBand.height, 30)
  assert.equal(leftBand.width, 40)
  assert.equal(rightBand.width, 20)

  // Gap band between child 'a' and 'b' in horizontal frame
  // a: x=40, y=10, width=60, height=40
  // b: x=40+60+12 = 112, y=10, width=80, height=60
  const gapBands = layoutGapBands(frame, store.getSnapshot().elements)
  assert.equal(gapBands.length, 1)
  assert.equal(gapBands[0].x, 100) // a.x + a.width = 40 + 60
  assert.equal(gapBands[0].width, 12) // gap span = 112 - 100 = 12
  assert.equal(gapBands[0].axis, 'x')
  assert.equal(gapBands[0].value, 12)
})

test('layoutGapBands for wrapped flow calculates cross-axis line gaps accurately', () => {
  const store = new SceneStore()
  store.add('frame', {
    id: 'wrap-frame',
    width: 200,
    height: 300,
    layout: layout({ wrap: 'wrap', gap: 16, padding: { top: 10, right: 10, bottom: 10, left: 10 } }),
  })
  store.add('rectangle', { id: 'r1', parentId: 'wrap-frame', width: 100, height: 40 })
  store.add('rectangle', { id: 'r2', parentId: 'wrap-frame', width: 100, height: 40 })
  // Inner width = 180. r1 width = 100, gap = 16, r2 width = 100 => 216 > 180, so r2 wraps!
  // Line 1: r1 at x=10, y=10, height=40 (bottom at 50)
  // Line 2: r2 at x=10, y=10 + 40 + 16 = 66
  const bands = layoutGapBands(node(store, 'wrap-frame'), store.getSnapshot().elements)
  const lineGapBand = bands.find(b => b.id === 'line-gap-band-1')
  assert.ok(lineGapBand)
  assert.equal(lineGapBand.axis, 'y')
  assert.equal(lineGapBand.y, 50)
  assert.equal(lineGapBand.height, 16)
})



