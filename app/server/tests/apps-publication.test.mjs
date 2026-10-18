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
  const service = await createService({ root, secret: 'source-export-test-secret-at-least-32-characters', origin: 'http://localhost:3000', releaseOrigin: 'http://127.0.0.1:4180',
    appValidator: async () => ({ status: 'passed', diagnostics: [], viewports: [], screenshots: [] }), ...extra })
  const responses = []
  t.after(async () => { service.close(); responses.forEach(r => r.emit('close')); await rm(root, { recursive: true, force: true }) })
  const request = async (url, headers = {}, method = 'GET', input = {}, publicRequest = false) => {
    const socket = new Duplex({ read() {}, write(_chunk, _encoding, cb) { cb() } })
    const req = new IncomingMessage(socket)
    req.url = url; req.method = method; req.headers = headers
    const res = new ServerResponse(req); res.assignSocket(socket); responses.push(res)
    const chunks = []
    res.end = chunk => { if (chunk) chunks.push(Buffer.from(chunk)); return res }
    await (publicRequest ? service.publicHandler : service.handler)(req, res, input)
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

test('publish freezes validated bytes, explicitly updates and revokes all version URLs', async t => {
  const f = await fixture(t), alice = await f.login('alice'), bob = await f.login('bob')
  const p = await f.storage.apps.put(alice.user.id, 'app_publish', {}, null)
  const path = '/api/apps/app_publish/release'
  assert.equal((await f.request(path, {}, 'POST', { expectedRevision: 1 })).status, 401)
  assert.equal((await f.request(path, bob.headers, 'POST', { expectedRevision: 1 })).status, 404)
  assert.equal((await f.request(path, alice.headers, 'POST', { expectedRevision: 2 })).status, 409)
  const published = await f.request(path, alice.headers, 'POST', { expectedRevision: 1 })
  assert.equal(published.status, 201)
  assert.equal(published.data.revision, 1)
  const url = new URL(published.data.url)
  assert.equal(url.origin, 'http://127.0.0.1:4180')
  const publicGet = path => f.request(path, { host: url.host, cookie: alice.headers.cookie }, 'GET', {}, true)
  const live = await publicGet(url.pathname)
  assert.equal(live.status, 200)
  assert.match(live.headers['content-security-policy'], /connect-src 'none'/)
  assert.equal(live.headers['cache-control'], 'public, max-age=0, must-revalidate')
  assert.equal(live.headers['cross-origin-opener-policy'], 'same-origin')
  assert.equal(live.headers['cross-origin-embedder-policy'], 'require-corp')
  assert.equal(live.headers['set-cookie'], undefined)
  assert.equal(live.headers['access-control-allow-origin'], undefined)
  assert.match(live.bytes.toString(), /sandbox="allow-scripts"/)
  assert.equal((await publicGet('/api/auth/session')).status, 404)
  assert.equal((await f.request(url.pathname, alice.headers)).status, 404)
  assert.equal((await f.request(url.pathname, { host: 'localhost:3000' }, 'GET', {}, true)).status, 404)
  await f.storage.apps.put(alice.user.id, p.id, { ...p, name: 'Changed' }, 1)
  assert.deepEqual((await publicGet(url.pathname)).bytes, live.bytes)
  assert.equal((await f.request(path, alice.headers, 'POST', { expectedRevision: 1 })).status, 409)
  const updated = await f.request(path, alice.headers, 'POST', { expectedRevision: 2 })
  assert.equal(updated.status, 201)
  assert.notEqual(updated.data.url, published.data.url)
  assert.equal((await f.request(path, alice.headers)).data.url, updated.data.url)
  assert.equal((await f.request(path, alice.headers, 'DELETE', { expectedRevision: 1 })).status, 409)
  assert.equal((await f.request(path, alice.headers, 'DELETE', { expectedRevision: 2 })).status, 200)
  assert.equal((await publicGet(url.pathname)).status, 404)
  assert.equal((await publicGet(new URL(updated.data.url).pathname)).status, 404)
  assert.equal((await f.request(path, alice.headers)).data, null)
})

test('failed/blocked browsers and hostile builds leave no release and preserve a working release', async t => {
  for (const status of ['failed', 'blocked']) {
    const f = await fixture(t, { appValidator: async () => ({ status, diagnostics: [], viewports: [], screenshots: [] }) })
    const alice = await f.login('alice')
    await f.storage.apps.put(alice.user.id, 'app_fail', {}, null)
    assert.equal((await f.request('/api/apps/app_fail/release', alice.headers, 'POST', { expectedRevision: 1 })).status, 422)
    assert.equal((await f.request('/api/apps/app_fail/release', alice.headers)).data, null)
  }
  const f = await fixture(t), alice = await f.login('alice')
  const p = await f.storage.apps.put(alice.user.id, 'app_hostile', {}, null)
  const path = '/api/apps/app_hostile/release'
  const original = await f.request(path, alice.headers, 'POST', { expectedRevision: 1 })
  assert.equal(original.status, 201)
  for (const content of ["import x from 'node:fs'; export default () => <main>{x}</main>", 'export default () => <main>{</main>', 'export default () => <img src="paper-asset:ast_missing123"/>']) {
    const head = await f.storage.apps.read(alice.user.id, p.id)
    const changed = await f.storage.apps.put(alice.user.id, p.id, { ...head, files: { 'src/App.tsx': { path: 'src/App.tsx', content } } }, head.revision)
    assert.equal((await f.request(path, alice.headers, 'POST', { expectedRevision: changed.revision })).status, 422)
    assert.equal((await f.request(path, alice.headers)).data.url, original.data.url)
  }
})

test('an unavailable real browser blocks publication without creating a public URL', async t => {
  const previous = process.env.PAPER_VALIDATION_CHROMIUM
  process.env.PAPER_VALIDATION_CHROMIUM = '/nonexistent/paper-publication-browser'
  t.after(() => {
    if (previous === undefined) delete process.env.PAPER_VALIDATION_CHROMIUM
    else process.env.PAPER_VALIDATION_CHROMIUM = previous
  })
  const f = await fixture(t, { appValidator: undefined }), alice = await f.login('alice')
  await f.storage.apps.put(alice.user.id, 'app_no_browser', {}, null)
  const path = '/api/apps/app_no_browser/release'
  const response = await f.request(path, alice.headers, 'POST', { expectedRevision: 1 })
  assert.equal(response.status, 422)
  assert.match(response.data.error, /validation failed or is unavailable/)
  assert.equal((await f.request(path, alice.headers)).data, null)
  assert.equal((await f.request('/r/anything/', { host: '127.0.0.1:4180' }, 'GET', {}, true)).status, 404)
})

test('browser failures during update preserve the public document and release metadata', async t => {
  let status = 'passed'
  const f = await fixture(t, { appValidator: async () => ({ status, diagnostics: [], viewports: [], screenshots: [] }) })
  const alice = await f.login('alice'), id = 'app_browser_update', path = `/api/apps/${id}/release`
  const project = await f.storage.apps.put(alice.user.id, id, {}, null)
  const published = await f.request(path, alice.headers, 'POST', { expectedRevision: 1 })
  assert.equal(published.status, 201)
  const url = new URL(published.data.url)
  const publicGet = () => f.request(url.pathname, { host: url.host }, 'GET', {}, true)
  const original = await publicGet()
  assert.equal(original.status, 200)
  await f.storage.apps.put(alice.user.id, id, { ...project, files: {
    'src/App.tsx': { path: 'src/App.tsx', content: 'export default () => <main>Unreleased update</main>' },
  } }, 1)
  for (status of ['failed', 'blocked']) {
    assert.equal((await f.request(path, alice.headers, 'POST', { expectedRevision: 2 })).status, 422)
    assert.deepEqual((await f.request(path, alice.headers)).data, published.data)
    const live = await publicGet()
    assert.equal(live.status, 200)
    assert.deepEqual(live.bytes, original.bytes)
  }
})

test('a hostile first build never reaches browser validation or creates a public release', async t => {
  let validations = 0
  const f = await fixture(t, { appValidator: async () => {
    validations++
    return { status: 'passed', diagnostics: [], viewports: [], screenshots: [] }
  } })
  const alice = await f.login('alice'), id = 'app_hostile_first', path = `/api/apps/${id}/release`
  let project = await f.storage.apps.put(alice.user.id, id, {}, null)
  for (const content of [
    "import fs from 'node:fs'; export default () => <main>{fs}</main>",
    'export default () => <main>{</main>',
    'export default () => <img src="paper-asset:ast_missing123"/>',
  ]) {
    project = await f.storage.apps.put(alice.user.id, id, { ...project, files: {
      'src/App.tsx': { path: 'src/App.tsx', content },
    } }, project.revision)
    const response = await f.request(path, alice.headers, 'POST', { expectedRevision: project.revision })
    assert.equal(response.status, 422)
    assert.match(response.data.error, /build validation failed/)
    assert.equal((await f.request(path, alice.headers)).data, null)
  }
  assert.equal(validations, 0)
})

test('edits during browser validation reject publication', async t => {
  let started, finish
  const start = new Promise(resolve => { started = resolve })
  const done = new Promise(resolve => { finish = resolve })
  const f = await fixture(t, { appValidator: async () => { started(); await done; return { status: 'passed', diagnostics: [], viewports: [], screenshots: [] } } })
  const alice = await f.login('alice')
  const p = await f.storage.apps.put(alice.user.id, 'app_race', {}, null)
  const publishing = f.request('/api/apps/app_race/release', alice.headers, 'POST', { expectedRevision: 1 })
  await start
  await f.storage.apps.put(alice.user.id, p.id, p, 1)
  finish()
  assert.equal((await publishing).status, 409)
  assert.equal((await f.request('/api/apps/app_race/release', alice.headers)).data, null)
})

test('deleting and recreating an app during validation cannot publish the deleted source', async t => {
  let started, finish
  const start = new Promise(resolve => { started = resolve })
  const done = new Promise(resolve => { finish = resolve })
  const f = await fixture(t, { appValidator: async () => { started(); await done; return { status: 'passed', diagnostics: [], viewports: [], screenshots: [] } } })
  const alice = await f.login('alice')
  const id = 'app_recreated', path = `/api/apps/${id}/release`
  await f.storage.apps.put(alice.user.id, id, {}, null)
  const pending = f.request(path, alice.headers, 'POST', { expectedRevision: 1 })
  await start
  await f.storage.apps.delete(alice.user.id, id)
  const replacement = await f.storage.apps.put(alice.user.id, id, { files: {
    'src/App.tsx': { path: 'src/App.tsx', content: 'export default () => <main>Replacement app</main>' },
  } }, null)
  assert.equal(replacement.revision, 1)
  finish()
  assert.equal((await pending).status, 409)
  assert.equal((await f.request(path, alice.headers)).data, null)
})

test('unpublish invalidates in-flight validation and a new publish cannot resurrect old URLs', async t => {
  let started, finish
  const start = new Promise(resolve => { started = resolve })
  const done = new Promise(resolve => { finish = resolve })
  const f = await fixture(t, { appValidator: async () => { started(); await done; return { status: 'passed', diagnostics: [], viewports: [], screenshots: [] } } })
  const alice = await f.login('alice')
  await f.storage.apps.put(alice.user.id, 'app_revoke', {}, null)
  const path = '/api/apps/app_revoke/release'
  const pending = f.request(path, alice.headers, 'POST', { expectedRevision: 1 })
  await start
  assert.equal((await f.request(path, alice.headers, 'DELETE', { expectedRevision: 1 })).status, 200)
  finish()
  assert.equal((await pending).status, 409)
  assert.equal((await f.request(path, alice.headers)).data, null)
  const one = await f.request(path, alice.headers, 'POST', { expectedRevision: 1 })
  assert.equal(one.status, 201)
  assert.equal((await f.request(path, alice.headers, 'DELETE', { expectedRevision: 1 })).status, 200)
  const two = await f.request(path, alice.headers, 'POST', { expectedRevision: 1 })
  assert.equal(two.status, 201)
  assert.notEqual(one.data.url, two.data.url)
  assert.equal((await f.request(new URL(one.data.url).pathname, { host: '127.0.0.1:4180' }, 'GET', {}, true)).status, 404)
})

test('publication persists across restart, rejects tampered bytes, and deletion revokes access', async t => {
  const f = await fixture(t), alice = await f.login('alice')
  await f.storage.apps.put(alice.user.id, 'app_durable', {}, null)
  const published = await f.request('/api/apps/app_durable/release', alice.headers, 'POST', { expectedRevision: 1 })
  assert.equal(published.status, 201)
  const origin = 'http://127.0.0.1:4180'
  const restarted = await createService({ root: f.root, secret: 'source-export-test-secret-at-least-32-characters', origin: 'http://localhost:3000', releaseOrigin: origin })
  t.after(() => restarted.close())
  assert.deepEqual(await restarted.storage.apps.publication(alice.user.id, 'app_durable'), published.data)
  const url = new URL(published.data.url), [, , user, id, generation, version] = url.pathname.split('/')
  assert.ok(await restarted.storage.apps.publicPublication(user, id, generation, version))
  const artifact = join(f.root, 'apps', user, id, `release-${generation}-${version}.html`)
  const bytes = await readFile(artifact)
  await writeFile(artifact, '<script>hostile()</script>')
  assert.equal((await f.request(url.pathname, { host: url.host }, 'GET', {}, true)).status, 404)
  await writeFile(artifact, bytes)
  await f.storage.apps.delete(alice.user.id, id)
  assert.equal((await f.request(url.pathname, { host: url.host }, 'GET', {}, true)).status, 404)
})

test('publication rejects missing guards, foreign origins, client policies and unsafe host configuration', async t => {
  const f = await fixture(t), alice = await f.login('alice')
  await f.storage.apps.put(alice.user.id, 'app_guard', {}, null)
  const path = '/api/apps/app_guard/release'
  assert.equal((await f.request(path, { cookie: alice.headers.cookie }, 'POST', { expectedRevision: 1 })).status, 403)
  assert.equal((await f.request(path, { ...alice.headers, origin: 'http://evil.test' }, 'POST', { expectedRevision: 1 })).status, 403)
  assert.equal((await f.request(path, alice.headers, 'POST', { expectedRevision: 1, validated: true })).status, 400)
  assert.equal((await f.request(path, alice.headers, 'POST', { expectedRevision: 0 })).status, 400)
  const unconfigured = await fixture(t, { releaseOrigin: undefined }), owner = await unconfigured.login('owner')
  await unconfigured.storage.apps.put(owner.user.id, 'app_config', {}, null)
  assert.equal((await unconfigured.request('/api/apps/app_config/release', owner.headers, 'POST', { expectedRevision: 1 })).status, 503)
  for (const releaseOrigin of ['http://localhost:9999', 'https://localhost', 'http://public.example', 'https://user:pass@public.example', 'https://public.example/path']) {
    await assert.rejects(createService({ root: f.root, secret: 'test-secret-with-at-least-thirty-two-characters', origin: 'http://localhost:3000', releaseOrigin }), /separate hostname/)
  }
})

test('release embeds validated local assets and never depends on preview asset credentials', async t => {
  const f = await fixture(t), alice = await f.login('alice')
  await f.storage.apps.put(alice.user.id, 'app_images', {}, null)
  const upload = await f.storage.apps.uploadAsset(alice.user.id, 'app_images', 'logo.png', PNG_SAMPLE, 1)
  const p = await f.storage.apps.put(alice.user.id, 'app_images', { ...upload.project, files: {
    'src/App.tsx': { path: 'src/App.tsx', content: `export default () => <main><img alt="Local logo" src="paper-asset:${upload.asset.id}"/></main>` },
  } }, 2)
  const result = await f.request('/api/apps/app_images/release', alice.headers, 'POST', { expectedRevision: p.revision })
  assert.equal(result.status, 201)
  const url = new URL(result.data.url)
  const live = await f.request(url.pathname, { host: url.host }, 'GET', {}, true)
  assert.equal(live.status, 200)
  const html = JSON.parse(live.bytes.toString().split('.srcdoc=')[1].split(';</script>')[0])
  const encoded = html.match(/src="data:text\/javascript;base64,([^"]+)"/)[1]
  const script = Buffer.from(encoded, 'base64').toString()
  assert.ok(script.includes(`data:image/png;base64,${Buffer.from(PNG_SAMPLE).toString('base64')}`))
  assert.ok(!script.includes('paper-asset:'))
  assert.ok(!script.includes(alice.headers.cookie))
  assert.equal((await f.request(url.pathname, { host: url.host }, 'HEAD', {}, true)).bytes.length, 0)
  for (const method of ['POST', 'DELETE', 'OPTIONS']) {
    assert.equal((await f.request(url.pathname, { host: url.host }, method, {}, true)).status, 404)
  }
})
