import test from 'node:test'
import assert from 'node:assert/strict'
import {
  computeFileDiff,
  computeBoundedDiff,
  DIFF_LIMITS,
} from '../src/make/diff.ts'
import {
  createAppPlan,
  approvePlan,
  parseModelGenerateResponse,
  GenerationValidationError,
} from '../src/make/plan.ts'
import {
  createMakeWorkspaceStore,
  MAKE_FIXTURES,
} from '../src/make/workspace-model.ts'
import { createAppProject } from '../src/make/manifest.ts'

test('computeFileDiff & computeBoundedDiff: computes line-by-line diffs with additions, deletions and bounds', () => {
  const oldContent = `import React from 'react'
export default function App() {
  return <div>Original</div>
}`

  const newContent = `import React from 'react'
import { Sparkles } from 'lucide-react'
export default function App() {
  return <div>Updated with Sparkles</div>
}`

  const diff = computeFileDiff('src/App.tsx', oldContent, newContent)
  assert.ok(diff)
  assert.equal(diff.path, 'src/App.tsx')
  assert.equal(diff.action, 'modify')
  assert.ok(diff.additions > 0)
  assert.ok(diff.deletions > 0)
  assert.ok(diff.lines.some(l => l.type === 'add' && l.text.includes('Sparkles')))
  assert.ok(diff.lines.some(l => l.type === 'delete' && l.text.includes('Original')))

  // Unchanged files return null
  assert.equal(computeFileDiff('src/App.tsx', oldContent, oldContent), null)

  // Created file
  const createdDiff = computeFileDiff('src/New.tsx', undefined, 'export const x = 1\nexport const y = 2')
  assert.ok(createdDiff)
  assert.equal(createdDiff.action, 'create')
  assert.equal(createdDiff.additions, 2)
  assert.equal(createdDiff.deletions, 0)
  assert.ok(createdDiff.lines.every(l => l.type === 'add'))

  // Deleted file
  const deletedDiff = computeFileDiff('src/Old.tsx', 'line 1\nline 2', undefined)
  assert.ok(deletedDiff)
  assert.equal(deletedDiff.action, 'delete')
  assert.equal(deletedDiff.deletions, 2)
  assert.equal(deletedDiff.additions, 0)
  assert.ok(deletedDiff.lines.every(l => l.type === 'delete'))

  // Multi-file bounded diff
  const oldFiles = {
    'src/App.tsx': { path: 'src/App.tsx', content: oldContent },
    'src/utils.ts': { path: 'src/utils.ts', content: 'export const util = () => true' },
  }
  const newFiles = {
    'src/App.tsx': { path: 'src/App.tsx', content: newContent },
    'src/utils.ts': { path: 'src/utils.ts', content: 'export const util = () => true' }, // untouched
    'src/Badge.tsx': { path: 'src/Badge.tsx', content: 'export function Badge() { return null }' },
  }

  const bounded = computeBoundedDiff(oldFiles, newFiles, { baseRevision: 1, targetRevision: 2 })
  assert.equal(bounded.baseRevision, 1)
  assert.equal(bounded.targetRevision, 2)
  assert.equal(bounded.changedFilesCount, 2) // App.tsx (modify) + Badge.tsx (create); utils.ts untouched
  assert.equal(bounded.files.some(f => f.path === 'src/utils.ts'), false)
  assert.ok(bounded.totalAdditions > 0)

  // Bounded limits: truncates large diffs
  const hugeLines = Array.from({ length: 600 }, (_, i) => `line ${i}`).join('\n')
  const hugeDiff = computeFileDiff('src/Huge.tsx', '', hugeLines, { maxDiffLinesPerFile: 50 })
  assert.ok(hugeDiff)
  assert.equal(hugeDiff.truncated, true)
  assert.ok(hugeDiff.lines.length <= 51)
})

test('iterative prompt edit: targets existing files, updates preview, and preserves unrelated files', async () => {
  const initialFiles = {
    'src/App.tsx': {
      path: 'src/App.tsx',
      content: `import React, { useState } from 'react'
export default function App() {
  const [count, setCount] = useState(0)
  return <div>Count: {count}</div>
}`,
    },
    'src/styles.css': {
      path: 'src/styles.css',
      content: 'body { background: #080808; color: #edebe1; }',
    },
    'src/unrelated.ts': {
      path: 'src/unrelated.ts',
      content: 'export const config = { maxRetries: 5, timeout: 3000 }',
    },
  }

  const initial = createAppProject({
    id: 'iterative-demo',
    revision: 1,
    files: initialFiles,
  })

  const initialAssets = {
    entryPoint: 'src/App.tsx',
    js: 'console.log("rev 1")',
    css: 'body { background: #080808; }',
    html: '<div>Count: 0</div>',
  }

  const updatedAppContent = `import React, { useState } from 'react'
export default function App() {
  const [count, setCount] = useState(0)
  return (
    <div>
      <span>Count: {count}</span>
      <button onClick={() => setCount(c => c + 1)}>Increment</button>
      <span className="badge">Active</span>
    </div>
  )
}`

  const updatedAssets = {
    entryPoint: 'src/App.tsx',
    js: 'console.log("rev 2")',
    css: 'body { background: #080808; }',
    html: '<div><span>Count: 0</span><button>Increment</button><span class="badge">Active</span></div>',
  }

  const editPlan = createAppPlan({
    planId: 'plan_iterative_01',
    appId: initial.id,
    baseRevision: 1,
    prompt: 'Add an increment button and active badge',
    summary: 'Add button and badge to App.tsx',
    files: [
      { path: 'src/App.tsx', description: 'Add increment button and badge', action: 'modify' },
    ],
    interactions: ['Click increment increases count'],
    risks: [],
  })

  const store = createMakeWorkspaceStore({
    initialProject: initial,
    compiler: async project => {
      if (project.revision === 1) return { success: true, assets: initialAssets, diagnostics: [] }
      return { success: true, assets: updatedAssets, diagnostics: [] }
    },
    planner: async () => editPlan,
    generator: async plan => {
      assert.equal(plan.baseRevision, 1)
      return {
        success: true,
        project: {
          ...initial,
          revision: 2,
          files: {
            ...initial.files,
            'src/App.tsx': { path: 'src/App.tsx', content: updatedAppContent },
          },
        },
        generatedFiles: {
          'src/App.tsx': { path: 'src/App.tsx', content: updatedAppContent },
        },
        assets: updatedAssets,
        diagnostics: [],
        plan,
      }
    },
  })

  // Start with initial preview
  await store.runPreview()
  assert.equal(store.getState().previewStatus, 'ready')
  assert.deepEqual(store.getState().assets, initialAssets)

  // Plan and approve iterative follow-up
  await store.generatePlan('Add an increment button and active badge')
  await store.approveCurrentPlan()

  // Generate / apply the iterative edit
  const res = await store.generateFromApprovedPlan()
  assert.equal(res.success, true)

  const state = store.getState()
  // 1. Revision advanced to 2
  assert.equal(state.activeProject.revision, 2)
  // 2. Target file modified
  assert.equal(state.activeProject.files['src/App.tsx'].content, updatedAppContent)
  // 3. CRITICAL: Unrelated files are preserved exactly!
  assert.equal(state.activeProject.files['src/styles.css'].content, initialFiles['src/styles.css'].content)
  assert.equal(state.activeProject.files['src/unrelated.ts'].content, initialFiles['src/unrelated.ts'].content)
  // 4. Preview updated to new assets
  assert.deepEqual(state.assets, updatedAssets)
  // 5. Bounded diff is computed and presented in state
  assert.ok(state.currentDiff)
  assert.equal(state.currentDiff.baseRevision, 1)
  assert.equal(state.currentDiff.targetRevision, 2)
  assert.equal(state.currentDiff.changedFilesCount, 1)
  assert.equal(state.currentDiff.files[0].path, 'src/App.tsx')
  assert.equal(state.currentDiff.files[0].action, 'modify')
  // 6. Exactly one rollback point recorded
  assert.ok(state.rollbackPoint)
  assert.equal(state.rollbackPoint.revision, 1)
  assert.equal(state.rollbackPoint.project.files['src/App.tsx'].content, initialFiles['src/App.tsx'].content)
})

test('rollback: restores previous revision, source files, and working preview atomically', async () => {
  const initialFiles = {
    'src/App.tsx': { path: 'src/App.tsx', content: '// Revision 1' },
    'src/styles.css': { path: 'src/styles.css', content: '/* css 1 */' },
  }
  const initial = createAppProject({ id: 'rollback-demo', revision: 1, files: initialFiles })
  const assets1 = { entryPoint: 'src/App.tsx', js: 'js1', css: 'css1', html: 'rev1' }
  const assets2 = { entryPoint: 'src/App.tsx', js: 'js2', css: 'css1', html: 'rev2' }

  const editPlan = createAppPlan({
    planId: 'plan_rb',
    appId: initial.id,
    baseRevision: 1,
    prompt: 'Update App',
    summary: 'Update App to Rev 2',
    files: [{ path: 'src/App.tsx', description: 'Update', action: 'modify' }],
    interactions: ['Interaction'],
  })

  const store = createMakeWorkspaceStore({
    initialProject: initial,
    compiler: async project => {
      if (project.files['src/App.tsx'].content === '// Revision 1') {
        return { success: true, assets: assets1, diagnostics: [] }
      }
      return { success: true, assets: assets2, diagnostics: [] }
    },
    planner: async (prompt, project) => createAppPlan({
      ...editPlan,
      prompt,
      appId: project.id,
      baseRevision: project.revision,
    }),
    generator: async plan => ({
      success: true,
      project: {
        ...initial,
        revision: 2,
        files: { ...initial.files, 'src/App.tsx': { path: 'src/App.tsx', content: '// Revision 2' } },
      },
      assets: assets2,
      diagnostics: [],
      plan,
    }),
  })

  await store.runPreview()
  await store.generatePlan('Update')
  await store.approveCurrentPlan()
  await store.generateFromApprovedPlan()

  // App is at Revision 2 with assets2
  assert.equal(store.getState().activeProject.files['src/App.tsx'].content, '// Revision 2')
  assert.deepEqual(store.getState().assets, assets2)
  assert.ok(store.getState().rollbackPoint)
  assert.equal(store.getState().rollbackPoint.revision, 1)

  // Perform rollback
  const restored = await store.rollback()
  assert.ok(restored)

  const state = store.getState()
  // Files restored to Revision 1
  assert.equal(state.activeProject.files['src/App.tsx'].content, '// Revision 1')
  // Preview assets restored to assets1
  assert.deepEqual(state.assets, assets1)
  assert.equal(state.previewStatus, 'ready')
  // Rollback point is consumed/cleared (exactly one rollback point)
  assert.equal(state.rollbackPoint, null)
})

test('stale revision & manual conflict: reject edits atomically', async () => {
  const initial = createAppProject({ id: 'conflict-demo', revision: 1, files: MAKE_FIXTURES.counter.files })
  const store = createMakeWorkspaceStore({
    initialProject: initial,
    planner: async () => createAppPlan({
      planId: 'plan_conf',
      appId: initial.id,
      baseRevision: 1,
      prompt: 'Prompt',
      summary: 'Summary',
      files: [{ path: 'src/App.tsx', description: 'Edit' }],
      interactions: ['Interaction'],
    }),
  })

  await store.generatePlan('Prompt')
  await store.approveCurrentPlan()

  // Manual edit occurs in workspace
  store.updateActiveFile('src/App.tsx', '// manual change by user')

  // Applying edit against stale revision / conflicting source rejects atomically
  await assert.rejects(() => store.generateFromApprovedPlan(), /stale/i)

  // The active file remains what the user typed manually
  assert.equal(store.getState().activeProject.files['src/App.tsx'].content, '// manual change by user')
})

test('failed build in iterative edit rejects atomically and retains previous preview & rollback point', async () => {
  const initial = createAppProject({ id: 'failed-edit-demo', revision: 1, files: MAKE_FIXTURES.counter.files })
  const assets1 = { entryPoint: 'src/App.tsx', js: 'working', css: '', html: 'working' }

  const syntaxErrorDiagnostic = {
    file: 'src/App.tsx',
    line: 5,
    column: 1,
    code: 'SYNTAX_ERROR',
    severity: 'error',
    message: 'Unexpected token',
  }

  const store = createMakeWorkspaceStore({
    initialProject: initial,
    compiler: async () => ({ success: true, assets: assets1, diagnostics: [] }),
    planner: async () => createAppPlan({
      planId: 'plan_fail',
      appId: initial.id,
      baseRevision: 1,
      prompt: 'Broken edit',
      summary: 'Broken edit',
      files: [{ path: 'src/App.tsx', description: 'Broken' }],
      interactions: ['Interaction'],
    }),
    generator: async plan => ({
      success: false,
      project: initial,
      assets: null,
      diagnostics: [syntaxErrorDiagnostic],
      error: 'Build failed: syntax error',
      plan,
    }),
  })

  await store.runPreview()
  assert.equal(store.getState().previewStatus, 'ready')
  assert.deepEqual(store.getState().assets, assets1)

  await store.generatePlan('Broken edit')
  await store.approveCurrentPlan()

  const result = await store.generateFromApprovedPlan()
  assert.equal(result.success, false)

  const state = store.getState()
  // Atomic rejection: revision NOT advanced
  assert.equal(state.activeProject.revision, 1)
  assert.equal(state.activeProject.files['src/App.tsx'].content, initial.files['src/App.tsx'].content)
  // Previous working preview retained!
  assert.deepEqual(state.assets, assets1)
  assert.equal(state.previewStatus, 'ready')
  // Diagnostics displayed
  assert.equal(state.diagnostics.length, 1)
  assert.equal(state.diagnostics[0].code, 'SYNTAX_ERROR')
})

test('cancellation: aborting follow-up edit preserves current revision, source files, and preview', async () => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  const initial = createAppProject({ id: 'cancel-demo', revision: 1, files: MAKE_FIXTURES.counter.files })
  const assets1 = { entryPoint: 'src/App.tsx', js: 'working', css: '', html: 'working' }

  const store = createMakeWorkspaceStore({
    initialProject: initial,
    compiler: async () => ({ success: true, assets: assets1, diagnostics: [] }),
    planner: async (prompt, project) => createAppPlan({
      planId: 'plan_cancel',
      appId: project.id,
      baseRevision: project.revision,
      prompt,
      summary: 'Edit to be cancelled',
      files: [{ path: 'src/App.tsx', description: 'Modify' }],
      interactions: ['Interaction'],
    }),
    generator: () => pending,
  })

  await store.runPreview()
  await store.generatePlan('Add feature')
  await store.approveCurrentPlan()

  // Start generation asynchronously
  const generating = store.generateFromApprovedPlan()
  assert.equal(store.getState().planStatus, 'generating_app')

  // Cancel generation
  store.cancelAppGeneration()

  const state = store.getState()
  assert.equal(state.planStatus, 'approved')
  assert.match(state.planError, /cancelled/i)
  assert.equal(state.activeProject.revision, 1)
  assert.equal(state.activeProject.files['src/App.tsx'].content, initial.files['src/App.tsx'].content)
  assert.deepEqual(state.assets, assets1)
  assert.equal(state.previewStatus, 'ready')

  // Late resolution does not affect state
  release({ success: true, assets: { entryPoint: 'src/App.tsx', js: 'late', css: '', html: 'late' }, plan: state.currentPlan })
  await generating
  assert.equal(store.getState().activeProject.revision, 1)
  assert.deepEqual(store.getState().assets, assets1)
})


test('bounded diff enforces aggregate line and UTF-8 byte caps and counts every changed file', () => {
  const after = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`src/file${i}.ts`, 'first\nsecond\nthird']))
  const diff = computeBoundedDiff({}, after, { maxTotalDiffLines: 4 })
  assert.ok(diff.files.reduce((n, f) => n + f.lines.length, 0) <= 4)
  assert.equal(diff.changedFilesCount, 5)
  assert.equal(diff.totalAdditions, 15)
  assert.equal(diff.truncated, true)
  const unicode = computeBoundedDiff({}, { 'src/a.ts': '😀'.repeat(100), 'src/b.ts': 'é'.repeat(100) }, { maxDiffBytes: 24 })
  assert.ok(unicode.files.reduce((n, f) => n + f.lines.reduce((m, l) => m + Buffer.byteLength(l.text + '\n'), 0), 0) <= 24)
  assert.equal(unicode.truncated, true)
})

test('rollback never consumes the point or changes preview when validation fails', async () => {
  const initial = createAppProject({ id: 'rollback-validation', files: MAKE_FIXTURES.counter.files })
  const assets = { entryPoint: 'src/App.tsx', js: 'working', css: '', html: '' }
  let fail = false
  const store = createMakeWorkspaceStore({
    initialProject: initial,
    compiler: async () => fail ? { success: false, assets: null, diagnostics: [], error: 'Rejected build' } : { success: true, assets, diagnostics: [] },
    planner: async (prompt, project) => createAppPlan({ appId: project.id, baseRevision: project.revision, prompt, summary: 'Edit', files: [{ path: 'src/App.tsx', description: 'Edit' }], interactions: ['Edit'] }),
    generator: async plan => ({ success: true, plan, assets, diagnostics: [], generatedFiles: { 'src/App.tsx': { path: 'src/App.tsx', content: 'export default () => <p>Updated</p>' } } }),
  })
  await store.runPreview()
  await store.generatePlan('Update')
  await store.approveCurrentPlan()
  await store.generateFromApprovedPlan()
  const before = store.getState()
  fail = true
  await assert.rejects(store.rollback(), /validat|build/i)
  assert.equal(store.getState().activeProject, before.activeProject)
  assert.equal(store.getState().assets, before.assets)
  assert.equal(store.getState().rollbackPoint, before.rollbackPoint)
})

test('each successful follow-up replaces the single rollback point; failed builds keep it intact', async () => {
  const initial = createAppProject({ files: MAKE_FIXTURES.counter.files })
  const assets = { entryPoint: 'src/App.tsx', js: 'working', css: '', html: '' }
  let fail = false
  const store = createMakeWorkspaceStore({ initialProject: initial,
    planner: async (prompt, project) => createAppPlan({ appId: project.id, baseRevision: project.revision, prompt, summary: prompt, files: [{ path: 'src/App.tsx', description: 'Edit' }], interactions: ['Edit'] }),
    generator: async (plan, project) => fail ? { success: false, plan, diagnostics: [], error: 'Build failed' } : {
      success: true, plan, assets, diagnostics: [], generatedFiles: { 'src/App.tsx': { path: 'src/App.tsx', content: `export default () => <p>Revision ${project.revision + 1}</p>` } },
    },
  })
  const edit = async () => { await store.generatePlan('Update app'); await store.approveCurrentPlan(); return store.generateFromApprovedPlan() }
  await edit()
  const point = store.getState().rollbackPoint
  const project = store.getState().activeProject
  fail = true
  assert.equal((await edit()).success, false)
  assert.equal(store.getState().rollbackPoint, point)
  assert.equal(store.getState().activeProject, project)
  assert.equal(store.getState().assets, assets)
  fail = false
  await edit()
  assert.equal(store.getState().rollbackPoint.revision, 2)
  assert.deepEqual(store.getState().rollbackPoint.project, project)
  assert.equal(store.getState().currentDiff.baseRevision, 2)
})
