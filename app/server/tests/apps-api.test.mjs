import test from 'node:test'
import assert from 'node:assert/strict'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Duplex } from 'node:stream'
import { mkdtemp, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createService } from '../dist/server/service.js'
import { createAppProject, APP_PROJECT_LIMITS } from '../dist/src/make/manifest.js'

const secret = 'a-persistent-secret-for-apps-api-tests-12345'

async function fixture(t, extra = {}) {
  const root = await mkdtemp(join(tmpdir(), 'paper-apps-api-'))
  let service = await createService({ root, secret, origin: 'http://localhost:3000', ...extra })
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
    let text = ''
    const write = res.write.bind(res), end = res.end.bind(res)
    res.write = chunk => { text += String(chunk); return write(chunk) }
    res.end = chunk => { if (chunk) text += String(chunk); return end(chunk) }
    if (options.rawBody) {
      req.push(options.body ?? '')
      req.push(null)
    }
    await service.handler(req, res, Object.hasOwn(options, 'parsedBody') ? options.parsedBody : options.rawBody ? undefined : options.body ? JSON.parse(options.body) : {})
    const headers = new Headers()
    for (const line of res._header.split('\r\n').slice(1)) {
      const split = line.indexOf(':')
      if (split > 0) headers.append(line.slice(0, split), line.slice(split + 1).trim())
    }
    return { status: res.statusCode, headers, res, text: () => text }
  }

  const request = async (path, options = {}) => {
    const response = await open(path, options)
    return {
      status: response.status,
      headers: response.headers,
      data: response.headers.get('content-type')?.includes('json') ? JSON.parse(response.text()) : response.text(),
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

  return { ...service, root, open, request, login, restart: async () => {
    service.close()
    service = await createService({ root, secret, origin: 'http://localhost:3000', ...extra })
  } }
}

test('app project endpoints enforce session authentication and CSRF guards', async t => {
  const f = await fixture(t)
  const a = await f.login('alice')

  // Unauthenticated requests must reject with 401
  assert.equal((await f.request('/api/apps')).status, 401)
  assert.equal((await f.request('/api/apps', { method: 'POST', body: '{}' })).status, 401)
  assert.equal((await f.request('/api/apps/app_sample')).status, 401)
  assert.equal((await f.request('/api/apps/app_sample', { method: 'PUT', body: '{}' })).status, 401)
  assert.equal((await f.request('/api/apps/app_sample', { method: 'DELETE' })).status, 401)

  // Mutating requests without CSRF guard ('X-Paper-Client: web') must reject with 403
  const noCsrf = { Cookie: a.headers.Cookie }
  assert.equal((await f.request('/api/apps', { method: 'POST', headers: noCsrf, body: '{}' })).status, 403)
  assert.equal((await f.request('/api/apps/app_sample', { method: 'PUT', headers: noCsrf, body: '{}' })).status, 403)
  assert.equal((await f.request('/api/apps/app_sample', { method: 'DELETE', headers: noCsrf })).status, 403)

  // Untrusted Origin must reject with 403
  assert.equal(
    (await f.request('/api/apps', { headers: { ...a.headers, Origin: 'https://evil.attacker.com' } })).status,
    403
  )
})

test('app project CRUD lifecycle: list, create, read, update, delete', async t => {
  const f = await fixture(t)
  const a = await f.login('creator')

  // 1. Initial list should be empty
  const initial = await f.request('/api/apps', { headers: a.headers })
  assert.equal(initial.status, 200)
  assert.deepEqual(initial.data.apps, [])

  // 2. Create an App Project via POST /api/apps
  const input = {
    id: 'app_counter',
    name: 'Counter App',
    description: 'An interactive counter created with Paper Make',
    files: {
      'src/App.tsx': 'import React from "react"; export default function App() { return <h1>Counter</h1>; }',
    },
  }
  const created = await f.request('/api/apps', {
    method: 'POST',
    headers: a.headers,
    body: JSON.stringify(input),
  })
  assert.ok([200, 201].includes(created.status), `create status was ${created.status}`)
  assert.equal(created.data.id, 'app_counter')
  assert.equal(created.data.name, 'Counter App')
  assert.equal(created.data.revision, 1)
  assert.ok(created.data.files['src/App.tsx'])

  // 3. List should now contain the new app summary
  const listed = await f.request('/api/apps', { headers: a.headers })
  assert.equal(listed.status, 200)
  assert.equal(listed.data.apps.length, 1)
  assert.equal(listed.data.apps[0].id, 'app_counter')
  assert.equal(listed.data.apps[0].name, 'Counter App')
  assert.equal(listed.data.apps[0].revision, 1)

  // 4. Read the project via GET /api/apps/:id
  const read = await f.request('/api/apps/app_counter', { headers: a.headers })
  assert.equal(read.status, 200)
  assert.equal(read.data.id, 'app_counter')
  assert.equal(read.data.name, 'Counter App')
  assert.equal(read.data.revision, 1)
  assert.equal(read.data.files['src/App.tsx'].content, input.files['src/App.tsx'])

  // 5. Read individual source file via GET /api/apps/:id/files?path=src/App.tsx
  const fileRead = await f.request('/api/apps/app_counter/files?path=src/App.tsx', { headers: a.headers })
  assert.equal(fileRead.status, 200)
  assert.equal(fileRead.data.path, 'src/App.tsx')
  assert.equal(fileRead.data.content, input.files['src/App.tsx'])

  // Reading non-existent file returns 404
  const missingFile = await f.request('/api/apps/app_counter/files?path=src/Missing.tsx', { headers: a.headers })
  assert.equal(missingFile.status, 404)

  // 6. Update the project via PUT /api/apps/:id with expectedRevision: 1
  const updatePayload = {
    ...read.data,
    name: 'Counter App v2',
    files: {
      'src/App.tsx': {
        path: 'src/App.tsx',
        content: 'export default function App() { return <h1>Counter v2</h1>; }',
      },
      'src/utils.ts': {
        path: 'src/utils.ts',
        content: 'export const add = (a: number, b: number) => a + b;',
      },
    },
    expectedRevision: 1,
  }
  const updated = await f.request('/api/apps/app_counter', {
    method: 'PUT',
    headers: a.headers,
    body: JSON.stringify(updatePayload),
  })
  assert.equal(updated.status, 200)
  assert.equal(updated.data.revision, 2)
  assert.equal(updated.data.name, 'Counter App v2')
  assert.ok(updated.data.files['src/utils.ts'])

  // 7. Verify revisions endpoint
  const revs = await f.request('/api/apps/app_counter/revisions', { headers: a.headers })
  assert.equal(revs.status, 200)
  assert.equal(revs.data.revisions.length, 2)
  assert.equal(revs.data.revisions[0].revision, 1)
  assert.equal(revs.data.revisions[1].revision, 2)

  const rev1 = await f.request('/api/apps/app_counter/revisions/1', { headers: a.headers })
  assert.equal(rev1.status, 200)
  assert.equal(rev1.data.project.name, 'Counter App')
  assert.equal(rev1.data.project.revision, 1)

  // 8. Delete the app via DELETE /api/apps/:id
  const deleted = await f.request('/api/apps/app_counter', {
    method: 'DELETE',
    headers: a.headers,
  })
  assert.equal(deleted.status, 200)
  assert.equal(deleted.data.ok, true)
  await assert.rejects(access(join(f.root, 'apps', a.user.id, 'app_counter')), { code: 'ENOENT' })
  for (const resource of ['files?path=src/App.tsx', 'revisions', 'revisions/1']) {
    assert.equal((await f.request(`/api/apps/app_counter/${resource}`, { headers: a.headers })).status, 404)
  }

  // Subsequent read returns 404
  assert.equal((await f.request('/api/apps/app_counter', { headers: a.headers })).status, 404)

  // Subsequent delete returns 404
  assert.equal((await f.request('/api/apps/app_counter', { method: 'DELETE', headers: a.headers })).status, 404)

  // List is now empty
  const afterDelete = await f.request('/api/apps', { headers: a.headers })
  assert.equal(afterDelete.status, 200)
  assert.deepEqual(afterDelete.data.apps, [])
})

test('cross-account isolation prevents unauthorized access and mutations', async t => {
  const f = await fixture(t)
  const a = await f.login('alice')
  const b = await f.login('bob')

  // Alice creates a private app
  const project = createAppProject({ id: 'alice_secret_app', name: 'Alice Private Project' })
  const created = await f.request('/api/apps', {
    method: 'POST',
    headers: a.headers,
    body: JSON.stringify(project),
  })
  assert.ok([200, 201].includes(created.status))

  // Bob cannot see Alice's app in list
  const bobList = await f.request('/api/apps', { headers: b.headers })
  assert.equal(bobList.status, 200)
  assert.deepEqual(bobList.data.apps, [])

  // Bob cannot read Alice's app (returns 404)
  assert.equal((await f.request('/api/apps/alice_secret_app', { headers: b.headers })).status, 404)

  // Bob cannot read Alice's app files or revisions (returns 404)
  assert.equal((await f.request('/api/apps/alice_secret_app/files?path=src/App.tsx', { headers: b.headers })).status, 404)
  assert.equal((await f.request('/api/apps/alice_secret_app/revisions', { headers: b.headers })).status, 404)
  assert.equal((await f.request('/api/apps/alice_secret_app/revisions/1', { headers: b.headers })).status, 404)

  // Bob cannot overwrite Alice's app
  const bobOverwrite = await f.request('/api/apps/alice_secret_app', {
    method: 'PUT',
    headers: b.headers,
    body: JSON.stringify({ ...project, name: 'Bob Hijack', expectedRevision: 1 }),
  })
  assert.equal(bobOverwrite.status, 409)

  // Bob cannot delete Alice's app (returns 404)
  assert.equal((await f.request('/api/apps/alice_secret_app', { method: 'DELETE', headers: b.headers })).status, 404)

  // Alice passes X-Paper-Account with Bob's ID -> rejected with 403
  assert.equal(
    (await f.request('/api/apps', { headers: { ...a.headers, 'X-Paper-Account': b.user.id } })).status,
    403
  )

  // Alice's app remains intact and unaffected
  const aliceRead = await f.request('/api/apps/alice_secret_app', { headers: a.headers })
  assert.equal(aliceRead.status, 200)
  assert.equal(aliceRead.data.name, 'Alice Private Project')
})

test('stale writes and invalid expected revisions are rejected with 409 and 400', async t => {
  const f = await fixture(t)
  const a = await f.login('alice')

  const project = createAppProject({ id: 'stale_test_app', name: 'Initial Version' })
  await f.request('/api/apps', {
    method: 'POST',
    headers: a.headers,
    body: JSON.stringify(project),
  })

  // Advance to revision 2
  const v2 = await f.request('/api/apps/stale_test_app', {
    method: 'PUT',
    headers: a.headers,
    body: JSON.stringify({ name: 'Version 2', expectedRevision: 1 }),
  })
  assert.equal(v2.status, 200)
  assert.equal(v2.data.revision, 2)

  // Stale expectedRevision (1 when current is 2) -> 409 Revision conflict
  const staleWrite = await f.request('/api/apps/stale_test_app', {
    method: 'PUT',
    headers: a.headers,
    body: JSON.stringify({ name: 'Stale update', expectedRevision: 1 }),
  })
  assert.equal(staleWrite.status, 409)
  assert.equal(staleWrite.data.current.revision, 2)

  // Future expectedRevision (999 instead of 2) -> 409 Revision conflict
  const futureWrite = await f.request('/api/apps/stale_test_app', {
    method: 'PUT',
    headers: a.headers,
    body: JSON.stringify({ name: 'Future update', expectedRevision: 999 }),
  })
  assert.equal(futureWrite.status, 409)
  assert.equal(futureWrite.data.current.revision, 2)

  // Non-positive or non-integer expectedRevision -> 400 Bad Request
  const zeroRev = await f.request('/api/apps/stale_test_app', {
    method: 'PUT',
    headers: a.headers,
    body: JSON.stringify({ name: 'Zero rev', expectedRevision: 0 }),
  })
  assert.equal(zeroRev.status, 400)

  const invalidRev = await f.request('/api/apps/stale_test_app', {
    method: 'PUT',
    headers: a.headers,
    body: JSON.stringify({ name: 'Bad rev', expectedRevision: -1 }),
  })
  assert.equal(invalidRev.status, 400)

  // Creating an existing app with POST and expectedRevision: null -> 409 Conflict
  const duplicateCreate = await f.request('/api/apps', {
    method: 'POST',
    headers: a.headers,
    body: JSON.stringify({ id: 'stale_test_app', name: 'Duplicate Create' }),
  })
  assert.equal(duplicateCreate.status, 409)
})

test('malformed files, path traversal, oversized files and payloads reject safely', async t => {
  const f = await fixture(t)
  const a = await f.login('alice')

  // 1. Path traversal in file path rejected with 400
  const traversal = await f.request('/api/apps', {
    method: 'POST',
    headers: a.headers,
    body: JSON.stringify({
      id: 'bad_paths_app',
      name: 'Traversal Test',
      files: {
        '../evil.tsx': 'export const hack = true;',
      },
    }),
  })
  assert.equal(traversal.status, 400)

  // Absolute path in file rejected with 400
  const absolutePath = await f.request('/api/apps', {
    method: 'POST',
    headers: a.headers,
    body: JSON.stringify({
      id: 'bad_paths_app2',
      name: 'Absolute Path Test',
      files: {
        '/etc/passwd': 'root:x:0:0',
      },
    }),
  })
  assert.equal(absolutePath.status, 400)

  // 2. Oversized single file (> 512 KB) rejected with 400
  const oversizedFile = 'x'.repeat(APP_PROJECT_LIMITS.MAX_FILE_BYTES + 1)
  const oversizedFileReq = await f.request('/api/apps', {
    method: 'POST',
    headers: a.headers,
    body: JSON.stringify({
      id: 'oversized_file_app',
      name: 'Oversized File',
      files: {
        'src/Huge.tsx': oversizedFile,
      },
    }),
  })
  assert.equal(oversizedFileReq.status, 400)

  // 3. Total files size exceeding limit (> 2 MB) rejected with 400
  const largeChunk = 'y'.repeat(450 * 1024)
  const totalFilesReq = await f.request('/api/apps', {
    method: 'POST',
    headers: a.headers,
    body: JSON.stringify({
      id: 'total_files_app',
      name: 'Total Files Limit',
      files: {
        'src/chunk1.tsx': largeChunk,
        'src/chunk2.tsx': largeChunk,
        'src/chunk3.tsx': largeChunk,
        'src/chunk4.tsx': largeChunk,
        'src/chunk5.tsx': largeChunk,
      },
    }),
  })
  assert.equal(totalFilesReq.status, 400)

  // 4. Oversized request payload (> 4 MB MAX_MANIFEST_BYTES) rejected with 413
  const hugePayload = 'z'.repeat(APP_PROJECT_LIMITS.MAX_MANIFEST_BYTES + 1024)
  const payloadTooLarge = await f.request('/api/apps', {
    method: 'POST',
    headers: a.headers,
    rawBody: true,
    body: JSON.stringify({ id: 'huge_payload_app', name: 'Huge', extra: hugePayload }),
  })
  assert.equal(payloadTooLarge.status, 413)

  // Verify no corrupt files were written
  const list = await f.request('/api/apps', { headers: a.headers })
  assert.equal(list.status, 200)
  assert.deepEqual(list.data.apps, [])
})

test('create cannot overwrite an existing app even with its current revision', async t => {
  const f = await fixture(t), a = await f.login('alice')
  const original = createAppProject({ id: 'create_only', name: 'Keep me' })
  assert.equal((await f.request('/api/apps', { method: 'POST', headers: a.headers, body: JSON.stringify(original) })).status, 201)
  const response = await f.request('/api/apps', {
    method: 'POST', headers: a.headers,
    body: JSON.stringify({ ...original, name: 'Overwrite', expectedRevision: 1 }),
  })
  assert.equal(response.status, 400)
  assert.equal((await f.request('/api/apps/create_only', { headers: a.headers })).data.name, 'Keep me')
})

test('updates require a positive expected revision and cannot create missing projects', async t => {
  const f = await fixture(t), a = await f.login('alice')
  for (const expectedRevision of [undefined, null, 0, -1, 1.5, '1']) {
    const response = await f.request('/api/apps/missing', {
      method: 'PUT', headers: a.headers,
      body: JSON.stringify({ name: 'Unintended create', expectedRevision }),
    })
    assert.equal(response.status, 400, `expectedRevision=${expectedRevision}`)
  }
  assert.deepEqual((await f.request('/api/apps', { headers: a.headers })).data.apps, [])
})

test('raw app JSON rejects duplicate keys before any write', async t => {
  const f = await fixture(t), a = await f.login('alice')
  const response = await f.request('/api/apps', {
    method: 'POST', headers: a.headers, rawBody: true,
    body: '{"id":"duplicate","name":"First","name":"Second"}',
  })
  assert.equal(response.status, 400)
  assert.deepEqual((await f.request('/api/apps', { headers: a.headers })).data.apps, [])
})

test('concurrent API updates commit exactly one revision and retain immutable history', async t => {
  const f = await fixture(t), a = await f.login('alice')
  const project = createAppProject({ id: 'race', name: 'Original', files: { 'src/App.tsx': 'export default () => null' } })
  assert.equal((await f.request('/api/apps', { method: 'POST', headers: a.headers, body: JSON.stringify(project) })).status, 201)
  const results = await Promise.all(['One', 'Two'].map(name => f.request('/api/apps/race', {
    method: 'PUT', headers: a.headers, body: JSON.stringify({ ...project, name, expectedRevision: 1 }),
  })))
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409])
  const saved = (await f.request('/api/apps/race', { headers: a.headers })).data
  assert.equal(saved.revision, 2)
  assert.equal(saved.name, results.find(result => result.status === 200).data.name)
  assert.deepEqual(saved.files, project.files)
  const history = (await f.request('/api/apps/race/revisions/1', { headers: a.headers })).data
  assert.equal(history.project.name, 'Original')
  assert.deepEqual(history.project.files, project.files)
})

test('malformed update bodies leave the entire working revision and history unchanged', async t => {
  const f = await fixture(t), a = await f.login('alice')
  const project = createAppProject({ id: 'stable', name: 'Keep working', files: { 'src/App.tsx': 'export default () => null' } })
  const saved = (await f.request('/api/apps', { method: 'POST', headers: a.headers, body: JSON.stringify(project) })).data
  const badFiles = [
    null, [], { '../evil.tsx': 'bad' }, { 'src/App.tsx': { path: 'src/Other.tsx', content: 'bad' } },
    { 'src/App.tsx': { path: 'src/App.tsx', content: 42 } },
    { 'src/App.tsx': { path: 'src/App.tsx', content: 'bad', executable: true } },
    { 'src/App.tsx': { path: 'src/App.tsx', content: 'é'.repeat(APP_PROJECT_LIMITS.MAX_FILE_BYTES / 2 + 1) } },
    Object.fromEntries(Array.from({ length: APP_PROJECT_LIMITS.MAX_FILES_COUNT + 1 }, (_, i) => [`src/f${i}.tsx`, { path: `src/f${i}.tsx`, content: '' }])),
  ]
  for (const files of badFiles) {
    assert.equal((await f.request('/api/apps/stable', {
      method: 'PUT', headers: a.headers, rawBody: true,
      body: JSON.stringify({ ...saved, files, expectedRevision: 1 }),
    })).status, 400)
  }
  for (const body of ['{', 'null', '[]', '42', '"text"', '{"expectedRevision":1,"__proto__":{}}', '{"project":null,"expectedRevision":1}']) {
    assert.equal((await f.request('/api/apps/stable', { method: 'PUT', headers: a.headers, rawBody: true, body })).status, 400)
  }
  assert.equal((await f.request('/api/apps/stable', {
    method: 'PUT', headers: a.headers, body: JSON.stringify({ ...saved, id: 'different', expectedRevision: 1 }),
  })).status, 400)
  assert.deepEqual((await f.request('/api/apps/stable', { headers: a.headers })).data, saved)
  assert.deepEqual((await f.request('/api/apps/stable/revisions', { headers: a.headers })).data.revisions.map(r => r.revision), [1])
})

test('accounts can use the same app ID without exposing or deleting each other’s artifacts', async t => {
  const f = await fixture(t), a = await f.login('alice'), b = await f.login('bob')
  for (const [account, name] of [[a, 'Alice'], [b, 'Bob']]) {
    assert.equal((await f.request('/api/apps', { method: 'POST', headers: account.headers, body: JSON.stringify({ id: 'shared_id', name }) })).status, 201)
  }
  assert.equal((await f.request('/api/apps/shared_id', { method: 'DELETE', headers: b.headers })).status, 200)
  assert.equal((await f.request('/api/apps/shared_id', { headers: b.headers })).status, 404)
  assert.equal((await f.request('/api/apps/shared_id', { headers: a.headers })).data.name, 'Alice')
  assert.equal((await f.request('/api/apps/shared_id/revisions/1', { headers: a.headers })).data.project.name, 'Alice')
})

test('the production parser representation is strictly validated and byte bounded', async t => {
  const f = await fixture(t), a = await f.login('alice')
  const valid = await f.request('/api/apps', { method: 'POST', headers: a.headers, parsedBody: '{"name":"Wire input"}' })
  assert.equal(valid.status, 201)
  assert.match(valid.data.id, /^app_[a-z0-9]+$/)
  assert.equal(valid.headers.get('location'), `/api/apps/${valid.data.id}`)
  assert.equal(valid.headers.get('cache-control'), 'no-store')
  assert.equal(valid.headers.get('x-content-type-options'), 'nosniff')
  const cases = [
    ['{"name":"A","name":"B"}', 400],
    ['{"name":"A", "nested":{"constructor":{}}}', 400],
    ['{"name":"' + 'é'.repeat(APP_PROJECT_LIMITS.MAX_MANIFEST_BYTES / 2) + '"}', 413],
    [{ name: 'x'.repeat(APP_PROJECT_LIMITS.MAX_MANIFEST_BYTES) }, 413],
  ]
  for (const [parsedBody, status] of cases) {
    assert.equal((await f.request('/api/apps', { method: 'POST', headers: a.headers, parsedBody })).status, status)
    assert.equal((await f.request(`/api/apps/${valid.data.id}`, { method: 'PUT', headers: a.headers, parsedBody })).status, status)
  }
})

test('malformed URL encoding and invalid IDs return client errors', async t => {
  const f = await fixture(t), a = await f.login('alice')
  for (const path of ['/api/apps/%E0%A4%A', '/api/apps/%2Fetc', '/api/apps/x/files/%ZZ']) {
    assert.equal((await f.request(path, { headers: a.headers })).status, 400, path)
  }
  for (const id of [null, 42, '', '../escape']) {
    assert.equal((await f.request('/api/apps', { method: 'POST', headers: a.headers, body: JSON.stringify({ id }) })).status, 400)
  }
})

test('annotations persist across service restart, remain account scoped and reject stale or malformed writes', async t => {
  const f = await fixture(t)
  const owner = await f.login('annotation-owner')
  const other = await f.login('annotation-other')
  const input = createAppProject({ id: 'annotated-preview', files: { 'src/App.tsx': 'export default () => <button>Action</button>' } })
  const created = await f.request('/api/apps', { method: 'POST', headers: owner.headers, body: JSON.stringify({ project: input }) })
  assert.equal(created.status, 201)
  const annotation = { id: 'ann_saved', elementId: 'p-app-button-1~1', tagName: 'button', text: 'Make this blue', createdAt: new Date().toISOString() }
  const body = { project: { ...created.data, annotations: [annotation] }, expectedRevision: created.data.revision }
  const updated = await f.request('/api/apps/annotated-preview', { method: 'PUT', headers: owner.headers, body: JSON.stringify(body) })
  assert.equal(updated.status, 200)
  assert.deepEqual(updated.data.annotations, [annotation])
  assert.deepEqual(updated.data.files, created.data.files)
  assert.equal((await f.request('/api/apps/annotated-preview', { method: 'PUT', headers: owner.headers, body: JSON.stringify(body) })).status, 409)
  assert.equal((await f.request('/api/apps/annotated-preview', { headers: other.headers })).status, 404)
  const malformed = { project: { ...updated.data, annotations: [{ ...annotation, innerHTML: '<script>bad()</script>' }] }, expectedRevision: updated.data.revision }
  assert.equal((await f.request('/api/apps/annotated-preview', { method: 'PUT', headers: owner.headers, body: JSON.stringify(malformed) })).status, 400)
  const restarted = await createService({ root: f.root, secret, origin: 'http://localhost:3000' })
  t.after(() => restarted.close())
  const reloaded = await restarted.storage.apps.read(owner.user.id, input.id)
  assert.deepEqual(reloaded.annotations, [annotation])
  assert.equal(reloaded.revision, updated.data.revision)
  assert.deepEqual(reloaded.files, created.data.files)
})

test('history restore and re-edit survive service restart and retain every immutable checkpoint', async t => {
  const f = await fixture(t), a = await f.login('history-owner')
  const headers = a.headers
  const original = createAppProject({ id: 'history', files: { 'src/App.tsx': 'export default () => <h1>Original</h1>' } })
  const created = await f.request('/api/apps', { method: 'POST', headers, body: JSON.stringify({ project: original }) })
  assert.equal(created.status, 201)
  let project = created.data
  for (const source of ['manual', 'inspector']) {
    const response = await f.request('/api/apps/history', { method: 'PUT', headers, body: JSON.stringify({
      project: { ...project, files: { 'src/App.tsx': { path: 'src/App.tsx', content: `export default () => <h1>${source}</h1>` } } }, expectedRevision: project.revision, source,
    }) })
    assert.equal(response.status, 200)
    project = response.data
  }
  const old = (await f.request('/api/apps/history/revisions/1', { headers })).data
  await f.restart()
  const restored = await f.request('/api/apps/history/rollback', { method: 'POST', headers, body: JSON.stringify({ expectedRevision: 3, targetRevision: 1 }) })
  assert.equal(restored.status, 200, JSON.stringify(restored.data))
  assert.equal(restored.data.project.revision, 4)
  assert.deepEqual(restored.data.project.files, old.project.files)
  assert.ok(restored.data.assets.js)
  const reedit = await f.request('/api/apps/history', { method: 'PUT', headers, body: JSON.stringify({ project: { ...restored.data.project, name: 'Re-edited after restore' }, expectedRevision: 4 }) })
  assert.equal(reedit.status, 200)
  await f.restart()
  assert.equal((await f.request('/api/apps/history', { headers })).data.name, 'Re-edited after restore')
  assert.deepEqual((await f.request('/api/apps/history/revisions/1', { headers })).data, old)
  const history = (await f.request('/api/apps/history/revisions', { headers })).data.revisions
  assert.deepEqual(history.map(r => r.revision), [1, 2, 3, 4, 5])
  assert.deepEqual(history.map(r => r.checkpoint.source), ['initial', 'manual', 'inspector', 'restore', 'manual'])
  assert.equal(history[3].checkpoint.restoredFromRevision, 1)
  assert.equal(history[3].diff.baseRevision, 3)
  assert.equal(history[3].diff.targetRevision, 4)
})

test('concurrent restores and source edits accept exactly one writer and never rewrite history', async t => {
  const f = await fixture(t), a = await f.login('history-race')
  const headers = a.headers, id = 'history-race'
  const original = await f.storage.apps.put(a.user.id, id, createAppProject({ id, files: { 'src/App.tsx': 'export default () => <h1>Original</h1>' } }), null)
  await f.storage.apps.put(a.user.id, id, { ...original, name: 'Second' }, 1)
  const restores = await Promise.all(Array.from({ length: 2 }, () => f.request(`/api/apps/${id}/rollback`, { method: 'POST', headers, body: JSON.stringify({ expectedRevision: 2, targetRevision: 1 }) })))
  assert.deepEqual(restores.map(r => r.status).sort(), [200, 409])
  const current = (await f.request(`/api/apps/${id}`, { headers })).data
  const results = await Promise.all([
    f.request(`/api/apps/${id}/rollback`, { method: 'POST', headers, body: JSON.stringify({ expectedRevision: 3, targetRevision: 1 }) }),
    f.request(`/api/apps/${id}`, { method: 'PUT', headers, body: JSON.stringify({ project: { ...current, name: 'Concurrent edit' }, expectedRevision: 3 }) }),
  ])
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409])
  assert.deepEqual((await f.request(`/api/apps/${id}/revisions/1`, { headers })).data.project, original)
  assert.equal((await f.request(`/api/apps/${id}`, { headers })).data.revision, 4)
})

test('restore enforces ownership, CSRF, strict targets, and compilation before committing', async t => {
  const f = await fixture(t), a = await f.login('history-secure'), b = await f.login('history-other')
  const id = 'history-secure'
  const broken = await f.storage.apps.put(a.user.id, id, createAppProject({ id, files: { 'src/App.tsx': "import fs from 'node:fs'; export default () => <h1 />" } }), null)
  const working = await f.storage.apps.put(a.user.id, id, { ...broken, files: { 'src/App.tsx': { path: 'src/App.tsx', content: 'export default () => <h1>Working</h1>' } } }, 1)
  const restore = (headers, input) => f.request(`/api/apps/${id}/rollback`, { method: 'POST', headers, body: JSON.stringify(input) })
  assert.equal((await restore({}, { expectedRevision: 2, targetRevision: 1 })).status, 401)
  assert.equal((await restore({ Cookie: a.headers.Cookie }, { expectedRevision: 2, targetRevision: 1 })).status, 403)
  assert.equal((await restore(b.headers, { expectedRevision: 2, targetRevision: 1 })).status, 404)
  for (const targetRevision of ['1', null, 0, -1, 1.5, 2, 999]) {
    assert.equal((await restore(a.headers, { expectedRevision: 2, targetRevision })).status, 400)
  }
  assert.equal((await restore(a.headers, { expectedRevision: 1, targetRevision: 1 })).status, 409)
  assert.equal((await restore(a.headers, { expectedRevision: 2, targetRevision: 1 })).status, 422)
  const forged = await f.request(`/api/apps/${id}`, { method: 'PUT', headers: a.headers, body: JSON.stringify({ project: working, expectedRevision: 2, source: 'chat' }) })
  assert.equal(forged.status, 400)
  assert.deepEqual(await f.storage.apps.read(a.user.id, id), working)
  assert.equal((await f.storage.apps.listRevisions(a.user.id, id)).length, 2)
})

test('restoring detached assets uses retained bytes; missing bytes reject without changing head', async t => {
  const f = await fixture(t), a = await f.login('history-assets')
  const id = 'history-assets', headers = a.headers
  const project = await f.storage.apps.put(a.user.id, id, createAppProject({ id, files: { 'src/App.tsx': 'export default () => <h1>Assets</h1>' } }), null)
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><rect width="20" height="20"/></svg>')
  const { asset, project: uploaded } = await f.storage.apps.uploadAsset(a.user.id, id, 'retained.svg', svg, project.revision)
  const withImage = await f.storage.apps.put(a.user.id, id, { ...uploaded, files: {
    'src/App.tsx': { path: 'src/App.tsx', content: `export default () => <img alt="Retained" src="paper-asset:${asset.id}" />` },
  } }, 2)
  await f.storage.apps.detachAsset(a.user.id, id, asset.id, 3)
  await f.restart()
  const restore = expectedRevision => f.request(`/api/apps/${id}/rollback`, { method: 'POST', headers, body: JSON.stringify({ expectedRevision, targetRevision: 3 }) })
  const restored = await restore(4)
  assert.equal(restored.status, 200, JSON.stringify(restored.data))
  assert.deepEqual(restored.data.project.assetIds, [asset.id])
  assert.deepEqual(restored.data.project.files, withImage.files)
  assert.match(restored.data.assets.js, /data:image\/svg\+xml;base64,/)
  assert.ok(!restored.data.assets.js.includes(`paper-asset:${asset.id}`))
  assert.equal((await f.request(`/api/apps/${id}/assets/${asset.id}`, { headers })).status, 200)
  const detached = await f.storage.apps.detachAsset(a.user.id, id, asset.id, 5)
  await rm(join(f.root, 'apps', a.user.id, id, 'assets', `${asset.id}.json`))
  const missing = await restore(6)
  assert.equal(missing.status, 404)
  assert.deepEqual((await f.request(`/api/apps/${id}`, { headers })).data, detached)
  assert.deepEqual((await f.request(`/api/apps/${id}/revisions`, { headers })).data.revisions.map(r => r.revision), [1, 2, 3, 4, 5, 6])
})
