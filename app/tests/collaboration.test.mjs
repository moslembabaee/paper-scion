import test from 'node:test'
import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { SceneReplica, normalizeHierarchy } from '../src/collaboration/model.ts'
import { SceneStore } from '../src/scene/store.ts'
import { CollaborationServer } from '../collaboration/server.ts'
import { roomFromHash } from '../src/collaboration/room.ts'

const copy = value => structuredClone(value)
function fixture() {
  const store = new SceneStore()
  store.add('frame', { id: 'frame' })
  store.add('rectangle', { id: 'rect', parentId: 'frame', x: 20, y: 30 })
  store.clearHistory()
  const seed = new SceneReplica('seed'); seed.seed(store.toJSON())
  return { store, seed, a: new SceneReplica('a', seed.export()), b: new SceneReplica('b', seed.export()) }
}
function valid(document) { const store = new SceneStore(); store.load(document); return store }

test('concurrent edits to position and nested paint merge in any order without clobbering', () => {
  const { store, a, b, seed } = fixture(), before = store.toJSON()
  store.update('rect', 'rectangle', { x: 200, style: { fill: '#81adec' } })
  const left = a.change(before, store.toJSON())
  const other = valid(before); other.update('rect', 'rectangle', { y: 400, style: { opacity: .5 } })
  const right = b.change(before, other.toJSON())
  const one = new SceneReplica('one', seed.export()), two = new SceneReplica('two', seed.export())
  one.merge([...left, ...right, ...left]); two.merge([...right, ...left, ...right])
  assert.deepEqual(one.document(), two.document())
  const node = valid(one.document()).getSnapshot().elements.rect
  assert.equal(node.x, 200); assert.equal(node.y, 400); assert.equal(node.style.fill, '#81adec'); assert.equal(node.style.opacity, .5)
})

test('same-field conflicts use actor tie breaks and later logical timestamps', () => {
  const { store, a, b } = fixture(), before = store.toJSON()
  store.update('rect', 'rectangle', { x: 100 }); const left = a.change(before, store.toJSON())
  const other = valid(before); other.update('rect', 'rectangle', { x: 200 }); const right = b.change(before, other.toJSON())
  a.merge(right); b.merge(left)
  assert.deepEqual(a.document(), b.document()); assert.equal(a.document().elements.rect.x, 200)
  const next = valid(a.document()); next.update('rect', 'rectangle', { x: 300 })
  b.merge(a.change(a.document(), next.toJSON())); assert.equal(b.document().elements.rect.x, 300)
})

test('concurrent additions preserve every sibling and produce valid contiguous paint order', () => {
  const { store, a, b } = fixture(), before = store.toJSON()
  store.add('ellipse', { id: 'a-child', parentId: 'frame' })
  const left = a.change(before, store.toJSON())
  const other = valid(before); other.add('rectangle', { id: 'b-child', parentId: 'frame' })
  const right = b.change(before, other.toJSON())
  a.merge(right); b.merge(left)
  assert.deepEqual(a.document(), b.document())
  assert.deepEqual(valid(a.document()).getChildren('frame'), ['rect', 'a-child', 'b-child'])
})

test('deletion wins over delayed property edits; explicit undo can restore an entity', () => {
  const { store, a, b } = fixture(), before = store.toJSON()
  store.remove('rect'); const removed = a.change(before, store.toJSON())
  const other = valid(before); other.update('rect', 'rectangle', { x: 400 }); const moved = b.change(before, other.toJSON())
  a.merge(moved); b.merge(removed)
  assert.deepEqual(a.document(), b.document()); assert.equal(a.document().elements.rect, undefined)
  const restored = a.change(a.document(), before); b.merge(restored)
  assert.deepEqual(a.document(), b.document()); assert.equal(b.document().elements.rect.x, 20)
})

test('a concurrent child survives a deleted parent, and cyclic reparenting repairs deterministically', () => {
  const { store, a, b } = fixture(), before = store.toJSON()
  store.remove('frame'); const removed = a.change(before, store.toJSON())
  const other = valid(before); other.add('text', { id: 'new-child', parentId: 'frame' }); const added = b.change(before, other.toJSON())
  a.merge(added); b.merge(removed)
  assert.deepEqual(a.document(), b.document()); assert.deepEqual(valid(a.document()).getChildren(null), ['new-child'])
  const tree = new SceneStore(); tree.add('frame', { id: 'a' }); tree.add('frame', { id: 'b' })
  const document = copy(tree.toJSON()); document.elements.a.parentId = 'b'; document.elements.b.parentId = 'a'
  const repaired = normalizeHierarchy(document)
  assert.equal(repaired.elements.a.parentId, null); valid(repaired)
})

test('nullable nested paints replace older leaves without reviving them', () => {
  const { store, a } = fixture()
  store.update('rect', 'rectangle', { style: { shadow: { x: 2, y: 3, blur: 4, color: '#080808' } } })
  a.change(a.document(), store.toJSON())
  const before = store.toJSON(); store.update('rect', 'rectangle', { style: { shadow: null } }); a.change(before, store.toJSON())
  assert.equal(valid(a.document()).getSnapshot().elements.rect.style.shadow, null)
})

test('remote changes preserve selection and rebase local undo/redo and active gestures', () => {
  const { store } = fixture(); store.select(['rect']); store.update('rect', 'rectangle', { x: 100 })
  const remote = valid(store.toJSON()); remote.update('rect', 'rectangle', { y: 400 })
  store.applyRemote(remote.toJSON()); assert.deepEqual(store.getSnapshot().selection, ['rect'])
  store.undo(); assert.equal(store.getSnapshot().elements.rect.x, 20); assert.equal(store.getSnapshot().elements.rect.y, 400)
  store.redo(); assert.equal(store.getSnapshot().elements.rect.x, 100); assert.equal(store.getSnapshot().elements.rect.y, 400)
  store.beginTransaction('Drag'); store.update('rect', 'rectangle', { x: 200 })
  remote.update('rect', 'rectangle', { x: 200, style: { fill: '#81adec' } }); store.applyRemote(remote.toJSON())
  store.cancelTransaction(); assert.equal(store.getSnapshot().elements.rect.x, 100); assert.equal(store.getSnapshot().elements.rect.style.fill, '#81adec')
})

test('remote arrivals and deletions remain valid across undo', () => {
  const { store } = fixture(); store.update('rect', 'rectangle', { x: 100 })
  const remote = valid(store.toJSON()); remote.add('text', { id: 'remote-child', parentId: 'frame' }); store.applyRemote(remote.toJSON())
  store.undo(); assert.ok(store.getSnapshot().elements['remote-child']); valid(store.toJSON())
  store.redo(); remote.remove('rect'); store.applyRemote(remote.toJSON()); store.undo(); assert.equal(store.getSnapshot().elements.rect, undefined); valid(store.toJSON())
})

test('register validation blocks prototype pollution and malformed timestamps', () => {
  const replica = new SceneReplica('test')
  assert.throws(() => replica.merge([{ path: ['elements', '__proto__', 'x'], clock: 1, actor: 'a', value: true }]), /Invalid/)
  assert.throws(() => replica.merge([{ path: ['tokens'], clock: Infinity, actor: 'a', value: [] }]), /Invalid/)
  assert.equal({}.x, undefined)
  assert.equal(roomFromHash('#room=bad'), null)
})

test('self-hosted relay seeds rooms, isolates sessions, streams updates and validates mutations', async t => {
  const relay = new CollaborationServer(); t.after(() => relay.close())
  // Exercise the real streaming HTTP middleware without requiring a listening socket.
  const call = async (path, data, method = 'POST', origin = undefined) => {
    const request = new PassThrough()
    request.url = `/__paper_collaboration/${path}`
    request.method = method
    request.headers = { host: 'paper.local', 'content-type': 'application/json', ...(origin ? { origin } : {}) }
    const response = new PassThrough(), chunks = []
    response.writeHead = (status, headers) => { response.statusCode = status; response.headers = headers; response.headersSent = true }
    response.on('data', chunk => chunks.push(chunk.toString()))
    const completed = new Promise(resolve => response.once('finish', resolve))
    relay.middleware(request, response, () => { response.writeHead(404); response.end() })
    request.end(data === undefined ? '' : JSON.stringify(data))
    if (method !== 'GET' || !path.includes('/events')) await completed
    return { response, status: response.statusCode, text: () => chunks.join(''), json: () => JSON.parse(chunks.join('')) }
  }
  const room = crypto.randomUUID(), { store } = fixture()
  const user = id => ({ id, name: 'Ada', color: '#81adec', status: 'active', cursor: { x: 120, y: 240 }, selection: ['rect'], viewport: { center: { x: 0, y: 0 }, zoom: 1, size: { width: 900, height: 600 } }, following: null })
  const first = crypto.randomUUID(), second = crypto.randomUUID()
  const credential = crypto.randomUUID()
  const joined = (await call(`${room}/join`, { id: first, token: credential, presence: user(first), document: store.toJSON() })).json()
  assert.equal(joined.token, credential)
  // Retrying a join whose response was lost must preserve the original session.
  const retried = (await call(`${room}/join`, { id: first, token: credential, presence: user(first), document: store.toJSON() })).json()
  assert.equal(retried.token, credential); assert.equal(retried.peers.length, 1)
  const other = (await call(`${room}/join`, { id: second, presence: user(second), document: new SceneStore().toJSON() })).json()
  assert.equal(other.peers.length, 2); assert.ok(new SceneReplica(second, other.registers).document().elements.rect)
  assert.equal((await call(`${room}/events?id=${first}&token=wrong`, undefined, 'GET')).status, 401)
  const stream = await call(`${room}/events?id=${second}&token=${other.token}`, undefined, 'GET')
  assert.match(stream.text(), /event: state/)
  const replica = new SceneReplica(first, joined.registers), before = store.toJSON(); store.update('rect', 'rectangle', { x: 500 })
  const changes = replica.change(before, store.toJSON())
  assert.equal((await call(`${room}/update?id=${first}&token=${joined.token}`, { changes, presence: user(first) })).status, 200)
  assert.match(stream.text(), /event: changes/)
  const invalid = [{ path: ['elements', 'rect', 'width'], clock: 100, actor: first, value: -1 }]
  assert.equal((await call(`${room}/update?id=${first}&token=${joined.token}`, { changes: invalid })).status, 409)
  assert.equal((await call(`${room}/update?id=${first}&token=${joined.token}`, { presence: { ...user(first), viewport: { ...user(first).viewport, size: { width: -1, height: 600 } } } })).status, 400)
  assert.equal((await call(`${room}/update?id=${first}&token=${joined.token}`, { presence: user(first) }, 'POST', 'https://evil.local')).status, 403)
  const isolatedRoom = crypto.randomUUID()
  const isolated = (await call(`${isolatedRoom}/join`, { id: crypto.randomUUID(), presence: user(first), document: new SceneStore().toJSON() })).json()
  assert.equal(isolated.peers.length, 1); assert.equal(Object.keys(new SceneReplica('test', isolated.registers).document().elements).length, 0)
  const resynced = (await call(`${room}/join`, { id: first, token: joined.token, presence: user(first), document: new SceneStore().toJSON() })).json()
  assert.equal(new SceneReplica('reconnected', resynced.registers).document().elements.rect.x, 500)
  assert.equal((await call(`${room}/leave?id=${first}&token=${joined.token}`, {})).status, 200)
  stream.response.destroy()
})
