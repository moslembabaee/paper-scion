import test from 'node:test'
import assert from 'node:assert/strict'
import { createPreviewMessage, parsePreviewMessage, PREVIEW_CSP_HEADER } from '../src/make/preview-sandbox.ts'
import { isCapabilityRequest } from '../src/make/secrets.ts'

test('preview capability protocol carries only bounded handles, operations and sanitized results', () => {
  const payload = { handle: 'sec_' + 'A'.repeat(32), operation: 'hmac-sha256', message: 'Hello Paper' }
  const request = createPreviewMessage('paper-preview', 'preview:capability', payload)
  assert.equal(parsePreviewMessage(request, 'paper-preview').valid, true)
  const result = createPreviewMessage('paper-host', 'preview:capability-result', { requestId: request.id, signature: 'a'.repeat(64) })
  assert.equal(parsePreviewMessage(result, 'paper-host').valid, true)
  for (const input of [
    { ...payload, url: 'http://127.0.0.1' }, { ...payload, operation: 'fetch' },
    { ...payload, value: 'raw-secret' }, { ...payload, message: 'x'.repeat(4097) },
    { ...payload, handle: '../other-app' }, { ...payload, accountId: 'other-owner' },
  ]) assert.equal(parsePreviewMessage({ ...request, payload: input }, 'paper-preview').valid, false)
  for (const response of [
    { requestId: request.id, signature: 'raw-secret' }, { requestId: request.id, value: 'raw-secret' },
    { requestId: request.id, error: 'arbitrary provider error with secrets' },
  ]) assert.equal(parsePreviewMessage({ ...result, payload: response }, 'paper-host').valid, false)
  assert.ok(PREVIEW_CSP_HEADER.includes("connect-src 'none'"))
})

test('capability validator rejects caller-controlled hosts and UTF-8 byte overflows', () => {
  assert.equal(isCapabilityRequest({ operation: 'hmac-sha256', message: 'hello' }), true)
  assert.equal(isCapabilityRequest({ operation: 'hmac-sha256', message: '😀'.repeat(1025) }), false)
  assert.equal(isCapabilityRequest({ operation: 'hmac-sha256', message: 'hello', host: 'example.test' }), false)
})

// Execute the actual guest bridge without browser process privileges. The real
// Chromium lifecycle test is separately required in playwright.secrets.config.ts.
test('guest bridge correlates results, rejects spoofed parents and exposes no raw-value method', async () => {
  const { Script, createContext } = await import('node:vm')
  const { getPreviewGuestScript } = await import('../src/make/preview-sandbox.ts')
  const listeners = new Map(), sent = []
  const parent = { postMessage: value => sent.push(value) }
  const window = {}
  const context = createContext({
    window, parent, TextEncoder, setTimeout, clearTimeout,
    addEventListener: (name, handler) => listeners.set(name, handler),
    document: { addEventListener() {} },
  })
  new Script(getPreviewGuestScript()).runInContext(context)
  assert.deepEqual(Object.keys(window.paperCapabilities), ['invoke'])
  const handle = 'sec_' + 'B'.repeat(32)
  const invoke = () => new Script(`window.paperCapabilities.invoke('${handle}', { operation: 'hmac-sha256', message: 'Hello' })`).runInContext(context)
  const call = invoke()
  assert.equal(sent.length, 1)
  const response = createPreviewMessage('paper-host', 'preview:capability-result', { requestId: sent[0].id, signature: 'b'.repeat(64) })
  // Transfer plain JSON through the VM's realm, as structured-clone messaging does.
  context.rawResponse = JSON.stringify(response)
  context.actualParent = parent
  const deliver = source => {
    context.sourceWindow = source
    const event = new Script('({source:sourceWindow, data:JSON.parse(rawResponse)})').runInContext(context)
    listeners.get('message')(event)
  }
  deliver({})
  let settled = false
  void call.then(() => { settled = true })
  await Promise.resolve()
  assert.equal(settled, false)
  deliver(parent)
  assert.equal((await call).signature, 'b'.repeat(64))
  const denied = invoke()
  const failed = assert.rejects(denied, /Capability unavailable/)
  context.rawResponse = JSON.stringify(createPreviewMessage('paper-host', 'preview:capability-result', { requestId: sent[1].id, error: 'Capability unavailable' }))
  deliver(parent)
  await failed
  await assert.rejects(new Script(`window.paperCapabilities.invoke('${handle}', {operation:'fetch', message:'Hello'})`).runInContext(context), /Capability unavailable/)
  assert.equal(sent.length, 2, 'unsupported operations never leave the guest')
})
