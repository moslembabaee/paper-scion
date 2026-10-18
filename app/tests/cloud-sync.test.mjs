import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import ts from 'typescript'
import { canonical, newer } from '../src/cloud/model.ts'
import { ApiError } from '../src/cloud/api.ts'

// Run the actual hook with deterministic effects and timers, without browser sockets.
async function harness({ guest = false, guestProject = false, foreignProject = false } = {}) {
  const states = [], cleanups = [], timers = new Map(), listeners = new Set()
  let timerId = 0, version = 0, dirty = false
  let live = { format: 'paper', version: 1, name: 'Study', grid: true, viewport: { x: 0, y: 0, zoom: 1 }, scene: { version: 1, elements: {}, rootIds: [] } }
  const initial = { id: 'project', name: live.name, document: live, createdAt: 1, updatedAt: 1, cloud: { owner: 'account', projectId: 'project', revision: null, dirty: true, syncedAt: 0 } }
  if (guestProject) delete initial.cloud
  if (foreignProject) initial.cloud.owner = 'other-account'
  const records = new Map([['project', initial]])
  const network = { remote: null, extra: new Map(), lists: 0, puts: 0, hold: null, conflict: null, error: null }
  const browser = new EventTarget(), document = new EventTarget(), navigator = { onLine: true }
  document.hidden = false
  const current = () => structuredClone(records.get('project'))
  const io = {
    getProject: () => live, getEditVersion: () => version, hasPendingEdits: () => dirty,
    applyRemoteProject: (project, expectedVersion) => {
      if (dirty || expectedVersion !== version) return false
      live = structuredClone(project); return true
    },
    persistProject: async () => {
      if (!dirty) return
      dirty = false
      const old = current()
      records.set('project', { ...old, name: live.name, document: structuredClone(live), updatedAt: Date.now(), ...(old.cloud ? { cloud: { ...old.cloud, dirty: true } } : {}) })
      for (const notify of listeners) notify({ id: 'project', source: 'local' })
    },
  }
  const manager = {
    persistent: true,
    active: { record: initial, store: { applyRemote: scene => { live = { ...live, scene } } }, controller: { setCamera: viewport => { live = { ...live, viewport } } } },
    acceptCloud: async (record, expected, preserve) => {
      if (expected && canonical(records.get(record.id)?.document) !== canonical(expected)) return false
      if (preserve) records.set('recovery', { ...current(), id: 'recovery', cloud: { owner: 'account', projectId: 'recovery', revision: null, syncedAt: 0, dirty: true } })
      records.set(record.id, structuredClone(record)); return true
    },
  }
  const api = async (path, options = {}) => {
    if (options.signal?.aborted) throw new Error('Aborted')
    if (network.error) throw network.error
    if (path === '/projects') { network.lists++; return { projects: [...(network.remote ? [network.remote] : []), ...network.extra.values()].map(({ id, revision }) => ({ id, revision })) } }
    const id = path.split('/').pop()
    if (id !== 'project') {
      if (options.method !== 'PUT') return structuredClone(network.extra.get(id))
      network.puts++
      const body = JSON.parse(options.body)
      const remote = { id, revision: `revision-${network.puts}`, document: body.document, updatedAt: body.updatedAt, createdAt: 1 }
      network.extra.set(id, remote)
      return structuredClone(remote)
    }
    if (options.method !== 'PUT') return structuredClone(network.remote)
    network.puts++
    const body = JSON.parse(options.body), hold = network.hold
    network.hold = null
    if (hold) await hold
    if (network.conflict) { network.remote = network.conflict; network.conflict = null }
    if (body.expectedRevision !== (network.remote?.revision ?? null)) throw new ApiError(409, 'Conflict', structuredClone(network.remote))
    network.remote = { id: 'project', revision: `revision-${network.puts}`, document: body.document, updatedAt: body.updatedAt, createdAt: 1 }
    return structuredClone(network.remote)
  }
  const mocks = {
    react: {
      useState: value => { const index = states.push(value) - 1; return [value, next => { states[index] = next }] },
      useRef: value => ({ current: value }), useCallback: callback => callback,
      useEffect: effect => { const cleanup = effect(); if (cleanup) cleanups.push(cleanup) },
    },
    '../workspace/database': { listLocalProjects: async () => structuredClone([...records.values()]), readProject: async id => structuredClone(records.get(id)), subscribeProjectChanges: callback => { listeners.add(callback); return () => listeners.delete(callback) } },
    './model': { canonical, newer }, './api': { api, ApiError },
  }
  const globals = {
    window: browser, document, navigator, EventSource: class extends EventTarget { close() {} },
    // Crypto's worker-pool completion is unrelated to sync ordering. Keep the real hash deterministic.
    crypto: { subtle: { digest: async (_algorithm, data) => createHash('sha256').update(data).digest() } },
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id },
    clearTimeout: id => timers.delete(id), setInterval: () => 0, clearInterval: () => {},
  }
  const key = `__paperSyncTest${crypto.randomUUID().replaceAll('-', '')}`
  globalThis[key] = { mocks, globals }
  const dataURL = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
  let source = ts.transpileModule(await readFile(new URL('../src/cloud/useCloudSync.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText
  for (const [specifier, exports] of Object.entries(mocks)) {
    const module = Object.keys(exports).map(name => `export const ${name} = globalThis.${key}.mocks[${JSON.stringify(specifier)}].${name};`).join('\n')
    source = source.replaceAll(`from '${specifier}'`, `from '${dataURL(module)}'`)
  }
  source = `const { ${Object.keys(globals).join(', ')} } = globalThis.${key}.globals;\n${source}`
  const { useCloudSync } = await import(dataURL(source))
  delete globalThis[key]
  const sync = useCloudSync(manager, io, guest ? null : { id: 'account' }, remote => { live = { ...live, name: remote.document.name, grid: remote.document.grid } })
  const settle = async () => { for (let i = 0; i < 25; i++) await new Promise(resolve => setImmediate(resolve)) }
  const drain = async (limit = 5) => {
    await settle()
    for (let i = 0; timers.size && i < limit; i++) {
      const [id, timer] = timers.entries().next().value
      timers.delete(id); timer.callback(); await settle()
    }
    assert.equal(timers.size, 0, 'sync must become idle instead of enqueueing its own acknowledgements')
  }
  return { sync, states, network, records, navigator, browser, io, live: () => live, settle, drain,
    dispose: () => cleanups.forEach(cleanup => cleanup()), edit: name => { live = { ...live, name }; version++; dirty = true },
    notify: change => { for (const listener of listeners) listener(change) }, timers }
}

test('successful sync becomes idle and guest mode never calls cloud APIs', async () => {
  const h = await harness(); await h.drain()
  assert.equal(h.states[0], 'synced'); assert.equal(h.network.puts, 1)
  assert.equal(h.records.get('project').cloud.dirty, false); h.dispose()
  const guest = await harness({ guest: true }); await guest.drain()
  assert.equal(guest.states[0], 'auth-required'); assert.equal(guest.network.lists, 0); assert.equal(guest.network.puts, 0); guest.dispose()
})

test('edits during a delayed PUT stay queued and upload the newer document', async () => {
  const h = await harness(); await h.drain()
  let release
  h.network.hold = new Promise(resolve => { release = resolve })
  h.edit('First upload'); h.sync.retry(); await h.settle(); assert.equal(h.network.puts, 2)
  h.edit('Newer edit'); await h.io.persistProject(); await h.settle()
  release(); await h.drain()
  assert.equal(h.live().name, 'Newer edit'); assert.equal(h.network.remote.document.name, 'Newer edit')
  assert.equal(h.records.get('project').cloud.dirty, false); assert.equal(h.states[0], 'synced'); h.dispose()
})

test('offline outbox is durable and reconnect flushes queued edits', async () => {
  const h = await harness(); await h.drain()
  h.navigator.onLine = false; h.browser.dispatchEvent(new Event('offline'))
  h.edit('Offline draft'); await h.io.persistProject(); await h.drain()
  assert.equal(h.network.puts, 1); assert.equal(h.states[0], 'offline'); assert.equal(h.records.get('project').cloud.dirty, true)
  h.navigator.onLine = true; h.browser.dispatchEvent(new Event('online')); await h.drain()
  assert.equal(h.network.remote.document.name, 'Offline draft'); assert.equal(h.states[0], 'synced'); h.dispose()
})

test('remote conflict winner preserves the losing local draft', async () => {
  const h = await harness(); await h.drain()
  h.network.conflict = { ...h.network.remote, revision: 'winner', updatedAt: Date.now() + 1000, document: { ...h.network.remote.document, name: 'Remote winner' } }
  h.edit('Local draft'); h.sync.retry(); await h.drain()
  assert.equal(h.live().name, 'Remote winner'); assert.equal(h.records.get('recovery').document.name, 'Local draft')
  assert.equal(h.records.get('project').cloud.dirty, false); h.dispose()
})

test('newer local conflict winner retries using the current server revision', async () => {
  const h = await harness(); await h.drain()
  h.network.conflict = { ...h.network.remote, revision: 'older', updatedAt: 1, document: { ...h.network.remote.document, name: 'Old remote' } }
  h.edit('Local winner'); h.sync.retry(); await h.drain()
  assert.equal(h.live().name, 'Local winner'); assert.equal(h.network.remote.document.name, 'Local winner')
  assert.equal(h.records.get('project').cloud.dirty, false); h.dispose()
})

test('expired sessions pause requests and retain edits until retry succeeds', async () => {
  const h = await harness(); await h.drain()
  h.network.error = new ApiError(401, 'Expired'); h.edit('Private draft'); h.sync.retry(); await h.drain()
  assert.equal(h.states[0], 'auth-required'); assert.equal(h.records.get('project').cloud.dirty, true)
  h.edit('Another private edit'); await h.io.persistProject(); await h.drain()
  assert.equal(h.states[0], 'auth-required', 'local saves must not dismiss an expired-session indicator')
  h.network.error = null; h.sync.retry(); await h.drain()
  assert.equal(h.network.remote.document.name, 'Another private edit'); assert.equal(h.states[0], 'synced'); h.dispose()
})

test('a clean tab hydrates another tab’s acknowledged document and becomes idle', async () => {
  const h = await harness(); await h.drain()
  const updated = { ...h.network.remote.document, name: 'Other tab edit' }
  h.network.remote = { ...h.network.remote, document: updated, revision: 'other-tab', updatedAt: 20 }
  const old = h.records.get('project')
  h.records.set('project', { ...old, document: updated, name: updated.name, updatedAt: 20, cloud: { ...old.cloud, revision: 'other-tab' } })
  h.notify({ id: 'project', source: 'cloud', external: true }); await h.drain()
  assert.equal(h.live().name, 'Other tab edit'); assert.equal(h.network.puts, 1)
  assert.equal(h.states[0], 'synced'); h.dispose()
})

test('legacy unowned projects silently save to the authenticated account and become idle', async () => {
  const h = await harness({ guestProject: true }); await h.drain()
  assert.equal(h.network.puts, 1)
  assert.equal(h.records.get('project').cloud.owner, 'account')
  h.edit('Cloud study'); await h.io.persistProject(); await h.drain()
  assert.equal(h.states[0], 'synced'); assert.equal(h.network.puts, 2)
  assert.equal(h.network.remote.document.name, 'Cloud study')
  assert.equal(h.records.get('project').cloud.dirty, false); h.dispose()
})

test('another account’s cached projects are never adopted or uploaded', async () => {
  const h = await harness({ foreignProject: true }); await h.drain()
  assert.equal(h.network.puts, 0)
  assert.equal(h.records.get('project').cloud.owner, 'other-account')
  assert.notEqual(h.states[0], 'synced'); h.dispose()
})

test('unavailable cloud backs off and cleanup cancels queued retries', async () => {
  const h = await harness(); await h.drain()
  h.network.error = new ApiError(503, 'Unavailable'); h.sync.retry(); await h.settle()
  assert.equal(h.states[0], 'offline')
  for (const delay of [2000, 4000, 8000, 16000, 32000, 60000, 60000]) {
    assert.equal(h.timers.size, 1)
    const [id, timer] = h.timers.entries().next().value
    assert.equal(timer.delay, delay)
    h.timers.delete(id); timer.callback(); await h.settle()
  }
  h.dispose(); assert.equal(h.timers.size, 0)
})
