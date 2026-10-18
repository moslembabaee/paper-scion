import test from 'node:test'
import assert from 'node:assert/strict'
import {
  VALIDATION_LIMITS,
  boundedDiagnostics,
  createValidationReport,
  formatValidationSummary,
  isValidationPassing,
} from '../src/make/validation.ts'
import {
  createMakeWorkspaceStore,
  MAKE_FIXTURES,
  formatDiagnostic,
} from '../src/make/workspace-model.ts'
import { createAppPlan, approvePlan } from '../src/make/plan.ts'
import { createAppProject } from '../src/make/manifest.ts'
import { redactSensitiveText } from '../src/make/model-protocol.ts'

const sampleDraftPlan = createAppPlan({
  planId: 'plan_val_01',
  appId: 'validation-test-app',
  baseRevision: 1,
  prompt: 'Fix crash in counter on click',
  summary: 'Repair runtime error and ensure mobile viewport layout',
  files: [{ path: 'src/App.tsx', description: 'Counter component', action: 'modify' }],
  interactions: ['Click button without crashing'],
  risks: ['Runtime exception during render or interaction'],
})

test('VALIDATION_LIMITS enforces strict bounding constants', () => {
  assert.equal(VALIDATION_LIMITS.maxAttempts, 2)
  assert.equal(VALIDATION_LIMITS.timeoutMs, 15000)
  assert.equal(VALIDATION_LIMITS.maxDiagnostics, 8)
  assert.equal(VALIDATION_LIMITS.maxMessageChars, 500)
  assert.equal(VALIDATION_LIMITS.maxScreenshotBytes, 12000)
  assert.equal(Object.isFrozen(VALIDATION_LIMITS), true)
})

test('boundedDiagnostics: redacts credentials, strips image payloads, truncates length and count', () => {
  const noisyDiagnostics = Array.from({ length: 20 }, (_, index) => ({
    file: `src/components/DeeplyNestedComponent${index}.tsx`,
    line: index + 1,
    column: 1,
    code: 'RUNTIME_ERROR',
    severity: 'error',
    message: `Crash at index ${index} with secret sk-live-secret-key-12345678 and data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg== ` + 'z'.repeat(1000),
  }))

  const bounded = boundedDiagnostics(noisyDiagnostics, redactSensitiveText)

  // Max diagnostics capped at 8
  assert.equal(bounded.length, 8)
  for (const d of bounded) {
    // Truncated to maxMessageChars (500)
    assert.ok(d.message.length <= 500)
    // Redacts API key
    assert.doesNotMatch(d.message, /sk-live-secret/)
    // Replaces raw image data URL with placeholder
    assert.doesNotMatch(d.message, /data:image\/png/)
    assert.match(d.message, /\[image omitted\]/)
  }
})

test('createValidationReport: builds structured report for pass, fail, and blocked', () => {
  const passingAttempt = {
    attempt: 1,
    status: 'passed',
    diagnostics: [],
    viewports: [
      { viewport: 'desktop', width: 1280, height: 800, screenshotBytes: 4500 },
      { viewport: 'mobile', width: 390, height: 844, screenshotBytes: 2800 },
    ],
  }

  const passedReport = createValidationReport([passingAttempt], 'passed')
  assert.equal(passedReport.status, 'passed')
  assert.equal(passedReport.maxAttempts, 2)
  assert.equal(passedReport.attempts.length, 1)
  assert.match(passedReport.message, /passed/i)
  assert.equal(isValidationPassing(passedReport), true)

  const failedAttempt1 = {
    attempt: 1,
    status: 'failed',
    diagnostics: [{ file: 'src/App.tsx', line: 10, column: 1, code: 'RUNTIME_ERROR', severity: 'error', message: 'TypeError: undefined is not a function' }],
    viewports: [{ viewport: 'desktop', width: 1280, height: 800, screenshotBytes: 3000 }],
  }
  const failedAttempt2 = {
    attempt: 2,
    status: 'failed',
    diagnostics: [{ file: 'src/App.tsx', line: 10, column: 1, code: 'RUNTIME_ERROR', severity: 'error', message: 'ReferenceError: button is not defined' }],
    viewports: [{ viewport: 'desktop', width: 1280, height: 800, screenshotBytes: 3100 }],
  }

  const exhaustedReport = createValidationReport([failedAttempt1, failedAttempt2], 'failed')
  assert.equal(exhaustedReport.status, 'failed')
  assert.equal(exhaustedReport.attempts.length, 2)
  assert.match(exhaustedReport.message, /exhausted/i)
  assert.equal(isValidationPassing(exhaustedReport), false)

  const blockedAttempt = {
    attempt: 1,
    status: 'blocked',
    diagnostics: [{ file: 'src/App.tsx', line: 1, column: 1, code: 'VALIDATION_BLOCKED', severity: 'error', message: 'Validation timed out.' }],
    viewports: [],
  }
  const blockedReport = createValidationReport([blockedAttempt], 'blocked')
  assert.equal(blockedReport.status, 'blocked')
  assert.match(blockedReport.message, /blocked/i)
  assert.equal(isValidationPassing(blockedReport), false)
})

test('formatValidationSummary: provides clean craft summary for status bar', () => {
  const summaryPassed = formatValidationSummary({
    status: 'passed',
    maxAttempts: 2,
    attempts: [{ attempt: 1, status: 'passed', diagnostics: [], viewports: [] }],
    message: 'Passed',
  })
  assert.match(summaryPassed, /Validated · 1\/2/i)

  const summaryRepaired = formatValidationSummary({
    status: 'passed',
    maxAttempts: 2,
    attempts: [
      { attempt: 1, status: 'failed', diagnostics: [], viewports: [] },
      { attempt: 2, status: 'passed', diagnostics: [], viewports: [] },
    ],
    message: 'Repaired',
  })
  assert.match(summaryRepaired, /Repaired · 2\/2/i)

  const summaryFailed = formatValidationSummary({
    status: 'failed',
    maxAttempts: 2,
    attempts: [
      { attempt: 1, status: 'failed', diagnostics: [], viewports: [] },
      { attempt: 2, status: 'failed', diagnostics: [], viewports: [] },
    ],
    message: 'Exhausted',
  })
  assert.match(summaryFailed, /Failed · 2\/2/i)
})

test('formatDiagnostic: handles RUNTIME_ERROR, VISUAL_ERROR, and VALIDATION_BLOCKED with craft hints', () => {
  const runtimeItem = formatDiagnostic({
    file: 'src/App.tsx',
    line: 14,
    column: 3,
    code: 'RUNTIME_ERROR',
    severity: 'error',
    message: 'Uncaught TypeError: count.toFixed is not a function',
  })
  assert.equal(runtimeItem.title, 'Runtime Error')
  assert.match(runtimeItem.actionableHint, /render error/i)

  const visualItem = formatDiagnostic({
    file: 'src/App.tsx',
    line: 1,
    column: 1,
    code: 'VISUAL_ERROR',
    severity: 'error',
    message: 'mobile: Content overflows the viewport horizontally.',
  })
  assert.equal(visualItem.title, 'Layout Error')
  assert.match(visualItem.actionableHint, /responsive/i)

  const blockedItem = formatDiagnostic({
    file: 'src/App.tsx',
    line: 1,
    column: 1,
    code: 'VALIDATION_BLOCKED',
    severity: 'error',
    message: 'Validation capacity is busy. Try again after the active checks finish.',
  })
  assert.equal(blockedItem.title, 'Validation Blocked')
  assert.match(blockedItem.actionableHint, /validation blocker/i)
})

test('workspace store: runtime error on candidate 1 repaired on candidate 2 advances revision and updates validation state', async () => {
  const initial = createAppProject({ id: 'proj-val-repair', revision: 1, files: MAKE_FIXTURES.counter.files })
  const fakeAssets = { entryPoint: 'src/App.tsx', js: 'console.log("repaired")', css: '', html: '<html><body>Repaired App</body></html>' }

  let attempts = 0
  const store = createMakeWorkspaceStore({
    initialProject: initial,
    planner: async (prompt, project) => createAppPlan({ ...sampleDraftPlan, prompt, appId: project.id, baseRevision: project.revision }),
    generator: async plan => {
      attempts++
      if (attempts === 1) {
        // Attempt 1: runtime error
        return {
          success: false,
          assets: null,
          diagnostics: [{ file: 'src/App.tsx', line: 12, column: 5, code: 'RUNTIME_ERROR', severity: 'error', message: 'TypeError: crash on start' }],
          plan,
          validation: {
            status: 'failed',
            maxAttempts: 2,
            attempts: [{
              attempt: 1,
              status: 'failed',
              diagnostics: [{ file: 'src/App.tsx', line: 12, column: 5, code: 'RUNTIME_ERROR', severity: 'error', message: 'TypeError: crash on start' }],
              viewports: [{ viewport: 'desktop', width: 1280, height: 800, screenshotBytes: 3200 }],
            }],
            message: 'Validation failed. One repair attempt remains.',
          },
        }
      }
      // Attempt 2: repaired successfully
      return {
        success: true,
        project: {
          ...initial,
          revision: 2,
          files: {
            ...initial.files,
            'src/App.tsx': { path: 'src/App.tsx', content: 'export default () => <main>Repaired</main>' },
          },
        },
        assets: fakeAssets,
        diagnostics: [],
        plan,
        validation: {
          status: 'passed',
          maxAttempts: 2,
          attempts: [
            {
              attempt: 1,
              status: 'failed',
              diagnostics: [{ file: 'src/App.tsx', line: 12, column: 5, code: 'RUNTIME_ERROR', severity: 'error', message: 'TypeError: crash on start' }],
              viewports: [{ viewport: 'desktop', width: 1280, height: 800, screenshotBytes: 3200 }],
            },
            {
              attempt: 2,
              status: 'passed',
              diagnostics: [],
              viewports: [
                { viewport: 'desktop', width: 1280, height: 800, screenshotBytes: 4100 },
                { viewport: 'mobile', width: 390, height: 844, screenshotBytes: 2500 },
              ],
            },
          ],
          message: 'Build and desktop/mobile render checks passed.',
        },
      }
    },
  })

  await store.generatePlan('Fix counter crash')
  await store.approveCurrentPlan()

  // First run fails candidate 1
  const firstResult = await store.generateFromApprovedPlan()
  assert.equal(firstResult.success, false)
  assert.equal(store.getState().activeProject.revision, 1) // unchanged
  assert.equal(store.getState().validation?.status, 'failed')
  assert.equal(store.getState().validation?.attempts.length, 1)

  // Repair run succeeds candidate 2
  const secondResult = await store.generateFromApprovedPlan()
  assert.equal(secondResult.success, true)
  assert.equal(store.getState().activeProject.revision, 2) // advanced
  assert.equal(store.getState().validation?.status, 'passed')
  assert.equal(store.getState().validation?.attempts.length, 2)
  assert.equal(store.getState().previewStatus, 'ready')
})

test('workspace store: persistent runtime error stops at fixed retry budget of 2 attempts and never overwrites revision', async () => {
  const initial = createAppProject({ id: 'proj-val-fail', revision: 1, files: MAKE_FIXTURES.counter.files })
  const originalSource = initial.files['src/App.tsx'].content

  let generatorCount = 0
  const store = createMakeWorkspaceStore({
    initialProject: initial,
    planner: async (prompt, project) => createAppPlan({ ...sampleDraftPlan, prompt, appId: project.id, baseRevision: project.revision }),
    generator: async plan => {
      generatorCount++
      return {
        success: false,
        assets: null,
        diagnostics: [{ file: 'src/App.tsx', line: 5, column: 1, code: 'RUNTIME_ERROR', severity: 'error', message: 'Uncaught error' }],
        plan,
        error: 'Validation failed after 2 candidates. Repair budget exhausted. The previous revision is unchanged.',
        validation: {
          status: 'failed',
          maxAttempts: 2,
          attempts: [
            { attempt: 1, status: 'failed', diagnostics: [], viewports: [] },
            { attempt: 2, status: 'failed', diagnostics: [], viewports: [] },
          ],
          message: 'Validation failed after 2 candidates. Repair budget exhausted.',
        },
      }
    },
  })

  await store.generatePlan('Broken prompt')
  await store.approveCurrentPlan()
  const result = await store.generateFromApprovedPlan()

  assert.equal(result.success, false)
  // Working revision is completely untouched
  assert.equal(store.getState().activeProject.revision, 1)
  assert.equal(store.getState().activeProject.files['src/App.tsx'].content, originalSource)
  // Validation reflects exhausted budget
  assert.equal(store.getState().validation?.status, 'failed')
  assert.equal(store.getState().validation?.attempts.length, 2)
  assert.match(store.getState().errorMessage, /Repair budget exhausted/i)
})

test('workspace store: validation blocker halts immediately without infinite retries', async () => {
  const initial = createAppProject({ id: 'proj-val-blocked', revision: 1, files: MAKE_FIXTURES.counter.files })

  let callCount = 0
  const store = createMakeWorkspaceStore({
    initialProject: initial,
    planner: async (prompt, project) => createAppPlan({ ...sampleDraftPlan, prompt, appId: project.id, baseRevision: project.revision }),
    generator: async plan => {
      callCount++
      return {
        success: false,
        assets: null,
        diagnostics: [{ file: 'src/App.tsx', line: 1, column: 1, code: 'VALIDATION_BLOCKED', severity: 'error', message: 'Browser validation capacity is busy.' }],
        plan,
        error: 'Validation blocked. The previous revision is unchanged.',
        validation: {
          status: 'blocked',
          maxAttempts: 2,
          attempts: [{
            attempt: 1,
            status: 'blocked',
            diagnostics: [{ file: 'src/App.tsx', line: 1, column: 1, code: 'VALIDATION_BLOCKED', severity: 'error', message: 'Browser validation capacity is busy.' }],
            viewports: [],
          }],
          message: 'Validation blocked. The previous revision is unchanged.',
        },
      }
    },
  })

  await store.generatePlan('Trigger blocker')
  await store.approveCurrentPlan()
  const result = await store.generateFromApprovedPlan()

  assert.equal(result.success, false)
  assert.equal(callCount, 1) // Halted on first try, no infinite loop
  assert.equal(store.getState().activeProject.revision, 1)
  assert.equal(store.getState().validation?.status, 'blocked')
  assert.equal(store.getState().validation?.attempts[0].status, 'blocked')
})
