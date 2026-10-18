import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fixture } from './sharing-fixture.mjs'
import { createAppProject } from '../dist/src/make/manifest.js'
import { AppSecrets } from '../dist/server/app-secrets.js'

const first = 'first-private-key-with-at-least-32-bytes'
const second = 'rotated-private-key-with-at-least-32-bytes'
async function setup(t, extra) {
  const f = await fixture(t, extra)
  const owner = await f.login('secret-owner'), other = await f.login('secret-reviewer')
  const project = await f.storage.apps.put(owner.user.id, 'signed-app', createAppProject({ id: 'signed-app' }), null)
  const request = (suffix, method = 'GET', input, headers = owner.headers) => f.request('/api/apps/signed-app' + suffix, {
    method, headers, ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  })
  const create = value => request('/secrets', 'POST', { capability: 'hmac-sha256', value })
  const invoke = (handle, input = { operation: 'hmac-sha256', message: 'Hello Paper' }, headers) => request('/capabilities/' + handle, 'POST', input, headers)
  return { f, owner, other, project, request, create, invoke }
}
const signature = (key, ownerId, message) => createHmac('sha256', key)
  .update(JSON.stringify(['paper-app-hmac-v1', ownerId, 'signed-app', message])).digest('hex')

test('malformed secret requests never reflect submitted fields in error responses', async t => {
  const { f, owner, create } = await setup(t)
  const created = await create(first)
  assert.equal(created.status, 201)
  for (const suffix of ['/secrets', '/secrets/' + created.data.handle, '/capabilities/' + created.data.handle]) {
    for (const payload of [
      `{"${first}":1,"${first}":2}`,
      `{"${first}" 1}`,
      '{"value":"\\uLEAK"}',
    ]) {
      const response = await f.request('/api/apps/signed-app' + suffix, {
        method: suffix.startsWith('/secrets/') ? 'PUT' : 'POST', headers: owner.headers,
        rawBody: true, body: payload,
      })
      assert.equal(response.status, 400)
      assert.deepEqual(response.data, { error: 'Invalid JSON' }, 'parser diagnostics must not reflect secret request content')
    }
  }
})

test('owner provisions an encrypted app-scoped handle; only its fixed signing result escapes', async t => {
  const { f, owner, project, request, create, invoke } = await setup(t)
  const created = await create(first)
  assert.equal(created.status, 201, 'owner can provision a secret handle')
  const handle = created.data.handle
  assert.match(handle, /^sec_[A-Za-z0-9_-]{32}$/)
  assert.deepEqual(created.data, { handle, capability: 'hmac-sha256', version: 1, status: 'active' })
  assert.equal(created.headers.get('cache-control'), 'no-store')
  const list = await request('/secrets')
  assert.deepEqual(list.data, { secrets: [created.data] })
  const result = await invoke(handle)
  assert.equal(result.status, 200)
  assert.deepEqual(result.data, { signature: signature(first, owner.user.id, 'Hello Paper') })
  assert.ok(!JSON.stringify([created.data, list.data, result.data]).includes(first))
  const directory = join(f.root, 'apps', owner.user.id, project.id)
  const disk = await readFile(join(directory, 'secrets.json'), 'utf8')
  assert.ok(!disk.includes(first), 'plaintext is never persisted')
  assert.equal((await stat(join(directory, 'secrets.json'))).mode & 0o777, 0o600)
  assert.equal((await stat(directory)).mode & 0o777, 0o700)
  assert.deepEqual(await f.storage.apps.read(owner.user.id, project.id), project)
})

test('rotation, optimistic concurrency and revocation survive restart; revoke erases ciphertext', async t => {
  const { f, owner, request, create, invoke } = await setup(t)
  const { data: record, status } = await create(first)
  assert.equal(status, 201)
  await f.restart()
  assert.equal((await invoke(record.handle)).status, 200)
  const rotated = await request('/secrets/' + record.handle, 'PUT', { value: second, expectedVersion: 1 })
  assert.equal(rotated.status, 200)
  assert.equal(rotated.data.version, 2)
  assert.equal((await request('/secrets/' + record.handle, 'PUT', { value: first, expectedVersion: 1 })).status, 409)
  await f.restart()
  assert.equal((await invoke(record.handle)).data.signature, signature(second, owner.user.id, 'Hello Paper'))
  assert.equal((await request('/secrets/' + record.handle, 'DELETE', { expectedVersion: 1 })).status, 409)
  assert.equal((await request('/secrets/' + record.handle, 'DELETE', { expectedVersion: 2 })).status, 200)
  assert.equal((await invoke(record.handle)).status, 403)
  assert.equal((await request('/secrets/' + record.handle, 'PUT', { value: first, expectedVersion: 3 })).status, 403)
  await f.restart()
  assert.equal((await invoke(record.handle)).status, 403)
  const disk = JSON.parse(await readFile(join(f.root, 'apps', owner.user.id, 'signed-app', 'secrets.json'), 'utf8'))
  assert.equal(disk[0].encrypted, undefined)
  assert.equal((await request('/secrets')).data.secrets[0].status, 'revoked')
})

test('owner account, exact app, session, origin and request guard are all required', async t => {
  const { f, owner, other, request, create, invoke } = await setup(t)
  const created = await create(first)
  assert.equal(created.status, 201)
  const { handle } = created.data
  await request('/permissions', 'PUT', { accountId: other.user.id, role: 'editor', revision: 1 })
  for (const [suffix, method, input] of [
    ['/secrets', 'GET'], ['/secrets', 'POST', { capability: 'hmac-sha256', value: first }],
    ['/secrets/' + handle, 'PUT', { value: second, expectedVersion: 1 }],
    ['/secrets/' + handle, 'DELETE', { expectedVersion: 1 }],
    ['/capabilities/' + handle, 'POST', { operation: 'hmac-sha256', message: 'Hello' }],
  ]) {
    assert.equal((await request(suffix, method, input, other.headers)).status, 404)
    assert.equal((await f.request(`/api/shared-apps/${owner.user.id}/signed-app${suffix}`, {
      method, headers: other.headers, ...(input ? { body: JSON.stringify(input) } : {}),
    })).status, 403)
  }
  assert.equal((await invoke(handle, undefined, {})).status, 401)
  assert.equal((await invoke(handle, undefined, { Cookie: owner.headers.Cookie })).status, 403)
  assert.equal((await invoke(handle, undefined, { ...owner.headers, Origin: 'https://evil.test' })).status, 403)
  assert.equal((await invoke(handle, undefined, { ...owner.headers, 'X-Paper-Account': other.user.id })).status, 403)
  await f.storage.apps.put(owner.user.id, 'other-app', createAppProject({ id: 'other-app' }), null)
  assert.equal((await f.request('/api/apps/other-app/capabilities/' + handle, { method: 'POST', headers: owner.headers, body: JSON.stringify({ operation: 'hmac-sha256', message: 'Hello' }) })).status, 404)
  await f.storage.apps.put(other.user.id, 'signed-app', createAppProject({ id: 'signed-app' }), null)
  assert.equal((await invoke(handle, undefined, other.headers)).status, 404)
  await f.storage.apps.delete(owner.user.id, 'signed-app')
  await f.storage.apps.put(owner.user.id, 'signed-app', createAppProject({ id: 'signed-app' }), null)
  assert.equal((await invoke(handle)).status, 404, 'recreating an app never revives old handles')
})

test('capability schema rejects generic network proxying, secret reads and unbounded input', async t => {
  let networkCalls = 0
  const { request, create, invoke } = await setup(t, { fetch: async () => { networkCalls++; throw new Error('No network allowed') } })
  for (const capability of ['fetch', 'http', 'proxy', 'https://api.example.test', '__proto__']) {
    assert.equal((await request('/secrets', 'POST', { capability, value: first })).status, 400)
  }
  assert.equal((await request('/secrets', 'POST', { capability: 'hmac-sha256', value: first, host: 'example.test' })).status, 400)
  assert.equal((await create('too short')).status, 400)
  const created = await create(first)
  assert.equal(created.status, 201)
  const { handle } = created.data
  for (const input of [
    { operation: 'fetch', url: 'http://169.254.169.254/latest/meta-data/' },
    { operation: 'read' }, { operation: 'hmac-sha256', message: 'ok', url: 'https://evil.test' },
    { operation: 'hmac-sha256', message: 'ok', headers: {} },
    { operation: 'hmac-sha256', message: 'ok', appId: 'other-app' },
    { operation: 'hmac-sha256', message: 'x'.repeat(4097) },
    { operation: 'hmac-sha256', message: {} },
  ]) assert.equal((await invoke(handle, input)).status, 400)
  assert.equal((await request('/secrets/' + handle)).status, 405)
  assert.equal(networkCalls, 0)
})

test('ciphertext substitution fails closed without leaking keys or changing source', async t => {
  const { f, owner, project, create, invoke } = await setup(t)
  const one = await create(first), two = await create(second)
  assert.equal(one.status, 201); assert.equal(two.status, 201)
  const path = join(f.root, 'apps', owner.user.id, project.id, 'secrets.json')
  const state = JSON.parse(await readFile(path, 'utf8'))
  state[0].encrypted = state[1].encrypted
  await writeFile(path, JSON.stringify(state))
  const failed = await invoke(one.data.handle)
  assert.equal(failed.status, 500)
  assert.ok(!JSON.stringify(failed.data).includes(first))
  assert.ok(!JSON.stringify(failed.data).includes(second))
  assert.deepEqual(await f.storage.apps.read(owner.user.id, project.id), project)
})

test('a replaced encryption key fails closed and leaves the recoverable vault unchanged', async t => {
  const { f, owner, create, invoke } = await setup(t)
  const created = await create(first)
  assert.equal(created.status, 201)
  const path = join(f.root, 'apps', owner.user.id, 'signed-app', 'secrets.json')
  const before = await readFile(path, 'utf8')
  const wrongKey = new AppSecrets(f.storage.apps, 'different-master-key-with-at-least-32-bytes')
  await assert.rejects(wrongKey.invoke(owner.user.id, 'signed-app', created.data.handle, {
    operation: 'hmac-sha256', message: 'Hello Paper',
  }), error => error.status === 500 && error.message === 'Secret capability is unavailable')
  assert.equal(await readFile(path, 'utf8'), before)
  await f.restart()
  assert.equal((await invoke(created.data.handle)).data.signature, signature(first, owner.user.id, 'Hello Paper'))
})

test('symlink and malformed vaults never expose private artifacts or allow capability use', async t => {
  const { f, owner, create, invoke, request } = await setup(t)
  const created = await create(first)
  assert.equal(created.status, 201)
  const { rename, symlink, unlink } = await import('node:fs/promises')
  const path = join(f.root, 'apps', owner.user.id, 'signed-app', 'secrets.json')
  await rename(path, path + '.saved')
  await symlink(path + '.saved', path)
  assert.deepEqual((await request('/secrets')).data, { error: 'Secret storage is unavailable' })
  assert.equal((await invoke(created.data.handle)).status, 500)
  await unlink(path)
  await writeFile(path, JSON.stringify([{ handle: created.data.handle, value: first }]))
  const failed = await request('/secrets')
  assert.equal(failed.status, 500)
  assert.deepEqual(failed.data, { error: 'Secret storage is unavailable' })
  assert.equal((await invoke(created.data.handle)).status, 500)
  await rename(path + '.saved', path)
  assert.equal((await invoke(created.data.handle)).status, 200)
})

test('model requests, revision APIs, compiled bundles, source exports and publication never read the vault', async t => {
  const seen = []
  const { f, owner, request, create } = await setup(t, {
    releaseOrigin: 'http://127.0.0.1:4180',
    appValidator: async () => ({ status: 'passed', diagnostics: [], viewports: [], screenshots: [] }),
    modelGateway: { provider: 'test', customAdapter: async input => {
      seen.push(input)
      return { content: '{"message":"Use the scoped handle"}', usage: { promptTokens: 1, completionTokens: 1 } }
    } },
  })
  const created = await create(first)
  assert.equal(created.status, 201)
  const encrypted = JSON.parse(await readFile(join(f.root, 'apps', owner.user.id, 'signed-app', 'secrets.json'), 'utf8'))[0].encrypted
  const generated = await request('/generate', 'POST', { prompt: 'Describe a signing UI', expectedRevision: 1 })
  assert.equal(generated.status, 200)
  assert.equal(seen.length, 1)
  const outputs = [seen, generated.data]
  for (const [suffix, method, input] of [
    ['', 'GET'], ['/revisions', 'GET'], ['/revisions/1', 'GET'], ['/compile', 'POST'],
    ['/turns', 'GET'], ['/export', 'GET'],
    ['/export/approve', 'POST', { expectedRevision: 1 }], ['/export.zip?revision=1', 'GET'],
    ['/release', 'POST', { expectedRevision: 1 }],
  ]) {
    const response = await request(suffix, method, input)
    assert.ok(response.status >= 200 && response.status < 300, suffix + ': ' + response.status)
    outputs.push(response.data)
  }
  const serialized = JSON.stringify(outputs)
  assert.ok(!serialized.includes(first))
  assert.ok(!serialized.includes(encrypted))
  assert.ok(!serialized.includes('secrets.json'))
  const ledger = await readFile(join(f.root, 'model-usage.json'), 'utf8')
  assert.ok(!ledger.includes(first)); assert.ok(!ledger.includes(encrypted))
})

test('strict JSON, byte limits, durable failures and concurrent mutations never fall back to unsafe state', async t => {
  const { f, owner, request, create, invoke } = await setup(t)
  const duplicate = await f.request('/api/apps/signed-app/secrets', {
    method: 'POST', headers: owner.headers, rawBody: true,
    body: '{"capability":"fetch","capability":"hmac-sha256","value":"' + first + '"}',
  })
  assert.equal(duplicate.status, 400)
  const oversized = await request('/secrets', 'POST', { capability: 'hmac-sha256', value: 'x'.repeat(17 * 1024) })
  assert.equal(oversized.status, 413)
  const created = await create(first)
  assert.equal(created.status, 201)
  const { handle } = created.data
  const results = await Promise.all([first, second].map(value => request('/secrets/' + handle, 'PUT', { value, expectedVersion: 1 })))
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409])
  assert.equal((await invoke(handle)).status, 200)
  // Replace the destination with a directory to force the atomic write to fail.
  const { rename, mkdir, readdir } = await import('node:fs/promises')
  const directory = join(f.root, 'apps', owner.user.id, 'signed-app'), path = join(directory, 'secrets.json')
  await rename(path, path + '.saved'); await mkdir(path)
  assert.equal((await request('/secrets/' + handle, 'DELETE', { expectedVersion: 2 })).status, 500)
  assert.equal((await invoke(handle)).status, 500)
  assert.equal((await readdir(directory)).filter(name => name.endsWith('.tmp')).length, 0)
  const { rmdir } = await import('node:fs/promises')
  await rmdir(path); await rename(path + '.saved', path)
  await f.restart()
  assert.equal((await invoke(handle)).status, 200)
  assert.equal((await request('/secrets/' + handle, 'DELETE', { expectedVersion: 2 })).status, 200)
  assert.equal((await invoke(handle)).status, 403)
})
