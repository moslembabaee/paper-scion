import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppStorage } from '../server/app-storage.ts'
import { createAppProject } from '../src/make/manifest.ts'
import { compileAppProject } from '../src/make/compiler.ts'
import { createMakeWorkspaceStore } from '../src/make/workspace-model.ts'

const code = label => `export default () => <main>${label}</main>`
const initial = () => createAppProject({ id: 'history', files: { 'src/App.tsx': code('Original') } })
const changed = (project, label) => ({ ...project, files: { ...project.files, 'src/App.tsx': { path: 'src/App.tsx', content: code(label) } } })
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'paper-history-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return { root, storage: new AppStorage(root) }
}

test('durable checkpoints identify chat, manual and inspector sources and bounded file diffs', async t => {
  const { storage, root } = await fixture(t)
  let project = await storage.put('alice', 'history', initial(), null)
  for (const source of ['chat', 'manual', 'inspector']) {
    project = await storage.put('alice', project.id, changed(project, source), project.revision, { source })
  }
  const restarted = new AppStorage(root)
  const history = await restarted.listRevisions('alice', project.id)
  assert.deepEqual(history.map(r => r.checkpoint.source), ['initial', 'chat', 'manual', 'inspector'])
  assert.deepEqual(history.map(r => r.checkpoint.baseRevision), [0, 1, 2, 3])
  assert.equal(history[3].diff.changedFilesCount, 1)
  assert.equal(history[3].diff.files[0].path, 'src/App.tsx')
  const record = await restarted.readRevision('alice', project.id, 2)
  assert.match(record.project.files['src/App.tsx'].content, /chat/)
  assert.ok(record.diff.files[0].lines.some(line => line.type === 'add' && line.text.includes('chat')))
})

test('queued writes snapshot checkpoint provenance before the caller can mutate it', async t => {
  const { storage, root } = await fixture(t)
  const project = await storage.put('alice', 'history', initial(), null)
  const metadata = { source: 'chat', turnId: 'turn-original' }
  const saving = storage.put('alice', 'history', changed(project, 'Queued edit'), 1, metadata)
  metadata.source = 'inspector'
  metadata.turnId = 'turn-mutated'
  await saving
  const record = await new AppStorage(root).readRevision('alice', 'history', 2)
  assert.deepEqual(record.checkpoint, { source: 'chat', turnId: 'turn-original', baseRevision: 1 })
})

test('invalid checkpoint provenance rejects before publishing an unreadable revision', async t => {
  const { storage } = await fixture(t)
  const project = await storage.put('alice', 'history', initial(), null)
  for (const metadata of [
    { source: 'unknown' }, { source: 'initial' }, { source: 'manual', baseRevision: 0 },
    { source: 'manual', turnId: 'forged' }, { source: 'chat', turnId: 'x'.repeat(201) },
    { source: 'restore' }, { source: 'restore', restoredFromRevision: 2 },
    { source: 'restore', restoredFromRevision: '1' }, { source: 'manual', restoredFromRevision: 1 },
  ]) {
    await assert.rejects(storage.put('alice', 'history', changed(project, 'Invalid'), 1, metadata), { status: 400 })
    assert.deepEqual(await storage.read('alice', 'history'), project)
    assert.equal((await storage.listRevisions('alice', 'history')).length, 1)
  }
})

test('workspace can restore any checkpoint repeatedly and re-edit without changing older source', async () => {
  const store = createMakeWorkspaceStore({ initialProject: initial(), compiler: compileAppProject })
  await store.saveSourceFile('src/App.tsx', code('Second'))
  await store.saveSourceFile('src/App.tsx', code('Third'))
  await store.loadHistory()
  assert.deepEqual(store.getState().history.map(r => r.revision), [1, 2, 3])
  await store.restoreRevision(1)
  assert.equal(store.getState().activeProject.revision, 4)
  assert.match(store.getState().activeProject.files['src/App.tsx'].content, /Original/)
  await store.saveSourceFile('src/App.tsx', code('After restore'))
  await store.inspectRevision(2)
  assert.match(store.getState().selectedRevision.project.files['src/App.tsx'].content, /Second/)
  await store.restoreRevision(2)
  assert.equal(store.getState().activeProject.revision, 6)
  await store.inspectRevision(1)
  assert.match(store.getState().selectedRevision.project.files['src/App.tsx'].content, /Original/)
})

test('retention keeps the earliest checkpoint through many writes and restart; failed writes add nothing', async t => {
  const { storage, root } = await fixture(t)
  let project = await storage.put('alice', 'history', initial(), null)
  const path = join(root, 'apps', 'alice', 'history', 'revisions', '1', 'record.json')
  const { readFile } = await import('node:fs/promises')
  const originalBytes = await readFile(path)
  for (let i = 0; i < 35; i++) project = await storage.put('alice', 'history', changed(project, `Edit ${i}`), project.revision)
  await assert.rejects(storage.put('alice', 'history', changed(project, 'Stale'), 1), { status: 409 })
  const restarted = new AppStorage(root)
  assert.equal((await restarted.listRevisions('alice', 'history')).length, 36)
  assert.deepEqual(await readFile(path), originalBytes)
  assert.match((await restarted.readRevision('alice', 'history', 1)).project.files['src/App.tsx'].content, /Original/)
})

test('late history and source reads never replace another project or a newer inspected checkpoint', async () => {
  const first = initial(), second = createAppProject({ id: 'other' })
  let resolveList, resolveRead
  const repository = {
    list: async () => [first, second], read: async id => id === first.id ? first : second,
    listRevisions: () => new Promise(resolve => { resolveList = resolve }),
    readRevision: () => new Promise(resolve => { resolveRead = resolve }),
  }
  const store = createMakeWorkspaceStore({ initialProject: first, projects: [first, second], repository })
  await store.loadProjects()
  const listing = store.loadHistory(), reading = store.inspectRevision(1)
  store.selectProject(second)
  resolveList([{ revision: 1 }])
  resolveRead({ revision: 1, project: first })
  await Promise.all([listing, reading])
  assert.equal(store.getState().activeProject.id, second.id)
  assert.deepEqual(store.getState().history, [])
  assert.equal(store.getState().selectedRevision, null)
  assert.equal(store.getState().historyStatus, 'idle')
})

test('restore discards a delayed checkpoint read after project switching without submitting a write', async () => {
  const first = { ...initial(), revision: 2 }, second = createAppProject({ id: 'other' })
  let resolveRead, writes = 0
  const repository = {
    list: async () => [first], readRevision: () => new Promise(resolve => { resolveRead = resolve }),
    rollback: async () => { writes++; throw new Error('Must not write') },
  }
  const store = createMakeWorkspaceStore({ initialProject: first, repository })
  await store.loadProjects()
  const restoring = store.restoreRevision(1)
  store.selectProject(second)
  resolveRead({ revision: 1, project: initial() })
  await restoring
  assert.equal(writes, 0)
  assert.equal(store.getState().activeProject.id, second.id)
})

test('legacy records remain readable and tampered checkpoint provenance fails integrity validation', async t => {
  const { storage, root } = await fixture(t)
  const project = await storage.put('alice', 'history', initial(), null)
  const { readFile, writeFile } = await import('node:fs/promises')
  const { serializeAppProject } = await import('../src/make/manifest.ts')
  const { hash } = await import('../server/storage.ts')
  const path = join(root, 'apps', 'alice', 'history', 'revisions', '1', 'record.json')
  const original = JSON.parse(await readFile(path, 'utf8'))
  const legacy = { ...original, hash: hash(serializeAppProject(project)) }
  delete legacy.checkpoint
  await writeFile(path, JSON.stringify(legacy))
  assert.equal((await new AppStorage(root).readRevision('alice', 'history', 1)).checkpoint.source, 'legacy')
  await writeFile(path, JSON.stringify({ ...original, checkpoint: { ...original.checkpoint, source: 'chat' } }))
  await assert.rejects(storage.readRevision('alice', 'history', 1), /integrity/)
})

test('the latest inspection wins when two checkpoint source reads finish out of order', async () => {
  const project = { ...initial(), revision: 3 }
  const reads = new Map()
  const store = createMakeWorkspaceStore({ initialProject: project, repository: {
    list: async () => [project], readRevision: (_id, revision) => new Promise(resolve => reads.set(revision, resolve)),
  } })
  await store.loadProjects()
  const first = store.inspectRevision(1), second = store.inspectRevision(2)
  reads.get(2)({ revision: 2, project: changed({ ...project, revision: 2 }, 'Second') })
  await second
  reads.get(1)({ revision: 1, project: initial() })
  await first
  assert.equal(store.getState().selectedRevision.revision, 2)
  assert.match(store.getState().selectedRevision.project.files['src/App.tsx'].content, /Second/)
})

test('restoring a historical checkpoint that fails compilation preserves source, preview and history', async () => {
  let reject = false
  const store = createMakeWorkspaceStore({ initialProject: initial(), compiler: project => reject
    ? Promise.resolve({ success: false, assets: null, diagnostics: [] }) : compileAppProject(project) })
  await store.saveSourceFile('src/App.tsx', code('Working'))
  await store.loadHistory()
  const before = store.getState()
  reject = true
  await assert.rejects(store.restoreRevision(1), /validation/)
  assert.equal(store.getState().activeProject, before.activeProject)
  assert.equal(store.getState().assets, before.assets)
  assert.deepEqual(store.getState().history, before.history)
  assert.equal(store.getState().rollbackPoint, before.rollbackPoint)
})
