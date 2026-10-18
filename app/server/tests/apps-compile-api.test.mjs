import test from 'node:test'
import assert from 'node:assert/strict'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Duplex } from 'node:stream'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createService } from '../dist/server/service.js'
import { createAppProject } from '../dist/src/make/manifest.js'

const secret = 'persistent-secret-for-compile-api-tests-12345'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'paper-compile-api-'))
  const service = await createService({ root, secret, origin: 'http://localhost:3000' })
  const responses = []
  t.after(async () => {
    service.close()
    for (const res of responses) res.emit('close')
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
    let text = ''
    const write = res.write.bind(res), end = res.end.bind(res)
    res.write = chunk => { text += String(chunk); return write(chunk) }
    res.end = chunk => { if (chunk) text += String(chunk); return end(chunk) }
    await service.handler(req, res, options.body ?? {})
    const headers = new Headers()
    for (const line of res._header.split('\r\n').slice(1)) {
      const split = line.indexOf(':')
      if (split > 0) headers.append(line.slice(0, split), line.slice(split + 1).trim())
    }
    return {
      status: res.statusCode,
      headers,
      data: headers.get('content-type')?.includes('json') ? JSON.parse(text) : text,
    }
  }

  return { service, open }
}

async function login(service, sub = 'u1') {
  const { session } = await service.auth.login('github', {
    sub,
    email: `${sub}@test.local`,
    name: sub,
    avatar: '',
  })
  return session
}

test('POST /api/apps/compile compiles valid TSX sources into sandboxed preview assets', async t => {
  const { service, open } = await fixture(t)
  const cookie = await login(service)

  const res = await open('/api/apps/compile', {
    method: 'POST',
    headers: {
      Cookie: `paper_session=${cookie}`,
      'X-Paper-Client': 'web',
      Origin: 'http://localhost:3000',
    },
    body: {
      files: {
        'src/App.tsx': `
import React, { useState } from 'react'
export default function App() {
  const [count, setCount] = useState(0)
  return <button onClick={() => setCount(c => c + 1)}>Count: {count}</button>
}`,
      },
    },
  })

  assert.equal(res.status, 200)
  assert.equal(res.data.success, true)
  assert.ok(res.data.assets)
  assert.ok(res.data.assets.js.includes('Count:'))
  assert.ok(res.data.assets.html.includes('Content-Security-Policy'))
  assert.equal(res.data.diagnostics.length, 0)
})

test('POST /api/apps/compile returns actionable diagnostics on malformed sources', async t => {
  const { service, open } = await fixture(t)
  const cookie = await login(service)

  const res = await open('/api/apps/compile', {
    method: 'POST',
    headers: {
      Cookie: `paper_session=${cookie}`,
      'X-Paper-Client': 'web',
      Origin: 'http://localhost:3000',
    },
    body: {
      files: {
        'src/App.tsx': `export default function App() { return <div><span> unclosed }`,
      },
    },
  })

  assert.equal(res.status, 200)
  assert.equal(res.data.success, false)
  assert.equal(res.data.assets, null)
  assert.ok(res.data.diagnostics.length > 0)
  assert.equal(res.data.diagnostics[0].code, 'SYNTAX_ERROR')
  assert.equal(res.data.diagnostics[0].file, 'src/App.tsx')
  assert.ok(res.data.diagnostics[0].line > 0)
})

test('POST /api/apps/:id/compile compiles an existing stored app project', async t => {
  const { service, open } = await fixture(t)
  const cookie = await login(service)
  const authHeaders = {
    Cookie: `paper_session=${cookie}`,
    'X-Paper-Client': 'web',
    Origin: 'http://localhost:3000',
  }

  // Create app first
  const project = createAppProject({
    id: 'app-to-compile',
    name: 'Stored App',
    files: {
      'src/App.tsx': `export default function App() { return <h1>Stored App Live</h1> }`,
    },
  })
  const created = await open('/api/apps', {
    method: 'POST',
    headers: authHeaders,
    body: { project },
  })
  assert.equal(created.status, 201)

  // Compile stored app
  const compiled = await open('/api/apps/app-to-compile/compile', {
    method: 'POST',
    headers: authHeaders,
    body: {},
  })
  assert.equal(compiled.status, 200)
  assert.equal(compiled.data.success, true)
  assert.ok(compiled.data.assets.js.includes('Stored App Live'))
})

test('compile endpoints enforce authentication and CSRF guard', async t => {
  const { service, open } = await fixture(t)

  // No session
  const unauth = await open('/api/apps/compile', {
    method: 'POST',
    headers: { 'X-Paper-Client': 'web', Origin: 'http://localhost:3000' },
    body: { files: { 'src/App.tsx': 'export default () => null' } },
  })
  assert.equal(unauth.status, 401)

  const cookie = await login(service)
  // Missing CSRF client header
  const noClient = await open('/api/apps/compile', {
    method: 'POST',
    headers: { Cookie: `paper_session=${cookie}`, Origin: 'http://localhost:3000' },
    body: { files: { 'src/App.tsx': 'export default () => null' } },
  })
  assert.equal(noClient.status, 403)
})

test('compilation enforces account isolation, origin, source policy and bounded strict JSON', async t => {
  const { service, open } = await fixture(t)
  const cookie = await login(service)
  const headers = { Cookie: `paper_session=${cookie}`, 'X-Paper-Client': 'web', Origin: 'http://localhost:3000' }
  const project = createAppProject({ id: 'private-compile', files: { 'src/App.tsx': 'export default () => <div>Private</div>' } })
  assert.equal((await open('/api/apps', { method: 'POST', headers, body: { project } })).status, 201)
  const otherCookie = await login(service, 'other-account')
  const crossAccount = await open('/api/apps/private-compile/compile', { method: 'POST', headers: { ...headers, Cookie: `paper_session=${otherCookie}` } })
  assert.equal(crossAccount.status, 404)
  assert.equal((await open('/api/apps/compile', { method: 'POST', headers: { ...headers, 'X-Paper-Account': 'other-account' }, body: { project } })).status, 403)
  assert.equal((await open('/api/apps/compile', { method: 'POST', headers: { ...headers, Origin: 'https://evil.test' }, body: { project } })).status, 403)
  for (const path of ['/api/apps/compile', '/api/app-projects/compile']) {
    const result = await open(path, { method: 'POST', headers, body: { files: { 'src/App.tsx': "import fs from 'node:fs'; export default () => null" }, allowlist: ['node:fs'] } })
    assert.equal(result.status, 200)
    assert.equal(result.data.success, false)
    assert.equal(result.data.assets, null)
    assert.equal(result.data.diagnostics[0].code, 'DENIED_IMPORT')
  }
  const duplicate = await open('/api/apps/compile', { method: 'POST', headers, body: '{"files":{"src/App.tsx":"safe","src/App.tsx":"unsafe"}}' })
  assert.equal(duplicate.status, 400)
  const oversized = await open('/api/apps/compile', { method: 'POST', headers, body: JSON.stringify({ files: { 'src/App.tsx': 'x'.repeat(4 * 1024 * 1024) } }) })
  assert.equal(oversized.status, 413)
  const invalidProject = await open('/api/apps/compile', { method: 'POST', headers, body: { project: { ...project, version: 999 } } })
  assert.equal(invalidProject.status, 400)
  assert.deepEqual((await open('/api/apps/private-compile', { headers })).data.files, project.files)
  assert.equal((await open('/api/apps/private-compile', { headers })).data.revision, 1)
})

test('source formatting is authenticated, bounded, draft-only and preserves code and CSS literals', async t => {
  const { service, open } = await fixture(t)
  const cookie = await login(service)
  const headers = { Cookie: `paper_session=${cookie}`, 'X-Paper-Client': 'web', Origin: 'http://localhost:3000' }
  const format = (path, content, h = headers) => open('/api/apps/format', { method: 'POST', headers: h, body: { path, content } })
  assert.equal((await format('src/App.tsx', 'export default () => null', { 'X-Paper-Client': 'web' })).status, 401)
  assert.equal((await format('src/App.tsx', 'export default () => null', { Cookie: headers.Cookie, Origin: headers.Origin })).status, 403)
  assert.equal((await format('src/App.tsx', 'export default () => null', { ...headers, Origin: 'https://evil.test' })).status, 403)
  const tsx = await format('src/App.tsx', 'export default function App(){const text=`  exact\\n whitespace  `;return <h1>{text}</h1>}')
  assert.equal(tsx.status, 200)
  assert.match(tsx.data.content, /function App\(\) \{/)
  assert.match(tsx.data.content, /`  exact\\n whitespace  `/)
  assert.equal((await format('src/App.tsx', tsx.data.content)).data.content, tsx.data.content)
  const css = await format('src/styles.css', '@media (min-width: 20px){.title{color:#81adec;content:"a;{b}  c"}}')
  assert.equal(css.status, 200)
  assert.match(css.data.content, /\n  \.title/)
  assert.match(css.data.content, /\n    color: #81adec;/)
  assert.match(css.data.content, /content: "a;\{b\}  c"/)
  assert.equal((await format('src/styles.css', css.data.content)).data.content, css.data.content)
  assert.equal((await format('../secret.ts', 'export {}')).status, 400)
  assert.equal((await format('src/App.tsx', 'export default () => <main>')).status, 400)
  assert.equal((await format('src/styles.css', 'a { color: red')).status, 400)
  assert.equal((await format('src/App.tsx', 'x'.repeat(512 * 1024 + 1))).status, 400)
  assert.deepEqual((await open('/api/apps', { headers })).data.apps, [])
})

test('manual source writes use real expected revision guard and preserve the concurrent revision', async t => {
  const { service, open } = await fixture(t)
  const cookie = await login(service)
  const headers = { Cookie: `paper_session=${cookie}`, 'X-Paper-Client': 'web', Origin: 'http://localhost:3000' }
  const project = createAppProject({ id: 'manual-conflict', files: { 'src/App.tsx': 'export default () => <main>Original</main>' } })
  assert.equal((await open('/api/apps', { method: 'POST', headers, body: { project } })).status, 201)
  const model = { ...project, files: { 'src/App.tsx': { path: 'src/App.tsx', content: 'export default () => <main>Model</main>' } } }
  assert.equal((await open('/api/apps/manual-conflict', { method: 'PUT', headers, body: { project: model, expectedRevision: 1 } })).status, 200)
  const stale = await open('/api/apps/manual-conflict', { method: 'PUT', headers, body: { project, expectedRevision: 1 } })
  assert.equal(stale.status, 409)
  const current = (await open('/api/apps/manual-conflict', { headers })).data
  assert.equal(current.revision, 2)
  assert.deepEqual(current.files, model.files)
})
