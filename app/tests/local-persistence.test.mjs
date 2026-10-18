import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { SceneStore } from '../src/scene/store.ts'
import { ViewportController } from '../src/canvas/ViewportController.ts'
import { createProject } from '../src/io/project.ts'

// Exercise real scene/camera subscriptions and the hook's write queue without a DOM server.
async function harness() {
  const store = new SceneStore(), controller = new ViewportController()
  const cleanups = [], timers = new Map(), saved = [], states = []
  const frames = new Map()
  const previousRAF = globalThis.requestAnimationFrame, previousCancelRAF = globalThis.cancelAnimationFrame
  globalThis.requestAnimationFrame = callback => { const id = ++timerId; frames.set(id, callback); return id }
  globalThis.cancelAnimationFrame = id => frames.delete(id)
  let timerId = 0, nextWrite, opened
  const react = {
    useRef: current => ({ current }), useCallback: callback => callback,
    useState: value => { const index = states.push(value) - 1; return [value, next => { states[index] = next }] },
    useLayoutEffect: callback => callback(),
    useEffect: callback => { const cleanup = callback(); if (cleanup) cleanups.push(cleanup) },
  }
  const window = new EventTarget(), document = new EventTarget()
  window.setTimeout = (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id }
  window.clearTimeout = id => timers.delete(id)
  const key = `__paperIOTest${crypto.randomUUID().replaceAll('-', '')}`
  globalThis[key] = { react, window, document }
  const dataURL = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
  const reactURL = dataURL(Object.keys(react).map(name => `export const ${name} = globalThis.${key}.react.${name};`).join('\n'))
  let source = ts.transpileModule(await readFile(new URL('../src/io/useProjectIO.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText
  source = source.replaceAll("from 'react'", `from '${reactURL}'`).replace(/from '(\.[^']+)'/g, (_match, specifier) => `from '${new URL(`${specifier}.ts`, new URL('../src/io/useProjectIO.ts', import.meta.url)).href}'`)
  const { useProjectIO } = await import(dataURL(`const { window, document } = globalThis.${key};\n${source}`))
  delete globalThis[key]
  const io = useProjectIO({ store, controller, name: 'Study', grid: true, onImport() {}, onOpen: project => { opened = project },
    onPersist: async project => {
      const hold = nextWrite; nextWrite = undefined
      if (hold) await hold
      saved.push(project)
    },
  })
  await io.persistProject()
  return { io, store, controller, timers, saved, states, opened: () => opened,
    frame: () => { const callbacks = [...frames.values()]; frames.clear(); for (const callback of callbacks) callback(16) },
    hold: promise => { nextWrite = promise }, dispose: () => {
      cleanups.forEach(cleanup => cleanup()); controller.dispose()
      globalThis.requestAnimationFrame = previousRAF; globalThis.cancelAnimationFrame = previousCancelRAF
    } }
}

test('canvas edits are immediate, bounded autosave is deferred, and selection never saves', async () => {
  const h = await harness()
  const rectangle = h.store.add('rectangle', { id: 'shape', width: 120, height: 120 })
  assert.equal(h.store.getSnapshot().elements.shape, rectangle)
  assert.equal(h.saved.length, 1, 'a pointer edit must never wait for storage')
  assert.deepEqual([...h.timers.values()].map(timer => timer.delay), [650, 2000])
  await h.io.persistProject()
  const writes = h.saved.length, version = h.io.getEditVersion()
  h.store.select(['shape']); h.store.select([])
  h.controller.resize({ width: 1440, height: 900 })
  h.frame()
  assert.equal(h.io.getEditVersion(), version)
  assert.equal(h.io.hasPendingEdits(), false); assert.equal(h.timers.size, 0)
  await h.io.persistProject(); assert.equal(h.saved.length, writes)
  h.dispose()
})

test('cloud hydration applies settings and scene without marking the outbox dirty', async () => {
  const h = await harness(), remoteStore = new SceneStore()
  remoteStore.add('rectangle', { id: 'remote', width: 120, height: 120 })
  const remote = createProject(remoteStore, 'Remote study', { x: 120, y: 240, zoom: 2 }, false)
  const version = h.io.getEditVersion()
  assert.equal(h.io.applyRemoteProject(remote, version), true)
  h.frame()
  assert.deepEqual(h.io.getProject(), remote); assert.equal(h.opened(), remote)
  assert.equal(h.io.getEditVersion(), version); assert.equal(h.io.hasPendingEdits(), false)
  assert.equal(h.timers.size, 0)
  await h.io.persistProject(); assert.equal(h.saved.length, 1)
  h.store.update('remote', 'rectangle', { x: 360 })
  assert.equal(h.io.applyRemoteProject(remote, version), false, 'an incoming document must not replace live edits')
  assert.equal(h.store.getSnapshot().elements.remote.x, 360)
  await h.io.persistProject(); h.dispose()
})

test('serialized local writes keep newer edits made during a slow IndexedDB save', async () => {
  const h = await harness()
  let release
  h.hold(new Promise(resolve => { release = resolve }))
  h.store.add('rectangle', { id: 'shape', x: 120 })
  const first = h.io.persistProject()
  await Promise.resolve(); await Promise.resolve()
  h.store.update('shape', 'rectangle', { x: 240 })
  const second = h.io.persistProject()
  release(); await Promise.all([first, second])
  assert.deepEqual(h.saved.slice(1).map(project => project.scene.elements.shape.x), [120, 240])
  assert.equal(h.io.hasPendingEdits(), false)
  h.dispose()
})
