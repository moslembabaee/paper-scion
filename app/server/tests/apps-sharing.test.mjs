import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './sharing-fixture.mjs'
import { createAppProject } from '../dist/src/make/manifest.js'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

async function setup(t) {
  const f = await fixture(t), owner = await f.login('share-owner'), reviewer = await f.login('share-reviewer')
  const project = await f.storage.apps.put(owner.user.id, 'review', createAppProject({ id: 'review', files: { 'src/App.tsx': 'export default () => <h1>For review</h1>' } }), null)
  const base = `/api/shared-apps/${owner.user.id}/review`, permissions = '/api/apps/review/permissions'
  const grant = (role = 'viewer', revision = 1) => f.request(permissions, { method: 'PUT', headers: owner.headers, body: JSON.stringify({ accountId: reviewer.user.id, role, revision }) })
  return { f, owner, reviewer, project, base, permissions, grant }
}

test('explicit grants isolate private drafts, persist, deny viewer edits and revoke review', async t => {
  const { f, owner, reviewer, project, base, permissions, grant } = await setup(t)
  assert.equal((await f.request(base, { headers: reviewer.headers })).status, 404)
  assert.equal((await grant()).status, 200, 'owner can grant viewer access')
  await f.storage.apps.put(owner.user.id, 'review', { ...project, name: 'Private draft' }, 1)
  await f.restart()
  const shared = await f.request(base, { headers: reviewer.headers })
  assert.equal(shared.status, 200)
  assert.equal(shared.data.role, 'viewer')
  assert.equal(shared.data.project.revision, 1)
  assert.ok(!JSON.stringify(shared.data).includes('Private draft'))
  assert.equal((await f.request('/api/shared-apps', { headers: reviewer.headers })).data.apps.length, 1)
  assert.equal((await f.request('/api/apps/review', { headers: reviewer.headers })).status, 404)
  assert.equal((await f.request(base + '/compile', { method: 'POST', headers: reviewer.headers })).data.success, true)
  for (const [suffix, method] of [['', 'PUT'], ['', 'DELETE'], ['/release', 'POST'], ['/permissions', 'PUT'], ['/rollback', 'POST'], ['/assets', 'POST']]) {
    assert.equal((await f.request(base + suffix, { method, headers: reviewer.headers, body: JSON.stringify({ project, expectedRevision: 1 }) })).status, 403, suffix + method)
  }
  for (const suffix of ['/revisions/2', '/release', '/export', '/export.zip', '/turns']) assert.equal((await f.request(base + suffix, { headers: reviewer.headers })).status, 403)
  assert.equal((await f.request(permissions, { method: 'DELETE', headers: owner.headers, body: JSON.stringify({ accountId: reviewer.user.id }) })).status, 200)
  for (const [suffix, method] of [['', 'GET'], ['/compile', 'POST'], ['/assets', 'GET']]) assert.equal((await f.request(base + suffix, { method, headers: reviewer.headers })).status, 404)
  assert.deepEqual((await f.request('/api/shared-apps', { headers: reviewer.headers })).data.apps, [])
})

test('editor saves validate first, retain optimistic concurrency, and never expose a private head on conflict', async t => {
  const { f, owner, reviewer, project, base, grant } = await setup(t)
  assert.equal((await grant('editor')).status, 200)
  const edit = input => f.request(base, { method: 'PUT', headers: reviewer.headers, body: JSON.stringify(input) })
  assert.equal((await edit({ project: { ...project, files: { 'src/App.tsx': { path: 'src/App.tsx', content: "import fs from 'node:fs'; export default () => null" } } }, expectedRevision: 1 })).status, 422)
  assert.equal((await f.storage.apps.read(owner.user.id, 'review')).revision, 1)
  const saved = await edit({ project: { ...project, name: 'Reviewed edit' }, expectedRevision: 1 })
  assert.equal(saved.status, 200)
  assert.equal(saved.data.project.revision, 2)
  assert.equal((await f.request(base, { headers: reviewer.headers })).data.project.name, 'Reviewed edit')
  await f.storage.apps.put(owner.user.id, 'review', { ...saved.data.project, name: 'Private next draft' }, 2)
  const stale = await edit({ project: saved.data.project, expectedRevision: 2 })
  assert.equal(stale.status, 409)
  assert.ok(!JSON.stringify(stale.data).includes('Private next draft'))
})

test('role-only changes preserve the granted snapshot until the owner explicitly shares newer source and assets', async t => {
  const { f, owner, reviewer, project, base, permissions, grant } = await setup(t)
  const changeRole = role => f.request(permissions, { method: 'PUT', headers: owner.headers,
    body: JSON.stringify({ accountId: reviewer.user.id, role }) })
  assert.equal((await changeRole('editor')).status, 400, 'initial access requires an explicit saved revision')
  await grant('editor')
  const bytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><text>Private asset</text></svg>')
  const privateDraft = await f.storage.apps.uploadAsset(owner.user.id, 'review', 'private.svg', bytes, project.revision)
  for (const role of ['viewer', 'editor']) {
    const changed = await changeRole(role)
    assert.equal(changed.status, 200, 'owner can change role without sharing a newer revision')
    assert.deepEqual(changed.data.grants, [{ accountId: reviewer.user.id, role, revision: 1 }])
    const shared = await f.request(base, { headers: reviewer.headers })
    assert.equal(shared.data.project.revision, 1)
    assert.ok(!JSON.stringify(shared.data).includes(privateDraft.asset.id))
    assert.equal((await f.request(base + '/assets/' + privateDraft.asset.id, { headers: reviewer.headers })).status, 404)
    const edit = await f.request(base, { method: 'PUT', headers: reviewer.headers,
      body: JSON.stringify({ project, expectedRevision: 1 }) })
    assert.equal(edit.status, role === 'viewer' ? 403 : 409)
  }
  assert.equal((await grant('editor', privateDraft.project.revision)).status, 200)
  assert.equal((await f.request(base + '/assets/' + privateDraft.asset.id, { headers: reviewer.headers })).status, 200)
  await f.request(permissions, { method: 'DELETE', headers: owner.headers, body: JSON.stringify({ accountId: reviewer.user.id }) })
  assert.equal((await changeRole('viewer')).status, 400, 'a role-only change cannot revive revoked access')
  assert.equal((await f.request(base, { headers: reviewer.headers })).status, 404)
})

test('asset access is limited to the grant, including retained assets and guessed private IDs', async t => {
  const { f, owner, reviewer, project, base, grant } = await setup(t)
  const svg = text => new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg"><text>${text}</text></svg>`)
  const first = await f.storage.apps.uploadAsset(owner.user.id, 'review', 'shared.svg', svg('Shared bytes'), project.revision)
  assert.equal((await grant('viewer', first.project.revision)).status, 200)
  const second = await f.storage.apps.uploadAsset(owner.user.id, 'review', 'private.svg', svg('Private bytes'), first.project.revision)
  await f.storage.apps.detachAsset(owner.user.id, 'review', first.asset.id, second.project.revision)
  const list = await f.request(base + '/assets', { headers: reviewer.headers })
  assert.deepEqual(list.data.assets.map(a => a.id), [first.asset.id])
  const shared = await f.request(base + '/assets/' + first.asset.id, { headers: reviewer.headers })
  assert.equal(shared.status, 200)
  assert.match(shared.data, /Shared bytes/)
  assert.equal(shared.headers.get('cache-control'), 'private, no-store')
  assert.equal((await f.request(base + '/assets/' + second.asset.id, { headers: reviewer.headers })).status, 404)
  assert.equal((await f.request(`/api/apps/review/assets/${first.asset.id}`, { headers: reviewer.headers })).status, 404)
  assert.equal((await f.request(base + '/compile', { method: 'POST', headers: reviewer.headers })).data.success, true)
  await grant('editor', first.project.revision)
  // A private newer head must not be returned with conflict responses.
  const stale = await f.request(base, { method: 'PUT', headers: reviewer.headers, body: JSON.stringify({ project: second.project, expectedRevision: first.project.revision }) })
  assert.equal(stale.status, 409)
  assert.ok(!JSON.stringify(stale.data).includes(second.asset.id))
})

test('strict identity grants reject escalation, invalid revisions, CSRF and project resurrection', async t => {
  const { f, owner, reviewer, permissions, grant } = await setup(t)
  const put = (headers, input) => f.request(permissions, { method: 'PUT', headers, body: JSON.stringify(input) })
  assert.equal((await put({}, {})).status, 401)
  assert.equal((await put({ Cookie: owner.headers.Cookie }, {})).status, 403)
  for (const input of [
    { accountId: reviewer.user.id, role: 'owner', revision: 1 },
    { accountId: owner.user.id, role: 'viewer', revision: 1 },
    { accountId: reviewer.user.id, role: 'viewer', revision: 99 },
    { accountId: reviewer.user.id, role: 'viewer', revision: '1' },
    { accountId: reviewer.user.id, role: 'viewer', revision: 1, public: true },
  ]) assert.equal((await put(owner.headers, input)).status, 400)
  assert.equal((await put(owner.headers, { accountId: 'unknown', role: 'viewer', revision: 1 })).status, 404)
  await grant()
  assert.equal((await put(reviewer.headers, { accountId: reviewer.user.id, role: 'editor', revision: 1 })).status, 404)
  assert.equal((await f.request('/api/app-projects/review/permissions', { headers: owner.headers })).data.role, 'owner')
  await f.storage.apps.delete(owner.user.id, 'review')
  await f.storage.apps.put(owner.user.id, 'review', createAppProject({ id: 'review', name: 'Replacement' }), null)
  assert.deepEqual((await f.request(permissions, { headers: owner.headers })).data.grants, [])
})

test('shared editing cannot add private asset IDs or change provenance, even at the latest revision', async t => {
  const { f, reviewer, project, base, grant } = await setup(t)
  await grant('editor')
  for (const changed of [{ assetIds: ['ast_guessed'] }, { release: { status: 'published', version: 'fake' } }, { id: 'other' }]) {
    const response = await f.request(base, { method: 'PUT', headers: reviewer.headers, body: JSON.stringify({ project: { ...project, ...changed }, expectedRevision: 1 }) })
    assert.equal(response.status, 400)
  }
  const source = { path: 'src/App.tsx', content: 'export default () => <img src="paper-asset:ast_guessed" />' }
  assert.equal((await f.request(base, { method: 'PUT', headers: reviewer.headers, body: JSON.stringify({ project: { ...project, files: { 'src/App.tsx': source } }, expectedRevision: 1 }) })).status, 422)
})

test('duplicate account project IDs remain separate and shared access cannot authorize scene or owner routes', async t => {
  const { f, owner, reviewer, project, base, grant } = await setup(t)
  const local = await f.storage.apps.put(reviewer.user.id, 'review', createAppProject({ id: 'review', name: 'Reviewer private app' }), null)
  await grant('editor')
  assert.equal((await f.request(base, { headers: reviewer.headers })).data.project.name, project.name)
  assert.equal((await f.request('/api/apps/review', { headers: reviewer.headers })).data.name, local.name)
  assert.equal((await f.request(`/api/projects/${owner.user.id}`, { headers: reviewer.headers })).status, 404)
  const edit = name => f.request(base, { method: 'PUT', headers: reviewer.headers, body: JSON.stringify({ project: { ...project, name }, expectedRevision: 1 }) })
  const results = await Promise.all([edit('First'), edit('Second')])
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409])
  assert.equal((await f.storage.apps.read(reviewer.user.id, 'review')).name, local.name)
  assert.equal((await f.storage.apps.readRevision(owner.user.id, 'review', 1)).project.name, project.name)
})

test('grant and revoke leave releases independent, with no publication authority for reviewers', async t => {
  const f = await fixture(t, { releaseOrigin: 'http://127.0.0.1:4180', appValidator: async () => ({ status: 'passed', diagnostics: [], viewports: [], screenshots: [] }) })
  const owner = await f.login('release-owner'), reviewer = await f.login('release-reviewer')
  const project = await f.storage.apps.put(owner.user.id, 'release', createAppProject({ id: 'release', files: { 'src/App.tsx': 'export default () => <main>Public release</main>' } }), null)
  const publish = await f.request('/api/apps/release/release', { method: 'POST', headers: owner.headers, body: JSON.stringify({ expectedRevision: 1 }) })
  assert.equal(publish.status, 201)
  const path = '/api/apps/release/permissions'
  await f.request(path, { method: 'PUT', headers: owner.headers, body: JSON.stringify({ accountId: reviewer.user.id, role: 'editor', revision: project.revision }) })
  assert.equal((await f.request(`/api/shared-apps/${owner.user.id}/release/release`, { method: 'DELETE', headers: reviewer.headers, body: JSON.stringify({ expectedRevision: 1 }) })).status, 403)
  await f.request(path, { method: 'DELETE', headers: owner.headers, body: JSON.stringify({ accountId: reviewer.user.id }) })
  assert.deepEqual(await f.storage.apps.publication(owner.user.id, 'release'), publish.data)
  const url = new URL(publish.data.url), parts = url.pathname.split('/')
  assert.ok(await f.storage.apps.publicPublication(owner.user.id, 'release', parts[4], parts[5]))
})

test('an interrupted editor commit never grants a future private draft with the same revision number', async t => {
  const { f, owner, reviewer, project, base, permissions, grant } = await setup(t)
  await grant('editor')
  const path = join(f.root, 'apps', owner.user.id, 'review', 'permissions.json')
  const state = JSON.parse(await readFile(path, 'utf8'))
  // Crash between installing the next permission and committing source. The
  // target hash cannot match a later, independently saved private revision.
  state[0].revision = 2
  state[0].hash = 'a'.repeat(64)
  await writeFile(path, JSON.stringify(state))
  await f.storage.apps.put(owner.user.id, 'review', { ...project, name: 'Private after restart' }, 1)
  await f.restart()
  const response = await f.request(base, { headers: reviewer.headers })
  assert.equal(response.status, 404)
  assert.ok(!JSON.stringify(response.data).includes('Private after restart'))
  const changed = await f.request(permissions, { method: 'PUT', headers: owner.headers,
    body: JSON.stringify({ accountId: reviewer.user.id, role: 'viewer' }) })
  assert.equal(changed.status, 200)
  assert.equal(JSON.parse(await readFile(path, 'utf8'))[0].hash, state[0].hash, 'role changes cannot rebind interrupted grants to a private draft')
  assert.equal((await f.request(base, { headers: reviewer.headers })).status, 404)
})
