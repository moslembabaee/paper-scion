import test from 'node:test'
import assert from 'node:assert/strict'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Duplex } from 'node:stream'
import { mkdtemp, rm, readFile, mkdir, symlink, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { createService } from '../dist/server/service.js'
import { canonical, newer } from '../dist/src/cloud/model.js'
import { SceneStore } from '../dist/src/scene/store.js'
import { SceneReplica } from '../dist/src/collaboration/model.js'
import { paperTools } from '../dist/src/mcp/schema.js'

const secret = 'a-persistent-secret-for-integration-tests-12345'
async function fixture(t, extra = {}) {
  const root = await mkdtemp(join(tmpdir(), 'paper-cloud-'))
  const service = await createService({ root, secret, origin: 'http://localhost:3000', ...extra })
  const responses = []
  t.after(async () => { service.close(); for (const response of responses) response.emit('close'); await rm(root, { recursive: true, force: true }) })
  // Real IncomingMessage/ServerResponse streams, without a listening socket.
  // This also runs in sandboxes that forbid binding TCP ports.
  const open = async (path, options = {}) => {
    const socket = new Duplex({ read() {}, write(_chunk, _encoding, callback) { callback() } })
    socket.remoteAddress = '127.0.0.1'
    const req = new IncomingMessage(socket)
    req.url = path; req.method = options.method ?? 'GET'
    req.headers = Object.fromEntries(Object.entries({ 'Content-Type': 'application/json', ...options.headers }).map(([key, value]) => [key.toLowerCase(), value]))
    const res = new ServerResponse(req); res.assignSocket(socket); responses.push(res)
    let text = ''
    const write = res.write.bind(res), end = res.end.bind(res)
    res.write = chunk => { text += String(chunk); return write(chunk) }
    res.end = chunk => { if (chunk) text += String(chunk); return end(chunk) }
    if (options.rawBody) { req.push(options.body ?? ''); req.push(null) }
    await service.handler(req, res, options.rawBody ? undefined : options.body ? JSON.parse(options.body) : {})
    const headers = new Headers()
    for (const line of res._header.split('\r\n').slice(1)) {
      const split = line.indexOf(':'); if (split > 0) headers.append(line.slice(0, split), line.slice(split + 1).trim())
    }
    return { status: res.statusCode, headers, res, text: () => text }
  }
  const request = async (path, options = {}) => {
    const response = await open(path, options)
    return { status: response.status, headers: response.headers, data: response.headers.get('content-type')?.includes('json') ? JSON.parse(response.text()) : response.text() }
  }
  const login = async sub => {
    const { user, session } = await service.auth.login('github', { sub, email: `${sub}@test.local`, name: sub, avatar: '' })
    const token = await service.auth.regenerate(user.id)
    return { user, session, token, headers: { Cookie: `paper_session=${session}`, 'X-Paper-Client': 'web' } }
  }
  const sessions = new Map()
  const post = (token, method, params, sessionId, notification = false) => request('/mcp', { method: 'POST', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream', ...(sessionId ? { 'MCP-Session-Id': sessionId } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', ...(!notification ? { id: 1 } : {}), method, params }) })
  const rpc = async (token, method, params = {}) => {
    if (method === 'initialize') {
      const response = await post(token, method, params)
      if (response.status === 200 && !response.data.error) {
        const sessionId = response.headers.get('mcp-session-id')
        sessions.set(token, sessionId)
        assert.equal((await post(token, 'notifications/initialized', {}, sessionId, true)).status, 202)
      }
      return response
    }
    if (!sessions.has(token)) {
      const initialized = await rpc(token, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } })
      if (initialized.status !== 200) return initialized
    }
    return post(token, method, params, sessions.get(token))
  }
  const tool = (token, name, args) => rpc(token, 'tools/call', { name, arguments: args })
  return { ...service, root, open, request, login, rpc, tool, sessions }
}
const empty = name => ({ format: 'paper', version: 1, name, viewport: { x: 0, y: 0, zoom: 1 }, grid: true, scene: { version: 1, elements: {}, rootIds: [] } })

const collaborator = id => ({ id, name: 'Ada', color: '#81adec', status: 'active', cursor: { x: 120, y: 240 }, selection: ['rect'], viewport: { center: { x: 0, y: 0 }, zoom: 1, size: { width: 900, height: 600 } }, following: null })

test('backend collaboration accepts parsed JSON, streams edits and closes sessions without cloud sign-in', { timeout: 5000 }, async t => {
  const f = await fixture(t), room = randomUUID(), first = randomUUID(), second = randomUUID()
  const path = `/__paper_collaboration/${room}`
  // Nginx forwards $host without the public port. The configured origin is authoritative.
  const headers = { Host: 'localhost', Origin: 'http://localhost:3000' }
  const store = new SceneStore(); store.add('rectangle', { id: 'rect', x: 120 })
  const credential = randomUUID()
  const joined = await f.request(`${path}/join`, { method: 'POST', headers, body: JSON.stringify({ id: first, token: credential, presence: collaborator(first), document: store.toJSON() }) })
  assert.equal(joined.status, 200)
  assert.equal(joined.data.token, credential)
  assert.ok(joined.data.registers.length > 0)
  assert.deepEqual(joined.data.peers.map(peer => peer.id), [first])
  const replica = new SceneReplica(first, joined.data.registers)
  assert.equal(replica.document().elements.rect.x, 120)
  // The shared service also accepts a raw HTTP body outside Fastify.
  const other = await f.request(`${path}/join`, { method: 'POST', headers, rawBody: true, body: JSON.stringify({ id: second, presence: collaborator(second), document: new SceneStore().toJSON() }) })
  assert.equal(other.status, 200)
  assert.match(other.data.token, /^[a-f0-9-]{36}$/)
  assert.equal(new SceneReplica(second, other.data.registers).document().elements.rect.x, 120)
  const session = `${path}/events?id=${second}&token=${other.data.token}`
  assert.equal((await f.request(`${path}/events?id=${second}&token=wrong`, { headers })).status, 401)
  const stream = await f.open(session, { headers })
  assert.equal(stream.status, 200)
  assert.match(stream.headers.get('content-type'), /text\/event-stream/)
  assert.equal(stream.headers.get('x-accel-buffering'), 'no')
  assert.equal(stream.res.writableEnded, false)
  assert.match(stream.text(), /event: state/)
  const before = store.toJSON(); store.update('rect', 'rectangle', { x: 240 })
  const changes = replica.change(before, store.toJSON())
  assert.equal((await f.request(`${path}/update?id=${first}&token=${credential}`, { method: 'POST', headers, body: JSON.stringify({ changes, presence: { ...collaborator(first), cursor: { x: 240, y: 120 } } }) })).status, 200)
  assert.match(stream.text(), /event: changes/)
  assert.match(stream.text(), /"x":240/)
  assert.equal(stream.res.writableEnded, false)
  const rejoined = await f.request(`${path}/join`, { method: 'POST', headers, body: JSON.stringify({ id: first, token: credential, presence: collaborator(first) }) })
  assert.equal(new SceneReplica(first, rejoined.data.registers).document().elements.rect.x, 240)
  assert.equal((await f.request(`${path}/leave?id=${second}&token=${other.data.token}`, { method: 'POST', headers, body: '{}' })).status, 200)
  assert.equal(stream.res.writableEnded, true)
  assert.equal((await f.request(session, { headers })).status, 401)
  const remaining = await f.open(`${path}/events?id=${first}&token=${credential}`, { headers })
  assert.equal(remaining.res.writableEnded, false)
  f.close()
  assert.equal(remaining.res.writableEnded, true)
})

test('backend collaboration rejects invalid requests and always responds to the bare relay path', { timeout: 5000 }, async t => {
  const f = await fixture(t), room = randomUUID(), id = randomUUID()
  const headers = { Host: 'localhost', Origin: 'http://localhost:3000' }
  const body = JSON.stringify({ id, presence: collaborator(id), document: new SceneStore().toJSON() })
  assert.equal((await f.request('/__paper_collaboration', { headers })).status, 400)
  assert.equal((await f.request('/__paper_collaboration/', { headers })).status, 400)
  const path = `/__paper_collaboration/${room}/join`
  for (const Origin of ['http://localhost:4000', 'https://evil.test']) {
    assert.equal((await f.request(path, { method: 'POST', headers: { ...headers, Origin }, body })).status, 403)
  }
  assert.equal((await f.request(path, { method: 'POST', headers, body: '[]' })).status, 400)
  assert.equal((await f.request(path, { method: 'POST', headers, body: '{', rawBody: true })).status, 400)
  assert.equal((await f.request(path, { method: 'POST', headers: { ...headers, 'Content-Type': 'text/plain' }, body })).status, 400)
  const large = await f.request(path, { method: 'POST', headers, body: JSON.stringify({ padding: 'x'.repeat(16 * 1024 * 1024) }) })
  assert.equal(large.status, 400)
  assert.match(large.data.error, /exceeds 16 MB/)
  assert.equal((await f.request(path, { method: 'POST', headers, body })).status, 200)
})

test('session discovery is public; private endpoints require session and CSRF guard', async t => {
  const f = await fixture(t)
  assert.equal((await f.request('/api/auth/session')).data.user, null)
  assert.equal((await f.request('/api/projects')).status, 401)
  const a = await f.login('a')
  assert.equal((await f.request('/api/auth/token/regenerate', { method: 'POST', headers: { Cookie: a.headers.Cookie } })).status, 403)
  assert.equal((await f.request('/api/projects', { headers: { ...a.headers, Origin: 'https://evil.test' } })).status, 403)
  assert.equal((await f.request('/api/projects', { headers: { ...a.headers, 'X-Paper-Account': 'another-account' } })).status, 403)
  assert.equal((await f.request('/mcp', { method: 'POST', headers: { ...a.headers, Accept: 'application/json, text/event-stream' }, body: '{}' })).status, 401)
})

test('every project endpoint rejects missing, invalid and revoked sessions before accessing data', async t => {
  const f = await fixture(t), a = await f.login('private-account')
  const document = empty('Private study')
  const created = await f.request('/api/projects/private-project', {
    method: 'PUT', headers: a.headers,
    body: JSON.stringify({ document, expectedRevision: null, updatedAt: Date.now() }),
  })
  assert.equal(created.status, 200)
  const credentials = [
    {},
    { Cookie: 'paper_session=invalid' },
    { Cookie: `paper_session=${'a'.repeat(43)}` },
    { Authorization: `Bearer ${a.token}` },
    { 'X-Paper-Account': a.user.id, 'X-Paper-Client': 'web' },
    { Cookie: 'paper_session=invalid', 'X-Paper-Account': a.user.id, 'X-Paper-Client': 'web' },
  ]
  await f.auth.logout(a.session)
  credentials.push(a.headers)
  const endpoints = [
    ['GET', '/api/projects'],
    ['GET', '/api/projects/private-project'],
    ['GET', '/api/projects/nonexistent'],
    ['PUT', '/api/projects/private-project'],
    ['PUT', '/api/projects/new-project'],
    // Unsupported methods and invalid IDs must not bypass the session guard.
    ['POST', '/api/projects'],
    ['DELETE', '/api/projects/private-project'],
    ['PATCH', '/api/projects/private-project'],
    ['PUT', '/api/projects/bad%2Fid'],
  ]
  for (const headers of credentials) {
    for (const [method, path] of endpoints) {
      const response = await f.request(path, { method, headers, body: method === 'PUT' ? '{}' : undefined })
      assert.equal(response.status, 401, `${method} ${path} must require a browser session`)
      assert.deepEqual(response.data, { error: 'Sign in to access cloud projects' })
      assert.equal(response.headers.get('cache-control'), 'no-store')
    }
  }
  assert.equal((await f.storage.read(a.user.id, 'private-project')).revision, created.data.revision)
  assert.equal(await f.storage.read(a.user.id, 'new-project'), null)
})

test('expired browser sessions cannot list, read or write projects', async t => {
  const f = await fixture(t), a = await f.login('expired-account')
  const now = Date.now()
  t.mock.method(Date, 'now', () => now + 31 * 86400_000)
  for (const [method, path] of [['GET', '/api/projects'], ['GET', '/api/projects/private'], ['PUT', '/api/projects/private']]) {
    assert.equal((await f.request(path, { method, headers: a.headers, body: method === 'PUT' ? '{}' : undefined })).status, 401)
  }
})

test('remote MCP requires a valid Bearer token on every transport method and never falls back to cookies', async t => {
  const f = await fixture(t), a = await f.login('agent-account')
  const rejected = [undefined, '', a.token, `Basic ${a.token}`, 'Bearer', 'Bearer paper_short',
    `Bearer paper_${'a'.repeat(43)}`, `Bearer ${a.token} extra`, `Bearer ${a.token}, Bearer ${a.token}`]
  for (const authorization of rejected) {
    for (const method of ['POST', 'GET', 'DELETE']) {
      const response = await f.request('/mcp', {
        method,
        headers: { ...a.headers, Accept: 'application/json, text/event-stream',
          ...(authorization === undefined ? {} : { Authorization: authorization }) },
        body: method === 'POST' ? '{}' : undefined,
      })
      assert.equal(response.status, 401, `${method} /mcp must authenticate before handling the transport`)
      assert.equal(response.headers.get('www-authenticate'), 'Bearer realm="Paper"')
      assert.deepEqual(response.data, { error: 'Invalid MCP token' })
    }
  }
  // A cookie is neither necessary nor sufficient for the remote gateway.
  const initialized = await f.rpc(a.token, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'auth-test', version: '1' } })
  assert.equal(initialized.status, 200)
  assert.ok(initialized.headers.get('mcp-session-id'))
  assert.equal((await f.rpc(a.token, 'ping')).status, 200)
  await f.auth.revoke(a.user.id)
  for (const method of ['POST', 'GET', 'DELETE']) {
    const response = await f.request('/mcp', {
      method, headers: { ...a.headers, Authorization: `Bearer ${a.token}`, 'MCP-Session-Id': f.sessions.get(a.token) },
      body: method === 'POST' ? '{}' : undefined,
    })
    assert.equal(response.status, 401, 'revoked tokens must not authorize an existing MCP session')
  }
})

test('headless MCP edits persist, export correctly, and never cross account boundaries', async t => {
  const f = await fixture(t)
  const a = await f.login('account-a'), b = await f.login('account-b')
  const initialized = await f.rpc(a.token, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } })
  assert.equal(initialized.data.result.serverInfo.name, 'paper-cloud')
  assert.equal((await f.rpc(a.token, 'tools/list')).data.result.tools[0].name, 'list_projects')
  let created = await f.tool(a.token, 'create_frame', { project_id: 'shared-id', name: 'Account A private', width: 120, height: 240 })
  assert.equal(created.data.result.isError, false)
  const frame = created.data.result.structuredContent.element
  const revision = created.data.result.structuredContent.revision
  for (const name of ['get_canvas_elements', 'get_basic_info', 'list_tokens', 'export_selection']) assert.equal((await f.tool(b.token, name, { project_id: 'shared-id' })).data.result.isError, true)
  assert.equal((await f.tool(b.token, 'update_element', { project_id: 'shared-id', element_id: frame.id, patch: { name: 'stolen' } })).data.result.isError, true)
  assert.equal((await f.request('/api/projects/shared-id', { headers: b.headers })).status, 404)
  created = await f.tool(b.token, 'create_frame', { project_id: 'shared-id', name: 'Account B private' })
  assert.equal(created.data.result.isError, false)
  const read = await f.tool(a.token, 'get_canvas_elements', { project_id: 'shared-id' })
  assert.equal(read.data.result.structuredContent.elements[0].name, 'Account A private')
  const edit = await f.tool(a.token, 'update_element', { project_id: 'shared-id', element_id: frame.id, expected_revision: revision, patch: { name: 'Headless update', x: 120 } })
  assert.equal(edit.data.result.isError, false)
  assert.notEqual(edit.data.result.structuredContent.revision, revision)
  const browserOpen = await f.request('/api/projects/shared-id', { headers: a.headers })
  assert.equal(browserOpen.data.document.scene.elements[frame.id].name, 'Headless update')
  assert.equal(browserOpen.data.activity.tool, 'update_element')
  const svg = await f.tool(a.token, 'export_selection', { project_id: 'shared-id', format: 'svg' })
  assert.equal(svg.data.result.structuredContent.mimeType, 'image/svg+xml')
  assert.match(svg.data.result.structuredContent.content, /<svg/)
  for (const project_id of ['../account-b', '/data/projects/private', '%2e%2e', '__proto__', 'x\\y']) {
    // Reserved JS names are harmless opaque IDs, but path separators are always rejected.
    if (project_id === '__proto__') continue
    assert.equal((await f.tool(a.token, 'get_canvas_elements', { project_id })).data.result.isError, true)
  }
  assert.equal((await f.tool(a.token, 'get_canvas_elements', { project_id: 'shared-id', file: '../other' })).data.result.isError, true)
  assert.equal((await f.tool(a.token, 'export_selection', { project_id: 'shared-id', output: '../other' })).data.result.isError, true)
  const stored = JSON.parse(await readFile(join(f.root, 'projects', a.user.id, 'shared-id.paper.json'), 'utf8'))
  assert.equal(stored.document.scene.elements[frame.id].x, 120)
  const restarted = await createService({ root: f.root, secret, origin: 'http://localhost:3000' })
  assert.equal(restarted.auth.bearer(a.token).id, a.user.id)
  assert.equal((await restarted.storage.read(a.user.id, 'shared-id')).revision, stored.revision)
})

test('token rotation immediately revokes old tokens and survives restart without plaintext storage', async t => {
  const f = await fixture(t), a = await f.login('a')
  const rotation = await f.request('/api/auth/token/regenerate', { method: 'POST', headers: a.headers })
  assert.match(rotation.data.token, /^paper_/)
  assert.equal((await f.rpc(a.token, 'ping')).status, 401)
  assert.equal((await f.rpc(rotation.data.token, 'ping')).status, 200)
  assert.equal((await f.request('/api/auth/token', { headers: a.headers })).data.token, rotation.data.token)
  const disk = await readFile(join(f.root, 'auth.json'), 'utf8')
  assert.ok(!disk.includes(rotation.data.token))
  const restarted = await createService({ root: f.root, secret, origin: 'http://localhost:3000' })
  assert.equal(restarted.auth.bearer(a.token), undefined)
  assert.equal(restarted.auth.reveal(a.user.id), rotation.data.token)
  await f.request('/api/auth/logout', { method: 'POST', headers: a.headers })
  assert.equal((await f.request('/api/projects', { headers: a.headers })).status, 401)
})

test('atomic revision checks serialize racing REST and MCP writes; malformed scenes never replace data', async t => {
  const f = await fixture(t), a = await f.login('a')
  const created = await f.request('/api/projects/race', { method: 'PUT', headers: a.headers, body: JSON.stringify({ document: empty('Race'), updatedAt: Date.now(), expectedRevision: null }) })
  assert.equal(created.status, 200)
  const writes = await Promise.all(['first', 'second'].map(name => f.request('/api/projects/race', { method: 'PUT', headers: a.headers, body: JSON.stringify({ document: empty(name), updatedAt: Date.now(), expectedRevision: created.data.revision }) })))
  assert.deepEqual(writes.map(w => w.status).sort(), [200, 409])
  const conflict = writes.find(w => w.status === 409)
  assert.equal(conflict.data.current.revision, writes.find(w => w.status === 200).data.revision)
  const before = await f.storage.read(a.user.id, 'race')
  const mixed = await Promise.all([
    f.request('/api/projects/race', { method: 'PUT', headers: a.headers, body: JSON.stringify({ document: empty('REST'), updatedAt: Date.now(), expectedRevision: before.revision }) }),
    f.tool(a.token, 'create_frame', { project_id: 'race', expected_revision: before.revision, name: 'MCP' }),
  ])
  assert.equal(Number(mixed[0].status === 200) + Number(mixed[1].data.result.isError === false), 1)
  const after = await f.storage.read(a.user.id, 'race')
  const malformed = await f.request('/api/projects/race', { method: 'PUT', headers: a.headers, body: JSON.stringify({ document: { ...empty('Bad'), scene: { version: 1, elements: {}, rootIds: ['missing'] } }, updatedAt: Date.now(), expectedRevision: after.revision }) })
  assert.notEqual(malformed.status, 200)
  assert.equal((await f.storage.read(a.user.id, 'race')).revision, after.revision)
})

test('Google and GitHub OAuth bind state to the browser, exchange PKCE codes, and use verified identities', async t => {
  const calls = []
  const mockFetch = async (url, options) => {
    calls.push({ url, options })
    let data
    if (url.includes('/token') || url.includes('access_token')) data = { access_token: 'provider-private-token' }
    else if (url.includes('userinfo')) data = { sub: 'google-sub', name: 'Google User', email: 'google@test.local', email_verified: true }
    else if (url.endsWith('/user/emails')) data = [{ email: 'github@test.local', primary: true, verified: true }]
    else data = { id: 42, login: 'github-user', email: null }
    return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })
  }
  const f = await fixture(t, { google: { clientId: 'google-client', clientSecret: 'google-secret' }, github: { clientId: 'github-client', clientSecret: 'github-secret' }, fetch: mockFetch })
  for (const provider of ['google', 'github']) {
    const start = await f.request(`/api/auth/${provider}`)
    assert.equal(start.status, 302)
    const target = new URL(start.headers.get('location'))
    assert.equal(target.searchParams.get('code_challenge_method'), 'S256')
    assert.equal(target.searchParams.get('redirect_uri'), `http://localhost:3000/api/auth/${provider}/callback`)
    const state = target.searchParams.get('state')
    const callback = `/api/auth/${provider}/callback?state=${state}&code=private-code`
    const done = await f.request(callback, { headers: { Cookie: `paper_oauth=${state}` } })
    assert.equal(done.status, 302)
    const session = done.headers.get('set-cookie').match(/paper_session=([^;]+)/)[1]
    assert.equal((await f.request('/api/auth/session', { headers: { Cookie: `paper_session=${session}` } })).data.user.email, `${provider}@test.local`)
    const exchange = calls.findLast(c => c.options.method === 'POST')
    const verifier = new URLSearchParams(exchange.options.body).get('code_verifier')
    assert.equal(createHash('sha256').update(verifier).digest('base64url'), target.searchParams.get('code_challenge'))
    assert.equal((await f.request(callback, { headers: { Cookie: `paper_oauth=${state}` } })).status, 400)
  }
  const start = await f.request('/api/auth/google')
  const state = new URL(start.headers.get('location')).searchParams.get('state')
  assert.equal((await f.request(`/api/auth/google/callback?state=${state}&code=code`, { headers: { Cookie: 'paper_oauth=wrong' } })).status, 400)
  assert.ok(calls.filter(c => c.options.method === 'POST').every(c => new URLSearchParams(c.options.body).has('code_verifier')))
  const disk = await readFile(join(f.root, 'auth.json'), 'utf8')
  assert.ok(!disk.includes('provider-private-token'))
  assert.ok(!disk.includes('private-code'))
})

test('token revocation rejects agents immediately and stays revoked after restart', async t => {
  const f = await fixture(t), a = await f.login('a'), b = await f.login('b')
  assert.equal((await f.request('/api/auth/token', { method: 'DELETE', headers: { Cookie: a.headers.Cookie } })).status, 403)
  assert.equal((await f.request('/api/auth/token', { method: 'DELETE', headers: { ...a.headers, 'X-Paper-Account': b.user.id } })).status, 403)
  const revoked = await f.request('/api/auth/token', { method: 'DELETE', headers: a.headers })
  assert.equal(revoked.status, 200)
  assert.equal(revoked.data.user.hasMcpToken, false)
  assert.equal(revoked.data.user.tokenRotatedAt, undefined)
  assert.equal((await f.rpc(a.token, 'ping')).status, 401)
  assert.equal((await f.rpc(b.token, 'ping')).status, 200)
  assert.equal((await f.request('/api/auth/token', { headers: a.headers })).status, 404)
  const restarted = await createService({ root: f.root, secret, origin: 'http://localhost:3000' })
  assert.equal(restarted.auth.bearer(a.token), undefined)
  assert.throws(() => restarted.auth.reveal(a.user.id), { status: 404 })
  const regenerated = await f.request('/api/auth/token/regenerate', { method: 'POST', headers: a.headers })
  assert.match(regenerated.data.token, /^paper_[A-Za-z0-9_-]{43}$/)
  assert.equal(regenerated.data.user.hasMcpToken, true)
  assert.equal(typeof regenerated.data.user.tokenRotatedAt, 'number')
})

test('profiles validate edits, clear avatars, stay private, and survive provider login and restart', async t => {
  const f = await fixture(t), a = await f.login('a')
  const update = values => f.request('/api/auth/profile', { method: 'PATCH', headers: a.headers, body: JSON.stringify(values) })
  for (const input of [{ name: '' }, { name: 'x'.repeat(81) }, { name: 42 }, { avatar: 'javascript:alert(1)' }, { avatar: null }, { avatar: 'data:image/svg+xml;base64,AA==' }]) assert.equal((await update(input)).status, 400)
  assert.equal((await f.request('/api/auth/profile', { method: 'PATCH', headers: { Cookie: a.headers.Cookie }, body: '{"name":"unsafe"}' })).status, 403)
  const edited = await update({ name: '  Studio Designer  ', avatar: 'data:image/png;base64,AA==' })
  assert.equal(edited.data.user.name, 'Studio Designer')
  assert.equal(edited.data.user.provider, 'github')
  assert.equal(edited.data.user.tokenHash, undefined)
  assert.equal(edited.data.user.tokenEncrypted, undefined)
  assert.equal(edited.data.user.profileEdited, undefined)
  assert.equal((await update({ avatar: '' })).data.user.avatar, '')
  const again = await f.auth.login('github', { sub: 'a', email: 'changed@test.local', name: 'Provider name', avatar: 'https://example.com/avatar.png' })
  assert.equal(again.user.id, a.user.id)
  assert.equal(again.user.name, 'Studio Designer')
  assert.equal(again.user.avatar, '')
  assert.equal(again.user.email, 'changed@test.local')
  const other = await f.auth.login('google', { sub: 'a', email: 'changed@test.local', name: 'Google', avatar: '' })
  assert.notEqual(other.user.id, a.user.id)
  const restarted = await createService({ root: f.root, secret, origin: 'http://localhost:3000' })
  assert.equal(restarted.auth.profile(restarted.auth.session(a.session)).name, 'Studio Designer')
})

test('OAuth cancellation and unavailable providers return safely to the editor', async t => {
  const f = await fixture(t, { google: { clientId: 'client', clientSecret: 'secret' }, fetch: async () => { throw new Error('provider network failure') } })
  assert.equal((await f.request('/api/auth/github')).status, 503)
  const begin = async () => {
    const start = await f.request('/api/auth/google')
    return new URL(start.headers.get('location')).searchParams.get('state')
  }
  const cancelledState = await begin()
  const cancelled = await f.request(`/api/auth/google/callback?state=${cancelledState}&error=access_denied`, { headers: { Cookie: `paper_oauth=${cancelledState}`, Accept: 'text/html' } })
  assert.equal(cancelled.status, 302)
  assert.match(cancelled.headers.get('location'), /^\/\?auth_error=/)
  assert.match(cancelled.headers.get('set-cookie'), /paper_oauth=;.*Max-Age=0/)
  assert.equal((await f.request(`/api/auth/google/callback?state=${cancelledState}&code=code`, { headers: { Cookie: `paper_oauth=${cancelledState}` } })).status, 400)
  const failedState = await begin()
  const failed = await f.request(`/api/auth/google/callback?state=${failedState}&code=code`, { headers: { Cookie: `paper_oauth=${failedState}`, Accept: 'text/html' } })
  assert.equal(failed.status, 302)
  assert.ok(!failed.headers.get('location').includes('network failure'))
  assert.equal((await f.request('/api/auth/session')).data.user, null)
  const wrongCookieState = await begin()
  assert.equal((await f.request(`/api/auth/google/callback?state=${wrongCookieState}&code=code`, { headers: { Cookie: 'paper_oauth=wrong' } })).status, 400)
  // An unrelated browser cannot consume the legitimate browser's attempt.
  assert.equal((await f.request(`/api/auth/google/callback?state=${wrongCookieState}&code=code`, { headers: { Cookie: `paper_oauth=${wrongCookieState}` } })).status, 502)
})

test('failed persistence never publishes a token change to authentication', async t => {
  const f = await fixture(t), a = await f.login('a')
  const path = join(f.root, 'auth.json')
  await rm(path)
  const { mkdir } = await import('node:fs/promises')
  await mkdir(path)
  await assert.rejects(f.auth.regenerate(a.user.id))
  assert.equal(f.auth.bearer(a.token).id, a.user.id)
  assert.equal(f.auth.reveal(a.user.id), a.token)
  await assert.rejects(f.auth.revoke(a.user.id))
  assert.equal(f.auth.bearer(a.token).id, a.user.id)
})

test('OAuth rejects unverified identities and never issues a session on rejection', async t => {
  const f = await fixture(t, {
    google: { clientId: 'client', clientSecret: 'secret' }, github: { clientId: 'client', clientSecret: 'secret' },
    fetch: async url => {
      const data = url.includes('/token') || url.includes('access_token') ? { access_token: 'private' }
        : url.includes('userinfo') ? { sub: 'g', email: 'unverified@test.local', email_verified: false }
        : url.endsWith('/user/emails') ? [{ email: 'unverified@test.local', primary: true, verified: false }]
        : { id: 42, login: 'unverified' }
      return Response.json(data)
    },
  })
  for (const provider of ['google', 'github']) {
    const start = await f.request(`/api/auth/${provider}`)
    const state = new URL(start.headers.get('location')).searchParams.get('state')
    const rejected = await f.request(`/api/auth/${provider}/callback?state=${state}&code=code`, { headers: { Cookie: `paper_oauth=${state}` } })
    assert.equal(rejected.status, 403)
    assert.ok(!rejected.headers.get('set-cookie').includes('paper_session='))
  }
  assert.equal((await f.request('/api/auth/session')).data.user, null)
})

test('HTTPS OAuth uses secure cookies and expiring single-use state', async t => {
  const f = await fixture(t, { origin: 'https://paper.test', google: { clientId: 'client', clientSecret: 'secret' }, fetch: async () => { throw new Error('Expired attempts must never reach the provider') } })
  const start = await f.request('/api/auth/google')
  assert.match(start.headers.get('set-cookie'), /HttpOnly; SameSite=Lax; Max-Age=600; Secure/)
  const target = new URL(start.headers.get('location'))
  assert.equal(target.searchParams.get('redirect_uri'), 'https://paper.test/api/auth/google/callback')
  const state = target.searchParams.get('state')
  const now = Date.now()
  t.mock.method(Date, 'now', () => now + 601_000)
  const expired = await f.request(`/api/auth/google/callback?state=${state}&code=code`, { headers: { Cookie: `paper_oauth=${state}` } })
  assert.equal(expired.status, 400)
  assert.match(expired.headers.get('set-cookie'), /Max-Age=0; Secure/)
})

test('live changes are pushed only to the owning session through SSE', async t => {
  const f = await fixture(t), a = await f.login('a'), b = await f.login('b')
  const response = await f.open('/api/events', { headers: a.headers })
  await f.tool(b.token, 'create_frame', { project_id: 'b-only', name: 'B' })
  await f.tool(a.token, 'create_frame', { project_id: 'a-only', name: 'A' })
  const pushed = response.text()
  assert.match(pushed, /a-only/)
  assert.ok(!pushed.includes('b-only'))
  response.res.end(); response.res.emit('close')
})

test('canonical revisions and conflict ordering are deterministic', () => {
  assert.equal(canonical({ b: 2, a: { z: 1, x: 0 } }), canonical({ a: { x: 0, z: 1 }, b: 2 }))
  assert.equal(newer({ updatedAt: 3, revision: 'a' }, { updatedAt: 2, revision: 'z' }), true)
  assert.equal(newer({ updatedAt: 2, revision: 'z' }, { updatedAt: 2, revision: 'a' }), true)
})

const remoteHeaders = (token, sessionId) => ({ Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream', ...(sessionId ? { 'MCP-Session-Id': sessionId, 'MCP-Protocol-Version': '2025-11-25' } : {}) })
const initializeMessage = { jsonrpc: '2.0', id: 'initialize', method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'remote-test', version: '1' } } }

test('remote MCP enforces lifecycle, validates transport, and binds sessions to account and token', async t => {
  const f = await fixture(t), a = await f.login('a'), b = await f.login('b')
  const send = (message, headers = remoteHeaders(a.token)) => f.request('/mcp', { method: 'POST', headers, body: JSON.stringify(message) })
  assert.equal((await send({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).status, 400)
  assert.equal((await send({ ...initializeMessage, params: {} })).data.error.code, -32602)
  assert.equal((await send({ ...initializeMessage, id: null })).data.error.code, -32600)
  assert.equal((await send(initializeMessage, { ...remoteHeaders(a.token), Origin: 'https://evil.test' })).status, 403)
  assert.equal((await send(initializeMessage, { ...remoteHeaders(a.token), Accept: 'application/json' })).status, 406)
  assert.equal((await send(initializeMessage, { ...remoteHeaders(a.token), Accept: 'application/json, text/event-stream;q=0' })).status, 406)
  assert.equal((await send(initializeMessage, { ...remoteHeaders(a.token), 'Content-Type': 'text/plain' })).status, 415)
  assert.equal((await send(initializeMessage, { ...remoteHeaders(a.token), 'MCP-Protocol-Version': '1900-01-01' })).status, 400)
  const initialized = await send(initializeMessage)
  assert.equal(initialized.status, 200)
  const id = initialized.headers.get('mcp-session-id')
  assert.match(id, /^[a-z0-9-]{36}$/)
  const headers = remoteHeaders(a.token, id)
  assert.equal((await send({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, headers)).data.error.code, -32002)
  assert.equal((await f.request('/mcp', { headers: { ...headers, Accept: 'text/event-stream' } })).status, 400)
  assert.equal((await send({ jsonrpc: '2.0', method: 'notifications/initialized' }, headers)).status, 202)
  const tools = await send({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, headers)
  assert.equal(tools.data.result.tools.length, paperTools.length + 1)
  for (const tool of tools.data.result.tools.slice(1)) {
    assert.ok(tool.inputSchema.required.includes('project_id'))
    assert.equal(tool.inputSchema.properties.file, undefined)
    assert.equal(tool.inputSchema.properties.output, undefined)
  }
  assert.equal((await send({ jsonrpc: '2.0', id: 4, method: 'ping' }, remoteHeaders(b.token, id))).status, 404)
  assert.equal((await f.request('/mcp', { method: 'DELETE', headers: remoteHeaders(b.token, id) })).status, 404)
  assert.equal((await send({ jsonrpc: '2.0', id: 5, method: 'ping' }, { ...headers, 'MCP-Protocol-Version': '2025-06-18' })).status, 400)
  assert.equal((await send(initializeMessage, headers)).data.error.code, -32600)
  assert.equal((await send({ jsonrpc: '2.0', id: 6, method: 'resources/read', params: { uri: 'paper://schema' } }, headers)).data.result.contents[0].mimeType, 'application/schema+json')
  assert.ok(JSON.parse((await send({ jsonrpc: '2.0', id: 7, method: 'resources/read', params: { uri: 'paper://shaders' } }, headers)).data.result.contents[0].text).shaders)
  assert.equal((await send({ jsonrpc: '2.0', id: 8, result: {} }, headers)).status, 202)
  assert.equal((await send({ jsonrpc: '2.0', id: 9, method: 'no-such-method' }, headers)).data.error.code, -32601)
  assert.equal((await f.request('/mcp', { method: 'PATCH', headers })).headers.get('allow'), 'POST, GET, DELETE')
  assert.equal((await f.request('/mcp', { method: 'DELETE', headers })).status, 204)
  assert.equal((await send({ jsonrpc: '2.0', id: 10, method: 'ping' }, headers)).status, 404)
})

test('remote SSE delivers project notifications only to its account and closes on revoke, delete and shutdown', async t => {
  const f = await fixture(t), a = await f.login('a'), b = await f.login('b')
  await f.rpc(a.token, 'ping'); await f.rpc(b.token, 'ping')
  const headers = remoteHeaders(a.token, f.sessions.get(a.token)), otherHeaders = remoteHeaders(b.token, f.sessions.get(b.token))
  const stream = await f.open('/mcp', { headers: { ...headers, Accept: 'text/event-stream' } })
  const otherStream = await f.open('/mcp', { headers: { ...otherHeaders, Accept: 'text/event-stream' } })
  assert.equal(stream.status, 200)
  assert.equal(stream.headers.get('x-accel-buffering'), 'no')
  assert.match(stream.text(), /: connected/)
  assert.equal((await f.request('/mcp', { headers: { ...headers, Accept: 'text/event-stream' } })).status, 409)
  assert.equal((await f.request('/mcp', { headers: { ...headers, Origin: 'https://evil.test', Accept: 'text/event-stream' } })).status, 403)
  assert.equal((await f.request('/mcp', { headers: { Cookie: a.headers.Cookie, Accept: 'text/event-stream' } })).status, 401)
  await f.tool(a.token, 'create_frame', { project_id: 'private' })
  assert.match(stream.text(), /"method":"notifications\/paper\/project_changed"/)
  assert.match(stream.text(), /"project_id":"private"/)
  assert.ok(!otherStream.text().includes('private'))
  assert.equal(stream.text().split('event: message').length - 1, 1)
  const browser = await f.open('/api/events', { headers: a.headers })
  await f.tool(a.token, 'create_frame', { project_id: 'from-agent' })
  assert.match(browser.text(), /"id":"from-agent"/)
  const rotation = await f.request('/api/auth/token/regenerate', { method: 'POST', headers: a.headers })
  assert.equal(stream.res.writableEnded, true)
  assert.equal(otherStream.res.writableEnded, false)
  assert.equal((await f.request('/mcp', { headers: remoteHeaders(rotation.data.token, headers['MCP-Session-Id']) })).status, 404)
  assert.equal((await f.request('/mcp', { headers })).status, 401)
  await f.rpc(rotation.data.token, 'ping')
  const newStream = await f.open('/mcp', { headers: { ...remoteHeaders(rotation.data.token, f.sessions.get(rotation.data.token)), Accept: 'text/event-stream' } })
  await f.request('/api/auth/token', { method: 'DELETE', headers: a.headers })
  assert.equal(newStream.res.writableEnded, true)
  assert.equal((await f.request('/mcp', { method: 'DELETE', headers: otherHeaders })).status, 204)
  assert.equal(otherStream.res.writableEnded, true)
  await f.rpc(b.token, 'initialize', initializeMessage.params)
  const finalStream = await f.open('/mcp', { headers: { ...remoteHeaders(b.token, f.sessions.get(b.token)), Accept: 'text/event-stream' } })
  f.close()
  assert.equal(finalStream.res.writableEnded, true)
})

test('MCP can return SSE for POST requests and notifications never perform mutations', async t => {
  const f = await fixture(t), a = await f.login('a')
  await f.rpc(a.token, 'ping')
  const headers = { ...remoteHeaders(a.token, f.sessions.get(a.token)), Accept: 'text/event-stream, application/json;q=0.5' }
  const reply = await f.request('/mcp', { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 'sse-request', method: 'tools/call', params: { name: 'create_frame', arguments: { project_id: 'sse-project' } } }) })
  assert.equal(reply.status, 200)
  assert.equal(reply.headers.get('content-type'), 'text/event-stream')
  const payload = JSON.parse(reply.data.split('data: ')[1].trim())
  assert.equal(payload.id, 'sse-request')
  assert.equal(payload.result.structuredContent.project_id, 'sse-project')
  const notification = await f.request('/mcp', { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'create_frame', arguments: { project_id: 'must-not-exist' } } }) })
  assert.equal(notification.status, 202)
  assert.equal(notification.data, '')
  assert.equal(await f.storage.read(a.user.id, 'must-not-exist'), null)
})

test('headless tokens and native shader paints round-trip through persistent remote projects', async t => {
  const f = await fixture(t), a = await f.login('a')
  const frame = (await f.tool(a.token, 'create_frame', { project_id: 'offline', project_name: 'Offline studio' })).data.result.structuredContent
  assert.equal(frame.element.style.fill, '#edebe1')
  const token = await f.tool(a.token, 'create_token', { project_id: 'offline', expected_revision: frame.revision, name: 'agent-blue', type: 'color', value: '#81adec' })
  assert.equal(token.data.result.isError, false)
  assert.equal((await f.tool(a.token, 'list_tokens', { project_id: 'offline', type: 'color' })).data.result.structuredContent.tokens[0].value, '#81adec')
  const resources = await f.rpc(a.token, 'resources/read', { uri: 'paper://shaders' })
  const kind = Object.keys(JSON.parse(resources.data.result.contents[0].text).shaders)[0]
  const shape = await f.tool(a.token, 'add_shader_shape', { project_id: 'offline', shader_kind: kind, parentId: frame.element.id, x: 120, y: 120 })
  assert.equal(shape.data.result.isError, false)
  const exported = await f.tool(a.token, 'export_selection', { project_id: 'offline' })
  const document = JSON.parse(exported.data.result.structuredContent.content)
  assert.equal(document.scene.elements[shape.data.result.structuredContent.element.id].style.shader.kind, kind)
  assert.equal((await f.tool(a.token, 'get_basic_info', { project_id: 'offline' })).data.result.structuredContent.gridSize, 120)
})

test('workspace isolation rejects account and project symlinks and failed writes leave no staging files', async t => {
  const f = await fixture(t), a = await f.login('a'), b = await f.login('b')
  await f.tool(b.token, 'create_frame', { project_id: 'secret' })
  const directoryA = join(f.root, 'projects', a.user.id), directoryB = join(f.root, 'projects', b.user.id)
  await mkdir(directoryA)
  await symlink(join(directoryB, 'secret.paper.json'), join(directoryA, 'shortcut.paper.json'))
  assert.equal((await f.tool(a.token, 'get_canvas_elements', { project_id: 'shortcut' })).data.result.isError, true)
  assert.equal((await f.tool(a.token, 'create_frame', { project_id: 'shortcut' })).data.result.isError, true)
  assert.deepEqual((await f.tool(a.token, 'list_projects', {})).data.result.structuredContent.projects, [])
  await rm(directoryA, { recursive: true })
  await symlink(directoryB, directoryA)
  assert.equal((await f.tool(a.token, 'get_canvas_elements', { project_id: 'secret' })).data.result.isError, true)
  assert.equal((await f.tool(a.token, 'create_frame', { project_id: 'new' })).data.result.isError, true)
  const authPath = join(f.root, 'auth.json')
  await rm(authPath); await mkdir(authPath)
  await assert.rejects(f.auth.regenerate(a.user.id))
  assert.ok(!(await readdir(f.root)).some(name => name.endsWith('.tmp')))
})

test('revoking a token while a remote mutation waits for its project lock prevents the write', async t => {
  const f = await fixture(t), a = await f.login('a')
  await f.rpc(a.token, 'ping')
  let release, acquired
  const ready = new Promise(resolve => { acquired = resolve })
  const locked = f.storage.locked(`${a.user.id}/queued`, async () => { acquired(); await new Promise(resolve => { release = resolve }) })
  await ready
  const mutation = f.tool(a.token, 'create_frame', { project_id: 'queued' })
  // Tool handler has yielded at its asynchronous request-body read; revoke before releasing the lock.
  await f.request('/api/auth/token', { method: 'DELETE', headers: a.headers })
  release(); await locked
  const response = await mutation
  assert.equal(response.data.result.isError, true)
  assert.equal(await f.storage.read(a.user.id, 'queued'), null)
})

test('bounded remote reads publish schemas, match shared semantics and isolate accounts and projects', async t => {
  const { createProject } = await import('../dist/src/io/project.js')
  const { selectionContext, searchLayers } = await import('../dist/src/mcp/context.js')
  const { validateSchema } = await import('../dist/src/mcp/schema.js')
  const f = await fixture(t), a = await f.login('context-a'), b = await f.login('context-b')
  const store = new SceneStore()
  const token = store.addToken({ name: 'blue', type: 'color', value: '#81adec' })
  const root = store.add('frame', { id: 'root', name: 'Private A', rotation: 45 })
  store.add('frame', { id: 'card', parentId: root.id, rotation: -15 })
  store.add('text', { id: 'heading', parentId: 'card', text: 'Hello agent', tokenBindings: { fill: token.id } })
  store.add('rectangle', { id: 'locked', parentId: 'card', locked: true })
  store.add('text', { id: 'hidden', parentId: 'card', text: 'Private note', visible: false })
  const document = createProject(store, 'Context study', { x: 0, y: 0, zoom: 1 }, true)
  const put = (user, id, document) => f.request(`/api/projects/${id}`, { method: 'PUT', headers: user.headers, body: JSON.stringify({ document, updatedAt: Date.now(), expectedRevision: null }) })
  assert.equal((await put(a, 'study', document)).status, 200)
  assert.equal((await put(a, 'unrelated', empty('Unrelated project'))).status, 200)
  const before = await f.storage.read(a.user.id, 'study')
  const unrelated = await f.storage.read(a.user.id, 'unrelated')
  for (const name of ['get_selection_context', 'search_layers']) {
    const denied = await f.tool(b.token, name, { project_id: 'study' })
    assert.equal(denied.data.result.isError, true)
    assert.ok(!JSON.stringify(denied.data).includes('Private A'))
  }
  assert.equal((await put(b, 'study', empty('Account B private'))).status, 200)
  const otherUser = await f.storage.read(b.user.id, 'study')
  const tools = (await f.rpc(a.token, 'tools/list')).data.result.tools
  const identity = { projectId: 'study', project_id: 'study', revision: before.revision }
  const success = async (name, args = {}) => {
    const reply = await f.tool(a.token, name, { project_id: 'study', ...args })
    assert.equal(reply.data.result.isError, false, JSON.stringify(reply.data))
    const result = reply.data.result.structuredContent
    validateSchema(result, tools.find(tool => tool.name === name).outputSchema)
    assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 32768)
    return result
  }
  assert.equal((await success('get_selection_context')).empty, true)
  const context = await success('get_selection_context', { element_ids: ['heading'] })
  assert.deepEqual(context, selectionContext(before.document, ['heading'], identity))
  assert.ok(context.linkedTokens.some(t => t.id === token.id))
  const args = { scope_id: 'card', limit: 1 }
  const page = await success('search_layers', args)
  assert.deepEqual(page, searchLayers(before.document, args, identity))
  assert.equal((await success('search_layers', { ...args, cursor: page.nextCursor })).results[0].id, 'locked')
  for (const args of [{ element_ids: ['deleted'] }, { element_ids: ['heading', 'deleted'] }]) {
    assert.equal((await f.tool(a.token, 'get_selection_context', { project_id: 'study', ...args })).data.result.isError, true)
  }
  assert.equal((await f.tool(a.token, 'search_layers', { ...args, project_id: 'unrelated', cursor: page.nextCursor })).data.result.isError, true)
  assert.equal((await f.tool(b.token, 'search_layers', { ...args, project_id: 'study', cursor: page.nextCursor })).data.result.isError, true)
  assert.deepEqual(await f.storage.read(a.user.id, 'study'), before)
  assert.deepEqual(await f.storage.read(a.user.id, 'unrelated'), unrelated)
  assert.deepEqual(await f.storage.read(b.user.id, 'study'), otherUser)
  const edit = await f.tool(a.token, 'update_element', { project_id: 'study', element_id: 'heading', expected_revision: context.revision, patch: { text: 'Changed with targeted revision' } })
  assert.equal(edit.data.result.isError, false)
  assert.equal((await f.tool(a.token, 'search_layers', { project_id: 'study', ...args, cursor: page.nextCursor })).data.result.isError, true)
  assert.equal((await f.tool(a.token, 'update_element', { project_id: 'study', element_id: 'heading', expected_revision: context.revision, patch: { text: 'Stale' } })).data.result.isError, true)
  assert.deepEqual(await f.storage.read(a.user.id, 'unrelated'), unrelated)
  assert.deepEqual(await f.storage.read(b.user.id, 'study'), otherUser)
})

test('remote atomic plans preview without disk effects, serialize agents, and replay across sessions', async t => {
  const f = await fixture(t), a = await f.login('atomic-a'), b = await f.login('atomic-b')
  const success = async (token, name, args) => {
    const response = await f.tool(token, name, args)
    assert.equal(response.status, 200)
    assert.equal(response.data.result.isError, false, JSON.stringify(response.data))
    return response.data.result.structuredContent
  }
  const project_id = 'atomic'
  await success(a.token, 'create_frame', { project_id, id: 'seed' })
  await success(b.token, 'create_frame', { project_id, id: 'seed' })
  const info = await success(a.token, 'get_basic_info', { project_id })
  const file = join(f.root, 'projects', a.user.id, `${project_id}.paper.json`)
  const before = await readFile(file)
  const plan = { project_id, expected_revision: info.revision, idempotency_key: 'retry-me', operations: [
    { action: 'create', type: 'frame', id: 'card', width: 320, height: 240 },
    { action: 'create', type: 'text', parentId: '$0', text: 'Atomic handoff' },
    { action: 'create_token', name: 'accent', type: 'color', value: '#81adec' },
    { action: 'bind_token', element_id: '$1', property: 'fill', token_id: '$2' },
  ] }
  const preview = await success(a.token, 'apply_changes', { ...plan, dry_run: true })
  assert.equal(preview.dry_run, true)
  assert.equal(preview.revision, info.revision)
  assert.deepEqual(await readFile(file), before)
  const invalid = await f.tool(a.token, 'apply_changes', { ...plan, operations: [plan.operations[0], { action: 'update', element_id: 'missing', patch: { name: 'Invalid' } }] })
  assert.equal(invalid.data.result.isError, true)
  assert.deepEqual(await readFile(file), before)
  const [first, replay] = await Promise.all([success(a.token, 'apply_changes', plan), success(a.token, 'apply_changes', plan)])
  assert.deepEqual(replay, first)
  const after = await readFile(file)
  f.sessions.delete(a.token) // A lost HTTP session must not lose its receipt.
  assert.deepEqual(await success(a.token, 'apply_changes', plan), first)
  assert.deepEqual(await readFile(file), after)
  const changedPlan = await f.tool(a.token, 'apply_changes', { ...plan, operations: [{ action: 'create', type: 'text', text: 'Different' }] })
  assert.equal(changedPlan.data.result.isError, true)
  assert.match(changedPlan.data.result.content[0].text, /idempotency/i)
  assert.deepEqual(await readFile(file), after)
  assert.equal((await success(b.token, 'apply_changes', plan)).project_id, project_id)
  assert.ok((await f.storage.read(b.user.id, project_id)).document.scene.elements.card)
  await success(a.token, 'create_frame', { project_id: 'other', id: 'other' })
  const otherInfo = await success(a.token, 'get_basic_info', { project_id: 'other' })
  assert.equal((await success(a.token, 'apply_changes', { ...plan, project_id: 'other', expected_revision: otherInfo.revision })).project_id, 'other')
  const revision = (await success(a.token, 'get_basic_info', { project_id })).revision
  const results = await Promise.all(['agent-one', 'agent-two'].map(id => f.tool(a.token, 'apply_changes', { project_id, expected_revision: revision, operations: [{ action: 'create', type: 'text', id }] })))
  assert.equal(results.filter(response => !response.data.result.isError).length, 1)
  assert.equal(results.filter(response => response.data.result.isError).length, 1)
  const persisted = await f.storage.read(a.user.id, project_id)
  assert.equal(['agent-one', 'agent-two'].filter(id => persisted.document.scene.elements[id]).length, 1)
})

test('cloud storage confines account app artifacts, prevents symlinks, and enforces revision checks', async t => {
  const { createAppProject } = await import('../dist/src/make/manifest.js')
  const f = await fixture(t), a = await f.login('cloud-make-a'), b = await f.login('cloud-make-b')
  const appId = 'cloud_make_app'
  const project = createAppProject({ id: appId, name: 'Cloud App A', files: { 'src/App.tsx': 'export const a = 1' } })

  const saved = await f.storage.apps.put(a.user.id, appId, project, null)
  assert.equal(saved.revision, 1)

  // Stale expectedRevision rejected
  await assert.rejects(
    f.storage.apps.put(a.user.id, appId, project, 999),
    err => err.status === 409
  )

  // Account B cannot read A's app, files, or revisions
  assert.equal(await f.storage.apps.read(b.user.id, appId), null)
  assert.equal(await f.storage.apps.readFile(b.user.id, appId, 'src/App.tsx'), null)
  assert.equal(await f.storage.apps.readRevision(b.user.id, appId, 1), null)
  assert.deepEqual(await f.storage.apps.list(b.user.id), [])
  await assert.rejects(
    f.storage.apps.put(b.user.id, appId, { ...project, name: 'Attempted overwrite' }, 1),
    err => err.status === 409 && err.current === null
  )
  assert.equal(await f.storage.apps.delete(b.user.id, appId), false)
  await f.storage.apps.put(b.user.id, appId, { ...project, name: 'B independent app' }, null)
  assert.equal((await f.storage.apps.read(a.user.id, appId)).name, 'Cloud App A')

  // Symlink account traversal rejected
  const appsDir = join(f.root, 'apps')
  const dirA = join(appsDir, a.user.id), dirB = join(appsDir, b.user.id)
  await mkdir(dirB, { recursive: true })
  await symlink(join(dirA, appId), join(dirB, 'shortcut_app'))
  await assert.rejects(f.storage.apps.read(b.user.id, 'shortcut_app'), err => err.status === 403)
  await assert.rejects(f.storage.apps.readFile(b.user.id, 'shortcut_app', 'src/App.tsx'), err => err.status === 403)
  await assert.rejects(f.storage.apps.readRevision(b.user.id, 'shortcut_app', 1), err => err.status === 403)
  await assert.rejects(f.storage.apps.put(b.user.id, 'shortcut_app', project, 1), err => err.status === 403)
  await assert.rejects(f.storage.apps.delete(b.user.id, 'shortcut_app'), err => err.status === 403)
  assert.deepEqual(await f.storage.apps.read(a.user.id, appId), saved)
})
