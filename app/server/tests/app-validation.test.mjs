import test from 'node:test'
import assert from 'node:assert/strict'
import { boundedDiagnostics, validateAppInBrowser, runAppValidation } from '../dist/server/app-validation.js'
import { redactSensitiveText } from '../dist/src/make/model-protocol.js'

test('diagnostic caps apply after redaction, including embedded image payloads', () => {
  const input = Array.from({ length: 30 }, () => ({ file: 'src/App.tsx', line: 1, column: 1, code: 'RUNTIME_ERROR', severity: 'error', message: 'sk-abcdefghijk data:image/jpeg;base64,PRIVATEIMAGE ' + 'x'.repeat(2000) }))
  const result = boundedDiagnostics(input, redactSensitiveText)
  assert.equal(result.length, 8)
  assert.ok(result.every(d => d.message.length <= 500))
  assert.doesNotMatch(JSON.stringify(result), /sk-abcdefghijk|PRIVATEIMAGE/)
})

test('image payloads in diagnostic filenames never enter repair or history', () => {
  const result = boundedDiagnostics([{ file: 'data:image/jpeg;base64,PRIVATEIMAGE', line: 1, column: 1,
    code: 'RUNTIME_ERROR', severity: 'error', message: 'Crash' }])
  assert.doesNotMatch(JSON.stringify(result), /PRIVATEIMAGE|data:image/)
})

test('missing browser and pre-aborted validation return blockers, never passing results or screenshots', async () => {
  const previous = process.env.PAPER_VALIDATION_CHROMIUM
  process.env.PAPER_VALIDATION_CHROMIUM = '/nonexistent/paper-validation-browser'
  try {
    for (const aborted of [false, true]) {
      const controller = new AbortController()
      if (aborted) controller.abort()
      const result = await validateAppInBrowser({ entryPoint: 'src/App.tsx', html: '<main>Candidate</main>', js: '', css: '' }, controller.signal)
      assert.equal(result.status, 'blocked')
      assert.deepEqual(result.screenshots, [])
      assert.equal(result.diagnostics.at(-1).code, 'VALIDATION_BLOCKED')
    }
  } finally {
    if (previous === undefined) delete process.env.PAPER_VALIDATION_CHROMIUM
    else process.env.PAPER_VALIDATION_CHROMIUM = previous
  }
})

test('validation deadline aborts an uncooperative runner and ignores late success', { timeout: 1000 }, async () => {
  let release, signal
  const pending = new Promise(resolve => { release = resolve })
  const result = await runAppValidation({ entryPoint: 'src/App.tsx' }, new AbortController().signal,
    (_assets, current) => { signal = current; return pending }, { timeoutMs: 20 })
  assert.equal(result.status, 'blocked')
  assert.equal(signal.aborted, true)
  assert.deepEqual(result.screenshots, [])
  release({ status: 'passed', diagnostics: [], screenshots: [], viewports: [] })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(result.status, 'blocked')
})

test('validation cancellation settles even when the runner ignores its signal', { timeout: 1000 }, async () => {
  const controller = new AbortController()
  const pending = runAppValidation({ entryPoint: 'src/App.tsx' }, controller.signal,
    async () => { controller.abort(); return new Promise(() => {}) })
  const result = await pending
  assert.equal(result.status, 'blocked')
  assert.match(result.diagnostics[0].message, /cancelled/i)
})
