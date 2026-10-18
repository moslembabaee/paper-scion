import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { SceneStore } from '../src/scene/store.ts'
import { createProject } from '../src/io/project.ts'
import { LiveCanvas } from '../src/mcp/live.ts'
import { LivePaperClient, PaperBridge } from '../mcp/bridge.ts'

function canvas(t) {
  const store = new SceneStore()
  const activities = []
  const live = new LiveCanvas({ projectId: 'project-a', store, getProject: () => createProject(store, 'Live study', { x: 0, y: 0, zoom: 1 }, true), onSettings() {}, onActivity: value => activities.push(value) })
  live.start()
  t.after(() => live.close())
  return { live, store, activities }
}

test('live tools use current state, preserve human selection, reject stale revisions and undo atomically', t => {
  const { live, store, activities } = canvas(t)
  const info = live.call('get_basic_info', {})
  assert.equal(info.file, 'project-a')
  assert.equal(info.fileName, 'Live study')
  const created = live.call('create_frame', { id: 'agent-frame', expected_revision: info.revision })
  assert.equal(store.getSnapshot().elements['agent-frame'].width, 720)
  assert.equal(store.getHistorySnapshot().undoCount, 1)
  assert.throws(() => live.call('update_element', { element_id: 'agent-frame', patch: { x: 240 }, expected_revision: info.revision }), /Revision mismatch/)
  store.select(['agent-frame'])
  assert.equal(live.revision, created.revision, 'selection does not invalidate document revisions')
  live.call('add_shader_shape', { id: 'paint', parentId: 'agent-frame', shader_kind: 'mesh-gradient' })
  assert.deepEqual(store.getSnapshot().selection, ['agent-frame'])
  assert.ok(activities.at(-1).ids.includes('paint'))
  store.undo()
  assert.equal(store.getSnapshot().elements.paint, undefined)
  assert.ok(store.getSnapshot().elements['agent-frame'])
  store.redo()
  assert.ok(store.getSnapshot().elements.paint.style.shader)
  const before = store.getSnapshot()
  assert.throws(() => live.call('update_element', { element_id: 'paint', parentId: 'missing', patch: { x: 240 } }), /Unknown element/)
  assert.equal(store.getSnapshot(), before)
  store.beginTransaction('Drag')
  assert.throws(() => live.call('create_frame', {}), /gesture/)
  store.cancelTransaction()
})

test('design tokens are validated and creation is undoable through live tools', t => {
  const { live, store } = canvas(t)
  const token = live.call('create_token', { name: 'agent-blue', type: 'color', value: '#81adec' }).token
  assert.equal(live.call('list_tokens', { type: 'color' }).tokens[0].id, token.id)
  assert.throws(() => live.call('create_token', { name: 'bad-radius', type: 'radius', value: -1 }))
  assert.equal(store.getSnapshot().tokens.length, 1)
  store.undo()
  assert.equal(live.call('list_tokens', {}).tokens.length, 0)
})

test('read activity and no-op updates preserve revision, history and human selection', t => {
  const { live, store, activities } = canvas(t)
  live.call('create_frame', { id: 'frame' })
  live.call('add_shader_shape', { id: 'shape', parentId: 'frame', shader_kind: 'dithering' })
  store.select(['shape'])
  const revision = live.revision
  const history = store.getHistorySnapshot().undoCount
  live.call('get_canvas_elements', { element_ids: ['frame'] })
  assert.ok(activities.at(-1).ids.includes('frame'))
  assert.ok(activities.at(-1).ids.includes('shape'))
  live.call('update_element', { element_id: 'frame', patch: { x: store.getSnapshot().elements.frame.x } })
  assert.equal(live.revision, revision)
  assert.equal(store.getHistorySnapshot().undoCount, history)
  assert.deepEqual(store.getSnapshot().selection, ['shape'])
})

function untilState(store, predicate) {
  if (predicate()) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { unsubscribe(); reject(new Error('Tab sync timed out')) }, 2000)
    const unsubscribe = store.subscribe(() => {
      if (predicate()) { clearTimeout(timer); unsubscribe(); resolve() }
    })
  })
}

test('real BroadcastChannels sync agent edits, late tabs and human undo with project isolation', async t => {
  const first = canvas(t)
  first.live.call('create_frame', { id: 'shared' })
  const peer = canvas(t)
  await untilState(peer.store, () => !!peer.store.getSnapshot().elements.shared)
  assert.equal(peer.live.revision, first.live.revision)
  peer.store.select(['shared'])
  first.live.call('update_element', { element_id: 'shared', patch: { width: 840 } })
  await untilState(peer.store, () => peer.store.getSnapshot().elements.shared.width === 840)
  assert.deepEqual(peer.store.getSnapshot().selection, ['shared'])
  peer.store.undo()
  await untilState(first.store, () => first.store.getSnapshot().elements.shared.width === 720)
  assert.equal(peer.live.revision, first.live.revision)

  const isolatedStore = new SceneStore()
  const isolated = new LiveCanvas({ projectId: 'other-project', store: isolatedStore, getProject: () => createProject(isolatedStore, 'Other', { x: 0, y: 0, zoom: 1 }, true), onSettings() {}, onActivity() {} })
  isolated.start()
  t.after(() => isolated.close())
  first.live.call('create_frame', { id: 'second' })
  await untilState(peer.store, () => !!peer.store.getSnapshot().elements.second)
  assert.equal(isolatedStore.getSnapshot().rootIds.length, 0)
})

test('library-only edits advance live revisions and synchronize themes, presets and undo', async t => {
  const first = canvas(t), peer = canvas(t)
  const before = first.live.revision
  const theme = first.store.addTheme('Dark')
  assert.notEqual(first.live.revision, before)
  await untilState(peer.store, () => peer.store.getSnapshot().styleLibrary.themes.some(value => value.id === theme))
  first.store.setActiveTheme(theme)
  await untilState(peer.store, () => peer.store.getSnapshot().styleLibrary.activeThemeId === theme)
  const preset = first.store.addSharedStyle({ kind: 'color', name: 'Accent', value: '#81adec' })
  await untilState(peer.store, () => peer.store.getSnapshot().styleLibrary.styles.some(value => value.id === preset.id))
  first.store.updateSharedStyle({ ...preset, value: '#222222' })
  await untilState(peer.store, () => peer.store.getSnapshot().styleLibrary.styles[0]?.value === '#222222')
  first.store.undo()
  await untilState(peer.store, () => peer.store.getSnapshot().styleLibrary.styles[0]?.value === '#81adec')
  assert.equal(peer.live.revision, first.live.revision)
  assert.equal(peer.store.getSnapshot().tokens.length, 0)
})

// Exercise the exact HTTP middleware without binding sockets, so this suite also
// runs in restricted build environments. Browser integration lives in Playwright.
function transport(bridge) {
  return (path, value, headers = {}, method = value === undefined ? 'GET' : 'POST') => {
    const request = Readable.from(value === undefined ? [] : [JSON.stringify(value)])
    Object.assign(request, { url: path, method, headers: { host: '127.0.0.1:29979', 'content-type': 'application/json', ...headers }, socket: { remoteAddress: '127.0.0.1' } })
    const response = new EventEmitter()
    response.headers = {}
    response.setHeader = (key, value) => { response.headers[key] = value }
    return new Promise(resolve => {
      response.writeHead = (status, headers = {}) => { response.status = status; Object.assign(response.headers, headers) }
      response.end = data => { response.emit('close'); resolve({ status: response.status, headers: response.headers, body: data ? JSON.parse(data) : undefined }) }
      bridge.middleware(request, response, () => response.end())
    })
  }
}

test('HTTP MCP routes to focused editor, keeps polls across focus changes and rejects untrusted origins', async t => {
  const bridge = new PaperBridge()
  t.after(() => bridge.close())
  const send = transport(bridge)
  await assert.rejects(bridge.call('get_basic_info', {}), /No live/)
  assert.equal((await send('/api/paper/connect', {}, { origin: 'https://example.com' })).status, 403)
  const first = crypto.randomUUID(), active = crypto.randomUUID()
  await send('/api/paper/connect', { clientId: first, projectId: 'first', focused: true })
  await send('/api/paper/connect', { clientId: active, projectId: 'active', focused: true })
  const poll = send(`/api/paper/events?clientId=${active}`)
  await send('/api/paper/connect', { clientId: active, projectId: 'active', focused: true })
  const init = await send('/mcp', { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } })
  const headers = { 'mcp-session-id': init.headers['MCP-Session-Id'] }
  assert.ok(headers['mcp-session-id'])
  assert.equal((await send('/mcp', { jsonrpc: '2.0', method: 'notifications/initialized' }, headers)).status, 202)
  const call = send('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_basic_info', arguments: {} } }, headers)
  const events = (await poll).body
  assert.equal(events.requests[0].name, 'get_basic_info')
  const id = events.requests[0].id
  await send(`/api/paper/reply?clientId=${first}`, { id, result: { wrong: true } })
  await send(`/api/paper/reply?clientId=${active}`, { id, result: { projectId: 'active' } })
  assert.deepEqual((await call).body.result.structuredContent, { projectId: 'active' })
  const next = bridge.call('create_frame', {})
  await send(`/api/paper/disconnect?clientId=${active}`, {})
  await assert.rejects(next, /closed/)
})

test('re-registering an editor to a different project cancels queued writes', async t => {
  const bridge = new PaperBridge()
  t.after(() => bridge.close())
  const send = transport(bridge)
  const clientId = crypto.randomUUID()
  await send('/api/paper/connect', { clientId, projectId: 'old', focused: true })
  const write = bridge.call('create_frame', { id: 'old-frame' })
  const rejected = assert.rejects(write, /closed/)
  await send('/api/paper/connect', { clientId, projectId: 'new', focused: true })
  await rejected
  const poll = send(`/api/paper/events?clientId=${clientId}`)
  await send(`/api/paper/disconnect?clientId=${clientId}`, {})
  assert.deepEqual((await poll).body.requests, [])
})

test('stdio live backend negotiates HTTP MCP and receives actual browser mutation results', async t => {
  const { live, store } = canvas(t)
  const bridge = new PaperBridge()
  t.after(() => bridge.close())
  const send = transport(bridge)
  await send('/api/paper/connect', { clientId: live.clientId, projectId: 'project-a', focused: true })
  // Adapt fetch to the real middleware. This exercises the stdio backend's
  // handshake and tool forwarding even where binding localhost is prohibited.
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    const parsed = new URL(url)
    const reply = await send(parsed.pathname + parsed.search, JSON.parse(options.body), Object.fromEntries(new Headers(options.headers)), options.method)
    return new Response(reply.body ? JSON.stringify(reply.body) : null, { status: reply.status, headers: reply.headers })
  }
  t.after(() => { globalThis.fetch = originalFetch })
  const client = new LivePaperClient()
  async function issue(name, args = {}) {
    const poll = send(`/api/paper/events?clientId=${live.clientId}`)
    const result = client.call(name, args)
    const request = (await poll).body.requests[0]
    let reply
    try { reply = { result: live.call(request.name, request.args) } }
    catch (error) { reply = { error: error.message } }
    await send(`/api/paper/reply?clientId=${live.clientId}`, { id: request.id, ...reply })
    return result
  }
  const info = await issue('get_basic_info')
  assert.equal(info.projectId, 'project-a')
  const frame = await issue('create_frame', { id: 'via-stdio', expected_revision: info.revision })
  assert.equal(store.getSnapshot().elements['via-stdio'].name, frame.element.name)
  assert.equal(frame.revision, live.revision)
  await issue('create_token', { name: 'bridge-blue', type: 'color', value: '#81adec' })
  assert.equal((await issue('list_tokens')).tokens[0].value, '#81adec')

  store.select(['via-stdio'])
  const selected = await issue('get_selection_context')
  assert.equal(selected.elements[0].id, 'via-stdio')
  assert.equal(selected.projectId, info.projectId)
  const page = await issue('search_layers', { query: 'frame', limit: 1 })
  assert.equal(page.results[0].id, 'via-stdio')
  assert.equal(page.revision, selected.revision)
  assert.equal(store.getSnapshot().selection[0], 'via-stdio')

  const plan = { expected_revision: selected.revision, idempotency_key: 'live-stdio-plan', operations: [
    { action: 'create', type: 'frame', id: 'atomic-card' },
    { action: 'create', type: 'text', parentId: '$0', text: 'Complete edit' },
    { action: 'create_token', name: 'atomic-accent', type: 'color', value: '#81adec' },
    { action: 'bind_token', element_id: '$1', property: 'fill', token_id: '$2' },
  ] }
  const before = store.getSnapshot(), history = store.getHistorySnapshot()
  const preview = await issue('apply_changes', { ...plan, dry_run: true })
  assert.equal(preview.dry_run, true)
  assert.equal(preview.revision, selected.revision)
  assert.equal(store.getSnapshot(), before)
  assert.deepEqual(store.getHistorySnapshot(), history)
  await assert.rejects(issue('apply_changes', { ...plan, operations: [plan.operations[0], { action: 'reparent', element_id: '$0', parentId: 'missing' }] }), /Unknown element/)
  assert.equal(store.getSnapshot(), before)
  const applied = await issue('apply_changes', plan)
  assert.equal(applied.applied, true)
  assert.equal(store.getSnapshot().elements[applied.actionResults[1].id].style.fill, '#81adec')
  assert.equal(store.getHistorySnapshot().undoCount, history.undoCount + 1)
  assert.deepEqual(store.getSnapshot().selection, ['via-stdio'])
  assert.deepEqual(await issue('apply_changes', plan), applied)
  await assert.rejects(issue('apply_changes', { ...plan, idempotency_key: 'stale-agent' }), /Revision mismatch/)
  store.undo()
  assert.equal(store.getSnapshot().elements['atomic-card'], undefined)
  assert.equal(store.getSnapshot().tokens.some(token => token.name === 'atomic-accent'), false)
  assert.deepEqual(store.getSnapshot().selection, ['via-stdio'])
  store.redo()
  assert.ok(store.getSnapshot().elements['atomic-card'])
  assert.equal((await issue('get_selection_context', { element_ids: [applied.actionResults[1].id] })).linkedTokens[0].value, '#81adec')

  bridge.close()
  await send('/api/paper/connect', { clientId: live.clientId, projectId: 'project-a', focused: true })
  await assert.rejects(client.call('create_frame', { id: 'never-replayed' }), /404/)
  assert.equal(store.getSnapshot().elements['never-replayed'], undefined)
  assert.equal((await issue('get_basic_info')).projectId, 'project-a')
})
