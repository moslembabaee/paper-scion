import test from 'node:test'
import assert from 'node:assert/strict'
import { themePalettes } from '../src/design-system/tokens.ts'
import { getTheme, initializeTheme, setTheme, subscribeTheme, THEME_STORAGE_KEY } from '../src/design-system/theme.ts'
import { drawGrid } from '../src/canvas/grid.ts'
import { drawHorizontalRuler, drawVerticalRuler } from '../src/canvas/rulers.ts'

function browser(storageValue = null, unavailable = false) {
  const properties = new Map()
  const events = new Map()
  const storage = new Map(storageValue === null ? [] : [[THEME_STORAGE_KEY, storageValue]])
  const meta = new Map()
  const root = { dataset: {}, style: { setProperty: (key, value) => properties.set(key, value) } }
  globalThis.document = { documentElement: root, querySelector: () => ({ setAttribute: (key, value) => meta.set(key, value) }) }
  globalThis.localStorage = {
    getItem: key => { if (unavailable) throw new Error('Storage denied'); return storage.get(key) ?? null },
    setItem: (key, value) => { if (unavailable) throw new Error('Storage denied'); storage.set(key, value) },
  }
  globalThis.window = { devicePixelRatio: 2, addEventListener: (key, listener) => events.set(key, listener) }
  return { root, properties, events, storage, meta }
}

function rasterCanvas() {
  const strokes = []
  const fills = []
  const segments = []
  const context = {
    setTransform() {}, clearRect() {}, beginPath() {}, moveTo() {},
    lineTo: (x, y) => segments.push([x, y]),
    stroke() { strokes.push(this.strokeStyle) },
    fillRect() { fills.push(this.fillStyle) },
    fillText() {}, save() {}, restore() {}, translate() {}, rotate() {},
  }
  return { canvas: { width: 0, height: 0, getContext: () => context }, context, strokes, fills, segments }
}

test('theme restores, persists, syncs between tabs, and notifies subscribers after applying colors', () => {
  const state = browser('light')
  initializeTheme()
  assert.equal(getTheme(), 'light')
  assert.equal(state.root.style.colorScheme, 'light')
  assert.equal(state.properties.get('--paper-surface'), '#ffffff')
  let changes = 0
  const unsubscribe = subscribeTheme(() => {
    changes++
    assert.equal(state.root.dataset.theme, getTheme())
    assert.equal(state.properties.get('--paper-canvas'), themePalettes[getTheme()].canvas)
  })
  setTheme('dark')
  assert.equal(state.storage.get(THEME_STORAGE_KEY), 'dark')
  assert.equal(state.meta.get('content'), '#121215')
  state.events.get('storage')({ key: THEME_STORAGE_KEY, newValue: 'light' })
  assert.equal(getTheme(), 'light')
  assert.equal(changes, 2)
  unsubscribe()
  state.events.get('storage')({ key: THEME_STORAGE_KEY, newValue: null })
  assert.equal(getTheme(), 'dark')
  assert.equal(changes, 2)
})

test('invalid saved preferences and blocked storage keep the switcher usable', () => {
  browser('invalid')
  initializeTheme()
  assert.equal(getTheme(), 'dark')
  const state = browser(null, true)
  initializeTheme()
  assert.doesNotThrow(() => setTheme('light'))
  assert.equal(state.root.dataset.theme, 'light')
  assert.equal(state.properties.get('--paper-canvas'), '#f8fafc')
  assert.deepEqual(Object.keys(themePalettes.light).sort(), Object.keys(themePalettes.dark).sort())
})

test('grid and rulers rasterize both palettes at device-pixel precision with a stable 120px grid', () => {
  browser()
  const snapshot = { camera: { x: 0, y: 0, zoom: 1 }, size: { width: 480, height: 240 } }
  for (const theme of ['dark', 'light']) {
    setTheme(theme)
    const palette = themePalettes[theme]
    const grid = rasterCanvas()
    drawGrid(grid.canvas, snapshot)
    assert.equal(grid.canvas.width, 960)
    assert.equal(grid.canvas.height, 480)
    assert.equal(grid.context.lineWidth, 0.5)
    assert.deepEqual(grid.strokes, [palette['grid-minor'], palette['grid-major'], palette['grid-axis']])
    assert.ok(grid.segments.some(([x, y]) => x === 120.25 && y === 240))
    for (const drawRuler of [drawHorizontalRuler, drawVerticalRuler]) {
      const ruler = rasterCanvas()
      drawRuler(ruler.canvas, snapshot)
      assert.deepEqual(ruler.fills, [palette.surface, palette.border])
      assert.ok(ruler.strokes.includes(palette['ruler-tick']))
      assert.equal(ruler.strokes.at(-1), palette['accent-text'])
    }
  }
  assert.deepEqual(snapshot.camera, { x: 0, y: 0, zoom: 1 })
})
