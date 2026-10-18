import test from 'node:test'
import assert from 'node:assert/strict'
import {
  validateAppPlan,
  approvePlan,
  isPlanStale,
  PlanValidationError,
  StalePlanApprovalError,
  createAppPlan,
  parseModelPlanResponse,
} from '../src/make/plan.ts'
import {
  MAKE_FIXTURES,
  createMakeWorkspaceStore,
} from '../src/make/workspace-model.ts'

test('validateAppPlan: validates concise app plan with files, interactions, risks', () => {
  const validPlan = {
    planId: 'plan_123',
    appId: 'counter-app',
    baseRevision: 1,
    prompt: 'Add a dark mode toggle button to the top right of the counter',
    summary: 'Add a persistent dark mode toggle with smooth CSS transitions',
    files: [
      { path: 'src/App.tsx', description: 'Add theme state and toggle button', action: 'modify' },
      { path: 'src/styles.css', description: 'Add dark/light theme CSS variables', action: 'modify' },
    ],
    interactions: [
      'Clicking theme button toggles between light and dark modes',
      'Active mode indicator updates with Moon and Sun icons',
    ],
    risks: [
      'Theme preference is stored in React state only unless localStorage is bridged',
      'Contrast must meet WCAG AA standards in both modes',
    ],
    status: 'draft',
    createdAt: '2026-10-15T00:00:00.000Z',
  }

  const validated = validateAppPlan(validPlan)
  assert.equal(validated.planId, 'plan_123')
  assert.equal(validated.baseRevision, 1)
  assert.equal(validated.files.length, 2)
  assert.equal(validated.interactions.length, 2)
  assert.equal(validated.risks.length, 2)
  assert.equal(validated.status, 'draft')
})

test('validateAppPlan: rejects malformed plans, path traversal, and prototype pollution', () => {
  // Missing required fields
  assert.throws(() => validateAppPlan(null), PlanValidationError)
  assert.throws(() => validateAppPlan({}), PlanValidationError)
  assert.throws(() => validateAppPlan({ prompt: 'test' }), PlanValidationError)

  // Empty files array
  assert.throws(() => validateAppPlan({
    planId: 'p1', baseRevision: 1, prompt: 'test', summary: 'test',
    files: [], interactions: ['click button'], risks: ['none'], status: 'draft', createdAt: new Date().toISOString(),
  }), PlanValidationError)

  // Path traversal in file target
  assert.throws(() => validateAppPlan({
    planId: 'p2', baseRevision: 1, prompt: 'test', summary: 'test',
    files: [{ path: '../etc/passwd', description: 'bad file' }],
    interactions: ['click'], risks: ['none'], status: 'draft', createdAt: new Date().toISOString(),
  }), /path/i)

  // Absolute path in file target
  assert.throws(() => validateAppPlan({
    planId: 'p3', baseRevision: 1, prompt: 'test', summary: 'test',
    files: [{ path: '/root/App.tsx', description: 'bad file' }],
    interactions: ['click'], risks: ['none'], status: 'draft', createdAt: new Date().toISOString(),
  }), /path/i)

  // Missing interactions
  assert.throws(() => validateAppPlan({
    planId: 'p4', baseRevision: 1, prompt: 'test', summary: 'test',
    files: [{ path: 'src/App.tsx', description: 'good' }],
    interactions: [], risks: ['risk1'], status: 'draft', createdAt: new Date().toISOString(),
  }), /interaction/i)

  // Negative revision
  assert.throws(() => validateAppPlan({
    planId: 'p5', baseRevision: -1, prompt: 'test', summary: 'test',
    files: [{ path: 'src/App.tsx', description: 'good' }],
    interactions: ['interaction1'], risks: ['risk1'], status: 'draft', createdAt: new Date().toISOString(),
  }), /revision/i)

  // Prototype pollution attempt
  assert.throws(() => validateAppPlan(JSON.parse('{"__proto__": {"polluted": true}}')), PlanValidationError)
})

test('approvePlan: approves matching revision and rejects stale approvals', () => {
  const plan = createAppPlan({
    appId: 'counter-app',
    baseRevision: 2,
    prompt: 'Add reset confirmation dialog',
    summary: 'Prompt user before resetting counter',
    files: [{ path: 'src/App.tsx', description: 'Add confirm dialog', action: 'modify' }],
    interactions: ['Clicking Reset opens modal', 'Clicking Confirm sets count to 0'],
    risks: ['Modal accessibility requires focus trap and Esc handling'],
  })

  assert.equal(plan.status, 'draft')
  assert.equal(isPlanStale(plan, 2), false)
  assert.equal(isPlanStale(plan, 3), true)

  // Approve when current revision matches baseRevision (2 === 2)
  const approved = approvePlan(plan, 2)
  assert.equal(approved.status, 'approved')
  assert.ok(approved.approvedAt)
  assert.equal(approved.baseRevision, 2)

  // Reject approval when revision has advanced (stale approval)
  assert.throws(() => approvePlan(plan, 3), StalePlanApprovalError)
  assert.throws(() => approvePlan(plan, 1), StalePlanApprovalError)
})

test('parseModelPlanResponse: parses raw model text into valid AppPlan without writing files', () => {
  const modelOutput = JSON.stringify({
    summary: 'Create interactive stopwatch with lap timing',
    files: [
      { path: 'src/App.tsx', description: 'Stopwatch display and lap list', action: 'modify' },
      { path: 'src/styles.css', description: 'Lap list grid styling', action: 'modify' },
    ],
    interactions: [
      'Start/Stop toggles interval timer',
      'Lap button records current elapsed timestamp',
      'Reset button clears elapsed time and lap list',
    ],
    risks: [
      'requestAnimationFrame or setInterval drift if tab is backgrounded',
      'High frequency updates should avoid unnecessary re-renders',
    ],
  })

  const plan = parseModelPlanResponse(modelOutput, {
    prompt: 'Build a stopwatch with lap timer',
    appId: 'app-stopwatch',
    baseRevision: 1,
  })

  assert.equal(plan.summary, 'Create interactive stopwatch with lap timing')
  assert.equal(plan.baseRevision, 1)
  assert.equal(plan.files.length, 2)
  assert.equal(plan.interactions.length, 3)
  assert.equal(plan.risks.length, 2)
  assert.equal(plan.status, 'draft')
})

test('Make workspace store: plan-only mode leaves project revision and files unchanged', async () => {
  const initialProject = MAKE_FIXTURES.counter
  const originalRevision = initialProject.revision
  const originalFiles = JSON.stringify(initialProject.files)

  const mockPlanner = async (prompt, project) => {
    return createAppPlan({
      appId: project.id,
      baseRevision: project.revision,
      prompt,
      summary: `Planned changes for: ${prompt}`,
      files: [{ path: 'src/App.tsx', description: 'Update counter', action: 'modify' }],
      interactions: ['User interacts with new feature'],
      risks: ['Edge cases considered'],
    })
  }

  const store = createMakeWorkspaceStore({
    initialProject,
    planner: mockPlanner,
  })

  assert.equal(store.getState().planMode, 'idle')
  assert.equal(store.getState().currentPlan, null)

  // Generate a plan
  await store.generatePlan('Add a sound effect when incrementing')

  const state = store.getState()
  assert.equal(state.planMode, 'inspecting')
  assert.ok(state.currentPlan !== null)
  assert.equal(state.currentPlan.summary, 'Planned changes for: Add a sound effect when incrementing')
  assert.equal(state.currentPlan.baseRevision, originalRevision)

  // CRITICAL ACCEPTANCE CHECK: Plan-only leaves revision and files unchanged
  assert.equal(state.activeProject.revision, originalRevision, 'Revision must NOT change during planning')
  assert.equal(JSON.stringify(state.activeProject.files), originalFiles, 'Files must NOT change during planning')

  // User approves the plan
  await store.approveCurrentPlan()
  assert.equal(store.getState().currentPlan.status, 'approved')
  assert.equal(store.getState().activeProject.revision, originalRevision, 'Revision still unchanged after approval')
  assert.equal(JSON.stringify(store.getState().activeProject.files), originalFiles, 'Files still unchanged after approval')
})

test('Make workspace store: detects stale approval after project file edits and rejects approval', async () => {
  const store = createMakeWorkspaceStore({
    initialProject: MAKE_FIXTURES.counter,
    planner: async (prompt, project) => createAppPlan({
      appId: project.id,
      baseRevision: project.revision,
      prompt,
      summary: 'Add feature',
      files: [{ path: 'src/App.tsx', description: 'Edit', action: 'modify' }],
      interactions: ['Click'],
      risks: ['Risk'],
    }),
  })

  await store.generatePlan('Add feature')
  assert.equal(store.getState().currentPlan.baseRevision, store.getState().activeProject.revision)

  // Simulate a project edit that bumps the revision
  store.updateActiveFile('src/App.tsx', 'export default function App() { return <div>Edited App</div> }')
  // Project revision or files changed
  const bumpedProject = { ...store.getState().activeProject, revision: store.getState().activeProject.revision + 1 }
  store.selectProject(bumpedProject)

  // Attempting to approve the stale plan must be rejected
  await assert.rejects(store.approveCurrentPlan(), StalePlanApprovalError)
  assert.equal(store.getState().planStatus, 'stale')
  assert.match(store.getState().planError, /stale/i)
})

test('Make workspace store: revising a plan updates prompt and regenerates plan cleanly', async () => {
  let promptReceived = ''
  const store = createMakeWorkspaceStore({
    initialProject: MAKE_FIXTURES.counter,
    planner: async (prompt, project) => {
      promptReceived = prompt
      return createAppPlan({
        appId: project.id,
        baseRevision: project.revision,
        prompt,
        summary: `Plan: ${prompt}`,
        files: [{ path: 'src/App.tsx', description: 'Update', action: 'modify' }],
        interactions: ['Interact'],
        risks: ['Risk'],
      })
    },
  })

  await store.generatePlan('Initial plan idea')
  assert.equal(promptReceived, 'Initial plan idea')
  assert.equal(store.getState().currentPlan.summary, 'Plan: Initial plan idea')

  // Revise plan
  await store.reviseCurrentPlan('Revised idea with better layout')
  assert.equal(promptReceived, 'Revised idea with better layout')
  assert.equal(store.getState().currentPlan.summary, 'Plan: Revised idea with better layout')
  assert.equal(store.getState().planMode, 'inspecting')
})

const modelPlan = {
  summary: 'Add a reset button',
  files: [{ path: 'src/App.tsx', description: 'Reset counter state', action: 'modify' }],
  interactions: ['Reset returns the count to zero'],
  risks: [],
}
const planner = async (prompt, project) => createAppPlan({ ...modelPlan, prompt, appId: project.id, baseRevision: project.revision })

test('model plan parsing rejects incomplete output instead of inventing an approvable plan', () => {
  for (const output of [{}, { ...modelPlan, files: [null] }, { ...modelPlan, interactions: [{}] },
    { ...modelPlan, files: [{ ...modelPlan.files[0], action: 'execute' }] },
    { ...modelPlan, files: [{ ...modelPlan.files[0], content: 'unrequested code' }] },
    { ...modelPlan, files: [modelPlan.files[0], modelPlan.files[0]] },
    { ...modelPlan, risks: 'none' }, { ...modelPlan, artifact: 'code' }]) {
    assert.throws(() => parseModelPlanResponse(JSON.stringify(output), { prompt: 'Reset', baseRevision: 1 }), PlanValidationError)
  }
})

test('manual edits invalidate approval even before the saved revision increments', async () => {
  const store = createMakeWorkspaceStore({ planner })
  await store.generatePlan('Reset')
  store.updateActiveFile('src/App.tsx', 'export default function App() { return null }')
  await assert.rejects(async () => store.approveCurrentPlan(), StalePlanApprovalError)
})

test('same-revision project switches cannot approve a different project plan', async () => {
  const store = createMakeWorkspaceStore({ planner })
  await store.generatePlan('Reset')
  store.selectProject({ ...MAKE_FIXTURES.counter, id: 'another-app' })
  assert.equal(store.getState().currentPlan, null)
  assert.equal(await store.approveCurrentPlan(), null)
})

test('late planning responses cannot cross projects or resurrect dismissed plans', async () => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  const store = createMakeWorkspaceStore({ planner: async (...args) => { await pending; return planner(...args) } })
  const generating = store.generatePlan('Reset')
  store.createNewProject()
  release()
  await generating
  assert.equal(store.getState().currentPlan, null)
  assert.equal(store.getState().planStatus, 'idle')
})

test('malformed injected planner output is never shown for approval', async () => {
  const store = createMakeWorkspaceStore({ planner: async () => ({ summary: 'Broken' }) })
  assert.equal(await store.generatePlan('Reset'), null)
  assert.equal(store.getState().currentPlan, null)
  assert.match(store.getState().planError, /plan/i)
})

test('draft planning uses the account endpoint without saving an artifact', async t => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, ...options })
    return Response.json({ plan: createAppPlan({ ...modelPlan, prompt: 'Reset', baseRevision: 0 }) })
  }
  const store = createMakeWorkspaceStore({ accountId: 'alice' })
  const before = JSON.stringify(store.getState().activeProject)
  await store.generatePlan('Reset')
  assert.equal(calls[0].url, '/api/model/plan')
  assert.equal(calls[0].headers['X-Paper-Account'], 'alice')
  assert.equal(calls.length, 1)
  assert.equal(JSON.stringify(store.getState().activeProject), before)
})

test('failed server approval stays unapproved and exposes the failure', async t => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const project = MAKE_FIXTURES.counter
  globalThis.fetch = async () => Response.json({ error: 'Stale plan approval' }, { status: 409 })
  const store = createMakeWorkspaceStore({ planner, repository: { list: async () => [project] } })
  await store.loadProjects()
  await store.generatePlan('Reset')
  await assert.rejects(async () => store.approveCurrentPlan(), /stale/i)
  assert.equal(store.getState().currentPlan.status, 'draft')
  assert.equal(store.getState().planStatus, 'stale')
  assert.match(store.getState().planError, /stale/i)
})

// Exercise real UI handlers using the repository's auth-session hook harness pattern.
// Browser focus/layout remains covered by e2e/make-prompt-plan.spec.ts.
async function inspectionHarness(overrides = {}) {
  const [{ readFile }, { default: ts }, jsx, icons, plans] = await Promise.all([
    import('node:fs/promises'), import('typescript'), import('react/jsx-runtime'), import('lucide-react'), import('../src/make/plan.ts'),
  ])
  const slots = [], events = []
  let cursor = 0
  const react = {
    useState(initial) {
      const i = cursor++
      slots[i] ??= { value: initial }
      return [slots[i].value, value => { slots[i].value = value }]
    },
    useRef(initial) { const i = cursor++; slots[i] ??= { current: initial }; return slots[i] },
    useEffect() {},
  }
  const source = ts.transpileModule(await readFile(new URL('../src/make/PlanInspection.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const exports = {}
  const imports = { react, 'react/jsx-runtime': jsx, 'lucide-react': icons, './plan.ts': plans }
  new Function('require', 'exports', source)(name => { assert.ok(imports[name], name); return imports[name] }, exports)
  const props = {
    plan: createAppPlan({ ...modelPlan, prompt: 'Reset', baseRevision: 1 }),
    currentRevision: 1, planStatus: 'idle', planError: '',
    onApprove: () => events.push('approve'), onRevise: prompt => events.push(prompt), onDismiss: () => events.push('dismiss'),
    ...overrides,
  }
  const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree?.props ? [tree, ...nodes(tree.props.children)] : []
  const render = () => { cursor = 0; return exports.PlanInspection(props) }
  const find = predicate => nodes(render()).find(predicate)
  const text = tree => typeof tree === 'string' ? tree : Array.isArray(tree) ? tree.map(text).join('') : tree?.props ? text(tree.props.children) : ''
  const button = label => find(node => node.type === 'button' && (node.props['aria-label'] === label || text(node) === label))
  return { props, events, render, find, button }
}

test('inspection UI exposes named lists and keyboard revision form with guarded empty submission', async () => {
  const h = await inspectionHarness()
  const card = h.render()
  assert.equal(card.props.role, 'region')
  assert.equal(card.props['aria-label'], 'App plan')
  assert.equal(card.props.tabIndex, -1)
  for (const name of ['Planned files list', 'Planned interactions list', 'Planned risks list']) {
    assert.ok(h.find(node => node.type === 'ul' && node.props['aria-label'] === name))
  }
  h.button('Revise plan').props.onClick()
  const input = h.find(node => node.type === 'input')
  assert.equal(input.props.id, 'plan-revise-input')
  assert.ok(h.find(node => node.type === 'label' && node.props.htmlFor === input.props.id))
  assert.equal(input.props.autoFocus, true)
  assert.equal(h.button('Update plan').props.disabled, true)
  h.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
  assert.deepEqual(h.events, [])
  input.props.onChange({ target: { value: 'Reset with confirmation' } })
  assert.equal(h.button('Update plan').props.disabled, false)
  h.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
  assert.deepEqual(h.events, ['Reset with confirmation'])
})

test('inspection disables approval while busy, stale or approved and exposes errors as alerts', async () => {
  const h = await inspectionHarness()
  assert.equal(h.button('Approve plan').props.disabled, false)
  h.button('Approve plan').props.onClick()
  assert.deepEqual(h.events, ['approve'])
  h.props.busy = true
  assert.equal(h.render().props['aria-busy'], true)
  for (const name of ['Approve plan', 'Revise plan', 'Dismiss plan']) assert.equal(h.button(name).props.disabled, true)
  h.props.busy = false
  h.props.currentRevision = 2
  assert.equal(h.button('Approve plan').props.disabled, true)
  assert.ok(h.find(node => node.props.role === 'alert'))
  h.props.currentRevision = 1
  h.props.planStatus = 'approved'
  assert.equal(h.button('Approve plan').props.disabled, true)
  assert.ok(h.find(node => node.props.role === 'status'))
  h.props.planStatus = 'idle'
  h.props.planError = 'Approval failed. Try again.'
  assert.ok(h.find(node => node.props.role === 'alert'))
})

test('dismissal and newer prompts discard late plans without replacing the current plan', async () => {
  const pending = []
  const store = createMakeWorkspaceStore({ planner: (...args) => new Promise(resolve => pending.push(async () => resolve(await planner(...args)))) })
  const first = store.generatePlan('First')
  const second = store.generatePlan('Second')
  await pending[1]()
  await second
  await pending[0]()
  await first
  assert.equal(store.getState().currentPlan.prompt, 'Second')
  const third = store.generatePlan('Third')
  store.clearPlan()
  await pending[2]()
  await third
  assert.equal(store.getState().currentPlan, null)
  assert.equal(store.getState().planStatus, 'idle')
})

test('pending server approvals cannot survive a manual edit or be submitted twice', async t => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  let release, count = 0
  const pending = new Promise(resolve => { release = resolve })
  globalThis.fetch = async () => { count++; return pending }
  const project = MAKE_FIXTURES.counter
  const store = createMakeWorkspaceStore({ planner, repository: { list: async () => [project] } })
  await store.loadProjects()
  await store.generatePlan('Reset')
  const plan = store.getState().currentPlan
  const approval = store.approveCurrentPlan()
  assert.equal(store.getState().planStatus, 'approving')
  assert.equal(await store.approveCurrentPlan(), null)
  assert.equal(count, 1)
  store.updateActiveFile('src/App.tsx', 'export default function App() { return null }')
  release(Response.json({ ok: true, plan: approvePlan(plan, project.revision), approvedAt: new Date().toISOString() }))
  assert.equal(await approval, null)
  assert.equal(store.getState().planStatus, 'stale')
  assert.equal(store.getState().currentPlan.status, 'draft')
})
