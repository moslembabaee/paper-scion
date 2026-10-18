import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './sharing-fixture.mjs'
import { createAppProject } from '../dist/src/make/manifest.js'

const definition = () => ({ name: 'submissions', schema: {
  name: { type: 'string', required: true, maxLength: 80 },
  subscribed: { type: 'boolean', required: true },
}, operations: ['list', 'get', 'create', 'update', 'delete'], quotas: { maxRecords: 2, maxBytes: 1024, operationsPerMinute: 60 } })
async function setup(t, extra) {
  const f = await fixture(t, extra)
  const owner = await f.login('data-owner'), other = await f.login('data-other')
  const project = await f.storage.apps.put(owner.user.id, 'form-app', createAppProject({ id: 'form-app' }), null)
  const request = (suffix, method = 'GET', input, headers = owner.headers, app = 'form-app') => f.request('/api/apps/' + app + suffix, {
    method, headers, ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  })
  const create = (input = definition()) => request('/data', 'POST', input)
  const invoke = (handle, input, headers, app) => request('/data/' + handle, 'POST', input, headers, app)
  return { f, owner, other, project, request, create, invoke }
}

test('owner opts into schema-constrained CRUD; form records persist across restart without changing source', async t => {
  const { f, owner, project, request, create, invoke } = await setup(t)
  assert.deepEqual((await request('/data')).data, { collections: [] })
  const created = await create()
  assert.equal(created.status, 201, 'owner can provision an app data capability')
  const { handle } = created.data
  assert.match(handle, /^dat_[A-Za-z0-9_-]{32}$/)
  const inserted = await invoke(handle, { operation: 'create', expectedRevision: 0, value: { name: 'Ada', subscribed: true } })
  assert.equal(inserted.status, 200)
  assert.equal(inserted.data.revision, 1)
  const id = inserted.data.records[0].id
  assert.deepEqual(inserted.data.records[0].value, { name: 'Ada', subscribed: true })
  await f.restart()
  assert.deepEqual((await invoke(handle, { operation: 'get', id })).data, inserted.data)
  const updated = await invoke(handle, { operation: 'update', id, expectedRevision: 1, value: { name: 'Grace', subscribed: false } })
  assert.equal(updated.status, 200)
  assert.equal(updated.data.revision, 2)
  assert.equal((await invoke(handle, { operation: 'list' })).data.records[0].value.name, 'Grace')
  assert.equal((await invoke(handle, { operation: 'delete', id, expectedRevision: 2 })).status, 200)
  assert.deepEqual((await invoke(handle, { operation: 'list' })).data, { revision: 3, records: [] })
  assert.deepEqual(await f.storage.apps.read(owner.user.id, project.id), project)
})

import { readFile, stat, rename, mkdir, rmdir, readdir, symlink, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AppData } from '../dist/server/app-data.js'

test('account, app, session, origin and guard isolate data even from shared editors', async t => {
  const { f, owner, other, request, create, invoke } = await setup(t)
  const { data: c } = await create()
  await request('/permissions', 'PUT', { accountId: other.user.id, role: 'editor', revision: 1 })
  for (const [suffix, method, input] of [
    ['/data', 'GET'], ['/data', 'POST', definition()],
    ['/data/' + c.handle, 'POST', { operation: 'list' }], ['/data/' + c.handle, 'DELETE', { expectedVersion: 1 }],
  ]) {
    assert.equal((await request(suffix, method, input, other.headers)).status, 404)
    assert.equal((await f.request('/api/shared-apps/' + owner.user.id + '/form-app' + suffix, {
      method, headers: other.headers, ...(input ? { body: JSON.stringify(input) } : {}),
    })).status, 403)
  }
  for (const [headers, status] of [[{}, 401], [{ Cookie: owner.headers.Cookie }, 403],
    [{ ...owner.headers, Origin: 'https://evil.test' }, 403], [{ ...owner.headers, 'X-Paper-Account': other.user.id }, 403],
    [{ Authorization: 'Bearer ' + owner.user.id, 'X-Paper-Client': 'web' }, 401]]) {
    assert.equal((await invoke(c.handle, { operation: 'list' }, headers)).status, status)
  }
  await f.storage.apps.put(owner.user.id, 'other-app', createAppProject({ id: 'other-app' }), null)
  assert.equal((await invoke(c.handle, { operation: 'list' }, undefined, 'other-app')).status, 404)
  await f.storage.apps.put(other.user.id, 'form-app', createAppProject({ id: 'form-app' }), null)
  assert.equal((await invoke(c.handle, { operation: 'list' }, other.headers)).status, 404)
  const row = await invoke(c.handle, { operation: 'create', expectedRevision: 0, value: { name: 'Private', subscribed: true } })
  const second = await create({ ...definition(), name: 'second' })
  assert.equal((await invoke(second.data.handle, { operation: 'get', id: row.data.records[0].id })).status, 404)
})

test('owner-defined operations and revocation are enforced on every call and survive restart', async t => {
  const { f, create, request, invoke } = await setup(t)
  const { data: c } = await create({ ...definition(), operations: ['create'] })
  assert.equal((await invoke(c.handle, { operation: 'list' })).status, 403)
  assert.equal((await invoke(c.handle, { operation: 'create', expectedRevision: 0, value: { name: 'Erase me', subscribed: true } })).status, 200)
  assert.equal((await request('/data/' + c.handle, 'DELETE', { expectedVersion: 2 })).status, 409)
  assert.equal((await request('/data/' + c.handle, 'DELETE', { expectedVersion: 1 })).status, 200)
  await f.restart()
  assert.equal((await invoke(c.handle, { operation: 'create', expectedRevision: 1, value: { name: 'Denied', subscribed: true } })).status, 403)
  const collections = (await request('/data')).data.collections
  assert.equal(collections[0].status, 'revoked'); assert.equal(collections[0].usage.records, 0)
  assert.ok(!JSON.stringify(collections).includes('Erase me'))
})

test('strict definitions reject unbounded schemas, prototype keys, SQL and network grants', async t => {
  let networkCalls = 0
  const { create, request, invoke } = await setup(t, { fetch: async () => { networkCalls++; throw new Error('Network forbidden') } })
  const d = definition()
  for (const bad of [
    { ...d, sql: 'CREATE TABLE data' }, { ...d, url: 'http://169.254.169.254/' },
    { ...d, name: '../other' }, { ...d, name: 'constructor' }, { ...d, operations: ['fetch'] },
    { ...d, operations: ['list', 'list'] }, { ...d, operations: [] },
    { ...d, schema: { name: { type: 'string' } } }, { ...d, schema: { name: { type: 'object' } } },
    { ...d, schema: { name: { type: 'string', maxLength: 4097 } } },
    { ...d, schema: { name: { type: 'string', maxLength: 40, pattern: '(a+)+$' } } },
    { ...d, schema: { count: { type: 'number', minimum: 5, maximum: 1 } } },
    { ...d, schema: { constructor: { type: 'boolean' } } },
    { ...d, quotas: { ...d.quotas, maxRecords: 1001 } }, { ...d, quotas: { ...d.quotas, maxBytes: 262145 } },
    { ...d, quotas: { ...d.quotas, operationsPerMinute: 121 } }, { ...d, quotas: { ...d.quotas, maxRecords: 0 } },
  ]) assert.equal((await create(bad)).status, 400, JSON.stringify(bad))
  const { data: c } = await create()
  for (const input of [
    { operation: 'sql', query: 'SELECT * FROM data' }, { operation: 'fetch', url: 'http://169.254.169.254' },
    { operation: 'list', where: { $ne: null } }, { operation: 'list', owner: 'other' },
    { operation: 'create', expectedRevision: 0, value: { name: { $gt: '' }, subscribed: true } },
    { operation: 'create', expectedRevision: 0, value: { name: 'x', subscribed: true, admin: true } },
    { operation: 'create', expectedRevision: 0, value: { name: 'x' } },
    { operation: 'create', expectedRevision: 0, value: { name: 'x', subscribed: 'true' } },
    { operation: 'create', expectedRevision: 0, value: { name: '😀'.repeat(21), subscribed: true } },
    { operation: 'get', id: '../other' }, { operation: 'list', offset: -1 },
  ]) assert.equal((await invoke(c.handle, input)).status, 400)
  const literal = "'); DROP TABLE data;-- <script>alert(1)</script>"
  const result = await invoke(c.handle, { operation: 'create', expectedRevision: 0, value: { name: literal, subscribed: true } })
  assert.equal(result.status, 200)
  assert.equal(result.data.records[0].value.name, literal, 'injection-looking text is inert data')
  assert.equal((await request('/data/' + c.handle, 'GET')).status, 405)
  assert.equal(networkCalls, 0)
})

test('malformed JSON and oversized requests fail without reflecting submitted records', async t => {
  const { f, owner, create, invoke } = await setup(t)
  const { data: c } = await create()
  for (const suffix of ['/data', '/data/' + c.handle]) {
    for (const body of ['{"private-submission":1,"private-submission":2}', '{"private-submission" 1}', '{"name":"\\uLEAK"}', '{"__proto__":{}}']) {
      const response = await f.request('/api/apps/form-app' + suffix, { method: 'POST', headers: owner.headers, rawBody: true, body })
      assert.equal(response.status, 400)
      assert.deepEqual(response.data, { error: 'Invalid JSON' })
    }
  }
  assert.equal((await invoke(c.handle, { operation: 'create', expectedRevision: 0, value: { name: 'x'.repeat(17000), subscribed: true } })).status, 413)
})

test('record and byte quotas are atomic; rejected mutations retain previous data and revision', async t => {
  const { create, invoke } = await setup(t)
  const { data: c } = await create()
  for (let i = 0; i < 2; i++) assert.equal((await invoke(c.handle, { operation: 'create', expectedRevision: i, value: { name: 'Ada', subscribed: true } })).status, 200)
  assert.equal((await invoke(c.handle, { operation: 'create', expectedRevision: 2, value: { name: 'Excess', subscribed: false } })).status, 409)
  const rows = (await invoke(c.handle, { operation: 'list' })).data
  assert.equal(rows.revision, 2); assert.equal(rows.records.length, 2)
  assert.equal((await invoke(c.handle, { operation: 'delete', expectedRevision: 2, id: rows.records[0].id })).status, 200)
  assert.equal((await invoke(c.handle, { operation: 'create', expectedRevision: 3, value: { name: 'Space freed', subscribed: true } })).status, 200)
  const { data: small } = await create({ ...definition(), name: 'small', schema: { text: { type: 'string', maxLength: 200 } }, quotas: { maxRecords: 5, maxBytes: 110, operationsPerMinute: 60 } })
  const inserted = await invoke(small.handle, { operation: 'create', expectedRevision: 0, value: { text: 'short' } })
  assert.equal(inserted.status, 200)
  assert.equal((await invoke(small.handle, { operation: 'update', expectedRevision: 1, id: inserted.data.records[0].id, value: { text: 'x'.repeat(100) } })).status, 409)
  assert.deepEqual((await invoke(small.handle, { operation: 'list' })).data, inserted.data)
})

test('operation quota persists across restarts and applies to reads as well as writes', async t => {
  const { f, create, invoke } = await setup(t)
  const { data: c } = await create({ ...definition(), quotas: { ...definition().quotas, operationsPerMinute: 2 } })
  assert.equal((await invoke(c.handle, { operation: 'list' })).status, 200)
  await f.restart()
  assert.equal((await invoke(c.handle, { operation: 'list' })).status, 200)
  assert.equal((await invoke(c.handle, { operation: 'create', expectedRevision: 0, value: { name: 'Denied', subscribed: true } })).status, 429)
  await f.restart()
  assert.equal((await invoke(c.handle, { operation: 'list' })).status, 429)
})

test('number bounds and optional fields enforce schema without charging failed mutations', async t => {
  const { create, invoke } = await setup(t)
  const { data: c } = await create({ ...definition(), schema: {
    score: { type: 'number', minimum: 0, maximum: 10, required: true },
    note: { type: 'string', maxLength: 20 }, flag: { type: 'boolean' },
  }, quotas: { maxRecords: 2, maxBytes: 1024, operationsPerMinute: 2 } })
  for (const value of [{}, { score: -1 }, { score: 11 }, { score: '5' }, { score: 2, note: false },
    { score: 2, flag: 'true' }, { score: 2, note: '😀'.repeat(6) }]) {
    assert.equal((await invoke(c.handle, { operation: 'create', expectedRevision: 0, value })).status, 400)
  }
  const inserted = await invoke(c.handle, { operation: 'create', expectedRevision: 0, value: { score: 0 } })
  assert.equal(inserted.status, 200)
  const replaced = await invoke(c.handle, { operation: 'update', expectedRevision: 1,
    id: inserted.data.records[0].id, value: { score: 10, note: '😀'.repeat(5), flag: false } })
  assert.equal(replaced.status, 200)
  assert.equal(replaced.data.revision, 2)
  assert.equal((await invoke(c.handle, { operation: 'list' })).status, 429)
})

test('aggregate app byte quota cannot be bypassed by spreading records across collections', async t => {
  const { f, request, create, invoke } = await setup(t)
  const large = { ...definition(), schema: { text: { type: 'string', required: true, maxLength: 3900 } },
    quotas: { maxRecords: 1000, maxBytes: 256 * 1024, operationsPerMinute: 120 } }
  const value = { text: 'x'.repeat(3900) }
  for (let collection = 0; collection < 4; collection++) {
    const { data: c } = await create({ ...large, name: 'large_' + collection })
    for (let revision = 0; revision < 66; revision++) {
      assert.equal((await invoke(c.handle, { operation: 'create', expectedRevision: revision, value })).status, 200)
    }
  }
  const { data: fifth } = await create({ ...large, name: 'fifth' })
  const before = (await request('/data')).data
  assert.equal((await invoke(fifth.handle, { operation: 'create', expectedRevision: 0, value })).status, 409)
  assert.deepEqual((await request('/data')).data, before)
  await f.restart()
  assert.deepEqual((await invoke(fifth.handle, { operation: 'list' })).data, { revision: 0, records: [] })
})

test('concurrent writes require the current collection revision and accept exactly one writer', async t => {
  const { create, invoke } = await setup(t)
  const { data: c } = await create()
  const results = await Promise.all(['Ada', 'Grace'].map(name => invoke(c.handle, { operation: 'create', expectedRevision: 0, value: { name, subscribed: true } })))
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409])
  const rows = (await invoke(c.handle, { operation: 'list' })).data
  assert.equal(rows.revision, 1); assert.equal(rows.records.length, 1)
})

test('atomic writer failure rolls back the mutation, cleans temporary files and preserves source', async t => {
  const { f, owner, project, create, invoke } = await setup(t)
  const { data: c } = await create()
  const directory = join(f.root, 'apps', owner.user.id, 'form-app'), path = join(directory, 'data.json')
  const original = await readFile(path, 'utf8')
  const write = AppData.prototype.write
  const mock = t.mock.method(AppData.prototype, 'write', async function (directory, state) {
    await rename(path, path + '.saved'); await mkdir(path)
    try { return await write.call(this, directory, state) }
    finally { await rmdir(path); await rename(path + '.saved', path) }
  })
  assert.equal((await invoke(c.handle, { operation: 'create', expectedRevision: 0, value: { name: 'Never committed', subscribed: true } })).status, 500)
  mock.mock.restore()
  assert.equal(await readFile(path, 'utf8'), original)
  assert.equal((await readdir(directory)).filter(name => name.endsWith('.tmp')).length, 0)
  await f.restart()
  assert.deepEqual((await invoke(c.handle, { operation: 'list' })).data, { revision: 0, records: [] })
  assert.deepEqual(await f.storage.apps.read(owner.user.id, 'form-app'), project)
})

test('source rollback preserves live records; revocation and app recreation cannot revive data', async t => {
  const { f, owner, project, request, create, invoke } = await setup(t)
  const { data: c } = await create()
  const inserted = await invoke(c.handle, { operation: 'create', expectedRevision: 0, value: { name: 'Keep across source restore', subscribed: true } })
  await f.storage.apps.put(owner.user.id, 'form-app', { ...project, name: 'Edited source' }, 1)
  assert.equal((await request('/rollback', 'POST', { expectedRevision: 2, targetRevision: 1 })).status, 200)
  assert.deepEqual((await invoke(c.handle, { operation: 'list' })).data, inserted.data)
  assert.equal((await request('/data/' + c.handle, 'DELETE', { expectedVersion: 1 })).status, 200)
  assert.equal((await request('/rollback', 'POST', { expectedRevision: 3, targetRevision: 1 })).status, 200)
  assert.equal((await invoke(c.handle, { operation: 'list' })).status, 403)
  await f.storage.apps.delete(owner.user.id, 'form-app')
  await f.storage.apps.put(owner.user.id, 'form-app', createAppProject({ id: 'form-app' }), null)
  assert.equal((await invoke(c.handle, { operation: 'list' })).status, 404)
  assert.deepEqual((await request('/data')).data, { collections: [] })
})

test('private storage denies symlinks and corruption; source and export APIs exclude records', async t => {
  const { f, owner, request, create, invoke } = await setup(t, {
    appValidator: async () => ({ status: 'passed', diagnostics: [], viewports: [], screenshots: [] }),
  })
  const { data: c } = await create()
  const privateValue = 'PRIVATE_DATA_DO_NOT_EXPORT'
  await invoke(c.handle, { operation: 'create', expectedRevision: 0, value: { name: privateValue, subscribed: true } })
  const path = join(f.root, 'apps', owner.user.id, 'form-app', 'data.json')
  assert.equal((await stat(path)).mode & 0o777, 0o600)
  assert.equal((await stat(join(f.root, 'apps', owner.user.id, 'form-app'))).mode & 0o777, 0o700)
  const original = await readFile(path, 'utf8')
  for (const [suffix, method, input] of [[''], ['/revisions'], ['/revisions/1'], ['/compile', 'POST'], ['/export'], ['/export/approve', 'POST', { expectedRevision: 1 }], ['/export.zip?revision=1']]) {
    const response = await request(suffix, method, input)
    assert.equal(response.status, 200, suffix)
    assert.ok(!JSON.stringify(response.data).includes(privateValue), suffix)
  }
  assert.ok(!JSON.stringify((await request('/data')).data).includes(privateValue))
  await rename(path, path + '.saved'); await symlink(path + '.saved', path)
  assert.equal((await invoke(c.handle, { operation: 'list' })).status, 500)
  await unlink(path); await writeFile(path, '[{"handle":"broken"}]')
  assert.deepEqual((await request('/data')).data, { error: 'App data storage is unavailable' })
  await writeFile(path, original)
  assert.equal((await invoke(c.handle, { operation: 'list' })).data.records[0].value.name, privateValue)
})

test('collection caps bound grants; list results page all records', async t => {
  const { create, invoke } = await setup(t)
  const { data: c } = await create({ ...definition(), quotas: { maxRecords: 20, maxBytes: 4096, operationsPerMinute: 60 } })
  for (let i = 0; i < 9; i++) assert.equal((await invoke(c.handle, { operation: 'create', expectedRevision: i, value: { name: String(i), subscribed: true } })).status, 200)
  const first = await invoke(c.handle, { operation: 'list' })
  assert.equal(first.data.records.length, 8); assert.equal(first.data.nextOffset, 8)
  const second = await invoke(c.handle, { operation: 'list', offset: first.data.nextOffset })
  assert.equal(second.data.records.length, 1); assert.equal(second.data.nextOffset, undefined)
  for (let i = 1; i < 16; i++) assert.equal((await create({ ...definition(), name: 'collection_' + i })).status, 201)
  assert.equal((await create({ ...definition(), name: 'excess' })).status, 409)
})
