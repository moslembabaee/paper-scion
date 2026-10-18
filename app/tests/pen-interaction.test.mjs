import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { SceneStore } from '../src/scene/store.ts'
import { ViewportController } from '../src/canvas/ViewportController.ts'

// Run the real pointer handlers and scene transactions without browser sockets.
// Only React's mounting and the DOM event surface are replaced.
async function mountPen(store, { editingId = null, zoom = 1 } = {}) {
  const root = new EventTarget(), viewport = new EventTarget(), document = new EventTarget(), window = new EventTarget()
  const effects = [], cleanups = [], frames = new Map(), captured = new Set()
  let nextFrame = 0, finished = false, firstRef = true
  root.closest = () => viewport
  root.getBoundingClientRect = () => ({ left: 0, top: 0 })
  root.setPointerCapture = id => captured.add(id)
  root.hasPointerCapture = id => captured.has(id)
  root.releasePointerCapture = id => captured.delete(id)
  viewport.dataset = {}; viewport.focus = () => {}
  document.querySelector = () => null
  document.elementsFromPoint = () => []
  const controller = new ViewportController({ x: 0, y: 0, zoom })
  const react = {
    useRef: current => { const ref = { current: firstRef ? root : current }; firstRef = false; return ref },
    useState: initial => { let value = typeof initial === 'function' ? initial() : initial; return [value, next => { value = typeof next === 'function' ? next(value) : next }] },
    useLayoutEffect: effect => effects.push(effect), useEffect: effect => effects.push(effect),
  }
  const key = `__paperPenTest${crypto.randomUUID().replaceAll('-', '')}`
  const dataURL = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
  const runtime = {
    react, window, document,
    requestAnimationFrame: callback => { const id = ++nextFrame; frames.set(id, callback); return id },
    cancelAnimationFrame: id => frames.delete(id),
  }
  globalThis[key] = runtime
  const reactURL = dataURL(Object.keys(react).map(name => `export const ${name} = globalThis.${key}.react.${name};`).join('\n'))
  const jsxURL = dataURL('export const jsx = (type, props) => ({ type, props }); export const jsxs = jsx; export const Fragment = "fragment";')
  const sceneURL = dataURL('export const useScene = (store, select) => select(store.getSnapshot());')
  const inspectorURL = dataURL('export const PathNodeInspector = "node-inspector";')
  const path = new URL('../src/scene/PenOverlay.tsx', import.meta.url)
  let source = ts.transpileModule(await readFile(path, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } }).outputText
  source = source.replace(/import ['"]\.\/pen\.css['"];?/, '')
    .replace(/from ['"]react\/jsx-runtime['"]/g, `from '${jsxURL}'`)
    .replace(/from ['"]react['"]/g, `from '${reactURL}'`)
    .replace(/from ['"]\.\/useScene['"]/g, `from '${sceneURL}'`)
    .replace(/from ['"]\.\/PathNodeInspector['"]/g, `from '${inspectorURL}'`)
    .replace(/from ['"](\.[^'"]+)['"]/g, (_match, specifier) => `from '${new URL(specifier.replace(/\.ts$/, '') + '.ts', path).href}'`)
  const { PenOverlay } = await import(dataURL(`const { window, document, requestAnimationFrame, cancelAnimationFrame } = globalThis.${key};\n${source}`))
  delete globalThis[key]
  const tree = PenOverlay({ store, controller, editingId, penMode: !editingId, onFinish: () => { finished = true } })
  for (const effect of effects) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup) }
  const surface = { closest: () => null }
  const anchor = (index, contour = 0, control) => ({ closest: selector => selector === '[data-anchor]' ? { dataset: { anchor: String(index), contour: String(contour), ...(control ? { control } : {}) } } : null })
  const pointer = (type, x, y, target = surface, extra = {}) => {
    const event = new Event(type, { cancelable: true })
    Object.assign(event, { clientX: x * zoom, clientY: y * zoom, button: 0, pointerType: 'mouse', pointerId: 1, detail: 1, ...extra })
    Object.defineProperty(event, 'target', { value: target })
    ;(type === 'pointermove' ? viewport : root).dispatchEvent(event)
    if (type === 'pointermove') { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()) }
  }
  const click = (x, y, target, extra) => { pointer('pointerdown', x, y, target, extra); pointer('pointerup', x, y, target, extra) }
  const keydown = key => {
    const event = new Event('keydown', { cancelable: true })
    Object.assign(event, { key }); Object.defineProperty(event, 'target', { value: surface })
    document.dispatchEvent(event)
  }
  const inspector = tree.props.children.find(child => child?.type === 'node-inspector')
  return { pointer, click, anchor, keydown, inspector, finished: () => finished,
    dispose: () => { cleanups.reverse().forEach(cleanup => cleanup()); controller.dispose() } }
}

test('pen snaps new vertices to scene geometry while tangent drags stay independent', async () => {
  const store = new SceneStore()
  store.add('rectangle', { x: 200, y: 100, width: 100, height: 100 })
  const pen = await mountPen(store)
  try {
    pen.pointer('pointerdown', 203, 103)
    pen.pointer('pointermove', 230, 110)
    pen.pointer('pointerup', 230, 110)
    pen.click(350, 250)
    pen.keydown('Enter')
    const path = store.getSnapshot().elements[store.getSnapshot().selection[0]]
    const first = path.nodes[0].anchors[0]
    assert.equal(first.x, 200); assert.equal(first.y, 100)
    assert.deepEqual(first.out, { x: 230, y: 110 })
    assert.deepEqual(first.in, { x: 170, y: 90 })
    assert.equal(pen.finished(), true)
    store.undo(); assert.equal(Object.values(store.getSnapshot().elements).filter(n => n.type === 'path').length, 0)
  } finally { pen.dispose() }
})

test('clicking a node near another vertex does not snap it until a drag starts', async () => {
  const store = new SceneStore()
  const path = store.add('path', { width: 100, height: 100, viewBox: [0, 0, 100, 100], d: 'M0 0L6 0L100 100' })
  store.select([path.id]); store.clearHistory()
  const pen = await mountPen(store, { editingId: path.id })
  try {
    const before = store.getSnapshot()
    pen.click(0, 0, pen.anchor(0))
    assert.equal(store.getSnapshot(), before)
    assert.equal(store.getHistorySnapshot().undoCount, 0)
  } finally { pen.dispose() }
})

test('Alt bypasses vertex snapping when placing a new pen point', async () => {
  const store = new SceneStore()
  store.add('rectangle', { x: 200, y: 100, width: 100, height: 100 })
  const pen = await mountPen(store)
  try {
    pen.click(203, 103, undefined, { altKey: true })
    pen.click(350, 250)
    pen.keydown('Enter')
    const first = store.getSnapshot().elements[store.getSnapshot().selection[0]].nodes[0].anchors[0]
    assert.equal(first.x, 203); assert.equal(first.y, 103)
  } finally { pen.dispose() }
})

test('pen closes by snapping near its first anchor and preserves the original vertices', async () => {
  const store = new SceneStore(), pen = await mountPen(store)
  try {
    pen.click(200, 100); pen.click(300, 100); pen.click(300, 200)
    // Outside the anchor hit area but inside the screen-space snap radius.
    pen.click(206, 103)
    assert.equal(pen.finished(), true)
    const path = store.getSnapshot().elements[store.getSnapshot().selection[0]]
    assert.equal(path.nodes[0].closed, true)
    assert.equal(path.nodes[0].anchors.length, 3)
    assert.equal(path.style.fill, '#81adec')
  } finally { pen.dispose() }
})

test('node drags snap the anchor despite an off-center grab and undo in one step', async () => {
  const store = new SceneStore()
  store.add('rectangle', { x: 200, y: 100, width: 100, height: 100 })
  const path = store.add('path', { width: 100, height: 100, viewBox: [0, 0, 100, 100], d: 'M0 0L100 100' })
  store.select([path.id]); store.clearHistory()
  const pen = await mountPen(store, { editingId: path.id, zoom: 2 })
  try {
    const before = store.getSnapshot(), handle = pen.anchor(0)
    pen.pointer('pointerdown', 1, 1, handle)
    pen.pointer('pointermove', 203, 103, handle)
    pen.pointer('pointerup', 203, 103, handle)
    const point = store.getSnapshot().elements[path.id].nodes[0].anchors[0]
    assert.equal(point.x, 200); assert.equal(point.y, 100)
    assert.equal(store.getHistorySnapshot().undoCount, 1)
    store.undo(); assert.equal(store.getSnapshot(), before)
  } finally { pen.dispose() }
})

test('subpath closure remains editable and reversible through the node inspector', async () => {
  const store = new SceneStore()
  const path = store.add('path', { width: 100, height: 100, viewBox: [0, 0, 100, 100], d: 'M0 0L100 0L100 100' })
  store.select([path.id]); store.clearHistory()
  const pen = await mountPen(store, { editingId: path.id })
  try {
    pen.click(100, 0, pen.anchor(1))
    pen.inspector.props.onEdit('toggle-closed')
    assert.equal(store.getSnapshot().elements[path.id].nodes[0].closed, true)
    assert.match(store.getSnapshot().elements[path.id].d, /Z/)
    store.undo(); assert.equal(store.getSnapshot().elements[path.id].d, path.d)
    store.redo(); pen.inspector.props.onEdit('toggle-closed')
    assert.equal(store.getSnapshot().elements[path.id].nodes[0].closed, false)
  } finally { pen.dispose() }
})
