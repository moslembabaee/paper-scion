import test from 'node:test'
import assert from 'node:assert/strict'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Duplex } from 'node:stream'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createService } from '../dist/server/service.js'
import { PNG_SAMPLE } from '../../tests/asset-fixtures.mjs'

async function fixture(t, extra = {}) {
  const root = await mkdtemp(join(tmpdir(), 'paper-source-export-'))
  const service = await createService({ root, secret: 'source-export-test-secret-at-least-32-characters', origin: 'http://localhost:3000',
    appValidator: async () => ({ status: 'passed', diagnostics: [], viewports: [], screenshots: [] }), ...extra })
  const responses = []
  t.after(async () => { service.close(); responses.forEach(r => r.emit('close')); await rm(root, { recursive: true, force: true }) })
  const request = async (url, headers = {}, method = 'GET', input = {}) => {
    const socket = new Duplex({ read() {}, write(_chunk, _encoding, cb) { cb() } })
    const req = new IncomingMessage(socket)
    req.url = url; req.method = method; req.headers = headers
    const res = new ServerResponse(req); res.assignSocket(socket); responses.push(res)
    const chunks = []
    res.end = chunk => { if (chunk) chunks.push(Buffer.from(chunk)); return res }
    await service.handler(req, res, input)
    const bytes = Buffer.concat(chunks)
    const responseHeaders = {}
    for (const line of (res._header ?? '').split('\r\n').slice(1)) {
      const i = line.indexOf(':'); if (i > 0) responseHeaders[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim()
    }
    return { status: res.statusCode, headers: responseHeaders, bytes, data: responseHeaders['content-type']?.includes('json') ? JSON.parse(bytes) : undefined }
  }
  const login = async sub => {
    const { user, session } = await service.auth.login('github', { sub, email: `${sub}@test.local`, name: sub, avatar: '' })
    return { user, headers: { cookie: `paper_session=${session}`, 'x-paper-client': 'web' } }
  }
  return { ...service, root, request, login }
}

test('source ZIP requires explicit approval of the exact current saved revision', async t => {
  const f = await fixture(t), alice = await f.login('alice'), bob = await f.login('bob')
  const project = await f.storage.apps.put(alice.user.id, 'app_export', { name: 'Export fixture' }, null)
  const path = `/api/apps/${project.id}`
  assert.equal((await f.request(`${path}/export.zip?revision=1`)).status, 401)
  assert.equal((await f.request(`${path}/export.zip?revision=1`, bob.headers)).status, 404)
  assert.equal((await f.request(`${path}/export.zip?revision=1`, alice.headers)).status, 409)
  assert.equal((await f.request(`${path}/export/approve`, { cookie: alice.headers.cookie }, 'POST', { expectedRevision: 1 })).status, 403)
  assert.equal((await f.request(`${path}/export/approve`, alice.headers, 'POST', { expectedRevision: 1, approved: true, allowlist: ['evil'] })).status, 400)
  const approval = await f.request(`${path}/export/approve`, alice.headers, 'POST', { expectedRevision: 1 })
  assert.equal(approval.status, 200)
  const exported = await f.request(`${path}/export.zip?revision=1`, alice.headers)
  assert.equal(exported.status, 200)
  assert.equal(exported.headers['content-type'], 'application/zip')
  assert.equal(exported.bytes.readUInt32LE(), 0x04034b50)
  assert.deepEqual((await f.request(`${path}/export.zip?revision=1`, alice.headers)).bytes, exported.bytes)
  assert.deepEqual(await f.storage.apps.read(alice.user.id, project.id), project)
  await f.storage.apps.put(alice.user.id, project.id, project, 1)
  assert.equal((await f.request(`${path}/export.zip?revision=1`, alice.headers)).status, 409)
  assert.equal((await f.request(`${path}/export.zip?revision=2`, alice.headers)).status, 409)
})

test('failed/blocked browser checks, forbidden packages and unknown asset references never approve', async t => {
  for (const status of ['failed', 'blocked']) {
    const f = await fixture(t, { appValidator: async () => ({ status, diagnostics: [], viewports: [], screenshots: [] }) })
    const alice = await f.login('alice')
    await f.storage.apps.put(alice.user.id, 'app_denied', { name: 'Denied', preview: { status: 'ready' }, release: { status: 'published' } }, null)
    assert.equal((await f.request('/api/apps/app_denied/export/approve', alice.headers, 'POST', { expectedRevision: 1 })).status, 422)
    assert.equal((await f.request('/api/apps/app_denied/export.zip?revision=1', alice.headers)).status, 409)
  }
  const f = await fixture(t), alice = await f.login('alice')
  for (const [id, content] of [
    ['package', "import x from 'unapproved-package'; export default () => <main>{x}</main>"],
    ['asset', 'export default () => <img src="paper-asset:ast_missing123"/>'],
  ]) {
    const project = await f.storage.apps.put(alice.user.id, `app_${id}`, { files: { 'src/App.tsx': content } }, null)
    assert.equal((await f.request(`/api/apps/${project.id}/export/approve`, alice.headers, 'POST', { expectedRevision: 1 })).status, 422)
    assert.equal((await f.request(`/api/apps/${project.id}/export.zip?revision=1`, alice.headers)).status, 409)
    assert.deepEqual(await f.storage.apps.read(alice.user.id, project.id), project)
  }
})

test('concurrent edits during validation reject without approving either revision', async t => {
  let validationStarted, finishValidation
  const started = new Promise(resolve => { validationStarted = resolve })
  const done = new Promise(resolve => { finishValidation = resolve })
  const f = await fixture(t, { appValidator: async () => { validationStarted(); await done; return { status: 'passed', diagnostics: [], viewports: [], screenshots: [] } } })
  const alice = await f.login('alice')
  const project = await f.storage.apps.put(alice.user.id, 'app_race', {}, null)
  const approval = f.request('/api/apps/app_race/export/approve', alice.headers, 'POST', { expectedRevision: 1 })
  await started
  await f.storage.apps.put(alice.user.id, project.id, project, 1)
  finishValidation()
  assert.equal((await approval).status, 409)
  assert.equal((await f.request('/api/apps/app_race/export.zip?revision=2', alice.headers)).status, 409)
})

test('missing or tampered asset bytes after approval reject and preserve the revision', async t => {
  const f = await fixture(t), alice = await f.login('alice')
  await f.storage.apps.put(alice.user.id, 'app_asset', {}, null)
  const { project, asset } = await f.storage.apps.uploadAsset(alice.user.id, 'app_asset', 'logo.png', PNG_SAMPLE, 1)
  const path = '/api/apps/app_asset'
  assert.equal((await f.request(`${path}/export/approve`, alice.headers, 'POST', { expectedRevision: 2 })).status, 200)
  const assetPath = join(f.root, 'apps', alice.user.id, project.id, 'assets', `${asset.id}.json`)
  const original = await readFile(assetPath, 'utf8')
  await writeFile(assetPath, original.replace(asset.sha256, '0'.repeat(64)))
  assert.equal((await f.request(`${path}/export.zip?revision=2`, alice.headers)).status, 500)
  await rm(assetPath)
  assert.equal((await f.request(`${path}/export.zip?revision=2`, alice.headers)).status, 404)
  assert.deepEqual(await f.storage.apps.read(alice.user.id, project.id), project)
})
