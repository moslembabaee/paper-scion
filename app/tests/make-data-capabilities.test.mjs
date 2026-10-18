import test from 'node:test'
import assert from 'node:assert/strict'
import { Script, createContext } from 'node:vm'
import { build } from 'vite'
import { fileURLToPath } from 'node:url'
import { createPreviewMessage, parsePreviewMessage, getPreviewGuestScript, PREVIEW_CSP_HEADER } from '../src/make/preview-sandbox.ts'

const handle = 'dat_' + 'A'.repeat(32)
test('data bridge accepts only fixed bounded CRUD and plain records, never account or network selectors', () => {
  const request = createPreviewMessage('paper-preview', 'preview:data', { handle, operation: 'list' })
  assert.equal(parsePreviewMessage(request, 'paper-preview').valid, true)
  for (const payload of [
    { handle, operation: 'sql', query: 'DROP TABLE apps' }, { handle, operation: 'list', accountId: 'other' },
    { handle, operation: 'list', appId: 'other' }, { handle, operation: 'list', url: 'https://evil.test' },
    { handle, operation: 'create', expectedRevision: 0, value: { name: '😀'.repeat(1025) } },
    { handle, operation: 'create', expectedRevision: 0, value: { name: { $ne: null } } },
  ]) assert.equal(parsePreviewMessage({ ...request, payload }, 'paper-preview').valid, false)
  const result = createPreviewMessage('paper-host', 'preview:data-result', { requestId: request.id, result: { revision: 0, records: [] } })
  assert.equal(parsePreviewMessage(result, 'paper-host').valid, true)
  assert.equal(parsePreviewMessage({ ...result, payload: { requestId: request.id, error: 'raw database error' } }, 'paper-host').valid, false)
  assert.ok(PREVIEW_CSP_HEADER.includes("connect-src 'none'"))
})

test('actual guest data API correlates results and rejects spoofed parents and invalid requests', async () => {
  const sent = [], listeners = new Map(), parent = { postMessage: message => sent.push(message) }
  const context = createContext({ window: {}, parent, TextEncoder, setTimeout, clearTimeout,
    addEventListener: (name, callback) => listeners.set(name, callback), document: { addEventListener() {} } })
  new Script(getPreviewGuestScript()).runInContext(context)
  const call = new Script(`window.paperData.invoke('${handle}', {operation:'list'})`).runInContext(context)
  assert.equal(sent.length, 1)
  const deliver = (source, payload) => {
    context.source = source
    context.raw = JSON.stringify(createPreviewMessage('paper-host', 'preview:data-result', { requestId: sent[0].id, ...payload }))
    listeners.get('message')(new Script('({source, data:JSON.parse(raw)})').runInContext(context))
  }
  let settled = false; void call.then(() => { settled = true })
  deliver({}, { result: { revision: 1, records: [] } })
  await Promise.resolve(); assert.equal(settled, false)
  deliver(parent, { result: { revision: 1, records: [] } })
  assert.equal((await call).revision, 1)
  await assert.rejects(new Script(`window.paperData.invoke('${handle}', {operation:'sql',query:'SELECT 1'})`).runInContext(context), /Data operation unavailable/)
  assert.equal(sent.length, 1)
})

test('production-minified iframe protocol exchanges data without references to host bundle names', async () => {
  const bundle = await build({ configFile: false, envDir: false, publicDir: false, logLevel: 'silent',
    build: { write: false, minify: true, lib: { entry: fileURLToPath(new URL('../src/make/preview-sandbox.ts', import.meta.url)),
      name: 'Sandbox', formats: ['iife'] } },
  })
  const host = createContext({ TextEncoder })
  const output = (Array.isArray(bundle) ? bundle : [bundle]).flatMap(item => item.output)
  new Script(output.find(chunk => chunk.type === 'chunk').code).runInContext(host)
  const guestScript = new Script('Sandbox.getPreviewGuestScript()').runInContext(host)
  const sent = [], listeners = new Map(), parent = { postMessage: message => sent.push(message) }
  const guest = createContext({ window: {}, parent, TextEncoder, setTimeout, clearTimeout,
    addEventListener: (name, callback) => listeners.set(name, callback), document: { addEventListener() {} } })
  new Script(guestScript).runInContext(guest)
  const call = new Script(`window.paperData.invoke('${handle}', {operation:'list'})`).runInContext(guest)
  // Attach a handler before asserting to avoid an unhandled rejection if the
  // generated validator fails immediately.
  void call.catch(() => {})
  assert.equal(sent.length, 1, 'the minified guest must send a valid CRUD request')
  guest.parent = parent
  guest.raw = JSON.stringify(createPreviewMessage('paper-host', 'preview:data-result', {
    requestId: sent[0].id, result: { revision: 1, records: [{ id: 'row_' + 'B'.repeat(32), value: { name: 'Ada' } }] },
  }))
  listeners.get('message')(new Script('({source:parent, data:JSON.parse(raw)})').runInContext(guest))
  assert.equal((await call).records[0].value.name, 'Ada')
})
