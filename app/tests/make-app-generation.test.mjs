import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createAppPlan,
  approvePlan,
  formatGeneratePrompt,
  parseModelGenerateResponse,
  GenerationValidationError,
} from '../src/make/plan.ts'
import {
  MAKE_FIXTURES,
  createMakeWorkspaceStore,
} from '../src/make/workspace-model.ts'
import { createAppProject } from '../src/make/manifest.ts'

const sampleDraftPlan = createAppPlan({
  planId: 'plan_gen_01',
  appId: 'counter-app',
  baseRevision: 1,
  prompt: 'Add an interactive counter with increment, decrement and reset buttons',
  summary: 'Interactive counter with state hooks and Paper design aesthetic',
  files: [
    { path: 'src/App.tsx', description: 'Counter UI and state logic', action: 'modify' },
    { path: 'src/styles.css', description: 'Craft styling and grid layout', action: 'modify' },
  ],
  interactions: [
    'Click increment increases counter by 1',
    'Click decrement decreases counter by 1',
    'Click reset returns counter to 0',
  ],
  risks: [
    'State resets on iframe reload unless stored',
  ],
})

const sampleApprovedPlan = approvePlan(sampleDraftPlan, 1)

const validGeneratedCode = {
  summary: 'Complete counter prototype with reactive buttons',
  files: [
    {
      path: 'src/App.tsx',
      content: `import React, { useState } from 'react'
import { Plus, Minus, RotateCcw } from 'lucide-react'
import './styles.css'

export default function App() {
  const [count, setCount] = useState(0)
  return (
    <main className="make-app-shell">
      <div className="card">
        <h1>Counter: {count}</h1>
        <div className="buttons">
          <button onClick={() => setCount(c => c - 1)} aria-label="Decrement"><Minus size={14} /></button>
          <button onClick={() => setCount(c => c + 1)} aria-label="Increment"><Plus size={14} /></button>
          <button onClick={() => setCount(0)} aria-label="Reset"><RotateCcw size={14} /></button>
        </div>
      </div>
    </main>
  )
}`,
    },
    {
      path: 'src/styles.css',
      content: `.make-app-shell {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #080808;
  color: #edebe1;
  background-image: linear-gradient(#222222 1px, transparent 1px), linear-gradient(90deg, #222222 1px, transparent 1px);
  background-size: 120px 120px;
}
.card {
  background: #111111;
  border: 1px solid #222222;
  border-radius: 8px;
  padding: 24px;
}
.buttons { display: flex; gap: 8px; }
`,
    },
  ],
}

test('formatGeneratePrompt: formats instructions containing approved plan and craft constraints', () => {
  const { systemPrompt, userPrompt } = formatGeneratePrompt(sampleApprovedPlan, {
    name: 'Counter Demo',
    revision: 1,
    files: { 'src/App.tsx': { path: 'src/App.tsx' } },
  })

  assert.match(systemPrompt, /Paper Make App Generator/i)
  assert.match(systemPrompt, /#080808/)
  assert.match(systemPrompt, /#edebe1/)
  assert.match(systemPrompt, /#81adec/)
  assert.match(systemPrompt, /#222222/)
  assert.match(systemPrompt, /120px/i)
  assert.match(systemPrompt, /lucide-react/)
  assert.match(systemPrompt, /src\/App\.tsx/i)

  assert.match(userPrompt, /Add an interactive counter/i)
  assert.match(userPrompt, /Interactive counter with state hooks/i)
  assert.match(userPrompt, /Click increment increases/i)
})

test('parseModelGenerateResponse: validates and normalizes generated files', () => {
  const rawJson = JSON.stringify(validGeneratedCode)
  const parsed = parseModelGenerateResponse(rawJson)

  assert.equal(parsed.summary, 'Complete counter prototype with reactive buttons')
  assert.ok(parsed.files['src/App.tsx'])
  assert.ok(parsed.files['src/styles.css'])
  assert.equal(parsed.files['src/App.tsx'].path, 'src/App.tsx')
  assert.match(parsed.files['src/App.tsx'].content, /useState/)

  // Handles markdown codeblock wrapping
  const wrapped = `\`\`\`json\n${rawJson}\n\`\`\``
  const parsedWrapped = parseModelGenerateResponse(wrapped)
  assert.ok(parsedWrapped.files['src/App.tsx'])

  // Handles object map format: { files: { 'src/App.tsx': '...' } }
  const mapFormat = JSON.stringify({
    summary: 'Map format',
    files: {
      'src/App.tsx': validGeneratedCode.files[0].content,
      'src/styles.css': validGeneratedCode.files[1].content,
    },
  })
  const parsedMap = parseModelGenerateResponse(mapFormat)
  assert.ok(parsedMap.files['src/App.tsx'])
})

test('parseModelGenerateResponse: rejects invalid files, path traversal and missing entry points', () => {
  // Empty or non-JSON
  assert.throws(() => parseModelGenerateResponse(''), GenerationValidationError)
  assert.throws(() => parseModelGenerateResponse('not json'), GenerationValidationError)

  // Missing src/App.tsx entry point
  assert.throws(() => parseModelGenerateResponse(JSON.stringify({
    files: [{ path: 'src/styles.css', content: 'body {}' }],
  })), GenerationValidationError)

  // Path traversal
  assert.throws(() => parseModelGenerateResponse(JSON.stringify({
    files: [
      { path: '../evil.tsx', content: 'export default () => null' },
      { path: 'src/App.tsx', content: 'export default () => null' },
    ],
  })), GenerationValidationError)

  // Duplicate path
  assert.throws(() => parseModelGenerateResponse(JSON.stringify({
    files: [
      { path: 'src/App.tsx', content: 'export default () => 1' },
      { path: 'src/App.tsx', content: 'export default () => 2' },
    ],
  })), GenerationValidationError)

  // Prototype pollution attempt
  assert.throws(() => parseModelGenerateResponse(
    '{"__proto__":{"admin":true},"files":[{"path":"src/App.tsx","content":"export default () => null"}]}'
  ), GenerationValidationError)
})

test('store.generateFromApprovedPlan: requires an approved plan and rejects draft or stale plans', async () => {
  const initial = createAppProject({ id: 'proj-1', revision: 1, files: MAKE_FIXTURES.counter.files })
  const store = createMakeWorkspaceStore({
    initialProject: initial,
    planner: async (prompt, project) => createAppPlan({ ...sampleDraftPlan, prompt, appId: project.id, baseRevision: project.revision }),
  })

  // No plan set
  await assert.rejects(() => store.generateFromApprovedPlan(), /approved plan is required/i)

  // Draft plan (not yet approved)
  await store.generatePlan('Counter')
  assert.equal(store.getState().currentPlan.status, 'draft')
  await assert.rejects(() => store.generateFromApprovedPlan(), /approved plan is required/i)

  // Stale plan (revision mismatch)
  await store.approveCurrentPlan()
  assert.equal(store.getState().currentPlan.status, 'approved')
  // Advance project revision manually
  store.updateActiveFile('src/App.tsx', '// updated')
  await assert.rejects(() => store.generateFromApprovedPlan(), /stale/i)
})

test('store.generateFromApprovedPlan: successful generation advances revision, sets ready preview, and preserves plan and diagnostics', async () => {
  const initial = createAppProject({ id: 'proj-gen', revision: 1, files: MAKE_FIXTURES.counter.files })
  const fakeAssets = { entryPoint: 'src/App.tsx', js: 'console.log("ready")', css: '', html: '<html><body>preview</body></html>' }

  let generatorCalls = 0
  const store = createMakeWorkspaceStore({
    initialProject: initial,
    planner: async (prompt, project) => createAppPlan({ ...sampleDraftPlan, prompt, appId: project.id, baseRevision: project.revision }),
    generator: async (plan, project) => {
      generatorCalls++
      assert.equal(plan.planId, sampleDraftPlan.planId)
      assert.equal(project.id, initial.id)
      return {
        success: true,
        project: {
          ...project,
          revision: project.revision + 1,
          files: {
            ...project.files,
            'src/App.tsx': { path: 'src/App.tsx', content: validGeneratedCode.files[0].content },
          },
        },
        assets: fakeAssets,
        diagnostics: [],
        plan,
      }
    },
  })

  // Generate and approve plan
  await store.generatePlan('Add counter')
  await store.approveCurrentPlan()
  assert.equal(store.getState().planStatus, 'approved')

  // Run generation from approved plan
  const result = await store.generateFromApprovedPlan()
  assert.equal(generatorCalls, 1)
  assert.equal(result.success, true)

  const state = store.getState()
  // 1. Revision advanced
  assert.equal(state.activeProject.revision, 2)
  assert.match(state.activeProject.files['src/App.tsx'].content, /useState/)
  // 2. Preview is ready with assets
  assert.equal(state.previewStatus, 'ready')
  assert.deepEqual(state.assets, fakeAssets)
  // 3. Approved plan is preserved
  assert.ok(state.currentPlan)
  assert.equal(state.currentPlan.planId, sampleDraftPlan.planId)
  assert.equal(state.planStatus, 'approved')
  // 4. Diagnostics preserved
  assert.deepEqual(state.diagnostics, [])
})

test('store.generateFromApprovedPlan: invalid generation does NOT replace last usable revision and preserves diagnostics', async () => {
  const initial = createAppProject({ id: 'proj-fail', revision: 1, files: MAKE_FIXTURES.counter.files })
  const originalSource = initial.files['src/App.tsx'].content

  const syntaxErrorDiagnostic = {
    file: 'src/App.tsx',
    line: 12,
    column: 5,
    message: 'Unexpected token, expected "}"',
    severity: 'error',
    code: 'SYNTAX_ERROR',
  }

  const store = createMakeWorkspaceStore({
    initialProject: initial,
    planner: async (prompt, project) => createAppPlan({ ...sampleDraftPlan, prompt, appId: project.id, baseRevision: project.revision }),
    generator: async (plan, project) => {
      // Mock compiler validation failure
      return {
        success: false,
        project, // unchanged
        assets: null,
        diagnostics: [syntaxErrorDiagnostic],
        plan,
        error: 'Generated code failed compilation validation',
      }
    },
  })

  // Generate and approve plan
  await store.generatePlan('Add counter')
  await store.approveCurrentPlan()
  assert.equal(store.getState().planStatus, 'approved')

  // Run generation
  const result = await store.generateFromApprovedPlan()
  assert.equal(result.success, false)

  const state = store.getState()
  // CRITICAL ACCEPTANCE CHECK:
  // Last usable revision is NOT replaced!
  assert.equal(state.activeProject.revision, 1)
  assert.equal(state.activeProject.files['src/App.tsx'].content, originalSource)
  // Preview status reports error
  assert.equal(state.previewStatus, 'error')
  assert.equal(state.assets, null)
  // Diagnostics are populated and preserved
  assert.equal(state.diagnostics.length, 1)
  assert.equal(state.diagnostics[0].code, 'SYNTAX_ERROR')
  assert.equal(state.diagnostics[0].file, 'src/App.tsx')
  // Approved plan remains preserved
  assert.ok(state.currentPlan)
  assert.equal(state.currentPlan.planId, sampleApprovedPlan.planId)
  assert.equal(state.planStatus, 'approved')
})

test('failed generation retains a running usable preview and its approved plan', async () => {
  const assets = { entryPoint: 'src/App.tsx', js: 'ready', css: '', html: '<p>Usable</p>' }
  const diagnostic = { file: 'src/App.tsx', line: 1, column: 1, code: 'SYNTAX_ERROR', severity: 'error', message: 'Broken generated source' }
  const store = createMakeWorkspaceStore({
    initialProject: MAKE_FIXTURES.counter,
    compiler: async () => ({ success: true, assets, diagnostics: [] }),
    planner: async (prompt, project) => createAppPlan({ ...sampleDraftPlan, prompt, appId: project.id, baseRevision: project.revision }),
    generator: async plan => ({ success: false, assets: null, diagnostics: [diagnostic], plan }),
  })
  await store.runPreview()
  await store.generatePlan('Counter')
  const approved = await store.approveCurrentPlan()
  const project = store.getState().activeProject
  await store.generateFromApprovedPlan()
  assert.equal(store.getState().activeProject, project)
  assert.equal(store.getState().assets, assets)
  assert.equal(store.getState().previewStatus, 'ready')
  assert.deepEqual(store.getState().currentPlan, approved)
  assert.deepEqual(store.getState().diagnostics, [diagnostic])
})

test('generation supersedes an older preview compilation and ignores its late result', async () => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  const assets = { entryPoint: 'src/App.tsx', js: 'generated', css: '', html: '<p>New</p>' }
  const store = createMakeWorkspaceStore({
    compiler: () => pending,
    planner: async (prompt, project) => createAppPlan({ ...sampleDraftPlan, prompt, appId: project.id, baseRevision: project.revision }),
    generator: async plan => ({ success: true, files: MAKE_FIXTURES.counter.files, assets, diagnostics: [], plan }),
  })
  const preview = store.runPreview()
  await store.generatePlan('Counter')
  await store.approveCurrentPlan()
  await store.generateFromApprovedPlan()
  release({ success: false, assets: null, diagnostics: [] })
  await preview
  assert.equal(store.getState().assets, assets)
  assert.equal(store.getState().previewStatus, 'ready')
})

test('cancelled generation and project switches ignore late output without discarding approval or usable assets', async () => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  const assets = { entryPoint: 'src/App.tsx', js: 'ready', css: '', html: '<p>Ready</p>' }
  const store = createMakeWorkspaceStore({
    compiler: async () => ({ success: true, assets, diagnostics: [] }),
    planner: async (prompt, project) => createAppPlan({ ...sampleDraftPlan, prompt, appId: project.id, baseRevision: project.revision }),
    generator: () => pending,
  })
  await store.runPreview()
  await store.generatePlan('Counter')
  const plan = await store.approveCurrentPlan()
  const generating = store.generateFromApprovedPlan()
  store.cancelAppGeneration()
  assert.deepEqual(store.getState().currentPlan, plan)
  assert.equal(store.getState().previewStatus, 'ready')
  assert.equal(store.getState().assets, assets)
  store.selectProject(MAKE_FIXTURES.empty)
  release({ success: true, assets, diagnostics: [], plan, files: MAKE_FIXTURES.counter.files })
  assert.equal(await generating, null)
  assert.equal(store.getState().activeProject, MAKE_FIXTURES.empty)
  assert.equal(store.getState().assets, null)
})

test('store never applies a failed validation even if transport claims success, and clears report on project switch', async () => {
  const validation = { status: 'failed', maxAttempts: 2, attempts: [{ attempt: 1, status: 'failed', diagnostics: [], viewports: [] }], message: 'Runtime failed' }
  const store = createMakeWorkspaceStore({
    initialProject: MAKE_FIXTURES.counter,
    planner: async (prompt, project) => createAppPlan({ ...sampleDraftPlan, prompt, appId: project.id, baseRevision: project.revision }),
    generator: async plan => ({ success: true, assets: { html: '<main>Broken</main>', js: '', css: '', entryPoint: 'src/App.tsx' }, diagnostics: [], plan, validation }),
  })
  await store.generatePlan('Counter')
  await store.approveCurrentPlan()
  const result = await store.generateFromApprovedPlan()
  assert.equal(result.success, false)
  assert.equal(store.getState().activeProject.revision, 1)
  assert.equal(store.getState().assets, null)
  assert.deepEqual(store.getState().validation, validation)
  store.createNewProject()
  assert.equal(store.getState().validation, null)
})
