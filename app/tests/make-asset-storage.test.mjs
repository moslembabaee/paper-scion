import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, symlink, readFile, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppStorage } from '../server/app-storage.ts'
import { APP_ASSET_LIMITS } from '../src/make/assets.ts'
import { createAppProject } from '../src/make/manifest.ts'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'paper-assets-store-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const store = new AppStorage(root)
  const project = await store.put('alice', 'asset-test', createAppProject({ id: 'asset-test' }), null)
  return { root, store, project }
}
const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><rect width="20" height="20"/></svg>')

test('concurrent uploads are serialized without losing source edits or asset attachments', async t => {
  const { store, root, project } = await fixture(t)
  const other = new AppStorage(root)
  const results = await Promise.all([
    store.uploadAsset('alice', project.id, 'a.svg', svg),
    other.uploadAsset('alice', project.id, 'b.svg', svg),
  ])
  const head = await store.read('alice', project.id)
  assert.equal(head.revision, 3)
  assert.deepEqual(new Set(head.assetIds), new Set(results.map(result => result.asset.id)))
  assert.deepEqual(head.files, project.files)
  await assert.rejects(store.uploadAsset('alice', project.id, 'c.svg', svg, 1), { status: 409 })
  assert.equal((await readdir(join(root, 'apps', 'alice', project.id, 'assets'))).length, 2)
})

test('byte quota includes revision history and rejects overflow without publishing a revision', async t => {
  const { store, project } = await fixture(t)
  const largeSvg = new TextEncoder().encode('<svg><!--' + 'x'.repeat(APP_ASSET_LIMITS.MAX_ASSET_BYTES - 18) + '--></svg>')
  assert.equal(largeSvg.length, APP_ASSET_LIMITS.MAX_ASSET_BYTES)
  for (let i = 0; i < 5; i++) await store.uploadAsset('alice', project.id, `${i}.svg`, largeSvg)
  const before = await store.read('alice', project.id)
  await assert.rejects(store.uploadAsset('alice', project.id, 'overflow.svg', svg), { status: 413 })
  assert.deepEqual(await store.read('alice', project.id), before)
  await store.detachAsset('alice', project.id, before.assetIds[0])
  await assert.rejects(store.uploadAsset('alice', project.id, 'still-full.svg', svg), { status: 413 })
})

test('symlinked asset files and tampered metadata are rejected on read and export', async t => {
  const { store, root, project } = await fixture(t)
  const { asset } = await store.uploadAsset('alice', project.id, 'a.svg', svg)
  const path = join(root, 'apps', 'alice', project.id, 'assets', `${asset.id}.json`)
  const original = await readFile(path, 'utf8')
  const outside = join(root, 'outside.json')
  await writeFile(outside, original)
  await rm(path)
  await symlink(outside, path)
  await assert.rejects(store.readAsset('alice', project.id, asset.id), { status: 403 })
  await assert.rejects(store.exportPackage('alice', project.id), { status: 403 })
  await rm(path)
  await writeFile(path, original.replace(asset.sha256, '0'.repeat(64)))
  await assert.rejects(store.readAsset('alice', project.id, asset.id), { status: 500 })
})
