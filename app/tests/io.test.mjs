import test from 'node:test'
import assert from 'node:assert/strict'
import { SceneStore } from '../src/scene/store.ts'
import { createShader } from '../src/shaders/catalog.ts'
import { createProject, fileName, parseProject, serializeProject } from '../src/io/project.ts'
import { exportBounds, exportRoots, sceneToSVG } from '../src/io/svg.ts'
import { pngDimensions } from '../src/io/export.ts'
import { insertImportedScene } from '../src/io/import.ts'

const options = { scope: 'selection', scale: 2, background: 'transparent' }
const scene = () => {
  const store = new SceneStore()
  store.add('frame', { id: 'frame', x: 120, y: 240, width: 720, height: 480 })
  store.add('rectangle', { id: 'rect', parentId: 'frame', x: 40, y: 50, width: 100, height: 80, cornerRadius: 12 })
  store.add('text', { id: 'text', parentId: 'frame', x: 40, y: 150, text: 'A < B & C', fontSize: 24 })
  store.select(['frame'])
  return store
}

test('project files round-trip all scene data, name, camera and preferences without selection', () => {
  const store = scene()
  store.update('rect', 'rectangle', { style: { shader: createShader('mesh-gradient') } })
  store.setBackgroundShader(createShader('dithering'))
  const project = createProject(store, 'Study', { x: -144, y: 12, zoom: .5 }, false)
  const restored = parseProject(serializeProject(project))
  assert.deepEqual(restored, project)
  assert.equal('selection' in restored.scene, false)
  assert.equal(createProject(store, '  ', project.viewport, true).name, 'Untitled')
  assert.equal(parseProject(JSON.stringify(store.toJSON())).name, 'Untitled')
})

test('invalid project settings and malicious hierarchies reject without changing the store', () => {
  const store = scene()
  const before = store.getSnapshot()
  const project = createProject(store, 'Study', { x: 0, y: 0, zoom: 1 }, true)
  const cases = [null, [], { ...project, version: 2 }, { ...project, name: '' }, { ...project, grid: 'yes' }, { ...project, viewport: { x: 0, y: 0, zoom: 0 } }, { ...project, scene: { ...project.scene, rootIds: ['missing'] } }, { ...project, scene: { ...project.scene, elements: { frame: null } } }]
  for (const value of cases) assert.throws(() => parseProject(JSON.stringify(value)))
  assert.throws(() => parseProject('{broken'), /valid JSON/)
  assert.equal(store.getSnapshot(), before)
  assert.equal(fileName('a/b: c\n', 'paper.json'), 'a-b- c-.paper.json')
})

test('selected frames export exact artboard bounds and high-DPI dimensions', () => {
  const store = scene()
  const state = store.getSnapshot()
  assert.deepEqual(exportBounds(state, 'selection'), { x: 120, y: 240, width: 720, height: 480 })
  assert.deepEqual(pngDimensions(state, options), { width: 1440, height: 960 })
  assert.deepEqual(pngDimensions(state, { ...options, scale: 4 }), { width: 2880, height: 1920 })
  const svg = sceneToSVG(state, options)
  assert.match(svg, /viewBox="120 240 720 480"/)
  assert.match(svg, /clipPath/)
  assert.match(svg, /<text /)
  assert.match(svg, /A &lt; B &amp; C/)
  assert.doesNotMatch(svg, /foreignObject|artboard-label|viewport-grid/)
  assert.match(sceneToSVG(state, { ...options, background: 'cream' }), /fill="#edebe1"/)
})

test('selected descendants keep world transforms and inherited opacity/clipping', () => {
  const store = scene()
  store.update('frame', 'frame', { rotation: 90, style: { opacity: .5 } })
  store.update('rect', 'rectangle', { style: { opacity: .5 } })
  store.select(['rect'])
  const svg = sceneToSVG(store.getSnapshot(), options)
  assert.match(svg, /transform="matrix\(0 1 -1 0 670 160\)"/)
  assert.match(svg, /opacity="0.25"/)
  assert.match(svg, /clipPath/)
  assert.doesNotMatch(svg, /A &lt; B/)
})

test('selection descendants deduplicate, paint order stays stable, and hidden ancestors suppress export', () => {
  const store = scene()
  store.select(['text', 'rect', 'frame'])
  assert.deepEqual(exportRoots(store.getSnapshot(), 'selection'), ['frame'])
  store.select(['text', 'rect'])
  assert.deepEqual(exportRoots(store.getSnapshot(), 'selection'), ['rect', 'text'])
  store.setVisible('frame', false)
  assert.equal(exportBounds(store.getSnapshot(), 'canvas'), null)
  assert.throws(() => sceneToSVG(store.getSnapshot(), { ...options, scope: 'canvas' }), /no visible layers/)
})

test('whole canvas includes overflow from unclipped frames, but clips hidden content', () => {
  const store = new SceneStore()
  store.add('frame', { id: 'f', width: 100, height: 100, clipContent: false })
  store.add('rectangle', { id: 'r', parentId: 'f', x: 200, width: 50, height: 20 })
  assert.deepEqual(exportBounds(store.getSnapshot(), 'canvas'), { x: 0, y: 0, width: 250, height: 100 })
  store.update('f', 'frame', { clipContent: true })
  assert.deepEqual(exportBounds(store.getSnapshot(), 'canvas'), { x: 0, y: 0, width: 100, height: 100 })
})

test('SVG image sizing, rounded clips, strokes and shader snapshots survive serialization', () => {
  const store = scene()
  store.add('path', { id: 'path', parentId: 'frame', d: 'M0 0L10 10', viewBox: [0, 0, 10, 10], style: { fill: null, stroke: { color: '#080808', width: 2, dash: [2, 4] } } })
  store.add('image', { id: 'image', parentId: 'frame', src: '/asset.png', fit: 'cover', cornerRadius: 8 })
  store.update('rect', 'rectangle', { style: { shader: createShader('mesh-gradient') } })
  assert.throws(() => sceneToSVG(store.getSnapshot(), options), /could not be captured/)
  const svg = sceneToSVG(store.getSnapshot(), options, { images: new Map([['image', 'data:image/png;base64,AAAA']]), shaders: new Map([['rect', 'data:image/png;base64,BBBB']]) })
  assert.match(svg, /stroke-dasharray="2 4"/)
  assert.match(svg, /preserveAspectRatio="xMidYMid slice"/)
  assert.match(svg, /rx="8"/)
  assert.match(svg, /data:image\/png;base64,AAAA/)
  assert.match(svg, /data:image\/png;base64,BBBB/)
  assert.doesNotMatch(svg, /\/asset.png/)
})

test('PNG memory and dimension limits reject before allocating pixels', () => {
  const store = new SceneStore()
  store.add('frame', { id: 'large', width: 10000, height: 10000 })
  store.select(['large'])
  assert.throws(() => pngDimensions(store.getSnapshot(), { ...options, scale: 1 }), /too large/)
  store.update('large', 'frame', { width: 9000, height: 1 })
  assert.throws(() => pngDimensions(store.getSnapshot(), options), /too large/)
})

test('paste insertion remaps colliding IDs, retains hierarchy, centers artwork, and notifies once', () => {
  const destination = scene()
  const imported = scene()
  let notifications = 0
  destination.subscribe(() => notifications++)
  const roots = insertImportedScene(destination, imported.toJSON(), { x: 1000, y: 2000 })
  assert.equal(notifications, 1)
  assert.equal(roots.length, 1)
  assert.notEqual(roots[0], 'frame')
  const state = destination.getSnapshot()
  const node = state.elements[roots[0]]
  assert.equal(node.x, 640)
  assert.equal(node.y, 1760)
  assert.equal(node.zIndex, 1)
  assert.equal(node.children.length, 2)
  for (const id of node.children) assert.equal(state.elements[id].parentId, node.id)
  assert.deepEqual(state.selection, roots)
  assert.equal(state.elements.frame.x, 120)
  const reloaded = new SceneStore()
  reloaded.load(destination.toJSON())
  assert.deepEqual(reloaded.toJSON(), destination.toJSON())
  const before = destination.getSnapshot()
  assert.throws(() => insertImportedScene(destination, { version: 1, elements: {}, rootIds: ['missing'] }, { x: 0, y: 0 }))
  assert.equal(destination.getSnapshot(), before)
})
