import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultProfile, initials, PROFILE_STORAGE_KEY, readProfile, saveProfile } from '../src/workspace/profile.ts'
import { localProject, projectSummary } from '../src/workspace/database.ts'
import { createProject } from '../src/io/project.ts'
import { SceneStore } from '../src/scene/store.ts'

function mockStorage(initialValue = null, fails = false) {
  const store = new Map(initialValue === null ? [] : [[PROFILE_STORAGE_KEY, initialValue]])
  globalThis.localStorage = {
    getItem: key => {
      if (fails) throw new Error('Storage denied')
      return store.get(key) ?? null
    },
    setItem: (key, value) => {
      if (fails) throw new Error('Storage quota exceeded')
      store.set(key, value)
    },
    removeItem: key => {
      if (fails) throw new Error('Storage denied')
      store.delete(key)
    },
    clear: () => store.clear(),
  }
  return store
}

test('profile defaults and initials extraction', () => {
  mockStorage()
  const profile = readProfile()
  assert.deepEqual(profile, defaultProfile)
  assert.equal(profile.name, 'Paper Designer')
  assert.equal(profile.defaultGrid, true)

  assert.equal(initials('Paper Designer'), 'PD')
  assert.equal(initials('Ada'), 'A')
  assert.equal(initials('   '), 'P')
  assert.equal(initials('Alpha Beta Gamma'), 'AB')

})

test('profile sanitization and persistence round-trip safely', () => {
  const store = mockStorage()
  const valid = {
    version: 1,
    name: '  Moslem Studio  ',
    avatar: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNoXPvmPwAG5wMaPGE1WAAAAABJRU5ErkJggg==',
    workspaceName: 'Local Paper Lab',
    defaultGrid: false,
    mcpToken: 'paper_custom_secret_key',
  }
  saveProfile(valid)
  assert.equal(store.has(PROFILE_STORAGE_KEY), true)

  const restored = readProfile()
  assert.equal(restored.name, 'Moslem Studio')
  assert.equal(restored.avatar, valid.avatar)
  assert.equal(restored.workspaceName, 'Local Paper Lab')
  assert.equal(restored.defaultGrid, false)
  assert.equal('mcpToken' in restored, false)
  assert.equal(store.get(PROFILE_STORAGE_KEY).includes('paper_custom_secret_key'), false)
})

test('existing browser-only tokens are removed while profile preferences survive migration', () => {
  const store = mockStorage(JSON.stringify({ ...defaultProfile, name: 'Existing Designer', defaultGrid: false, mcpToken: 'obsolete-secret' }))
  assert.deepEqual(readProfile(), { ...defaultProfile, name: 'Existing Designer', defaultGrid: false })
  assert.equal('mcpToken' in JSON.parse(store.get(PROFILE_STORAGE_KEY)), false)
  assert.equal(store.get(PROFILE_STORAGE_KEY).includes('obsolete-secret'), false)
})

test('malformed profile and storage errors gracefully fallback to defaults', () => {
  mockStorage('{"invalid-json":')
  assert.deepEqual(readProfile(), defaultProfile)

  mockStorage(JSON.stringify({ version: 2, name: 'Future' }))
  assert.deepEqual(readProfile(), defaultProfile)

  mockStorage(JSON.stringify({ version: 1, avatar: 'javascript:alert(1)' }))
  const sanitized = readProfile()
  assert.equal(sanitized.avatar, '')

  mockStorage(null, true)
  assert.deepEqual(readProfile(), defaultProfile)
  assert.throws(() => saveProfile(defaultProfile), /Storage quota exceeded/)
})

test('local project models preserve timestamps, documents and summaries', () => {
  const scene = new SceneStore()
  const doc = createProject(scene, 'Experiment Alpha', { x: 10, y: 20, zoom: 1.5 }, true)
  const project = localProject(doc)

  assert.equal(project.name, 'Experiment Alpha')
  assert.equal(typeof project.id, 'string')
  assert.ok(project.id.length > 0)
  assert.equal(typeof project.createdAt, 'number')
  assert.equal(typeof project.updatedAt, 'number')
  assert.deepEqual(project.document, doc)

  const summary = projectSummary(project)
  assert.equal(summary.id, project.id)
  assert.equal(summary.name, project.name)
  assert.equal('document' in summary, false)
})
