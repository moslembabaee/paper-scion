import test from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate } from 'node:timers/promises'
import { CollaborationSession } from '../src/collaboration/session.ts'
import { SceneReplica } from '../src/collaboration/model.ts'
import { SceneStore } from '../src/scene/store.ts'

const settle = async () => { for (let i = 0; i < 4; i++) await setImmediate() }
const response = (body, status = 200) => new Response(JSON.stringify(body), { status })

function setup(t, transport) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 100_000 })
  const streams = [], requests = [], sessions = []
  class Stream extends EventTarget {
    closed = false
    constructor(url) { super(); this.url = url; streams.push(this) }
    emit(type, body) { this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(body) })) }
    close() { this.closed = true }
  }
  const window = new EventTarget(), document = Object.assign(new EventTarget(), { hidden: false })
  const replacements = { window, document, navigator: { onLine: true }, EventSource: Stream }
  const descriptors = Object.fromEntries(Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, { value, configurable: true })
  t.after(() => {
    for (const session of sessions) session.stop()
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  })
  const store = new SceneStore(); store.add('rectangle', { id: 'rect', x: 20, y: 30 }); store.clearHistory()
  const seed = new SceneReplica('seed'); seed.seed(store.toJSON())
  const remote = { id: crypto.randomUUID(), name: 'Mira Chen', color: '#81adec', status: 'active', cursor: { x: 120, y: 240 }, selection: [], viewport: { center: { x: 400, y: 300 }, zoom: 2, size: { width: 1440, height: 900 } }, following: null }
  const state = { registers: seed.export(), peers: [remote] }
  let camera = { x: 0, y: 0, zoom: 1 }, size = { width: 900, height: 600 }, stopped = 0
  const listeners = new Set()
  const controller = {
    getSnapshot: () => ({ camera, size }),
    screenToWorld: point => ({ x: (point.x - camera.x) / camera.zoom, y: (point.y - camera.y) / camera.zoom }),
    subscribe: listener => { listeners.add(listener); listener({ camera, size }); return () => listeners.delete(listener) },
    setCamera: next => { camera = next; for (const listener of listeners) listener({ camera, size }) },
    stop: () => { stopped++ },
  }
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const request = { route: new URL(url, 'http://paper.local').pathname.split('/').at(-1), body: options.body ? JSON.parse(options.body) : undefined, options }
    requests.push(request)
    return transport ? transport(request, state) : response(request.route === 'join' ? { ...state, token: request.body.token } : {})
  })
  const session = new CollaborationSession(crypto.randomUUID(), store, controller, 'Ada'); sessions.push(session)
  const open = async () => { await settle(); assert.ok(streams.length); streams.at(-1).emit('state', state); await settle() }
  const tick = async (ms = 33) => { t.mock.timers.tick(ms); await settle() }
  return { session, store, seed, state, remote, streams, requests, window, document, controller, open, tick, stops: () => stopped }
}

test('optimistic pre-join edits survive snapshots; remote deletion publishes the cleared selection', async t => {
  const rig = setup(t), { session, store } = rig
  session.start(); session.start()
  store.update('rect', 'rectangle', { x: 200 }); store.select(['rect'])
  assert.equal(store.getSnapshot().elements.rect.x, 200)
  await rig.open(); await rig.tick()
  assert.equal(rig.requests.filter(request => request.route === 'join').length, 1)
  assert.equal(store.getSnapshot().elements.rect.x, 200)
  const sent = rig.requests.find(request => request.route === 'update')
  assert.ok(sent.body.changes.some(change => change.path.at(-1) === 'x' && change.value === 200))
  assert.deepEqual(sent.body.presence.selection, ['rect'])
  const before = store.toJSON(), other = new SceneStore(); other.load(before); other.remove('rect')
  const remote = new SceneReplica(rig.remote.id, rig.seed.export())
  rig.streams.at(-1).emit('changes', remote.change(before, other.toJSON()))
  assert.equal(store.getSnapshot().elements.rect, undefined)
  assert.deepEqual(store.getSnapshot().selection, [])
  await rig.tick()
  assert.deepEqual(rig.requests.filter(request => request.route === 'update').at(-1).body.presence.selection, [])
})

test('follow uses world center on unequal viewports and stops immediately when explicitly ended or leader goes away', async t => {
  const rig = setup(t); rig.session.start(); await rig.open()
  rig.session.follow(rig.remote.id)
  assert.deepEqual(rig.controller.getSnapshot().camera, { x: -350, y: -300, zoom: 2 })
  assert.equal(rig.session.getSnapshot().following, rig.remote.id)
  rig.session.follow(null); assert.equal(rig.stops(), 1)
  rig.session.follow(rig.remote.id)
  rig.streams.at(-1).emit('peers', [{ ...rig.remote, status: 'away', cursor: null }])
  assert.equal(rig.session.getSnapshot().following, null); assert.equal(rig.stops(), 2)
  rig.streams.at(-1).emit('peers', [{ ...rig.remote, following: rig.session.id }])
  rig.session.follow(rig.remote.id)
  assert.equal(rig.session.getSnapshot().following, null)
})

test('lost initial join response retries with the same credential and replays edits made offline', async t => {
  let joins = 0
  const rig = setup(t, (request, state) => {
    if (request.route !== 'join') return response({})
    if (++joins === 1) throw new Error('Response lost after the relay accepted the join')
    return response({ ...state, token: request.body.token })
  })
  rig.session.start(); await settle()
  assert.equal(rig.session.getSnapshot().status, 'reconnecting')
  rig.store.update('rect', 'rectangle', { y: 480 })
  await rig.tick(2000); await rig.open(); await rig.tick()
  const joined = rig.requests.filter(request => request.route === 'join')
  assert.equal(joined.length, 2); assert.equal(joined[0].body.token, joined[1].body.token)
  assert.equal(rig.session.getSnapshot().status, 'live')
  assert.equal(rig.store.getSnapshot().elements.rect.y, 480)
  assert.ok(rig.requests.find(request => request.route === 'update').body.changes.some(change => change.value === 480))
})

test('an obsolete join response cannot replace the reconnected stream', async t => {
  let resolveFirst, joins = 0
  const rig = setup(t, (request, state) => {
    if (request.route !== 'join') return response({})
    if (++joins === 1) return new Promise(resolve => { resolveFirst = resolve })
    return response({ ...state, token: request.body.token })
  })
  rig.session.start(); await settle()
  rig.window.dispatchEvent(new Event('offline'))
  assert.equal(rig.requests[0].options.signal.aborted, true)
  rig.window.dispatchEvent(new Event('online')); await rig.open()
  resolveFirst(response({ ...rig.state, token: 'obsolete-token' })); await settle()
  assert.equal(rig.streams.length, 1)
  assert.equal(rig.streams[0].closed, false)
  assert.equal(rig.session.getSnapshot().status, 'live')
  rig.session.stop(); await rig.tick(10_000)
  assert.equal(rig.requests.filter(request => request.route === 'join').length, 2)
})

test('presence idles, becomes away when hidden, and returns to active after visibility resumes', async t => {
  const rig = setup(t); rig.session.start(); await rig.open(); await rig.tick()
  await rig.tick(70_000); await rig.tick()
  assert.equal(rig.requests.filter(request => request.route === 'update').at(-1).body.presence.status, 'idle')
  rig.document.hidden = true; rig.document.dispatchEvent(new Event('visibilitychange')); await rig.tick()
  assert.equal(rig.requests.filter(request => request.route === 'update').at(-1).body.presence.status, 'away')
  rig.document.hidden = false; rig.document.dispatchEvent(new Event('visibilitychange')); await rig.tick()
  assert.equal(rig.requests.filter(request => request.route === 'update').at(-1).body.presence.status, 'active')
  rig.session.setCursor({ x: 120, y: 240 }); await rig.tick()
  assert.deepEqual(rig.requests.filter(request => request.route === 'update').at(-1).body.presence.cursor, { x: 120, y: 240 })
})

test('an acknowledged batch never drops a newer edit to the same property', async t => {
  let resolveUpdate, updates = 0
  const rig = setup(t, (request, state) => {
    if (request.route === 'join') return response({ ...state, token: request.body.token })
    if (request.route === 'update' && ++updates === 1) return new Promise(resolve => { resolveUpdate = resolve })
    return response({})
  })
  rig.session.start(); await rig.open()
  rig.store.update('rect', 'rectangle', { x: 100 }); await rig.tick()
  rig.store.update('rect', 'rectangle', { x: 200 })
  resolveUpdate(response({})); await settle(); await rig.tick()
  const batches = rig.requests.filter(request => request.route === 'update')
  assert.equal(batches.length, 2)
  assert.ok(batches[0].body.changes.some(change => change.path.at(-1) === 'x' && change.value === 100))
  assert.ok(batches[1].body.changes.some(change => change.path.at(-1) === 'x' && change.value === 200))
  assert.equal(rig.store.getSnapshot().elements.rect.x, 200)
})

test('a stale failed update cannot disconnect the replacement connection or lose its pending edits', async t => {
  let rejectUpdate, updates = 0
  const rig = setup(t, (request, state) => {
    if (request.route === 'join') return response({ ...state, token: request.body.token })
    if (request.route === 'update' && ++updates === 1) return new Promise((_, reject) => { rejectUpdate = reject })
    return response({})
  })
  rig.session.start(); await rig.open()
  rig.store.update('rect', 'rectangle', { x: 100 }); await rig.tick()
  rig.window.dispatchEvent(new Event('offline'))
  rig.store.update('rect', 'rectangle', { y: 400 })
  rig.window.dispatchEvent(new Event('online')); await rig.open()
  rejectUpdate(new Error('Old request failed')); await settle(); await rig.tick()
  assert.equal(rig.session.getSnapshot().status, 'live')
  assert.equal(rig.streams.at(-1).closed, false)
  const replay = rig.requests.filter(request => request.route === 'update').at(-1)
  assert.ok(replay.body.changes.some(change => change.path.at(-1) === 'x' && change.value === 100))
  assert.ok(replay.body.changes.some(change => change.path.at(-1) === 'y' && change.value === 400))
})

test('a semantically rejected edit restores accepted state and exposes the relay explanation', async t => {
  const rig = setup(t, (request, state) => {
    if (request.route === 'join') return response({ ...state, token: request.body.token })
    if (request.route === 'update' && request.body.changes) return response({ error: 'Shared edit rejected: invalid reference', registers: state.registers }, 409)
    return response({})
  })
  rig.session.start(); await rig.open()
  rig.store.update('rect', 'rectangle', { x: 800 })
  assert.equal(rig.store.getSnapshot().elements.rect.x, 800)
  await rig.tick()
  assert.equal(rig.store.getSnapshot().elements.rect.x, 20)
  assert.match(rig.session.getSnapshot().error, /invalid reference/)
  assert.equal(rig.session.getSnapshot().status, 'live')
})

for (const status of [404, 405, 501]) {
  test(`terminal error ${status} aborts retry loop immediately and transitions status to unavailable`, async t => {
    const rig = setup(t, request => {
      if (request.route === 'join') return response({ error: 'Not Supported' }, status)
      return response({})
    })
    rig.session.start()
    await settle()
    assert.equal(rig.session.getSnapshot().status, 'unavailable')
    assert.match(rig.session.getSnapshot().error, new RegExp(`${status}`))
    const initialRequests = rig.requests.length

    // Advance clock past any retry timer
    await rig.tick(2000)
    await rig.tick(4000)
    await rig.tick(30000)
    assert.equal(rig.requests.length, initialRequests)
  })
}

test('transient failures use exponential backoff up to 30s and pause after max retry attempts', async t => {
  let joins = 0
  const rig = setup(t, request => {
    if (request.route === 'join') {
      joins++
      return response({ error: 'Service Unavailable' }, 503)
    }
    return response({})
  })
  rig.session.start()
  await settle()
  assert.equal(joins, 1)
  assert.equal(rig.session.getSnapshot().status, 'reconnecting')

  // Attempt 1 backoff: 2000ms
  await rig.tick(1900)
  assert.equal(joins, 1)
  await rig.tick(100)
  assert.equal(joins, 2)

  // Attempt 2 backoff: 4000ms
  await rig.tick(3900)
  assert.equal(joins, 2)
  await rig.tick(100)
  assert.equal(joins, 3)

  // Attempt 3 backoff: 8000ms
  await rig.tick(8000)
  assert.equal(joins, 4)

  // Attempt 4 backoff: 16000ms
  await rig.tick(16000)
  assert.equal(joins, 5)

  // Attempt 5 backoff: 30000ms (clamped from 32000ms to max 30000ms)
  await rig.tick(30000)
  assert.equal(joins, 6)

  // Max retries reached: paused and set to unavailable
  assert.equal(rig.session.getSnapshot().status, 'unavailable')
  assert.match(rig.session.getSnapshot().error, /paused|repeated failures|Retry/i)

  // Advancing time further makes NO new attempts
  await rig.tick(60000)
  assert.equal(joins, 6)

  // Manual retry resets attempts and triggers new connection attempt
  rig.session.retry()
  await settle()
  assert.equal(joins, 7)
})

test('manual retry restores connection attempt from unavailable state', async t => {
  let attempts = 0
  const rig = setup(t, (request, state) => {
    if (request.route !== 'join') return response({})
    attempts++
    if (attempts === 1) return response({ error: 'Endpoint not allowed' }, 405)
    return response({ ...state, token: request.body.token })
  })
  rig.session.start()
  await settle()
  assert.equal(rig.session.getSnapshot().status, 'unavailable')
  assert.equal(attempts, 1)

  await rig.tick(10000)
  assert.equal(attempts, 1)

  // User clicks manual Retry
  rig.session.retry()
  await rig.open()
  await rig.tick()
  assert.equal(attempts, 2)
  assert.equal(rig.session.getSnapshot().status, 'live')
})

test('terminal error during update aborts connection and transitions to unavailable', async t => {
  let updates = 0
  const rig = setup(t, (request, state) => {
    if (request.route === 'join') return response({ ...state, token: request.body.token })
    if (request.route === 'update') {
      updates++
      return response({ error: 'Endpoint gone' }, 404)
    }
    return response({})
  })
  rig.session.start()
  await rig.open()
  assert.equal(rig.session.getSnapshot().status, 'live')

  rig.store.update('rect', 'rectangle', { x: 500 })
  await rig.tick()
  assert.equal(updates, 1)
  assert.equal(rig.session.getSnapshot().status, 'unavailable')
  assert.match(rig.session.getSnapshot().error, /404/)

  await rig.tick(10000)
  assert.equal(updates, 1)
})

