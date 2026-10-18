import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAKE_FIXTURES,
  createMakeWorkspaceStore,
  formatDiagnostic,
  createStarterMakeProject,
} from '../src/make/workspace-model.ts'
import { compileAppProject } from '../src/make/compiler.ts'
import { SceneStore } from '../src/scene/store.ts'
import { createProject, serializeProject } from '../src/io/project.ts'

test('stopping or switching projects ignores a late compile result', async () => {
  for (const action of ['stop', 'switch']) {
    let finish
    const result = await compileAppProject(MAKE_FIXTURES.counter)
    const store = createMakeWorkspaceStore({ compiler: () => new Promise(resolve => { finish = resolve }) })
    const running = store.runPreview()
    assert.equal(store.getState().previewStatus, 'loading')
    if (action === 'stop') store.stopPreview()
    else store.selectProject(MAKE_FIXTURES.malformed)
    finish(result)
    await running
    assert.equal(store.getState().previewStatus, 'idle')
    assert.equal(store.getState().assets, null)
  }
})

test('starter project names remain text even when they contain TSX markup', async () => {
  const project = createStarterMakeProject('A < B & "quoted" {name}')
  const result = await compileAppProject(project)
  assert.equal(result.success, true, JSON.stringify(result.diagnostics))
})

test('saved projects load separately from scene documents, and failed saves preserve the draft', async () => {
  const saved = createStarterMakeProject('Saved app')
  const store = createMakeWorkspaceStore({ repository: {
    list: async () => [saved],
    read: async () => saved,
    create: async () => { throw new Error('Storage unavailable') },
    compile: compileAppProject,
  } })
  await store.loadProjects()
  assert.equal(store.getState().savedProjects[0].id, saved.id)
  await store.openSavedProject(saved.id)
  assert.equal(store.getState().activeProject.id, saved.id)
  await store.runPreview()
  assert.equal(store.getState().previewStatus, 'ready')
  await store.saveCopy()
  assert.match(store.getState().projectError, /Storage unavailable/)
  assert.equal(store.getState().activeProject.id, saved.id)
  assert.equal(store.getState().activeProject.revision, saved.revision)
})

test('newer runs win and a runtime failure clears the failed browsing context', async () => {
  const result = await compileAppProject(MAKE_FIXTURES.counter)
  const pending = []
  const store = createMakeWorkspaceStore({ compiler: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) })
  const oldRun = store.runPreview()
  const currentRun = store.retryPreview()
  pending[1].resolve(result)
  await currentRun
  pending[0].reject(new Error('Old request failed'))
  await oldRun
  assert.equal(store.getState().previewStatus, 'ready')
  assert.equal(store.getState().errorMessage, '')
  store.reportRuntimeError({ message: 'App render failed at src/App.tsx' })
  assert.equal(store.getState().assets, null)
  assert.equal(store.getState().previewStatus, 'error')
  assert.match(store.getState().errorMessage, /App render failed/)
})

test('late saved-project reads cannot replace a newly selected example', async () => {
  let finish
  let signal
  const store = createMakeWorkspaceStore({ repository: {
    list: async () => [], create: async project => project, compile: compileAppProject,
    read: (_id, requestSignal) => { signal = requestSignal; return new Promise(resolve => { finish = resolve }) },
  } })
  const opening = store.openSavedProject('saved-app')
  assert.equal(store.getState().projectStatus, 'loading')
  store.selectProject(MAKE_FIXTURES.malformed)
  assert.equal(signal.aborted, true)
  finish(createStarterMakeProject('Old saved app'))
  await opening
  assert.equal(store.getState().activeProject.id, MAKE_FIXTURES.malformed.id)
  assert.equal(store.getState().projectStatus, 'idle')
})

test('saving a copy publishes the returned revision without changing the example', async () => {
  const before = JSON.stringify(MAKE_FIXTURES.counter)
  let written
  const store = createMakeWorkspaceStore({ repository: {
    list: async () => [], read: async () => MAKE_FIXTURES.counter, compile: compileAppProject,
    create: async project => { written = project; return project },
  } })
  await store.saveCopy()
  assert.notEqual(written.id, MAKE_FIXTURES.counter.id)
  assert.equal(store.getState().activeProject.id, written.id)
  assert.equal(store.getState().savedProjects[0].id, written.id)
  assert.equal(JSON.stringify(MAKE_FIXTURES.counter), before)
})

test('Make fixtures: counter fixture compiles into valid interactive assets and mounts without error', async () => {
  const counterFixture = MAKE_FIXTURES.counter
  assert.ok(counterFixture, 'Counter fixture must exist')
  assert.equal(counterFixture.name, 'Counter Demo')
  assert.ok(counterFixture.files['src/App.tsx'], 'Counter fixture must have src/App.tsx')

  const result = await compileAppProject(counterFixture)
  assert.equal(result.success, true, 'Counter fixture must compile successfully')
  assert.ok(result.assets, 'Compile assets must be generated')
  assert.ok(result.assets.html.includes('Paper Preview'), 'Preview HTML must include title')
  assert.ok(result.assets.html.includes('paper-preview'), 'Preview HTML must embed preview bridge')
  assert.equal(result.diagnostics.length, 0, 'No diagnostics on valid fixture')
})

test('Make fixtures: malformed fixture produces actionable compiler diagnostics rather than blank iframe', async () => {
  const malformedFixture = MAKE_FIXTURES.malformed
  assert.ok(malformedFixture, 'Malformed fixture must exist')

  const result = await compileAppProject(malformedFixture)
  assert.equal(result.success, false, 'Malformed fixture compilation must fail')
  assert.equal(result.assets, null, 'Malformed fixture must not produce assets (no blank iframe)')
  assert.ok(result.diagnostics.length > 0, 'Malformed fixture must have diagnostics')

  const syntaxDiag = result.diagnostics.find(d => d.code === 'SYNTAX_ERROR')
  assert.ok(syntaxDiag, 'Must contain SYNTAX_ERROR diagnostic')
  assert.equal(syntaxDiag.file, 'src/App.tsx')
  assert.ok(syntaxDiag.line > 0)
  assert.ok(syntaxDiag.column > 0)

  // Test actionable diagnostic formatting
  const formatted = formatDiagnostic(syntaxDiag)
  assert.ok(formatted.title.includes('Syntax Error'), 'Formatted title must indicate syntax error')
  assert.ok(formatted.location.includes('src/App.tsx'), 'Formatted location must include file path')
  assert.ok(formatted.actionableHint.length > 0, 'Must provide an actionable hint to fix')
})

test('Make fixtures: denied import fixture produces actionable DENIED_IMPORT diagnostic', async () => {
  const deniedFixture = MAKE_FIXTURES.deniedImport
  assert.ok(deniedFixture, 'Denied import fixture must exist')

  const result = await compileAppProject(deniedFixture)
  assert.equal(result.success, false)
  assert.equal(result.assets, null)

  const deniedDiag = result.diagnostics.find(d => d.code === 'DENIED_IMPORT')
  assert.ok(deniedDiag, 'Must contain DENIED_IMPORT diagnostic')
  assert.equal(deniedDiag.file, 'src/App.tsx')

  const formatted = formatDiagnostic(deniedDiag)
  assert.ok(formatted.title.includes('Denied Import'), 'Formatted title must indicate denied import')
  assert.ok(formatted.actionableHint.includes('allowlisted'), 'Hint must mention allowlist')
})

test('Make workspace store: manages run/stop preview lifecycle and loading/error/retry states', async () => {
  let compilerCallCount = 0
  const mockCompiler = async (project) => {
    compilerCallCount++
    return compileAppProject(project)
  }

  const store = createMakeWorkspaceStore({
    compiler: mockCompiler,
    initialProject: MAKE_FIXTURES.counter,
  })

  // 1. Initial idle state
  assert.equal(store.getState().previewStatus, 'idle')
  assert.equal(store.getState().assets, null)
  assert.equal(store.getState().diagnostics.length, 0)
  assert.equal(store.getState().activeProject.name, 'Counter Demo')

  // 2. Run preview -> triggers compilation and ready state
  await store.runPreview()
  assert.equal(compilerCallCount, 1)
  assert.equal(store.getState().previewStatus, 'ready')
  assert.ok(store.getState().assets !== null)
  assert.equal(store.getState().diagnostics.length, 0)

  // 3. Stop preview -> halts preview back to idle
  store.stopPreview()
  assert.equal(store.getState().previewStatus, 'idle')
  assert.equal(store.getState().assets, null)

  // 4. Select malformed project and run -> enters error state with actionable diagnostics
  store.selectProject(MAKE_FIXTURES.malformed)
  assert.equal(store.getState().previewStatus, 'idle')
  assert.equal(store.getState().activeProject.name, MAKE_FIXTURES.malformed.name)

  await store.runPreview()
  assert.equal(compilerCallCount, 2)
  assert.equal(store.getState().previewStatus, 'error')
  assert.equal(store.getState().assets, null)
  assert.ok(store.getState().diagnostics.length > 0)
  assert.ok(store.getState().errorMessage.length > 0)

  // 5. Retry re-runs compilation
  await store.retryPreview()
  assert.equal(compilerCallCount, 3)
  assert.equal(store.getState().previewStatus, 'error')

  // 6. Fix project files and retry -> transitions from error to ready
  store.updateActiveFile('src/App.tsx', 'export default function App() { return <div>Fixed App</div> }')
  await store.retryPreview()
  assert.equal(compilerCallCount, 4)
  assert.equal(store.getState().previewStatus, 'ready')
  assert.ok(store.getState().assets !== null)
  assert.equal(store.getState().diagnostics.length, 0)
})

test('Make workspace store: project chooser switches projects and creates starter projects', () => {
  const store = createMakeWorkspaceStore({
    initialProject: MAKE_FIXTURES.counter,
  })

  assert.equal(store.getState().projects.length >= 3, true, 'Store should list fixtures and user projects')

  // Create new starter project
  const newProj = store.createNewProject('My Custom Make App')
  assert.equal(newProj.name, 'My Custom Make App')
  assert.ok(newProj.files['src/App.tsx'])
  assert.equal(store.getState().activeProject.id, newProj.id)
  assert.equal(store.getState().previewStatus, 'idle')

  // Rename project
  store.renameActiveProject('Renamed Make App')
  assert.equal(store.getState().activeProject.name, 'Renamed Make App')

  // Switch back to counter
  store.selectProjectById(MAKE_FIXTURES.counter.id)
  assert.equal(store.getState().activeProject.name, 'Counter Demo')
})

test('Make workspace preserves design scene editor state without mutations or regressions', async () => {
  // Create an existing Paper design scene with layers
  const sceneStore = new SceneStore()
  sceneStore.add('frame', { id: 'frame-1', x: 0, y: 0, width: 720, height: 480 })
  sceneStore.add('rectangle', { id: 'rect-1', parentId: 'frame-1', x: 24, y: 24, width: 120, height: 120 })
  const sceneProject = createProject(sceneStore, 'Design Document', { x: 0, y: 0, zoom: 1 }, true)
  const sceneSnapshotBefore = serializeProject(sceneProject)

  // Now create and operate Make workspace
  const makeStore = createMakeWorkspaceStore({
    initialProject: MAKE_FIXTURES.counter,
  })
  await makeStore.runPreview()
  makeStore.createNewProject('Side App')
  makeStore.stopPreview()

  // Verify scene is completely untouched
  const sceneSnapshotAfter = serializeProject(sceneProject)
  assert.equal(sceneSnapshotAfter, sceneSnapshotBefore, 'Make workspace operations must never mutate scene documents')
  assert.equal(sceneStore.getSnapshot().elements['frame-1']?.width, 720)
  assert.equal(sceneStore.getSnapshot().elements['rect-1']?.parentId, 'frame-1')
})
