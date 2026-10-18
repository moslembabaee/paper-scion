import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, symlink, writeFile, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import fs from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { constants } from 'node:fs'
import { AppStorage } from '../server/app-storage.ts'
import { createAppProject, AppProjectValidationError, APP_PROJECT_LIMITS } from '../src/make/manifest.ts'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'paper-app-storage-'))
  const storage = new AppStorage(root)
  t.after(async () => {
    await rm(root, { recursive: true, force: true })
  })
  return { root, storage }
}

// Exercise real filesystem boundaries, including callers using separate stores.
test('store instances sharing one service volume cannot both win the same revision', async t => {
  const { root, storage } = await fixture(t)
  const project = createAppProject({ id: 'race', name: 'Original' })
  await storage.put('alice', project.id, project, null)
  const other = new AppStorage(root)
  const results = await Promise.allSettled([
    storage.put('alice', project.id, { ...project, name: 'First' }, 1),
    other.put('alice', project.id, { ...project, name: 'Second' }, 1),
  ])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(results.find(result => result.status === 'rejected').reason.status, 409)
  assert.equal((await other.read('alice', project.id)).revision, 2)
})

test('reads during publication always see a complete committed revision', { timeout: 5000 }, async t => {
  const { root, storage } = await fixture(t)
  const project = createAppProject({ id: 'atomic', name: 'Before' })
  await storage.put('alice', project.id, project, null)
  const appDir = join(root, 'apps', 'alice', project.id)
  let resume, reached
  const paused = new Promise(resolve => { reached = resolve })
  const release = new Promise(resolve => { resume = resolve })
  t.after(() => resume())
  const rename = fs.rename
  t.mock.method(fs, 'rename', async (from, to) => {
    await rename(from, to)
    if (from === appDir || String(from).includes('.staging_')) {
      reached()
      await release
    }
  })
  t.after(() => t.mock.restoreAll())
  const write = storage.put('alice', project.id, { ...project, name: 'After' }, 1)
  try {
    await paused
    const reader = new AppStorage(root)
    assert.equal((await reader.read('alice', project.id))?.name, 'Before')
    assert.ok(await reader.readFile('alice', project.id, 'src/App.tsx'))
    assert.deepEqual((await reader.listRevisions('alice', project.id)).map(r => r.revision), [1])
  } finally {
    resume()
    await write
  }
})

test('storage validates the original input without dropping fields or invoking accessors', async t => {
  const { storage } = await fixture(t)
  const project = createAppProject({ id: 'strict' })
  let invoked = false
  const accessor = { ...project }
  Object.defineProperty(accessor, 'files', { enumerable: true, get() { invoked = true; return project.files } })
  await assert.rejects(storage.put('alice', project.id, accessor, null), AppProjectValidationError)
  assert.equal(invoked, false)
  const extra = { ...project, files: { 'src/App.tsx': { ...project.files['src/App.tsx'], executable: true } } }
  await assert.rejects(storage.put('alice', project.id, extra, null), AppProjectValidationError)
  const duplicates = { name: 'Legacy', files: [{ path: 'App.tsx', content: 'a' }, { path: 'App.tsx', content: 'b' }] }
  await assert.rejects(storage.put('alice', project.id, duplicates, null), AppProjectValidationError)
  assert.equal(await storage.read('alice', project.id), null)
})

test('persists manifest, files, and revisions under authenticated account with atomic round-trip', async t => {
  const { storage } = await fixture(t)
  const user = 'user_alice'
  const id = 'app_starter'
  const initial = createAppProject({
    id,
    name: 'Starter App',
    files: {
      'src/App.tsx': 'export default function App() { return <div>Hello</div> }',
      'src/components/Button.tsx': 'export function Button() { return <button>Click</button> }',
    },
  })

  // Put new app with expectedRevision = null
  const saved = await storage.put(user, id, initial, null)
  assert.equal(saved.id, id)
  assert.equal(saved.revision, 1)
  assert.equal(saved.name, 'Starter App')
  assert.ok(saved.createdAt)
  assert.ok(saved.updatedAt)

  // Read manifest
  const readBack = await storage.read(user, id)
  assert.ok(readBack)
  assert.equal(readBack.id, id)
  assert.equal(readBack.revision, 1)
  assert.equal(readBack.name, 'Starter App')
  assert.equal(Object.keys(readBack.files).length, 2)
  assert.equal(readBack.files['src/App.tsx'].content, 'export default function App() { return <div>Hello</div> }')

  // Read individual source files from storage
  const appFile = await storage.readFile(user, id, 'src/App.tsx')
  assert.ok(appFile)
  assert.equal(appFile.path, 'src/App.tsx')
  assert.equal(appFile.content, 'export default function App() { return <div>Hello</div> }')

  const btnFile = await storage.readFile(user, id, 'src/components/Button.tsx')
  assert.ok(btnFile)
  assert.equal(btnFile.path, 'src/components/Button.tsx')
  assert.equal(btnFile.content, 'export function Button() { return <button>Click</button> }')

  // Read non-existent file
  const missingFile = await storage.readFile(user, id, 'src/missing.tsx')
  assert.equal(missingFile, null)

  // Read revision artifact
  const revRecord = await storage.readRevision(user, id, 1)
  assert.ok(revRecord)
  assert.equal(revRecord.revision, 1)
  assert.ok(revRecord.hash)
  assert.ok(revRecord.timestamp)
  assert.equal(revRecord.project.name, 'Starter App')

  // List revisions
  const revisions = await storage.listRevisions(user, id)
  assert.equal(revisions.length, 1)
  assert.equal(revisions[0].revision, 1)
  assert.equal(revisions[0].hash, revRecord.hash)

  // List user apps
  const appList = await storage.list(user)
  assert.equal(appList.length, 1)
  assert.equal(appList[0].id, id)
  assert.equal(appList[0].name, 'Starter App')
  assert.equal(appList[0].revision, 1)
})

test('optimistic revision check rejects stale writes and serializes concurrent races', async t => {
  const { storage } = await fixture(t)
  const user = 'user_alice'
  const id = 'app_concurrency'
  const app1 = createAppProject({ id, name: 'Version 1' })

  // Initial creation with expectedRevision = null
  await storage.put(user, id, app1, null)

  // Re-creation with null fails with 409 Conflict
  await assert.rejects(
    storage.put(user, id, app1, null),
    err => err.status === 409 && err.current.revision === 1
  )

  // Stale expectedRevision fails with 409 Conflict
  await assert.rejects(
    storage.put(user, id, { ...app1, name: 'Stale' }, 999),
    err => err.status === 409 && err.current.revision === 1
  )

  // Valid update with expectedRevision = 1 succeeds and increments revision to 2
  const updated = await storage.put(
    user,
    id,
    {
      ...app1,
      name: 'Version 2',
      files: createAppProject({ files: {
        'src/App.tsx': 'export default () => <div>V2</div>',
        'src/New.tsx': 'export const New = 1',
      } }).files,
    },
    1
  )
  assert.equal(updated.revision, 2)
  assert.equal(updated.name, 'Version 2')

  const readV2 = await storage.read(user, id)
  assert.equal(readV2.revision, 2)
  assert.equal(Object.keys(readV2.files).length, 2)

  // Both revision 1 and 2 are preserved in revisions/
  const revList = await storage.listRevisions(user, id)
  assert.deepEqual(revList.map(r => r.revision), [1, 2])

  // Concurrent race: Two writes trying to update revision 2 at the same time
  const race1 = storage.put(user, id, { ...readV2, name: 'Race Branch A' }, 2)
  const race2 = storage.put(user, id, { ...readV2, name: 'Race Branch B' }, 2)

  const results = await Promise.allSettled([race1, race2])
  const fulfilled = results.filter(r => r.status === 'fulfilled')
  const rejected = results.filter(r => r.status === 'rejected')

  assert.equal(fulfilled.length, 1, 'Exactly one concurrent writer must succeed')
  assert.equal(rejected.length, 1, 'Exactly one concurrent writer must fail')
  assert.equal(rejected[0].reason.status, 409, 'Failing writer must receive 409 conflict')

  const finalState = await storage.read(user, id)
  assert.equal(finalState.revision, 3)
})

test('restart retains all artifacts, revisions, and files with transparent recovery', async t => {
  const { root, storage } = await fixture(t)
  const user = 'user_bob'
  const id = 'app_restart'

  // Write revision 1 and revision 2
  const v1 = createAppProject({ id, name: 'Before Restart V1' })
  await storage.put(user, id, v1, null)

  const v2 = {
    ...v1,
    name: 'Before Restart V2',
    files: createAppProject({ files: {
      'src/App.tsx': 'export default () => <h1>V2</h1>',
      'src/utils/math.ts': 'export const add = (a: number, b: number) => a + b',
    } }).files,
  }
  await storage.put(user, id, v2, 1)

  // Simulate server restart by creating a brand new AppStorage instance on the same root
  const restartedStorage = new AppStorage(root)

  // Verify read
  const app = await restartedStorage.read(user, id)
  assert.ok(app)
  assert.equal(app.revision, 2)
  assert.equal(app.name, 'Before Restart V2')

  // Verify files
  const f1 = await restartedStorage.readFile(user, id, 'src/App.tsx')
  assert.equal(f1.content, 'export default () => <h1>V2</h1>')
  const f2 = await restartedStorage.readFile(user, id, 'src/utils/math.ts')
  assert.equal(f2.content, 'export const add = (a: number, b: number) => a + b')

  // Verify revisions
  const revs = await restartedStorage.listRevisions(user, id)
  assert.equal(revs.length, 2)
  const rev1 = await restartedStorage.readRevision(user, id, 1)
  assert.equal(rev1.project.name, 'Before Restart V1')
  const rev2 = await restartedStorage.readRevision(user, id, 2)
  assert.equal(rev2.project.name, 'Before Restart V2')

  // Verify list
  const list = await restartedStorage.list(user)
  assert.equal(list.length, 1)
  assert.equal(list[0].revision, 2)
})

test('failed validation leaves existing artifacts untouched and clean without staging residue', async t => {
  const { root, storage } = await fixture(t)
  const user = 'user_charlie'
  const id = 'app_failure_test'

  // Establish stable revision 1
  const v1 = createAppProject({
    id,
    name: 'Stable V1',
    files: { 'src/App.tsx': 'export default () => <div>Stable</div>' },
  })
  await storage.put(user, id, v1, null)

  const userDir = join(root, 'apps', user)
  const appDir = join(userDir, id)
  const manifestBefore = await readFile(join(appDir, 'manifest.json'), 'utf8')

  // Invalid input must not touch any live artifacts.
  await assert.rejects(
    storage.put(user, id, { ...v1, name: 'x'.repeat(APP_PROJECT_LIMITS.MAX_NAME_LENGTH + 1) }, 1),
    AppProjectValidationError
  )

  // Verify manifest and state are completely untouched
  const manifestAfter = await readFile(join(appDir, 'manifest.json'), 'utf8')
  assert.equal(manifestAfter, manifestBefore)

  const current = await storage.read(user, id)
  assert.equal(current.revision, 1)
  assert.equal(current.name, 'Stable V1')

  // Verify no temporary or staging directories left behind
  const userEntries = await readdir(userDir)
  assert.ok(!userEntries.some(name => name.includes('staging') || name.includes('tmp') || name.startsWith('.')))

  // Valid write after failure still works
  const v2 = await storage.put(user, id, { ...v1, name: 'Recovered V2' }, 1)
  assert.equal(v2.revision, 2)
  assert.equal(v2.name, 'Recovered V2')
})

test('another user cannot read, overwrite, list or delete artifacts (account isolation)', async t => {
  const { storage } = await fixture(t)
  const userAlice = 'user_alice'
  const userBob = 'user_bob'
  const id = 'isolated_app'

  // Alice creates her app
  const aliceApp = createAppProject({
    id,
    name: 'Alice Secret Project',
    files: { 'src/App.tsx': 'export const secret = "alice-token"' },
  })
  await storage.put(userAlice, id, aliceApp, null)

  // Bob cannot read Alice's manifest
  const bobRead = await storage.read(userBob, id)
  assert.equal(bobRead, null)

  // Bob cannot read Alice's files
  const bobFile = await storage.readFile(userBob, id, 'src/App.tsx')
  assert.equal(bobFile, null)

  // Bob cannot read Alice's revision
  const bobRev = await storage.readRevision(userBob, id, 1)
  assert.equal(bobRev, null)
  assert.deepEqual(await storage.listRevisions(userBob, id), [])
  await assert.rejects(
    storage.put(userBob, id, { ...aliceApp, name: 'Overwrite Alice' }, 1),
    err => err.status === 409 && err.current === null
  )

  // Bob listing apps does not show Alice's app
  const bobList = await storage.list(userBob)
  assert.equal(bobList.length, 0)

  // Bob cannot delete Alice's app
  const deletedByBob = await storage.delete(userBob, id)
  assert.equal(deletedByBob, false)

  // Alice's app is still intact
  const aliceCheck = await storage.read(userAlice, id)
  assert.ok(aliceCheck)
  assert.equal(aliceCheck.name, 'Alice Secret Project')

  // Bob can create his OWN app with the same ID, completely separate
  const bobApp = createAppProject({
    id,
    name: 'Bob Separate Project',
    files: { 'src/App.tsx': 'export const bobData = "bob-token"' },
  })
  await storage.put(userBob, id, bobApp, null)

  // Verify Alice and Bob have their own isolated copies
  const aliceAfter = await storage.read(userAlice, id)
  const bobAfter = await storage.read(userBob, id)
  assert.equal(aliceAfter.name, 'Alice Secret Project')
  assert.equal(bobAfter.name, 'Bob Separate Project')
  assert.equal(aliceAfter.files['src/App.tsx'].content, 'export const secret = "alice-token"')
  assert.equal(bobAfter.files['src/App.tsx'].content, 'export const bobData = "bob-token"')
})

test('symlink traversal and confinement violation cannot read or overwrite artifacts', async t => {
  const { root, storage } = await fixture(t)
  const userAlice = 'user_alice'
  const userAttacker = 'user_attacker'
  const targetId = 'target_app'

  // Create Alice's private app
  await storage.put(userAlice, targetId, createAppProject({ id: targetId, name: 'Alice Confidential' }), null)

  const aliceAppDir = join(root, 'apps', userAlice, targetId)
  const attackerUserDir = join(root, 'apps', userAttacker)
  await mkdir(attackerUserDir, { recursive: true, mode: 0o700 })

  // 1. Attacker tries symlinking account directory to Alice's account
  const accountSymlinkUser = 'user_fake_alice'
  await symlink(join(root, 'apps', userAlice), join(root, 'apps', accountSymlinkUser))
  await assert.rejects(
    storage.read(accountSymlinkUser, targetId),
    err => err.status === 403
  )
  await assert.rejects(
    storage.put(accountSymlinkUser, targetId, createAppProject({ id: targetId, name: 'Hack' }), 1),
    err => err.status === 403
  )

  // 2. Attacker tries symlinking an app directory to Alice's app
  const shortcutAppId = 'shortcut_app'
  await symlink(aliceAppDir, join(attackerUserDir, shortcutAppId))
  await assert.rejects(
    storage.read(userAttacker, shortcutAppId),
    err => err.status === 403
  )
  await assert.rejects(
    storage.put(userAttacker, shortcutAppId, createAppProject({ id: shortcutAppId, name: 'Overwrite' }), 1),
    err => err.status === 403
  )
  await assert.rejects(
    storage.readFile(userAttacker, shortcutAppId, 'src/App.tsx'),
    err => err.status === 403
  )

  // 3. Traversal in file paths or safeId rejection
  for (const badId of ['../escape', '..', 'app/slash', 'app\\slash', 'app\0null']) {
    await assert.rejects(
      storage.read(userAlice, badId),
      err => err.status === 400
    )
    await assert.rejects(
      storage.put(userAlice, badId, createAppProject({ name: 'Bad' }), null),
      err => err.status === 400
    )
  }

  for (const badUser of ['../escape', '..', 'user/slash', 'user\0null']) {
    await assert.rejects(
      storage.read(badUser, targetId),
      err => err.status === 400
    )
  }

  // Alice's data was never modified
  const intact = await storage.read(userAlice, targetId)
  assert.equal(intact.name, 'Alice Confidential')
})

test('delete removes app artifacts and revisions completely', async t => {
  const { storage } = await fixture(t)
  const user = 'user_del'
  const id = 'app_to_delete'

  await storage.put(user, id, createAppProject({ id, name: 'Delete Me' }), null)
  assert.ok(await storage.read(user, id))

  const deleted = await storage.delete(user, id)
  assert.equal(deleted, true)

  assert.equal(await storage.read(user, id), null)
  assert.equal(await storage.readFile(user, id, 'src/App.tsx'), null)
  assert.equal(await storage.readRevision(user, id, 1), null)
  assert.deepEqual(await storage.list(user), [])

  // Deleting again returns false
  assert.equal(await storage.delete(user, id), false)
})

test('symlink on manifest, files, or revisions rejects with 403', async t => {
  const { root, storage } = await fixture(t)
  const user = 'user_sym_target'
  const id = 'app_sym'

  await storage.put(user, id, createAppProject({ id, name: 'Sym Test' }), null)
  const appDir = join(root, 'apps', user, id)
  const outsideSecret = join(root, 'secret.txt')
  await writeFile(outsideSecret, 'SUPER_SECRET')

  // 1. Replace manifest.json with a symlink to outside
  const manifestPath = join(appDir, 'manifest.json')
  await rm(manifestPath)
  await symlink(outsideSecret, manifestPath)
  await assert.rejects(storage.read(user, id), err => err.status === 403)

  // Restore manifest
  await rm(manifestPath)
  await writeFile(manifestPath, JSON.stringify(createAppProject({ id, name: 'Sym Test' })))

  // 2. Replace a source file with a symlink to outside
  const filePath = join(appDir, 'revisions', '1', 'files', 'src', 'App.tsx')
  await rm(filePath)
  await symlink(outsideSecret, filePath)
  await assert.rejects(storage.readFile(user, id, 'src/App.tsx'), err => err.status === 403)

  // 3. Replace revision file with a symlink
  const revPath = join(appDir, 'revisions', '1', 'record.json')
  await rm(revPath)
  await symlink(outsideSecret, revPath)
  await assert.rejects(storage.readRevision(user, id, 1), err => err.status === 403)

  // 4. Directory segment symlink inside files/
  const srcDir = join(appDir, 'revisions', '1', 'files', 'src')
  await rm(srcDir, { recursive: true })
  await symlink(root, srcDir)
  await assert.rejects(storage.readFile(user, id, 'src/App.tsx'), err => err.status === 403)
})

test('readFile rejects path traversal and invalid relative paths', async t => {
  const { storage } = await fixture(t)
  const user = 'user_trav'
  const id = 'app_trav'

  await storage.put(user, id, createAppProject({ id, name: 'Traversal Test' }), null)

  for (const badPath of [
    '../outside.tsx',
    '/absolute/path.tsx',
    'src/../../secret.txt',
    'src/./../../secret.txt',
    'src\\backslash.tsx',
    'src/\0null.tsx',
  ]) {
    await assert.rejects(storage.readFile(user, id, badPath))
  }
})

test('migrates v0 unversioned app draft into version 1 on put', async t => {
  const { storage } = await fixture(t)
  const user = 'user_mig'
  const id = 'app_v0'

  const v0Project = {
    name: 'V0 Project',
    files: {
      'App.tsx': 'export default () => <div>Legacy</div>',
    },
    release: { status: 'draft', notes: 'v0 draft' },
  }

  const migrated = await storage.put(user, id, v0Project, null)
  assert.equal(migrated.format, 'paper-app')
  assert.equal(migrated.version, 1)
  assert.equal(migrated.id, id)
  assert.equal(migrated.revision, 1)
  // App.tsx at root was moved to src/App.tsx
  assert.ok(migrated.files['src/App.tsx'])
  assert.equal(migrated.files['src/App.tsx'].content, 'export default () => <div>Legacy</div>')

  const readBack = await storage.read(user, id)
  assert.equal(readBack.format, 'paper-app')
  assert.equal(readBack.version, 1)
  assert.ok(readBack.files['src/App.tsx'])
})

test('restart hides abandoned snapshots and reclaims them only on the next locked write', async t => {
  const { root, storage } = await fixture(t)
  const user = 'user_crash', id = 'app_clean'
  const saved = await storage.put(user, id, createAppProject({ id, name: 'Before Crash' }), null)
  const appDir = join(root, 'apps', user, id)
  const staging = join(appDir, '.staging_00000000-0000-0000-0000-000000000000')
  await mkdir(staging)
  await writeFile(join(staging, 'garbage.txt'), 'junk')
  await mkdir(join(appDir, 'revisions', '2'))
  await writeFile(join(appDir, 'revisions', '2', 'record.json'), 'incomplete')
  const freshStorage = new AppStorage(root)
  assert.equal((await freshStorage.read(user, id)).name, 'Before Crash')
  assert.equal(await freshStorage.readRevision(user, id, 2), null)
  assert.deepEqual((await freshStorage.listRevisions(user, id)).map(r => r.revision), [1])
  // Readers cannot distinguish an abandoned write from a live one.
  assert.ok((await readdir(appDir)).some(name => name.startsWith('.staging_')))
  await freshStorage.put(user, id, { ...saved, name: 'Recovered' }, 1)
  assert.ok(!(await readdir(appDir)).some(name => name.startsWith('.')))
  assert.deepEqual((await freshStorage.listRevisions(user, id)).map(r => r.revision), [1, 2])
})

test('disk write, snapshot rename, manifest rename, and directory sync failures preserve the last revision', async t => {
  for (const boundary of ['write', 'snapshot', 'manifest', 'sync']) {
    await t.test(boundary, async t => {
      const { root, storage } = await fixture(t)
      const user = 'alice', id = 'io_failure'
      const saved = await storage.put(user, id, createAppProject({ id, name: 'Stable' }), null)
      const appDir = join(root, 'apps', user, id)
      const before = await readFile(join(appDir, 'manifest.json'), 'utf8')
      const rename = fs.rename, open = fs.open
      let injected = false
      const failure = Object.assign(new Error(`Injected ${boundary} failure`), { code: boundary === 'write' ? 'ENOSPC' : 'EIO' })
      t.mock.method(fs, 'rename', async (from, to) => {
        if (!injected && ((boundary === 'snapshot' && String(from).includes('.staging_')) ||
            (boundary === 'manifest' && to === join(appDir, 'manifest.json')))) {
          injected = true
          throw failure
        }
        return rename(from, to)
      })
      t.mock.method(fs, 'open', async (path, flags, ...args) => {
        if (!injected && boundary === 'write' && String(path).includes('.staging_') && String(path).endsWith('record.json')) {
          injected = true
          throw failure
        }
        const handle = await open(path, flags, ...args)
        if (!injected && boundary === 'sync' && path === join(appDir, 'revisions', '2') &&
            typeof flags === 'number' && (flags & constants.O_DIRECTORY)) {
          // This sync follows the head rename, so rollback must restore revision 1.
          t.mock.method(handle, 'sync', async () => { injected = true; throw failure })
        }
        return handle
      })
      try {
        await assert.rejects(storage.put(user, id, { ...saved, name: 'Must not commit' }, 1), failure)
      } finally { t.mock.restoreAll() }
      assert.equal(injected, true)
      assert.equal(await readFile(join(appDir, 'manifest.json'), 'utf8'), before)
      const restarted = new AppStorage(root)
      assert.equal((await restarted.read(user, id)).name, 'Stable')
      assert.equal((await restarted.readFile(user, id, 'src/App.tsx')).content, saved.files['src/App.tsx'].content)
      assert.deepEqual((await restarted.listRevisions(user, id)).map(r => r.revision), [1])
      assert.equal(await restarted.readRevision(user, id, 2), null)
      assert.deepEqual((await readdir(appDir)).sort(), ['manifest.json', 'revisions'])
      assert.equal((await restarted.put(user, id, { ...saved, name: 'Recovered' }, 1)).revision, 2)
      assert.equal((await restarted.readRevision(user, id, 1)).project.name, 'Stable')
    })
  }
})

test('a reader or another app writer cannot clean a live staging tree', { timeout: 5000 }, async t => {
  const { root, storage } = await fixture(t)
  const original = await storage.put('alice', 'one', createAppProject({ id: 'one' }), null)
  const open = fs.open
  let resume, reached
  const paused = new Promise(resolve => { reached = resolve })
  const release = new Promise(resolve => { resume = resolve })
  t.after(() => resume())
  t.mock.method(fs, 'open', async (path, ...args) => {
    if (String(path).includes('.staging_') && String(path).endsWith('src/App.tsx')) {
      reached()
      await release
    }
    return open(path, ...args)
  })
  const write = storage.put('alice', 'one', { ...original, name: 'Finished' }, 1)
  try {
    await paused
    t.mock.restoreAll()
    const other = new AppStorage(root)
    assert.equal((await other.list('alice')).length, 1)
    await other.put('alice', 'two', createAppProject({ id: 'two' }), null)
  } finally { resume(); await write; t.mock.restoreAll() }
  assert.equal((await storage.read('alice', 'one')).name, 'Finished')
})

test('SIGKILL between snapshot install and head publication retains the working revision on restart', { timeout: 10000 }, async t => {
  const { root, storage } = await fixture(t)
  const saved = await storage.put('alice', 'crash', createAppProject({ id: 'crash', name: 'Working' }), null)
  const moduleURL = new URL('../server/app-storage.ts', import.meta.url).href
  const child = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', `
    import fs from 'node:fs/promises'
    import { AppStorage } from ${JSON.stringify(moduleURL)}
    const store = new AppStorage(process.argv[1])
    const saved = await store.read('alice', 'crash')
    const rename = fs.rename
    fs.rename = async (from, to) => {
      await rename(from, to)
      if (String(from).includes('.staging_')) {
        process.send('installed')
        await new Promise(() => { setInterval(() => {}, 1000) })
      }
    }
    await store.put('alice', 'crash', { ...saved, name: 'Interrupted' }, 1)
  `, root], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += chunk })
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL') })
  const exit = once(child, 'exit')
  const milestone = await Promise.race([
    once(child, 'message').then(([message]) => message),
    exit.then(([code]) => { throw new Error(`Child exited before crash boundary (${code}): ${stderr}`) }),
  ])
  assert.equal(milestone, 'installed')
  child.kill('SIGKILL')
  await exit
  const restarted = new AppStorage(root)
  assert.equal((await restarted.read('alice', 'crash')).name, 'Working')
  assert.equal((await restarted.readFile('alice', 'crash', 'src/App.tsx')).content, saved.files['src/App.tsx'].content)
  assert.equal(await restarted.readRevision('alice', 'crash', 2), null)
  assert.deepEqual((await restarted.listRevisions('alice', 'crash')).map(r => r.revision), [1])
  assert.equal((await restarted.put('alice', 'crash', { ...saved, name: 'Recovered' }, 1)).revision, 2)
  assert.equal((await restarted.readRevision('alice', 'crash', 1)).project.name, 'Working')
})

test('all intermediate artifact directories reject symlinks without reading or changing their targets', async t => {
  for (const segment of ['apps', 'account', 'revisions', 'revision', 'files', 'source']) {
    await t.test(segment, async t => {
      const { root, storage } = await fixture(t)
      const saved = await storage.put('alice', 'target', createAppProject({ id: 'target', name: 'Private' }), null)
      const appDir = join(root, 'apps', 'alice', 'target')
      const paths = {
        apps: join(root, 'apps'), account: join(root, 'apps', 'alice'),
        revisions: join(appDir, 'revisions'), revision: join(appDir, 'revisions', '1'),
        files: join(appDir, 'revisions', '1', 'files'), source: join(appDir, 'revisions', '1', 'files', 'src'),
      }
      const original = paths[segment], outside = join(root, 'outside')
      await fs.rename(original, outside)
      await symlink(outside, original)
      await assert.rejects(storage.readFile('alice', 'target', 'src/App.tsx'), error => error.status === 403)
      if (['apps', 'account', 'revisions', 'revision'].includes(segment)) {
        await assert.rejects(storage.readRevision('alice', 'target', 1), error => error.status === 403)
        await assert.rejects(storage.listRevisions('alice', 'target'), error => error.status === 403)
      }
      if (['apps', 'account', 'revisions'].includes(segment)) {
        await assert.rejects(storage.put('alice', 'target', { ...saved, name: 'Attack' }, 1), error => error.status === 403)
      }
      await rm(original)
      await fs.rename(outside, original)
      assert.equal((await storage.read('alice', 'target')).name, 'Private')
      assert.equal((await storage.readRevision('alice', 'target', 1)).project.name, 'Private')
    })
  }
})

test('stored revision hashes and manifest identity are checked instead of silently repaired', async t => {
  const { root, storage } = await fixture(t)
  const saved = await storage.put('alice', 'integrity', createAppProject({ id: 'integrity' }), null)
  const appDir = join(root, 'apps', 'alice', 'integrity')
  const path = join(appDir, 'revisions', '1', 'record.json')
  const record = JSON.parse(await readFile(path, 'utf8'))
  await writeFile(path, JSON.stringify({ ...record, hash: 'tampered' }))
  await assert.rejects(storage.readRevision('alice', 'integrity', 1), error => error.status === 500)
  await assert.rejects(storage.listRevisions('alice', 'integrity'), error => error.status === 500)
  await writeFile(join(appDir, 'manifest.json'), JSON.stringify({ ...saved, id: 'another_app' }))
  await assert.rejects(storage.put('alice', 'integrity', saved, 1), error => error.status === 500)
})
