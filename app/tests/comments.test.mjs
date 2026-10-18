import test from 'node:test'
import assert from 'node:assert/strict'
import { SceneStore } from '../src/scene/store.ts'
import { SceneReplica } from '../src/collaboration/model.ts'
import { anchorAt, anchorPoint, createMessage, isUnread, mentionsIn, mentionsUser, validateComments } from '../src/comments/model.ts'

const ada = { id: 'ada', name: 'Ada Lovelace', username: 'ada' }
const mira = { id: 'mira', name: 'Mira Chen', username: 'mira' }
function addThread(store, id = 'thread') {
  const message = createMessage(ada, 'Check the spacing, @mira')
  const thread = { id, anchor: { nodeId: null, x: 120, y: 240, fallback: { x: 120, y: 240 } }, status: 'open', createdAt: message.createdAt, messages: { [message.id]: message } }
  store.setComments({ ...store.getSnapshot().comments, [id]: thread })
  return thread
}
function load(document) { const store = new SceneStore(); store.load(document); return store }

test('frame-relative pins follow ancestor transforms and resizing, with a deletion fallback', () => {
  const store = new SceneStore()
  store.add('frame', { id: 'parent', x: 120, y: 240, width: 400, height: 400, rotation: 90 })
  store.add('rectangle', { id: 'child', parentId: 'parent', x: 40, y: 60, width: 80, height: 100, rotation: 30 })
  const original = anchorPoint(store.getSnapshot(), { nodeId: 'child', x: .5, y: .5, fallback: { x: 0, y: 0 } })
  const anchor = anchorAt(store.getSnapshot(), original)
  assert.equal(anchor.nodeId, 'child')
  assert.ok(Math.abs(anchor.x - .5) < 1e-10); assert.ok(Math.abs(anchor.y - .5) < 1e-10)
  store.update('parent', 'frame', { x: 240 })
  assert.ok(Math.abs(anchorPoint(store.getSnapshot(), anchor).x - original.x - 120) < 1e-10)
  store.update('child', 'rectangle', { width: 160, height: 200 })
  const resized = anchorPoint(store.getSnapshot(), anchor)
  assert.notDeepEqual(resized, original)
  store.remove('parent')
  assert.deepEqual(anchorPoint(store.getSnapshot(), anchor), original)
  assert.equal(anchorAt(store.getSnapshot(), { x: -500, y: 600 }).nodeId, null)
})

test('threads round-trip with documents and undo/redo; invalid imports are atomic', () => {
  const store = new SceneStore(), thread = addThread(store)
  assert.deepEqual(load(store.toJSON()).toJSON(), store.toJSON())
  assert.ok(Object.isFrozen(store.getSnapshot().comments.thread.messages))
  store.undo(); assert.equal(store.getSnapshot().comments, undefined)
  store.redo(); assert.equal(store.getSnapshot().comments.thread.id, thread.id)
  const before = store.toJSON(), bad = structuredClone(before)
  bad.comments.thread.anchor.x = Infinity
  assert.throws(() => store.load(bad), /Invalid comment anchor/)
  assert.deepEqual(store.toJSON(), before)
  assert.throws(() => validateComments({ constructor: thread }), /Invalid comment thread/)
  assert.throws(() => createMessage(ada, ' \n '), /characters/)
  assert.throws(() => createMessage(ada, 'a'.repeat(4001)), /characters/)
})

test('concurrent replies and resolve merge without dropping messages, and remote replies survive local undo', () => {
  const base = new SceneStore(), thread = addThread(base), before = base.toJSON()
  const seed = new SceneReplica('seed'); seed.seed(before)
  const a = new SceneReplica('a', seed.export()), b = new SceneReplica('b', seed.export())
  const left = load(before), right = load(before), first = createMessage(ada, 'Left reply'), second = createMessage(mira, 'Right reply')
  left.setComments({ thread: { ...thread, messages: { ...thread.messages, [first.id]: first } } })
  right.setComments({ thread: { ...thread, status: 'resolved', messages: { ...thread.messages, [second.id]: second } } })
  const leftChanges = a.change(before, left.toJSON()), rightChanges = b.change(before, right.toJSON())
  a.merge(rightChanges); b.merge(leftChanges)
  assert.deepEqual(a.document(), b.document())
  const merged = load(a.document()).getSnapshot().comments.thread
  assert.equal(Object.keys(merged.messages).length, 3); assert.equal(merged.status, 'resolved')
  left.applyRemote(a.document()); left.undo()
  assert.equal(left.getSnapshot().comments.thread.messages[first.id], undefined)
  assert.equal(left.getSnapshot().comments.thread.messages[second.id].body, 'Right reply')
  assert.equal(left.getSnapshot().comments.thread.status, 'resolved')
})

test('simultaneous thread creation survives and deleted threads resist delayed replies', () => {
  const base = new SceneStore(), before = base.toJSON()
  const a = new SceneReplica('a'), b = new SceneReplica('b')
  a.seed(before); b.seed(before)
  const left = load(before), right = load(before)
  addThread(left, 'one'); addThread(right, 'two')
  const l = a.change(before, left.toJSON()), r = b.change(before, right.toJSON())
  a.merge(r); b.merge(l)
  assert.deepEqual(a.document(), b.document())
  assert.equal(Object.keys(load(a.document()).getSnapshot().comments).length, 2)
  const merged = a.document(), removed = load(merged), replied = load(merged)
  const { one, ...rest } = removed.getSnapshot().comments
  removed.setComments(rest)
  const message = createMessage(mira, 'Late reply')
  replied.setComments({ ...replied.getSnapshot().comments, one: { ...one, messages: { ...one.messages, [message.id]: message } } })
  const deleted = a.change(merged, removed.toJSON()), delayed = b.change(merged, replied.toJSON())
  a.merge(delayed); b.merge(deleted)
  assert.deepEqual(a.document(), b.document()); assert.equal(load(a.document()).getSnapshot().comments.one, undefined)
})

test('unread and mention filtering uses message identities and private read receipts', () => {
  const store = new SceneStore(), thread = addThread(store)
  assert.deepEqual(mentionsIn('Hi @Mira and @ada. name@example.com, @@ignored @mira'), ['mira', 'ada'])
  assert.equal(mentionsUser(thread, 'mira'), true)
  assert.equal(isUnread(thread, 'ada', new Set()), false)
  assert.equal(isUnread(thread, 'mira', new Set()), true)
  const seen = new Set(Object.keys(thread.messages))
  assert.equal(isUnread(thread, 'mira', seen), false)
  const reply = createMessage(ada, 'Same millisecond arrival'); reply.createdAt = thread.createdAt
  assert.equal(isUnread({ ...thread, messages: { ...thread.messages, [reply.id]: reply } }, 'mira', seen), true)
  assert.equal(store.toJSON().comments.thread.seen, undefined)
})

test('the self-hosted relay accepts comment registers, streams replies, and rejects malformed threads', async t => {
  const { CollaborationServer } = await import('../collaboration/server.ts')
  const { PassThrough } = await import('node:stream')
  const relay = new CollaborationServer(); t.after(() => relay.close())
  async function call(path, data, method = 'POST') {
    const request = new PassThrough(), response = new PassThrough(), chunks = []
    request.url = `/__paper_collaboration/${path}`; request.method = method
    request.headers = { host: 'paper.local', 'content-type': 'application/json' }
    response.writeHead = (status, headers) => { response.statusCode = status; response.headers = headers; response.headersSent = true }
    response.on('data', chunk => chunks.push(chunk.toString()))
    const done = new Promise(resolve => response.once('finish', resolve))
    relay.middleware(request, response, () => { response.writeHead(404); response.end() })
    request.end(data ? JSON.stringify(data) : '')
    if (method !== 'GET') await done
    return { status: response.statusCode, json: () => JSON.parse(chunks.join('')), text: () => chunks.join(''), response }
  }
  const room = crypto.randomUUID(), id = crypto.randomUUID(), store = new SceneStore()
  const presence = { id, name: 'Ada', status: 'active', cursor: null, selection: [], viewport: { center: { x: 0, y: 0 }, zoom: 1, size: { width: 900, height: 600 } }, following: null }
  const joined = (await call(`${room}/join`, { id, presence, document: store.toJSON() })).json()
  const endpoint = route => `${room}/${route}?id=${id}&token=${joined.token}`
  const stream = await call(endpoint('events'), undefined, 'GET')
  t.after(() => stream.response.destroy())
  const replica = new SceneReplica(id, joined.registers), before = store.toJSON(), thread = addThread(store)
  assert.equal((await call(endpoint('update'), { changes: replica.change(before, store.toJSON()) })).status, 200)
  assert.match(stream.text(), /event: changes/)
  assert.match(stream.text(), /Check the spacing/)
  const next = store.toJSON(), message = createMessage(mira, 'Reply from another designer')
  store.setComments({ thread: { ...thread, status: 'resolved', messages: { ...thread.messages, [message.id]: message } } })
  assert.equal((await call(endpoint('update'), { changes: replica.change(next, store.toJSON()) })).status, 200)
  assert.match(stream.text(), /Reply from another designer/)
  const invalid = [{ path: ['comments', 'thread', 'status'], clock: 1000, actor: id, value: 'invalid-status' }]
  assert.equal((await call(endpoint('update'), { changes: invalid })).status, 409)
  const snapshot = (await call(`${room}/join`, { id, token: joined.token, presence, document: before })).json()
  const restored = load(new SceneReplica('restore', snapshot.registers).document())
  assert.equal(restored.getSnapshot().comments.thread.status, 'resolved')
  assert.equal(Object.keys(restored.getSnapshot().comments.thread.messages).length, 2)
})
