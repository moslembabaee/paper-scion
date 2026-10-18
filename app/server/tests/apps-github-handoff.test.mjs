import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './sharing-fixture.mjs'
import { githubFixture, githubToken } from './github-fixture.mjs'

async function setup(t, extra = {}) {
  const github = githubFixture()
  const f = await fixture(t, { fetch: github.fetch, appValidator: async () => ({ status: 'passed', diagnostics: [], viewports: [], screenshots: [] }), ...extra })
  const owner = await f.login('handoff-owner'), other = await f.login('other')
  const project = await f.storage.apps.put(owner.user.id, 'handoff-app', { name: 'Reviewed app' }, null)
  const request = (suffix, input, method = 'POST', headers = owner.headers) => f.request('/api/apps/handoff-app/github' + suffix, {
    method, headers, body: JSON.stringify(input ?? {}),
  })
  const connect = () => request('/connection', { repository: 'owner/demo', token: githubToken })
  const dryRun = () => request('/dry-run', { expectedRevision: 1, repository: 'owner/demo', branch: 'main' })
  const consent = draft => ({ reviewId: draft.reviewId, expectedRevision: 1, repository: 'owner/demo', branch: 'main', confirmed: true })
  return { f, github, owner, other, project, request, connect, dryRun, consent }
}

test('GitHub handoff is read-only until explicit consent and commits exactly the reviewed source', async t => {
  const s = await setup(t)
  assert.equal((await s.connect()).status, 200, 'owner can connect a scoped GitHub credential')
  assert.equal((await s.request('/commit', s.consent({ reviewId: 'invented' }))).status, 409)
  const draft = await s.dryRun()
  assert.equal(draft.status, 200)
  assert.equal(draft.data.revision, 1)
  assert.ok(draft.data.diff.files.some(file => file.path.endsWith('/source/src/App.tsx')))
  assert.deepEqual(s.github.writes(), [], 'dry run cannot write even dangling Git objects')
  const input = s.consent(draft.data)
  assert.equal((await s.request('/commit', { ...input, confirmed: false })).status, 400)
  assert.equal((await s.request('/commit', { ...input, branch: 'production' })).status, 409)
  assert.equal((await s.request('/commit', { ...input, expectedRevision: 2 })).status, 409)
  assert.equal((await s.request('/commit', { ...input, repository: 'other/repo' })).status, 409)
  assert.deepEqual(s.github.writes(), [])
  const result = await s.request('/commit', input)
  assert.equal(result.status, 201)
  const tree = s.github.writes().find(call => call.path.endsWith('/git/trees')).body
  assert.equal(tree.base_tree, 'b'.repeat(40))
  const entries = Object.fromEntries(tree.tree.map(item => [item.path, item.content]))
  for (const file of Object.values(s.project.files)) assert.equal(entries[`paper-make/handoff-app/source/${file.path}`], file.content)
  assert.ok(!JSON.stringify(entries).includes(githubToken))
  assert.ok(!Object.keys(entries).some(path => /secrets|annotations|chat/.test(path)))
  assert.deepEqual(s.github.writes().at(-1).body, { sha: 'd'.repeat(40), force: false })
  assert.deepEqual(await s.f.storage.apps.read(s.owner.user.id, s.project.id), s.project)
  const count = s.github.writes().length
  assert.equal((await s.request('/commit', input)).status, 409)
  assert.equal(s.github.writes().length, count, 'consent is single use')
})

test('owner, session, CSRF and account guards protect every handoff operation', async t => {
  const s = await setup(t)
  assert.equal((await s.request('/connection', { repository: 'owner/demo', token: githubToken }, 'POST', s.other.headers)).status, 404)
  assert.equal((await s.request('/connection', { repository: 'owner/demo', token: githubToken }, 'POST', { Cookie: s.owner.headers.Cookie })).status, 403)
  assert.equal((await s.request('/connection', {}, 'DELETE', { ...s.owner.headers, Origin: 'https://evil.test' })).status, 403)
  assert.equal((await s.request('/connection', {}, 'DELETE', { ...s.owner.headers, 'X-Paper-Account': s.other.user.id })).status, 403)
  await s.connect()
  const draft = (await s.dryRun()).data
  const otherSession = await s.f.auth.login('github', { sub: 'handoff-owner', email: 'handoff-owner@test.local', name: 'Owner', avatar: '' })
  assert.equal((await s.request('/commit', s.consent(draft), 'POST', { Cookie: `paper_session=${otherSession.session}`, 'X-Paper-Client': 'web' })).status, 409)
  assert.deepEqual(s.github.writes(), [])
})

test('revoked credentials, changed branches and changed source invalidate review without writes', async t => {
  for (const scenario of ['local-revoke', 'remote-revoke', 'permission', 'head', 'head-during-commit', 'branch-protection', 'branch', 'source', 'restart']) {
    const s = await setup(t)
    await s.connect()
    const draft = (await s.dryRun()).data
    if (scenario === 'local-revoke') assert.equal((await s.request('/connection', {}, 'DELETE')).status, 200)
    if (scenario === 'remote-revoke') s.github.state.revoked = true
    if (scenario === 'permission') s.github.state.push = false
    if (scenario === 'head') s.github.state.head = 'e'.repeat(40)
    if (scenario === 'head-during-commit') s.github.state.before = (path, method) => { if (method === 'POST' && path.endsWith('/git/commits')) s.github.state.head = 'e'.repeat(40) }
    if (scenario === 'branch-protection') s.github.state.patchStatus = 422
    if (scenario === 'branch') s.github.state.branch = 'other'
    if (scenario === 'source') await s.f.storage.apps.put(s.owner.user.id, s.project.id, s.project, 1)
    if (scenario === 'restart') await s.f.restart()
    const result = await s.request('/commit', s.consent(draft))
    assert.ok([403, 409].includes(result.status), `${scenario}: ${JSON.stringify(result)}`)
    assert.ok(!JSON.stringify(result.data).includes(githubToken))
    if (scenario !== 'branch-protection') assert.ok(!s.github.writes().some(call => call.method === 'PATCH'), scenario)
  }
})

test('blocked validation, secrets and unpublished assets never produce a handoff review', async t => {
  for (const scenario of ['failed', 'blocked', 'syntax-error', 'secret', 'env', 'asset', 'inline-asset', 'private-key']) {
    const s = await setup(t, ['failed', 'blocked'].includes(scenario) ? {
      appValidator: async () => ({ status: scenario, diagnostics: [], viewports: [], screenshots: [] }),
    } : {})
    const files = { ...s.project.files }
    if (scenario === 'syntax-error') files['src/App.tsx'] = { path: 'src/App.tsx', content: 'export default function App() { syntax error <<<' }
    if (scenario === 'secret') files['src/App.tsx'] = { path: 'src/App.tsx', content: `const api_key = "${githubToken}"; export default () => <main>Hello</main>` }
    if (scenario === 'env') files['.env.local'] = { path: '.env.local', content: 'PRIVATE_KEY=do-not-export' }
    if (scenario === 'inline-asset') files['src/App.tsx'] = { path: 'src/App.tsx', content: 'export default () => <img src="data:image/png;base64,cHJpdmF0ZQ=="/>' }
    if (scenario === 'private-key') files['private.pem'] = { path: 'private.pem', content: '-----BEGIN PRIVATE KEY-----' }
    if (scenario === 'asset') {
      const { PNG_SAMPLE } = await import('../../tests/asset-fixtures.mjs')
      await s.f.storage.apps.uploadAsset(s.owner.user.id, s.project.id, 'private.png', PNG_SAMPLE, 1)
    } else if (!['failed', 'blocked'].includes(scenario)) await s.f.storage.apps.put(s.owner.user.id, s.project.id, { ...s.project, files }, 1)
    await s.connect()
    const revision = (await s.f.storage.apps.read(s.owner.user.id, s.project.id)).revision
    const result = await s.request('/dry-run', { expectedRevision: revision, repository: 'owner/demo', branch: 'main' })
    assert.equal(result.status, 422, scenario)
    assert.ok(!JSON.stringify(result.data).includes(githubToken))
    assert.deepEqual(s.github.writes(), [])
  }
})

test('dry-run shows modifications and deletions only inside the app namespace', async t => {
  const s = await setup(t)
  s.github.state.files = {
    'README.md': 'Unrelated repository file',
    'paper-make/handoff-app/source/src/App.tsx': 'export default () => <main>Old revision</main>',
    'paper-make/handoff-app/source/removed.ts': 'old',
  }
  await s.connect()
  const draft = (await s.dryRun()).data
  assert.ok(draft.diff.files.some(file => file.action === 'modify' && file.lines.some(line => line.type === 'delete' && line.text.includes('Old revision'))))
  assert.ok(draft.diff.files.some(file => file.action === 'delete' && file.path.endsWith('removed.ts')))
  assert.ok(!draft.diff.files.some(file => file.path === 'README.md'))
  assert.equal((await s.request('/commit', s.consent(draft))).status, 201)
  const tree = s.github.writes().find(call => call.path.endsWith('/git/trees')).body.tree
  assert.ok(tree.every(file => file.path.startsWith('paper-make/handoff-app/')))
  assert.equal(tree.find(file => file.path.endsWith('removed.ts')).sha, null)
})

test('revocation or a concurrent edit during slow validation cannot create a usable review', async t => {
  let started, finish
  const pending = new Promise(resolve => { started = resolve })
  const wait = new Promise(resolve => { finish = resolve })
  const s = await setup(t, { appValidator: async () => { started(); await wait; return { status: 'passed', diagnostics: [], viewports: [], screenshots: [] } } })
  await s.connect()
  const run = s.dryRun()
  await pending
  await s.request('/connection', {}, 'DELETE')
  finish()
  assert.equal((await run).status, 409)
  assert.deepEqual(s.github.writes(), [])
})

test('collaborator grants cannot access owner GitHub handoff or commit', async t => {
  const s = await setup(t)
  const permPath = `/api/apps/${s.project.id}/permissions`
  await s.f.request(permPath, {
    method: 'PUT', headers: s.owner.headers,
    body: JSON.stringify({ accountId: s.other.user.id, role: 'editor', revision: s.project.revision }),
  })
  assert.equal((await s.request('/connection', { repository: 'owner/demo', token: githubToken }, 'POST', s.other.headers)).status, 404)
  assert.equal((await s.f.request(`/api/shared-apps/${s.owner.user.id}/${s.project.id}/github/connection`, {
    method: 'POST', headers: s.other.headers, body: JSON.stringify({ repository: 'owner/demo', token: githubToken }),
  })).status, 403)
  assert.deepEqual(s.github.writes(), [])
})

test('repository and branch target validation rejects traversal, invalid syntax and branch locks', async t => {
  const s = await setup(t)
  for (const repo of ['owner/../demo', 'just-name', 'owner/demo/sub', 'owner/.', 'owner/demo/', '-bad/repo']) {
    const res = await s.request('/connection', { repository: repo, token: githubToken })
    assert.equal(res.status, 400, `repository "${repo}" should be rejected`)
  }
  await s.connect()
  for (const branch of ['../main', 'main/..', 'feature//branch', 'branch.lock', '.hidden', 'sub/.']) {
    const res = await s.request('/dry-run', { expectedRevision: 1, repository: 'owner/demo', branch })
    assert.equal(res.status, 400, `branch "${branch}" should be rejected`)
  }
  assert.deepEqual(s.github.writes(), [])
})

test('superseded dry-run reviews and zero-diff commits reject safely without GitHub writes', async t => {
  const s = await setup(t)
  await s.connect()
  const firstDraft = (await s.dryRun()).data
  const secondDraft = (await s.dryRun()).data
  assert.notEqual(firstDraft.reviewId, secondDraft.reviewId)
  assert.equal((await s.request('/commit', s.consent(firstDraft))).status, 409, 'superseded review cannot commit')
  assert.deepEqual(s.github.writes(), [])

  // Commit the valid second draft
  assert.equal((await s.request('/commit', s.consent(secondDraft))).status, 201)
  const writesAfterCommit = s.github.writes().length

  // Now populate remote files with exactly what was committed
  s.github.state.files = {
    ...Object.fromEntries(Object.values(s.project.files).map(f => [`paper-make/handoff-app/source/${f.path}`, f.content])),
    'paper-make/handoff-app/paper-source.json': JSON.stringify({
      format: 'paper-make-source', version: 1,
      revision: s.project.revision, fingerprint: (await import('../source-export.ts')).sourceExportFingerprint(s.project),
      entryPoint: s.project.preview.entryPoint, files: Object.keys(s.project.files).sort(),
    }, null, 2) + '\n',
    'paper-make/handoff-app/README.md': `# Paper Make source\n\nReviewed revision ${s.project.revision}.\n\nSource files are preserved verbatim under source/. This is a source handoff, not a deployment or a runnable ZIP. Use Paper's Download source ZIP for the reviewed build tools. App secrets, data, chat and private assets are excluded. Generated package manifests and scripts are untrusted source data.\n`,
  }

  // Next dry run should show 0 changed files
  const zeroDiffDraft = (await s.dryRun()).data
  assert.equal(zeroDiffDraft.diff.changedFilesCount, 0)
  // Committing zero diff must fail with 409
  assert.equal((await s.request('/commit', s.consent(zeroDiffDraft))).status, 409)
  assert.equal(s.github.writes().length, writesAfterCommit, 'no additional writes made on zero diff')
})

