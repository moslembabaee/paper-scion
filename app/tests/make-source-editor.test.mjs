import test from 'node:test'
import assert from 'node:assert/strict'
import { compileAppProject } from '../src/make/compiler.ts'
import { createAppProject, validateAppProject } from '../src/make/manifest.ts'
import * as workspace from '../src/make/workspace-model.ts'
const { createMakeWorkspaceStore } = workspace

// ── Helpers ──────────────────────────────────────────────────────────

function singleFileProject(content = 'export default () => <main>App</main>') {
  return createAppProject({
    id: 'source-editor-test',
    name: 'Source Editor Test',
    files: { 'src/App.tsx': content },
  })
}

const VALID_EDIT = `import React from 'react'

export default function App() {
  return (
    <main className="app-root">
      <h1>Hello from Source Editor</h1>
    </main>
  )
}
`
const MALFORMED_EDIT = `export default function App() {
  return <div>Hello
}
`
const INITIAL = `export default function App() {
  return <div>Initial</div>
}
`

// ── Test: Source editor accepts valid code and rebuilds preview ──

test('source editor: valid manual save rebuilds preview successfully', async () => {
  const store = createMakeWorkspaceStore({
    initialProject: singleFileProject(),
    compiler: compileAppProject,
  })
  await store.runPreview()
  assert.equal(store.getState().previewStatus, 'ready', 'Initial preview must be ready')

  const result = await store.saveSourceFile('src/App.tsx', VALID_EDIT)
  assert.equal(result.success, true, 'Valid source save must succeed')
  assert.equal(store.getState().activeProject.revision, 2, 'Valid save must advance revision')
  assert.equal(store.getState().previewStatus, 'ready', 'Valid save must leave preview ready')
  assert.ok(store.getState().assets, 'Valid save must produce assets')
  assert.ok(store.getState().activeProject.files['src/App.tsx'].content.includes('Hello from Source Editor'), 'Source must be preserved')
  assert.ok(store.getState().rollbackPoint, 'Save must record a rollback point')
  assert.equal(store.getState().rollbackPoint?.revision, 1, 'Rollback point must reference the prior revision')
})

// ── Test: Syntax errors retain prior runnable revision ──

test('source editor: syntax errors retain prior runnable revision and show actionable diagnostics', async () => {
  const store = createMakeWorkspaceStore({
    initialProject: singleFileProject(INITIAL),
    compiler: compileAppProject,
  })
  await store.runPreview()
  assert.equal(store.getState().previewStatus, 'ready', 'Initial valid code must compile')
  const assetsBefore = store.getState().assets
  const revisionBefore = store.getState().activeProject.revision

  // Attempt to save malformed syntax: must fail and retain prior runnable revision
  try {
    await store.saveSourceFile('src/App.tsx', MALFORMED_EDIT)
    assert.fail('Malformed source save must be rejected')
  } catch (err) {
    assert.ok(err instanceof Error, 'Must throw an error')
    assert.ok(/syntax|unexpected|closing|compile|diagnostic/i.test(err.message), 'Error message must indicate compilation failure: ' + err.message)
  }
  assert.equal(store.getState().activeProject.revision, revisionBefore, 'Failed save must not advance revision')
  assert.equal(store.getState().assets, assetsBefore, 'Failed save must retain the prior runnable preview assets')
  assert.equal(store.getState().previewStatus, 'ready', 'Prior runnable preview must remain ready')

  // Diagnostics are exposed from the rejected save for the user to act on
  const diagnostics = store.getState().diagnostics
  assert.ok(diagnostics.length > 0, 'Rejected save must surface diagnostics')
  assert.ok(diagnostics.some(d => d.code === 'SYNTAX_ERROR'), 'Must include SYNTAX_ERROR')
  const syntax = diagnostics.find(d => d.code === 'SYNTAX_ERROR')
  assert.ok(syntax.file, 'Diagnostic must identify the file')
  assert.ok(syntax.line > 0, 'Diagnostic line must be positive')
  assert.ok(syntax.column > 0, 'Diagnostic column must be positive')
  const formatted = workspace.formatDiagnostic(syntax)
  assert.ok(formatted.location.includes('src/App.tsx'), 'Formatted location must include file path')
  assert.ok(formatted.actionableHint.length > 0, 'Must provide an actionable hint')

  // Fix the code and save — must succeed
  const fixed = await store.saveSourceFile('src/App.tsx', INITIAL)
  assert.equal(fixed.success, true, 'Fixed code must save')
  assert.equal(store.getState().previewStatus, 'ready', 'Preview must be ready after fixing')
  assert.ok(store.getState().assets.js.length > 0, 'JS bundle must be non-empty')
  assert.ok(store.getState().assets.html.includes('paper-preview'), 'HTML must include preview bridge')
})

// ── Test: Stale revision conflict on save ──

test('source editor: stale save presents conflict rather than clobbering', async () => {
  let disk = createAppProject({ id: 'stale-save-test', name: 'Stale Save Test', files: { 'src/App.tsx': INITIAL } })
  let updateAttemptCount = 0

  const repository = {
    list: async () => [disk],
    read: async () => structuredClone(disk),
    create: async p => structuredClone(p),
    compile: compileAppProject,
    update: async (project, expectedRevision) => {
      updateAttemptCount++
      if (expectedRevision !== disk.revision) {
        const err = new Error('Revision conflict: expected ' + expectedRevision + ' but current is ' + disk.revision)
        err.status = 409
        throw err
      }
      disk = validateAppProject({ ...project, revision: expectedRevision + 1, updatedAt: new Date().toISOString() })
      return structuredClone(disk)
    },
  }

  const store = createMakeWorkspaceStore({ repository, compiler: compileAppProject })
  await store.loadProjects()
  await store.openSavedProject(disk.id)
  await store.runPreview()
  assert.equal(store.getState().activeProject.revision, 1, 'Initial revision must be 1')

  // Simulate a concurrent external edit: server revision advances to 2
  disk = validateAppProject({
    ...disk,
    revision: 2,
    files: { 'src/App.tsx': { path: 'src/App.tsx', content: INITIAL } },
    updatedAt: new Date().toISOString(),
  })

  // User attempts to save their edit against their (now stale) revision 1
  await assert.rejects(
    () => store.saveSourceFile('src/App.tsx', VALID_EDIT, 1),
    /conflict|revision|stale/i,
    'Stale save must present a conflict instead of clobbering'
  )
  assert.ok(updateAttemptCount >= 1, 'Repository update must have been attempted')

  // The user's working edit must not have been silently applied or clobbered
  const state = store.getState()
  assert.ok(state.projectError, 'Project error must explain the conflict')
  assert.match(state.projectError, /conflict|revision|stale/i)
  assert.equal(state.previewStatus, 'ready', 'Conflict must leave the runnable preview ready')
  // Local working project is unchanged until the user reloads the fresh revision
  assert.equal(state.activeProject.revision, 1, 'Local working revision must be unchanged after a rejected save')

  // Reloading confirms the committed revision is intact (no clobber)
  await store.openSavedProject(disk.id)
  assert.equal(store.getState().activeProject.files['src/App.tsx'].content, INITIAL, 'Committed revision must be unchanged')

  // Re-applying the edit against the fresh revision must succeed
  const saved = await store.saveSourceFile('src/App.tsx', VALID_EDIT, 2)
  assert.equal(saved.success, true, 'Save must succeed once it targets the current revision')
  assert.equal(store.getState().activeProject.revision, 3, 'Successful save must advance to revision 3')
  assert.equal(store.getState().activeProject.files['src/App.tsx'].content, VALID_EDIT, 'Edit must be committed')
})

test('source editor: a compiler transport failure keeps the prior runnable revision usable', async () => {
  let fail = false
  const store = createMakeWorkspaceStore({
    initialProject: singleFileProject(INITIAL),
    compiler: project => {
      if (fail) throw new Error('Compiler unavailable')
      return compileAppProject(project)
    },
  })
  await store.runPreview()
  const before = store.getState()
  fail = true
  await assert.rejects(store.saveSourceFile('src/App.tsx', VALID_EDIT, 1), /unavailable/)
  assert.equal(store.getState().activeProject, before.activeProject)
  assert.equal(store.getState().assets, before.assets)
  assert.equal(store.getState().previewStatus, 'ready')
  assert.equal(store.getState().projectStatus, 'idle')
})

// ── Test: Multiple file edits compile and rebuild ──

test('source editor: saving multiple files rebuilds preview correctly', async () => {
  const project = createAppProject({
    id: 'multi-file-test',
    name: 'Multi File Test',
    files: {
      'src/App.tsx': `import './styles.css'
export default function App() {
  return <div className="root">Main</div>
}
`,
      'src/styles.css': `.root { color: #edebe1; }`,
    },
  })

  const store = createMakeWorkspaceStore({ initialProject: project, compiler: compileAppProject })
  await store.runPreview()
  assert.equal(store.getState().previewStatus, 'ready', 'Multi-file project must compile')

  await store.saveSourceFile('src/App.tsx', `import './styles.css'
export default function App() {
  return <div className="root">Updated Main</div>
}
`)
  await store.saveSourceFile('src/styles.css', `.root { color: #81adec; background: #111; }`)

  assert.equal(store.getState().previewStatus, 'ready', 'After multi-file save, preview must rebuild')
  assert.equal(store.getState().activeProject.files['src/App.tsx'].content.includes('Updated Main'), true, 'App.tsx edit preserved')
  assert.equal(store.getState().activeProject.files['src/styles.css'].content.includes('#81adec'), true, 'styles.css edit preserved')
  assert.equal(store.getState().activeProject.revision, 3, 'Two saves must advance revision to 3')
})

// ── Test: Workspace tracks active file path for editor focus ──

test('source editor: workspace tracks active file path for editor focus', () => {
  const project = createAppProject({
    files: {
      'src/App.tsx': 'export default () => <div>App</div>',
      'src/styles.css': 'div { color: #edebe1 }',
    },
  })
  const store = createMakeWorkspaceStore({ initialProject: project })
  assert.equal(store.getState().activeFilePath, 'src/App.tsx', 'Default active file must be entry point')
  store.setActiveFile('src/styles.css')
  assert.equal(store.getState().activeFilePath, 'src/styles.css', 'Store must track active file selection')
})

// ── Test: Visual element selection cleared on source edit ──

test('source editor: saving a source edit clears stale element selection', async () => {
  const code = `export default function App() {
  return (
    <main>
      <h1>Title</h1>
      <button>Click</button>
    </main>
  )
}
`
  const store = createMakeWorkspaceStore({ initialProject: singleFileProject(code), compiler: compileAppProject })
  await store.runPreview()
  assert.equal(store.getState().previewStatus, 'ready')

  store.selectElement({ elementId: 'root', tagName: 'h1', previewText: 'Title' })
  assert.ok(store.getState().selectedElement, 'Element selection must be stored')

  const result = await store.saveSourceFile('src/App.tsx', code.replace('Click', 'Submit'))
  assert.equal(result.success, true)
  assert.equal(store.getState().selectedElement, null, 'Element selection must be cleared after source save')
})

// ── Test: updateActiveFile keeps revision stable (unsaved) ──

test('source editor: updateActiveFile stages an unsaved draft without advancing revision', () => {
  const store = createMakeWorkspaceStore({ initialProject: singleFileProject() })
  assert.equal(store.getState().activeProject.revision, 1, 'Initial revision must be 1')
  store.updateActiveFile('src/App.tsx', 'export default () => <div>After edit</div>')
  assert.equal(store.getState().activeProject.revision, 1, 'updateActiveFile must not advance revision without save')
  assert.equal(store.getState().activeProject.files['src/App.tsx'].content, 'export default () => <div>After edit</div>', 'Draft content must be staged')
})

test('source editor: same-store model revision rejects a stale manual draft before compiling', async () => {
  let compilations = 0
  const project = singleFileProject(INITIAL)
  const store = createMakeWorkspaceStore({ initialProject: project, compiler: p => { compilations++; return compileAppProject(p) } })
  const baseRevision = store.getState().activeProject.revision
  const model = validateAppProject({ ...project, revision: 2, files: { 'src/App.tsx': { path: 'src/App.tsx', content: VALID_EDIT } } })
  store.selectProject(model)
  await assert.rejects(store.saveSourceFile('src/App.tsx', INITIAL, baseRevision), /conflict/i)
  assert.equal(compilations, 0)
  assert.equal(store.getState().activeProject, model)
})

test('source editor: cancelled validation cannot update the next project or write to the repository', async () => {
  let release
  let writes = 0
  const initialProject = singleFileProject(INITIAL)
  const store = createMakeWorkspaceStore({ initialProject, repository: {
    list: async () => [initialProject], read: async () => initialProject, create: async p => p,
    compile: async p => compileAppProject(p), update: async p => { writes++; return p },
  }, compiler: () => new Promise(resolve => { release = resolve }) })
  await store.loadProjects()
  const pending = store.saveSourceFile('src/App.tsx', VALID_EDIT, 1)
  const next = createAppProject({ id: 'other-project' })
  store.selectProject(next)
  release(await compileAppProject(initialProject))
  await assert.rejects(pending, /changed|cancelled/i)
  assert.equal(writes, 0)
  assert.equal(store.getState().activeProject, next)
  assert.equal(store.getState().previewStatus, 'idle')
})

test('source editor: malformed CSS and forbidden execution never become committed source', async () => {
  const initialProject = createAppProject({ files: {
    'src/App.tsx': "import './styles.css'; export default () => <main>Safe</main>",
    'src/styles.css': 'main { color: #edebe1; }',
  } })
  const store = createMakeWorkspaceStore({ initialProject, compiler: compileAppProject })
  await store.runPreview()
  const assets = store.getState().assets
  for (const [path, content] of [
    ['src/styles.css', 'main { color: red'],
    ['src/styles.css', '@import "https://evil.test/track.css";'],
    ['src/App.tsx', 'export default () => <main>{eval("1")}</main>'],
  ]) {
    await assert.rejects(store.saveSourceFile(path, content, 1), /validation/i)
    assert.equal(store.getState().activeProject, initialProject)
    assert.equal(store.getState().assets, assets)
    assert.equal(store.getState().previewStatus, 'ready')
  }
})
