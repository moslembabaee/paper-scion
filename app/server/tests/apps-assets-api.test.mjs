import test from 'node:test'
import assert from 'node:assert/strict'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Duplex } from 'node:stream'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createService } from '../dist/server/service.js'
import { createAppProject } from '../dist/src/make/manifest.js'

const secret = 'a-persistent-secret-for-apps-assets-tests-12345'

import { PNG_SAMPLE, FONT_SAMPLE } from '../../tests/asset-fixtures.mjs'
const CLEAN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#81adec"/></svg>`
const MALICIOUS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert('xss')</script><circle r="10"/></svg>`

async function fixture(t, extra = {}) {
  const root = await mkdtemp(join(tmpdir(), 'paper-apps-assets-api-'))
  const service = await createService({ root, secret, origin: 'http://localhost:3000', ...extra })
  const responses = []
  t.after(async () => {
    service.close()
    for (const response of responses) response.emit('close')
    await rm(root, { recursive: true, force: true })
  })

  const open = async (path, options = {}) => {
    const socket = new Duplex({ read() {}, write(_chunk, _encoding, callback) { callback() } })
    socket.remoteAddress = '127.0.0.1'
    const req = new IncomingMessage(socket)
    req.url = path
    req.method = options.method ?? 'GET'
    req.headers = Object.fromEntries(
      Object.entries({ 'Content-Type': 'application/json', ...options.headers }).map(([k, v]) => [k.toLowerCase(), v])
    )
    const res = new ServerResponse(req)
    res.assignSocket(socket)
    responses.push(res)
    let buffer = Buffer.alloc(0)
    const write = res.write.bind(res), end = res.end.bind(res)
    res.write = chunk => {
      const chunkBuf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
      buffer = Buffer.concat([buffer, chunkBuf])
      return write(chunk)
    }
    res.end = chunk => {
      if (chunk) {
        const chunkBuf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
        buffer = Buffer.concat([buffer, chunkBuf])
      }
      return end(chunk)
    }
    if (options.rawBody) {
      req.push(options.body ?? '')
      req.push(null)
    }
    await service.handler(
      req,
      res,
      Object.hasOwn(options, 'parsedBody')
        ? options.parsedBody
        : options.rawBody
        ? undefined
        : options.body
        ? JSON.parse(options.body)
        : {}
    )
    const headers = new Headers()
    for (const line of res._header.split('\r\n').slice(1)) {
      const split = line.indexOf(':')
      if (split > 0) headers.append(line.slice(0, split), line.slice(split + 1).trim())
    }
    return {
      status: res.statusCode,
      headers,
      res,
      buffer: () => buffer,
      text: () => buffer.toString('utf8'),
    }
  }

  const request = async (path, options = {}) => {
    const response = await open(path, options)
    const ct = response.headers.get('content-type') || ''
    const isJson = ct.includes('json')
    return {
      status: response.status,
      headers: response.headers,
      data: isJson ? JSON.parse(response.text()) : response.text(),
      buffer: response.buffer(),
    }
  }

  const login = async sub => {
    const { user, session } = await service.auth.login('github', {
      sub,
      email: `${sub}@test.local`,
      name: sub,
      avatar: '',
    })
    return {
      user,
      session,
      headers: { Cookie: `paper_session=${session}`, 'X-Paper-Client': 'web' },
    }
  }

  return { ...service, root, open, request, login }
}

test('app asset endpoints enforce authentication and CSRF guards', async t => {
  const f = await fixture(t)
  const a = await f.login('alice')

  // Unauthenticated requests must reject with 401
  assert.equal((await f.request('/api/apps/app_sample/assets')).status, 401)
  assert.equal((await f.request('/api/apps/app_sample/assets', { method: 'POST', body: '{}' })).status, 401)
  assert.equal((await f.request('/api/apps/app_sample/assets/ast_123')).status, 401)
  assert.equal((await f.request('/api/apps/app_sample/assets/ast_123', { method: 'DELETE' })).status, 401)

  // CSRF missing on POST/DELETE rejects with 403
  const noCsrf = { Cookie: a.headers.Cookie }
  assert.equal((await f.request('/api/apps/app_sample/assets', { method: 'POST', headers: noCsrf, body: '{}' })).status, 403)
  assert.equal((await f.request('/api/apps/app_sample/assets/ast_123', { method: 'DELETE', headers: noCsrf })).status, 403)
})

test('app asset upload, preview compile, and export round-trip succeed', async t => {
  const f = await fixture(t)
  const a = await f.login('alice')

  // Create an app project
  const createRes = await f.request('/api/apps', {
    method: 'POST',
    headers: a.headers,
    body: JSON.stringify({
      project: { name: 'Asset Round-trip App' },
    }),
  })
  assert.equal(createRes.status, 201)
  const appId = createRes.data.id

  // 1. Upload PNG image
  const uploadImgRes = await f.request(`/api/apps/${appId}/assets`, {
    method: 'POST',
    headers: a.headers,
    body: JSON.stringify({
      name: 'logo.png',
      content: PNG_SAMPLE.toString('base64'),
    }),
  })
  assert.equal(uploadImgRes.status, 201)
  assert.ok(uploadImgRes.data.asset)
  const imgAsset = uploadImgRes.data.asset
  assert.equal(imgAsset.name, 'logo.png')
  assert.equal(imgAsset.mimeType, 'image/png')
  assert.equal(imgAsset.type, 'image')
  assert.match(imgAsset.id, /^ast_[a-f0-9]+$/)

  // 2. Upload WOFF2 font
  const uploadFontRes = await f.request(`/api/apps/${appId}/assets`, {
    method: 'POST',
    headers: a.headers,
    body: JSON.stringify({
      name: 'Inter.ttf',
      content: FONT_SAMPLE.toString('base64'),
    }),
  })
  assert.equal(uploadFontRes.status, 201)
  const fontAsset = uploadFontRes.data.asset
  assert.equal(fontAsset.name, 'Inter.ttf')
  assert.equal(fontAsset.mimeType, 'font/ttf')
  assert.equal(fontAsset.type, 'font')

  // 3. Verify app manifest has both asset IDs attached
  const appRes = await f.request(`/api/apps/${appId}`, { headers: a.headers })
  assert.equal(appRes.status, 200)
  assert.ok(appRes.data.assetIds.includes(imgAsset.id))
  assert.ok(appRes.data.assetIds.includes(fontAsset.id))

  // 4. List assets
  const listRes = await f.request(`/api/apps/${appId}/assets`, { headers: a.headers })
  assert.equal(listRes.status, 200)
  assert.equal(listRes.data.assets.length, 2)

  // 5. Read image asset binary content
  const readImgRes = await f.request(`/api/apps/${appId}/assets/${imgAsset.id}`, { headers: a.headers })
  assert.equal(readImgRes.status, 200)
  assert.equal(readImgRes.headers.get('content-type'), 'image/png')
  assert.equal(readImgRes.headers.get('x-content-type-options'), 'nosniff')
  assert.deepEqual(readImgRes.buffer, PNG_SAMPLE)

  // 6. Compile project with assets — sandbox resolves font @font-face without hotlinks
  const compileRes = await f.request(`/api/apps/${appId}/compile`, {
    method: 'POST',
    headers: a.headers,
  })
  assert.equal(compileRes.status, 200)
  assert.equal(compileRes.data.success, true)
  assert.ok(compileRes.data.assets.css.includes('@font-face'))
  assert.ok(compileRes.data.assets.css.includes('data:font/ttf;base64,'))
  assert.ok(!compileRes.data.assets.css.includes('http://') && !compileRes.data.assets.css.includes('https://'))

  // 7. Export round-trip
  const exportRes = await f.request(`/api/apps/${appId}/export`, { headers: a.headers })
  assert.equal(exportRes.status, 200)
  assert.equal(exportRes.data.format, 'paper-app-package')
  assert.equal(exportRes.data.version, 1)
  assert.equal(exportRes.data.assets.length, 2)
  assert.equal(exportRes.data.assets[0].id, imgAsset.id)
  assert.equal(exportRes.data.assets[0].dataBase64, PNG_SAMPLE.toString('base64'))
  assert.equal(exportRes.data.assets[1].id, fontAsset.id)
  assert.equal(exportRes.data.assets[1].dataBase64, FONT_SAMPLE.toString('base64'))
})

test('SVG active content, path traversal, oversized files and cross-account access reject', async t => {
  const f = await fixture(t)
  const alice = await f.login('alice')
  const bob = await f.login('bob')

  // Alice creates an app
  const createRes = await f.request('/api/apps', {
    method: 'POST',
    headers: alice.headers,
    body: JSON.stringify({ project: { name: 'Alice Security App' } }),
  })
  assert.equal(createRes.status, 201)
  const appId = createRes.data.id

  // 1. SVG active content must reject with 400
  const activeSvgRes = await f.request(`/api/apps/${appId}/assets`, {
    method: 'POST',
    headers: alice.headers,
    body: JSON.stringify({
      name: 'malicious.svg',
      content: Buffer.from(MALICIOUS_SVG).toString('base64'),
    }),
  })
  assert.equal(activeSvgRes.status, 400)
  assert.match(activeSvgRes.data.error, /SVG|active content|script/i)

  // 2. Clean SVG must succeed
  const cleanSvgRes = await f.request(`/api/apps/${appId}/assets`, {
    method: 'POST',
    headers: alice.headers,
    body: JSON.stringify({
      name: 'clean.svg',
      content: Buffer.from(CLEAN_SVG).toString('base64'),
    }),
  })
  assert.equal(cleanSvgRes.status, 201)
  const cleanAssetId = cleanSvgRes.data.asset.id

  // 3. Path traversal in name must reject with 400
  const traversalNames = ['../evil.png', '..\\evil.png', '%2e%2e/evil.png', 'folder/name.png']
  for (const name of traversalNames) {
    const res = await f.request(`/api/apps/${appId}/assets`, {
      method: 'POST',
      headers: alice.headers,
      body: JSON.stringify({
        name,
        content: PNG_SAMPLE.toString('base64'),
      }),
    })
    assert.equal(res.status, 400, `Expected 400 for traversal name: ${name}`)
  }

  // 4. Path traversal in asset ID must reject
  const traversalIdRes = await f.request(`/api/apps/${appId}/assets/..%2fevil`, {
    headers: alice.headers,
  })
  assert.equal(traversalIdRes.status >= 400, true)

  // 5. Oversized asset (> 2 MiB) must reject with 413
  const oversizedBuf = Buffer.alloc(2 * 1024 * 1024 + 10)
  PNG_SAMPLE.copy(oversizedBuf)
  const oversizedRes = await f.request(`/api/apps/${appId}/assets`, {
    method: 'POST',
    headers: alice.headers,
    body: JSON.stringify({
      name: 'huge.png',
      content: oversizedBuf.toString('base64'),
    }),
  })
  assert.equal(oversizedRes.status, 413)

  // 6. Cross-account asset access: Bob CANNOT access Alice's app assets
  assert.equal((await f.request(`/api/apps/${appId}/assets`, { headers: bob.headers })).status, 404)
  assert.equal(
    (await f.request(`/api/apps/${appId}/assets/${cleanAssetId}`, { headers: bob.headers })).status,
    404
  )
  assert.equal(
    (await f.request(`/api/apps/${appId}/assets`, {
      method: 'POST',
      headers: bob.headers,
      body: JSON.stringify({ name: 'bob.png', content: PNG_SAMPLE.toString('base64') }),
    })).status,
    404
  )
  assert.equal(
    (await f.request(`/api/apps/${appId}/assets/${cleanAssetId}`, {
      method: 'DELETE',
      headers: bob.headers,
    })).status,
    404
  )
})

test('invalid content and stale uploads preserve the head; IDs cannot cross app or account boundaries', async t => {
  const f = await fixture(t)
  const alice = await f.login('alice'), bob = await f.login('bob')
  const project = (await f.request('/api/apps', { method: 'POST', headers: alice.headers, body: JSON.stringify({ project: { name: 'Private' } }) })).data
  const path = `/api/apps/${project.id}`
  for (const input of [
    { name: 'fake.png', content: Buffer.from('<html>bad</html>').toString('base64') },
    { name: 'wrong.jpg', content: PNG_SAMPLE.toString('base64') },
    { name: 'bad.png', content: PNG_SAMPLE.toString('base64') + '!junk' },
    { name: 'bad.svg', content: Buffer.from('<svg><image href="https://evil.test/x"/></svg>').toString('base64') },
  ]) assert.equal((await f.request(`${path}/assets`, { method: 'POST', headers: alice.headers, body: JSON.stringify(input) })).status, 400)
  assert.deepEqual((await f.request(path, { headers: alice.headers })).data, project)
  const uploaded = await f.request(`${path}/assets`, { method: 'POST', headers: alice.headers,
    body: JSON.stringify({ name: 'logo.png', content: PNG_SAMPLE.toString('base64'), expectedRevision: 1 }) })
  assert.equal(uploaded.status, 201)
  assert.equal(uploaded.data.project.revision, 2)
  const asset = uploaded.data.asset
  assert.equal((await f.request(`${path}/assets`, { method: 'POST', headers: alice.headers,
    body: JSON.stringify({ name: 'stale.png', content: PNG_SAMPLE.toString('base64'), expectedRevision: 1 }) })).status, 409)
  assert.equal((await f.request(`${path}/assets`, { headers: alice.headers })).data.assets.length, 1)
  for (const account of [alice, bob]) {
    const other = (await f.request('/api/apps', { method: 'POST', headers: account.headers, body: JSON.stringify({ project: { name: 'Other' } }) })).data
    assert.equal((await f.request(`/api/apps/${other.id}/assets/${asset.id}`, { headers: account.headers })).status, 404)
    assert.equal((await f.request(`/api/apps/${other.id}`, { method: 'PUT', headers: account.headers,
      body: JSON.stringify({ project: { ...other, assetIds: [asset.id] }, expectedRevision: other.revision }) })).status, 404)
    assert.equal((await f.request('/api/apps/compile', { method: 'POST', headers: account.headers,
      body: JSON.stringify({ project: { ...other, assetIds: [asset.id] } }) })).status, 404)
  }
  for (const suffix of ['export', 'compile', 'copy']) {
    const result = await f.request(`${path}/${suffix}`, { method: suffix === 'export' ? 'GET' : 'POST', headers: bob.headers,
      body: suffix === 'copy' ? JSON.stringify({ project: createAppProject() }) : undefined })
    assert.equal(result.status, 404)
  }
  const copy = createAppProject({ files: uploaded.data.project.files, assetIds: [asset.id] })
  const copied = await f.request(`${path}/copy`, { method: 'POST', headers: alice.headers, body: JSON.stringify({ project: copy }) })
  assert.equal(copied.status, 201)
  assert.deepEqual((await f.request(`/api/apps/${copy.id}/assets/${asset.id}`, { headers: alice.headers })).buffer, PNG_SAMPLE)
  const detached = await f.request(`${path}/assets/${asset.id}`, { method: 'DELETE', headers: alice.headers, body: JSON.stringify({ expectedRevision: 2 }) })
  assert.equal(detached.status, 200)
  assert.equal(detached.data.project.revision, 3)
  assert.equal((await f.request(`${path}/assets/${asset.id}`, { headers: alice.headers })).status, 404)
  const restored = await f.request(`${path}/rollback`, { method: 'POST', headers: alice.headers, body: JSON.stringify({ expectedRevision: 3, targetRevision: 2 }) })
  assert.equal(restored.status, 200)
  assert.deepEqual((await f.request(`${path}/assets/${asset.id}`, { headers: alice.headers })).buffer, PNG_SAMPLE)
})
