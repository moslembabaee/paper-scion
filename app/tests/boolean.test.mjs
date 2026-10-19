import test from 'node:test'
import assert from 'node:assert/strict'
import { SceneStore } from '../src/scene/store.ts'
import { createElement } from '../src/scene/elements.ts'
import { computeBoolean, transformedSource } from '../src/scene/booleanGeometry.ts'
import { parsePath } from '../src/scene/pathGeometry.ts'
import { optimizeSvgBezierData } from '../src/scene/bezierOptimization.ts'
import { sceneToSVG } from '../src/io/svg.ts'
import { buildCSSProps, buildReactComponent } from '../src/tokens/codegen.ts'
import { createShader } from '../src/shaders/catalog.ts'

test('hover previews are cached, transient and cleared by edits, undo and selection changes', () => {
  const store = fixture(), snapshot = store.getSnapshot(), history = store.getHistorySnapshot()
  let documentNotifications = 0, previewNotifications = 0
  store.subscribe(() => documentNotifications++)
  const unsubscribePreview = store.subscribeBooleanPreview(() => previewNotifications++)
  for (const [operation, expected] of [['union', 17500], ['subtract', 7500], ['intersect', 2500], ['exclude', 15000]]) {
    store.previewBoolean(operation)
    const preview = store.getBooleanPreview()
    assert.equal(preview.operation, operation)
    close(area(preview.node.d), expected)
    assert.deepEqual(preview.sourceIds, ['b', 'a'])
    assert.equal(store.getSnapshot(), snapshot)
    assert.equal(store.getHistorySnapshot(), history)
    store.previewBoolean(null)
    assert.equal(store.getBooleanPreview(), null)
    store.previewBoolean(operation)
    assert.equal(store.getBooleanPreview(), preview)
  }
  assert.equal(documentNotifications, 0)
  assert.ok(previewNotifications > 0)
  unsubscribePreview()
  assert.doesNotMatch(JSON.stringify(store.toJSON()), /boolean-preview|sourceIds/)
  store.update('a', 'rectangle', { x: 10 })
  assert.equal(store.getBooleanPreview(), null)
  store.undo()
  assert.equal(store.getBooleanPreview(), null)
  store.previewBoolean('union')
  store.select(['a'])
  assert.equal(store.getBooleanPreview(), null)
})

test('compound previews preserve its transform and invalidate on transactions and source edits', () => {
  const store = fixture(), compound = store.booleanSelection('subtract')
  store.update(compound.id, 'path', { x: 250, y: 300, width: 180, height: 160, rotation: 35 })
  const snapshot = store.getSnapshot(), source = compound.boolean.operands[0]
  const before = transformedSource(source, snapshot.elements[compound.id])
  store.previewBoolean('union')
  const preview = store.getBooleanPreview()
  assert.equal(transformedSource(source, preview.node).d, before.d)
  close(area(preview.node.d), 17500)
  assert.equal(store.getSnapshot(), snapshot)
  store.beginTransaction('Move')
  assert.equal(store.getBooleanPreview(), null)
  assert.throws(() => store.previewBoolean('exclude'), /Finish the active edit/)
  store.cancelTransaction()
  assert.equal(store.getBooleanPreview(), null)
  store.previewBoolean('intersect')
  store.updateBooleanOperand(compound.id, 'b', { x: 75 })
  assert.equal(store.getBooleanPreview(), null)
})

test('SVG optimization preserves open endpoints, holes, cubic loops and flattened round trips', () => {
  assert.equal(optimizeSvgBezierData('M0 0L10 0L20 0L30 0'), 'M 0 0 H 30')
  const ring = 'M0 0H50H100V100H0Z M25 25V75H75V25Z'
  const optimized = optimizeSvgBezierData(ring)
  close(area(optimized), area(ring))
  assert.equal(parsePath(optimized).length, 2)
  for (const d of ['M0 0C100 100 -100 100 0 0Z', 'M0 0C-20 0 120 0 100 0V100H0Z']) {
    const result = optimizeSvgBezierData(d)
    assert.match(result, / C /)
    close(area(result), area(d))
  }
  const store = fixture()
  store.update('a', 'rectangle', { cornerRadius: 20 })
  const compound = store.booleanSelection('subtract')
  store.flattenBoolean(compound.id)
  const flattened = store.getSnapshot().elements[compound.id]
  assert.match(flattened.d, / C /)
  close(area(flattened.d), area(compound.d))
  const restored = new SceneStore()
  restored.load(JSON.parse(JSON.stringify(store.toJSON())))
  assert.equal(restored.getSnapshot().elements[compound.id].d, flattened.d)
  store.undo()
  assert.equal(store.getSnapshot().elements[compound.id], compound)
  assert.equal(optimizeSvgBezierData(''), '')
  assert.throws(() => optimizeSvgBezierData('M0 0', { precision: 100 }), /Invalid/)
})

const close = (actual, expected, epsilon = 1e-5) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} ≈ ${expected}`)
// Independent exact integration of cubic signed area (integrand has degree five).
function area(d) {
  const xs = [-.906179845938664, -.538469310105683, 0, .538469310105683, .906179845938664]
  const ws = [.236926885056189, .478628670499366, .568888888888889, .478628670499366, .236926885056189]
  let total = 0
  for (const { anchors, closed } of parsePath(d)) for (let i = 0; i < anchors.length - (closed ? 0 : 1); i++) {
    const a = anchors[i], b = anchors[(i + 1) % anchors.length]
    if (!a.out && !b.in) { total += (a.x * b.y - a.y * b.x) / 2; continue }
    const c = [a, a.out ?? a, b.in ?? b, b]
    for (let j = 0; j < 5; j++) {
      const t = (xs[j] + 1) / 2, u = 1 - t
      const value = key => u ** 3 * c[0][key] + 3 * u * u * t * c[1][key] + 3 * u * t * t * c[2][key] + t ** 3 * c[3][key]
      const derivative = key => 3 * u * u * (c[1][key] - c[0][key]) + 6 * u * t * (c[2][key] - c[1][key]) + 3 * t * t * (c[3][key] - c[2][key])
      total += ws[j] * (value('x') * derivative('y') - value('y') * derivative('x')) / 4
    }
  }
  return Math.abs(total)
}
const rectangle = (id, x = 0, y = 0, width = 100, height = 100) => createElement('rectangle', { id, x, y, width, height })
const fixture = () => {
  const store = new SceneStore()
  store.add('rectangle', { id: 'a', name: 'Base', width: 100, height: 100, style: { fill: '#080808' } })
  store.add('rectangle', { id: 'b', name: 'Cutter', x: 50, y: 50, width: 100, height: 100 })
  store.select(['b', 'a']); store.clearHistory()
  return store
}

test('all four operations merge geometry in paint order, with one undo command', () => {
  for (const [operation, expected] of [['union', 17500], ['subtract', 7500], ['intersect', 2500], ['exclude', 15000]]) {
    const store = fixture(), before = store.getSnapshot()
    const node = store.booleanSelection(operation)
    close(area(node.d), expected)
    assert.equal(node.style.fill, '#080808')
    assert.deepEqual(node.boolean.operands.map(n => n.id), ['a', 'b'])
    assert.deepEqual(store.getSnapshot().selection, [node.id])
    assert.deepEqual(store.getSnapshot().rootIds, [node.id])
    assert.equal(store.getHistorySnapshot().undoCount, 1)
    store.undo(); assert.equal(store.getSnapshot(), before)
    store.redo(); assert.equal(store.getSnapshot().elements[node.id], node)
  }
})

test('shared edges, touching corners, identical shapes and empty results', () => {
  for (const [a, b, overlap] of [
    [rectangle('a'), rectangle('b'), 10000],
    [rectangle('a'), rectangle('b', 100), 0],
    [rectangle('a'), rectangle('b', 100, 100), 0],
    [rectangle('a'), rectangle('b', 100, 25, 50, 50), 0],
    [rectangle('a'), rectangle('b', 500, 500), 0],
  ]) {
    close(area(computeBoolean([a, b], 'intersect').d), overlap)
    close(area(computeBoolean([a, b], 'union').d), a.width * a.height + b.width * b.height - overlap)
    close(area(computeBoolean([a, b], 'subtract').d), a.width * a.height - overlap)
    close(area(computeBoolean([a, b], 'exclude').d), a.width * a.height + b.width * b.height - 2 * overlap)
  }
  const empty = computeBoolean([rectangle('a'), rectangle('b')], 'exclude')
  assert.equal(empty.d, '')
  assert.ok(empty.viewBox[2] > 0 && empty.viewBox[3] > 0)
})

test('three-source intersection, subtraction and exclude use all operands', () => {
  const shapes = [rectangle('a'), rectangle('b', 25), rectangle('c', 50)]
  close(area(computeBoolean(shapes, 'intersect').d), 5000)
  close(area(computeBoolean(shapes, 'subtract').d), 2500)
  close(area(computeBoolean(shapes, 'exclude').d), 10000)
})

test('curved boundaries remain cubic and satisfy area identities', () => {
  const a = createElement('ellipse', { width: 100, height: 100 })
  const b = createElement('ellipse', { x: 50, width: 100, height: 100 })
  const union = computeBoolean([a, b], 'union'), intersect = computeBoolean([a, b], 'intersect')
  const subtract = computeBoolean([a, b], 'subtract'), exclude = computeBoolean([a, b], 'exclude')
  const single = area(computeBoolean([a, { ...a, id: 'duplicate' }], 'union').d)
  assert.match(union.d, / C /); assert.match(intersect.d, / C /)
  close(single, Math.PI * 2500, 3)
  close(area(union.d) + area(intersect.d), 2 * single)
  close(area(subtract.d) + area(intersect.d), single)
  close(area(exclude.d), 2 * area(subtract.d))
})

test('holes honor evenodd and nonzero winding; subtraction creates opposite winding', () => {
  const ring = createElement('path', { d: 'M0 0H100V100H0Z M25 25H75V75H25Z', viewBox: [0, 0, 100, 100], width: 100, height: 100, fillRule: 'evenodd' })
  const inner = rectangle('inner', 40, 40, 20, 20)
  close(area(computeBoolean([ring, inner], 'intersect').d), 0)
  close(area(computeBoolean([ring, inner], 'union').d), 7900)
  close(area(computeBoolean([{ ...ring, fillRule: 'nonzero' }, inner], 'union').d), 10000)
  const cut = computeBoolean([rectangle('outer'), rectangle('inner', 25, 25, 50, 50)], 'subtract')
  close(area(cut.d), 7500)
  assert.equal(parsePath(cut.d).length, 2)
  assert.equal(cut.fillRule, 'nonzero')
})

test('viewBox scaling, SVG arcs, rotations and rounded corners are merged accurately', () => {
  const path = createElement('path', { d: 'M10 20H60V70H10Z', viewBox: [10, 20, 50, 50], x: 50, y: 50, width: 100, height: 100 })
  close(area(computeBoolean([rectangle('base'), path], 'intersect').d), 2500)
  const rotated = { ...rectangle('rotated'), rotation: 45 }
  close(area(computeBoolean([rectangle('base'), rotated], 'intersect').d), 10000 * (2 * Math.SQRT2 - 2))
  const rounded = createElement('rectangle', { width: 100, height: 100, cornerRadius: 20 })
  assert.match(computeBoolean([rounded, rectangle('far', 200)], 'union').d, / C /)
  const arc = createElement('path', { d: 'M0 50 A50 50 0 0 1 100 50 A50 50 0 0 1 0 50 Z', viewBox: [0, 0, 100, 100], width: 100, height: 100 })
  close(area(computeBoolean([arc, rectangle('base')], 'intersect').d), Math.PI * 2500, 3)
})

test('source edits and operation changes recompute live geometry and preserve transforms', () => {
  const store = fixture(), node = store.booleanSelection('subtract')
  store.update(node.id, 'path', { x: node.x + 200, y: node.y + 100, rotation: 30, width: 200, height: 150 })
  const before = store.getSnapshot().elements[node.id]
  const source = node.boolean.operands[0]
  const sourceBefore = transformedSource(source, before)
  store.setBooleanOperation(node.id, 'union')
  const after = store.getSnapshot().elements[node.id]
  const sourceAfter = transformedSource(source, after)
  assert.equal(sourceBefore.d, sourceAfter.d)
  store.updateBooleanOperand(node.id, 'b', { x: 75 })
  const updated = store.getSnapshot().elements[node.id]
  close(area(updated.d), 18750)
  assert.equal(updated.boolean.operands[1].x, 75)
  store.undo(); assert.deepEqual(store.getSnapshot().elements[node.id], after)
})

test('release restores original sources, IDs and styles; flatten retains only the outline', () => {
  const store = fixture(), original = store.getSnapshot().elements
  const node = store.booleanSelection('union')
  store.releaseBoolean(node.id)
  assert.deepEqual(store.getSnapshot().elements, original)
  store.undo()
  store.flattenBoolean(node.id)
  assert.equal(store.getSnapshot().elements[node.id].boolean, undefined)
  close(area(store.getSnapshot().elements[node.id].d), area(node.d))
  assert.ok(store.getSnapshot().elements[node.id].d.length < node.d.length)
  store.undo(); assert.equal(store.getSnapshot().elements[node.id].boolean, node.boolean)
  const destructive = fixture().booleanSelection('exclude', true)
  assert.equal(destructive.boolean, undefined)
})

test('release follows moved, rotated, resized and reparented compounds without skew loss', () => {
  const store = fixture()
  store.update('b', 'rectangle', { rotation: 30 })
  const node = store.booleanSelection('union')
  store.add('frame', { id: 'frame', rotation: 20 })
  store.reparent(node.id, 'frame')
  store.update(node.id, 'path', { x: 200, y: 300, rotation: 45, width: 240, height: 90 })
  const compound = store.getSnapshot().elements[node.id]
  const expected = transformedSource(compound.boolean.operands[1], compound)
  store.releaseBoolean(node.id)
  const source = store.getSnapshot().elements.b
  assert.equal(source.type, 'path')
  assert.equal(source.parentId, 'frame')
  assert.equal(source.d, expected.d)
  assert.deepEqual(source.viewBox, expected.viewBox)
})

test('nested compounds remain immutable, serializable and exported as real SVG paths', () => {
  const store = fixture(), inner = store.booleanSelection('exclude')
  store.add('ellipse', { id: 'c', x: 80, y: 80 })
  store.select(['c', inner.id])
  const outer = store.booleanSelection('union')
  assert.ok(Object.isFrozen(outer.boolean.operands[0].boolean.operands))
  assert.ok(Object.isFrozen(outer.boolean.operands[0].boolean.operands[0].style))
  const restored = new SceneStore(); restored.load(JSON.parse(JSON.stringify(store.toJSON())))
  assert.deepEqual(restored.toJSON(), store.toJSON())
  const svg = sceneToSVG(store.getSnapshot(), { scope: 'selection', scale: 1, background: 'transparent' })
  assert.match(svg, /<path d="[Mm]/); assert.match(svg, /fill-rule="nonzero"/)
  assert.doesNotMatch(svg, /foreignObject|boolean|mask=/)
  restored.releaseBoolean(outer.id)
  assert.ok(restored.getSnapshot().elements[inner.id].boolean)
})

test('sibling order stays contiguous and combining in rotated frames stays in local coordinates', () => {
  const store = fixture()
  store.add('frame', { id: 'frame', x: 200, y: 300, rotation: 45 })
  store.reparent('a', 'frame'); store.reparent('b', 'frame')
  store.add('rectangle', { id: 'between', parentId: 'frame' }, 1)
  store.add('rectangle', { id: 'top', parentId: 'frame' })
  const node = store.booleanSelection('union')
  close(area(node.d), 17500)
  assert.equal(node.parentId, 'frame')
  assert.deepEqual(store.getChildren('frame'), ['between', node.id, 'top'])
  store.getChildren('frame').forEach((id, i) => assert.equal(store.getSnapshot().elements[id].zIndex, i))
})

test('invalid geometry, locks, mixed types, mixed parents and active gestures reject atomically', () => {
  const store = fixture()
  store.update('b', 'rectangle', { name: 'Invalid' })
  const invalid = store.add('path', { id: 'invalid', d: 'M0 0 BAD' })
  store.select(['a', invalid.id]); store.clearHistory()
  const before = store.getSnapshot()
  assert.throws(() => store.booleanSelection('union'))
  assert.equal(store.getSnapshot(), before); assert.equal(store.getHistorySnapshot().undoCount, 0)
  store.setLocked('a', true)
  assert.throws(() => store.booleanSelection('union', false, ['a', 'b']), /unlocked/)
  store.setLocked('a', false)
  store.add('text', { id: 'text' })
  assert.throws(() => store.booleanSelection('union', false, ['text', 'b']), /vector paths/)
  store.add('frame', { id: 'frame' }); store.reparent('b', 'frame')
  assert.throws(() => store.booleanSelection('union', false, ['a', 'b']), /same frame/)
  assert.throws(() => store.booleanSelection('union', false, ['a', 'a']), /at least two/)
  store.reparent('b', null); store.select(['a', 'b'])
  store.beginTransaction('Drag')
  assert.throws(() => store.booleanSelection('union'), /active edit/)
  store.cancelTransaction()
  const node = store.booleanSelection('union')
  assert.throws(() => store.update(node.id, 'path', { d: 'M0 0H10V10Z' }), /Flatten/)
  assert.throws(() => store.update(node.id, 'path', { boolean: {} }), /structural/)
  store.setLocked(node.id, true)
  assert.throws(() => store.releaseBoolean(node.id), /locked/)
})

test('malformed compound documents are rejected atomically', () => {
  const store = fixture(), node = store.booleanSelection('union'), before = store.getSnapshot()
  for (const boolean of [{ operation: 'bad', operands: node.boolean.operands }, { operation: 'union', operands: [] }, { operation: 'union', operands: [node.boolean.operands[0], node.boolean.operands[0]] }]) {
    assert.throws(() => store.load({ ...store.toJSON(), elements: { [node.id]: { ...node, boolean } } }))
    assert.equal(store.getSnapshot(), before)
  }
})

test('deterministic rotated curve arrangements satisfy area identities', () => {
  let seed = 123
  const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2 ** 32 }
  for (let i = 0; i < 24; i++) {
    const a = createElement('rectangle', { x: random() * 120, y: random() * 120, width: 30 + random() * 120, height: 30 + random() * 120, rotation: random() * 360 })
    const b = createElement('ellipse', { x: random() * 120, y: random() * 120, width: 30 + random() * 120, height: 30 + random() * 120, rotation: random() * 360 })
    const own = area(computeBoolean([a, { ...a, id: 'copy-a' }], 'union').d) + area(computeBoolean([b, { ...b, id: 'copy-b' }], 'union').d)
    const union = area(computeBoolean([a, b], 'union').d), overlap = area(computeBoolean([a, b], 'intersect').d)
    close(union + overlap, own, 1e-4)
    close(area(computeBoolean([a, b], 'exclude').d), union - overlap, 1e-4)
  }
})

test('shared cubic boundaries with different segment splits stay compact', () => {
  const source = d => createElement('path', { d, width: 100, height: 100, viewBox: [0, 0, 100, 100] })
  const a = source('M0 50C0 0 100 0 100 50C100 100 0 100 0 50Z')
  const b = source('M0 50C0 25 25 12.5 50 12.5C75 12.5 100 25 100 50C100 100 0 100 0 50Z')
  for (const operation of ['union', 'intersect']) {
    const result = computeBoolean([a, b], operation)
    close(area(result.d), 6000)
    assert.ok(parsePath(result.d)[0].anchors.length <= 8)
  }
  assert.equal(computeBoolean([a, b], 'subtract').d, '')
  assert.equal(computeBoolean([a, b], 'exclude').d, '')
})

test('single cubic loops are split into filled contours at their self intersection', () => {
  const loop = createElement('path', { d: 'M0 0C120 120 -60 120 60 0Z', width: 100, height: 100, viewBox: [0, 0, 100, 100] })
  const result = computeBoolean([loop, rectangle('far', 200)], 'subtract')
  const contours = parsePath(result.d)
  assert.equal(contours.length, 2)
  for (const contour of contours) {
    assert.equal(contour.closed, true)
    close(contour.anchors[0].x, 30)
    close(contour.anchors[0].y, 36)
  }
})

test('collinear cubic edges merge even with nonlinear or backtracking parameters', () => {
  for (const d of ['M0 0C0 0 100 0 100 0V100H0Z', 'M0 0C300 0 300 0 100 0V100H0Z']) {
    const source = createElement('path', { d, width: 100, height: 100, viewBox: [0, 0, 100, 100] })
    const strip = rectangle('strip', 25, 0, 50, 100)
    close(area(computeBoolean([source, strip], 'union').d), 10000)
    close(area(computeBoolean([source, strip], 'intersect').d), 5000)
    close(area(computeBoolean([source, strip], 'subtract').d), 5000)
    close(area(computeBoolean([source, strip], 'exclude').d), 5000)
  }
})

test('anisotropically resized rounded sources release with their actual outline', () => {
  const store = fixture()
  store.update('a', 'rectangle', { cornerRadius: 20 })
  const node = store.booleanSelection('union')
  store.update(node.id, 'path', { width: 300, height: 100 })
  const resized = store.getSnapshot().elements[node.id]
  const expected = transformedSource(resized.boolean.operands[0], resized)
  store.releaseBoolean(node.id)
  assert.equal(store.getSnapshot().elements.a.type, 'path')
  assert.equal(store.getSnapshot().elements.a.d, expected.d)
  store.undo()
  assert.equal(store.getSnapshot().elements[node.id], resized)
})

test('moving a compound reuses immutable source geometry without recomputing it', () => {
  const store = fixture(), node = store.booleanSelection('union')
  store.update(node.id, 'path', { x: 120 })
  const moved = store.getSnapshot().elements[node.id]
  assert.equal(moved.boolean, node.boolean)
  assert.equal(moved.d, node.d)
  assert.ok(Object.isFrozen(moved.boolean.operands[0]))
})

test('handoff emits SVG paths and shader export clips holes in path coordinates', () => {
  const store = fixture(), node = store.booleanSelection('exclude')
  const code = buildReactComponent(node)
  assert.match(code, /<svg/)
  assert.match(code, /<path/)
  assert.match(code, /fillRule="nonzero"/)
  assert.doesNotMatch(code, /bg-blue|<div/)
  const properties = buildCSSProps(node)
  assert.ok(properties.some(p => p.property === 'fill' && p.value === '#080808'))
  assert.ok(!properties.some(p => p.property === 'background-color'))
  store.update(node.id, 'path', { style: { shader: createShader('mesh-gradient') } })
  const svg = sceneToSVG(store.getSnapshot(), { scope: 'selection', scale: 1, background: 'transparent' }, { images: new Map(), shaders: new Map([[node.id, 'data:image/png;base64,AA==']]) })
  assert.match(svg, /<clipPath[^>]*><path[^>]*clip-rule="nonzero"/)
  assert.doesNotMatch(svg, /<clipPath[^>]*><svg/)
})

test('token edits and deletion reach nested sources and survive project reload', () => {
  const store = fixture()
  const color = store.addToken({ type: 'color', name: 'ink', value: '#080808' })
  const width = store.addToken({ type: 'spacing', name: 'source-width', value: 100 })
  store.bindToken('a', 'fill', color.id)
  store.bindToken('a', 'width', width.id)
  const inner = store.booleanSelection('union')
  assert.deepEqual(inner.tokenBindings, { fill: color.id })
  store.add('rectangle', { id: 'far', x: 300, width: 100, height: 100 })
  store.select([inner.id, 'far'])
  const outer = store.booleanSelection('union')
  store.updateToken(color.id, { value: '#81adec' })
  const painted = store.getSnapshot().elements[outer.id]
  assert.equal(painted.d, outer.d)
  assert.equal(painted.style.fill, '#81adec')
  assert.equal(painted.boolean.operands[0].boolean.operands[0].style.fill, '#81adec')
  store.updateToken(width.id, { value: 200 })
  const resized = store.getSnapshot().elements[outer.id]
  assert.equal(resized.boolean.operands[0].boolean.operands[0].width, 200)
  close(area(resized.d), 35000)
  assert.notEqual(resized.d, painted.d)
  const beforeDelete = store.getSnapshot()
  store.removeTokens([width.id, color.id])
  const detached = store.getSnapshot().elements[outer.id]
  assert.equal(detached.d, resized.d)
  assert.deepEqual(detached.boolean.operands[0].boolean.operands[0].tokenBindings, {})
  const restored = new SceneStore()
  restored.load(JSON.parse(JSON.stringify(store.toJSON())))
  assert.deepEqual(restored.toJSON(), store.toJSON())
  store.undo()
  assert.equal(store.getSnapshot(), beforeDelete)
  store.releaseBoolean(outer.id)
  store.releaseBoolean(inner.id)
  assert.equal(store.getSnapshot().elements.a.width, 200)
  assert.equal(store.getSnapshot().elements.a.tokenBindings.width, width.id)
})

test('release detaches transformed geometry bindings while retaining paint bindings', () => {
  const store = fixture()
  const position = store.addToken({ type: 'spacing', name: 'origin', value: 0 })
  const width = store.addToken({ type: 'spacing', name: 'width', value: 100 })
  const color = store.addToken({ type: 'color', name: 'ink', value: '#080808' })
  store.bindToken('a', 'x', position.id)
  store.bindToken('a', 'width', width.id)
  store.bindToken('a', 'fill', color.id)
  const node = store.booleanSelection('union')
  store.update(node.id, 'path', { x: 200, width: node.width * 2, height: node.height * 2 })
  store.releaseBoolean(node.id)
  const source = store.getSnapshot().elements.a
  assert.equal(source.x, 200)
  assert.equal(source.width, 200)
  assert.deepEqual(source.tokenBindings, { fill: color.id })
  const restored = new SceneStore()
  restored.load(JSON.parse(JSON.stringify(store.toJSON())))
  assert.deepEqual(restored.toJSON(), store.toJSON())
  restored.updateToken(color.id, { value: '#81adec' })
  assert.equal(restored.getSnapshot().elements.a.style.fill, '#81adec')
  assert.equal(restored.getSnapshot().elements.a.x, 200)
})

test('uniformly scaled primitive sources retain their fill boundaries and dashed strokes on release', () => {
  const store = fixture()
  store.update('a', 'rectangle', { style: { stroke: { color: '#080808', width: 10, dash: [4, 8] } } })
  const node = store.booleanSelection('union')
  store.update(node.id, 'path', { width: node.width * 2, height: node.height * 2 })
  const resized = store.getSnapshot().elements[node.id]
  const expected = transformedSource(resized.boolean.operands[0], resized)
  store.releaseBoolean(node.id)
  const released = store.getSnapshot().elements.a
  assert.equal(released.type, 'rectangle')
  assert.equal(released.style.stroke.width, 20)
  assert.deepEqual(released.style.stroke.dash, [8, 16])
  const outline = computeBoolean([released, { ...released, id: 'duplicate' }], 'union')
  assert.deepEqual(outline.bounds, expected.bounds)
  close(area(outline.d), area(expected.d))
})

test('live boolean operators switch non-destructively preserving editable source paths', () => {
  const store = fixture()
  const compound = store.booleanSelection('union')
  assert.equal(compound.boolean.operation, 'union')
  assert.equal(compound.boolean.operands.length, 2)
  close(area(compound.d), 17500)

  // Switch to Subtract
  store.setBooleanOperation(compound.id, 'subtract')
  let current = store.getSnapshot().elements[compound.id]
  assert.equal(current.boolean.operation, 'subtract')
  assert.equal(current.boolean.operands.length, 2)
  close(area(current.d), 7500)

  // Switch to Intersect
  store.setBooleanOperation(compound.id, 'intersect')
  current = store.getSnapshot().elements[compound.id]
  assert.equal(current.boolean.operation, 'intersect')
  assert.equal(current.boolean.operands.length, 2)
  close(area(current.d), 2500)

  // Switch to Exclude
  store.setBooleanOperation(compound.id, 'exclude')
  current = store.getSnapshot().elements[compound.id]
  assert.equal(current.boolean.operation, 'exclude')
  assert.equal(current.boolean.operands.length, 2)
  close(area(current.d), 15000)

  // Switch back to Union
  store.setBooleanOperation(compound.id, 'union')
  current = store.getSnapshot().elements[compound.id]
  assert.equal(current.boolean.operation, 'union')
  close(area(current.d), 17500)
  assert.equal(current.boolean.operands[0].id, 'a')
  assert.equal(current.boolean.operands[1].id, 'b')
})

test('real-time contour re-baking on sub-element transform (position, dimension, rotation, radius)', () => {
  const store = fixture()
  const compound = store.booleanSelection('union')
  close(area(compound.d), 17500)

  // 1. Sub-element position transform
  store.updateBooleanOperand(compound.id, 'b', { x: 100, y: 100 })
  let updated = store.getSnapshot().elements[compound.id]
  assert.equal(updated.boolean.operands[1].x, 100)
  assert.equal(updated.boolean.operands[1].y, 100)
  // Non-overlapping squares: 100*100 + 100*100 = 20000
  close(area(updated.d), 20000)

  // 2. Sub-element dimension transform
  store.updateBooleanOperand(compound.id, 'b', { width: 50, height: 50 })
  updated = store.getSnapshot().elements[compound.id]
  assert.equal(updated.boolean.operands[1].width, 50)
  assert.equal(updated.boolean.operands[1].height, 50)
  // 10000 + 2500 = 12500
  close(area(updated.d), 12500)

  // 3. Sub-element corner radius transform
  store.updateBooleanOperand(compound.id, 'a', { cornerRadius: 20 })
  updated = store.getSnapshot().elements[compound.id]
  assert.equal(updated.boolean.operands[0].cornerRadius, 20)
  // Rounded corners decrease area
  assert.ok(area(updated.d) < 12500)

  // 4. Sub-element rotation transform
  store.updateBooleanOperand(compound.id, 'b', { rotation: 45 })
  updated = store.getSnapshot().elements[compound.id]
  assert.equal(updated.boolean.operands[1].rotation, 45)

  // 5. Undo restores all previous states accurately
  store.undo() // undo rotation
  assert.equal(store.getSnapshot().elements[compound.id].boolean.operands[1].rotation, 0)
  store.undo() // undo radius
  assert.equal(store.getSnapshot().elements[compound.id].boolean.operands[0].cornerRadius, 0)
  store.undo() // undo dimension
  assert.equal(store.getSnapshot().elements[compound.id].boolean.operands[1].width, 100)
  store.undo() // undo position
  assert.equal(store.getSnapshot().elements[compound.id].boolean.operands[1].x, 50)
  close(area(store.getSnapshot().elements[compound.id].d), 17500)
})

test('sub-element operand selection, highlighting, and deselect tracking', () => {
  const store = fixture()
  const compound = store.booleanSelection('union')

  let operandNotifications = 0
  let highlightNotifications = 0
  const unsubOperand = store.subscribeSelectedCompoundOperand(() => operandNotifications++)
  const unsubHighlight = store.subscribeHighlightedBooleanSource(() => highlightNotifications++)

  assert.equal(store.getSelectedCompoundOperand(), null)
  assert.equal(store.getHighlightedBooleanSource(), null)

  // Select operand 'b'
  store.setSelectedCompoundOperand({ compoundId: compound.id, operandId: 'b' })
  assert.deepEqual(store.getSelectedCompoundOperand(), { compoundId: compound.id, operandId: 'b' })
  assert.equal(store.getHighlightedBooleanSource(), 'b')
  assert.ok(operandNotifications > 0)
  assert.ok(highlightNotifications > 0)

  // Retrieve operand directly via getCompoundOperand
  const op = store.getCompoundOperand(compound.id, 'b')
  assert.ok(op)
  assert.equal(op.id, 'b')
  assert.equal(op.name, 'Cutter')

  // Deselection clears operand selection
  store.select([])
  assert.equal(store.getSelectedCompoundOperand(), null)

  unsubOperand()
  unsubHighlight()
})

test('operand muting and unmuting re-bakes contour in real time', () => {
  const store = new SceneStore()
  store.add('rectangle', { id: 'a', x: 0, y: 0, width: 100, height: 100 })
  store.add('rectangle', { id: 'b', x: 50, y: 0, width: 100, height: 100 })
  store.add('rectangle', { id: 'c', x: 100, y: 0, width: 100, height: 100 })
  store.select(['a', 'b', 'c'])
  const compound = store.booleanSelection('union')
  // Total union width 200, height 100 -> area 20000
  close(area(compound.d), 20000)

  // Mute middle operand 'b'
  store.toggleBooleanOperandMute(compound.id, 'b')
  let current = store.getSnapshot().elements[compound.id]
  assert.deepEqual(current.boolean.mutedOperandIds, ['b'])
  // Without 'b', shapes 'a' (0..100) and 'c' (100..200) meet at x=100
  // Both aliases should work
  store.toggleBooleanOperandMuted(compound.id, 'b') // unmute
  current = store.getSnapshot().elements[compound.id]
  assert.equal(current.boolean.mutedOperandIds, undefined)
  close(area(current.d), 20000)
})

test('duplicate, remove, and extract boolean operands', () => {
  const store = fixture()
  const compound = store.booleanSelection('union')
  assert.equal(compound.boolean.operands.length, 2)

  // Duplicate operand 'b'
  store.duplicateBooleanOperand(compound.id, 'b')
  let current = store.getSnapshot().elements[compound.id]
  assert.equal(current.boolean.operands.length, 3)
  const clone = current.boolean.operands[2]
  assert.equal(clone.name, 'Cutter Copy')
  assert.equal(clone.x, 60)
  assert.equal(clone.y, 60)

  // Remove the clone
  store.removeBooleanOperand(compound.id, clone.id)
  current = store.getSnapshot().elements[compound.id]
  assert.equal(current.boolean.operands.length, 2)

  // Extract operand 'b' back to the scene
  store.duplicateBooleanOperand(compound.id, 'b') // add 3rd so we can extract
  current = store.getSnapshot().elements[compound.id]
  assert.equal(current.boolean.operands.length, 3)

  store.extractBooleanOperand(compound.id, 'b')
  current = store.getSnapshot().elements[compound.id]
  assert.equal(current.boolean.operands.length, 2)
  // Extracted 'b' is now a top-level element in the scene
  assert.ok(store.getSnapshot().elements.b)
  assert.equal(store.getSnapshot().elements.b.type, 'path')
})

test('nested compound shapes, group, and unwrap hierarchy', () => {
  const store = new SceneStore()
  store.add('rectangle', { id: 'a', x: 0, y: 0, width: 100, height: 100 })
  store.add('rectangle', { id: 'b', x: 50, y: 0, width: 100, height: 100 })
  store.add('rectangle', { id: 'c', x: 100, y: 0, width: 100, height: 100 })
  store.select(['a', 'b', 'c'])
  const compound = store.booleanSelection('union')

  // Group operands 'b' and 'c' into a nested subtract compound
  store.groupBooleanOperands(compound.id, ['b', 'c'], 'subtract')
  let current = store.getSnapshot().elements[compound.id]
  assert.equal(current.boolean.operands.length, 2)
  const nested = current.boolean.operands[1]
  assert.equal(nested.type, 'path')
  assert.ok(nested.boolean)
  assert.equal(nested.boolean.operation, 'subtract')
  assert.equal(nested.boolean.operands.length, 2)

  // Change nested boolean operation to intersect
  store.setNestedBooleanOperation(compound.id, nested.id, 'intersect')
  current = store.getSnapshot().elements[compound.id]
  assert.equal(current.boolean.operands[1].boolean.operation, 'intersect')

  // Unwrap the nested boolean back into parent compound
  store.unwrapNestedBoolean(compound.id, nested.id)
  current = store.getSnapshot().elements[compound.id]
  assert.equal(current.boolean.operands.length, 3)
})

