import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PREVIEW_SANDBOX_POLICY,
  PREVIEW_CSP_DIRECTIVES,
  PREVIEW_CSP_HEADER,
  PREVIEW_MESSAGE_CHANNEL,
  PREVIEW_PROTOCOL_VERSION,
  MAX_PREVIEW_MESSAGE_BYTES,
  isAllowedPreviewSandbox,
  createPreviewMessage,
  parsePreviewMessage,
  getPreviewGuestScript,
  generatePreviewHtml,
  createIsolatedPreviewDocument,
  MAX_PREVIEW_MESSAGES_PER_SECOND,
} from '../src/make/preview-sandbox.ts'
import { Script, createContext } from 'node:vm'
import { compileSourceFiles } from '../src/make/compiler.ts'

test('preview sandbox policy strictly allows only scripts and forbids credential/navigation privileges', () => {
  assert.equal(PREVIEW_SANDBOX_POLICY, 'allow-scripts')

  // Allowed sandbox policy
  assert.equal(isAllowedPreviewSandbox('allow-scripts'), true)
  assert.equal(isAllowedPreviewSandbox(' allow-scripts '), true)

  // Forbidden dangerous privileges
  assert.equal(isAllowedPreviewSandbox('allow-scripts allow-same-origin'), false)
  assert.equal(isAllowedPreviewSandbox('allow-same-origin'), false)
  assert.equal(isAllowedPreviewSandbox('allow-scripts allow-top-navigation'), false)
  assert.equal(isAllowedPreviewSandbox('allow-scripts allow-top-navigation-by-user-activation'), false)
  assert.equal(isAllowedPreviewSandbox('allow-scripts allow-popups'), false)
  assert.equal(isAllowedPreviewSandbox('allow-scripts allow-modals'), false)
  assert.equal(isAllowedPreviewSandbox('allow-scripts allow-pointer-lock'), false)
  assert.equal(isAllowedPreviewSandbox(''), false)
  assert.equal(isAllowedPreviewSandbox(null), false)
  assert.equal(isAllowedPreviewSandbox(undefined), false)
  assert.equal(isAllowedPreviewSandbox(123), false)
})

test('preview CSP restricts network exfiltration, plugins, frame ancestors, and base URIs', () => {
  assert.ok(PREVIEW_CSP_HEADER.includes("default-src 'none'"))
  assert.ok(PREVIEW_CSP_HEADER.includes("connect-src 'none'"))
  assert.ok(PREVIEW_CSP_HEADER.includes("object-src 'none'"))
  assert.ok(PREVIEW_CSP_HEADER.includes("base-uri 'none'"))
  assert.ok(PREVIEW_CSP_HEADER.includes("form-action 'none'"))
  assert.ok(PREVIEW_CSP_HEADER.includes("frame-src 'none'"))
  assert.ok(PREVIEW_CSP_HEADER.includes("script-src 'unsafe-inline' data:"))
  assert.ok(PREVIEW_CSP_HEADER.includes("style-src 'unsafe-inline' data:"))
  assert.ok(PREVIEW_CSP_HEADER.includes("img-src data: blob:"))
  assert.ok(PREVIEW_CSP_HEADER.includes("font-src data:"))

  // Verify CSP directives map
  assert.deepEqual(PREVIEW_CSP_DIRECTIVES['connect-src'], ["'none'"])
  assert.deepEqual(PREVIEW_CSP_DIRECTIVES['object-src'], ["'none'"])
  assert.deepEqual(PREVIEW_CSP_DIRECTIVES['base-uri'], ["'none'"])
  assert.deepEqual(PREVIEW_CSP_DIRECTIVES['form-action'], ["'none'"])
  assert.deepEqual(PREVIEW_CSP_DIRECTIVES['frame-src'], ["'none'"])
})

test('compiler output includes restrictive CSP meta tag and bounded guest protocol bridge', async () => {
  const result = await compileSourceFiles({
    'src/App.tsx': 'export default function App() { return <div>Test App</div> }',
  })
  assert.equal(result.success, true)
  assert.ok(result.assets)
  const html = result.assets.html

  // Meta CSP check
  assert.ok(html.includes('<meta http-equiv="Content-Security-Policy"'), 'HTML must include CSP meta tag')
  assert.ok(html.includes("connect-src 'none'"), 'CSP must block connect-src')
  assert.ok(html.includes("default-src 'none'"), 'CSP must block default-src')

  // Guest bridge check
  assert.ok(html.includes(PREVIEW_MESSAGE_CHANNEL), 'HTML must embed preview message protocol bridge')
  assert.ok(html.includes('preview:ready'), 'Guest bridge must emit ready message')
  assert.ok(html.includes('preview:error'), 'Guest bridge must capture runtime errors')
  assert.ok(html.includes('preview:pong'), 'Guest bridge must support ping/pong liveness')
})

test('bounded message protocol validates envelope structure, sources and types', () => {
  const hostMsg = createPreviewMessage('paper-host', 'preview:ping', { timestamp: 12345 })
  assert.equal(hostMsg.channel, PREVIEW_MESSAGE_CHANNEL)
  assert.equal(hostMsg.version, PREVIEW_PROTOCOL_VERSION)
  assert.equal(hostMsg.source, 'paper-host')
  assert.equal(hostMsg.type, 'preview:ping')
  assert.equal(typeof hostMsg.id, 'string')
  assert.ok(hostMsg.id.length > 0)
  assert.equal(typeof hostMsg.timestamp, 'number')
  assert.deepEqual(hostMsg.payload, { timestamp: 12345 })

  // Parsing valid host message
  const parsedHost = parsePreviewMessage(hostMsg, 'paper-host')
  assert.equal(parsedHost.valid, true)
  if (parsedHost.valid) {
    assert.equal(parsedHost.message.type, 'preview:ping')
  }

  // Creating valid guest message
  const guestMsg = createPreviewMessage('paper-preview', 'preview:ready', {
    entryPoint: 'src/App.tsx',
    timestamp: Date.now(),
  })
  const parsedGuest = parsePreviewMessage(guestMsg, 'paper-preview')
  assert.equal(parsedGuest.valid, true)
  if (parsedGuest.valid) {
    assert.equal(parsedGuest.message.type, 'preview:ready')
  }
})

test('bounded message protocol rejects untrusted channels, mismatched sources and unknown types', () => {
  // Wrong channel
  const wrongChannel = {
    channel: 'malicious-channel',
    version: 1,
    source: 'paper-preview',
    type: 'preview:ready',
    id: 'msg-1',
    timestamp: Date.now(),
    payload: {},
  }
  assert.equal(parsePreviewMessage(wrongChannel).valid, false)

  // Mismatched source
  const spoofedHost = createPreviewMessage('paper-host', 'preview:ping', { timestamp: 1 })
  assert.equal(parsePreviewMessage(spoofedHost, 'paper-preview').valid, false)

  // Unknown message type
  const unknownType = {
    channel: PREVIEW_MESSAGE_CHANNEL,
    version: 1,
    source: 'paper-preview',
    type: 'malicious:execute_code',
    id: 'msg-2',
    timestamp: Date.now(),
    payload: { code: 'alert(1)' },
  }
  assert.equal(parsePreviewMessage(unknownType).valid, false)

  // Non-object envelopes
  assert.equal(parsePreviewMessage(null).valid, false)
  assert.equal(parsePreviewMessage(undefined).valid, false)
  assert.equal(parsePreviewMessage('string message').valid, false)
  assert.equal(parsePreviewMessage(12345).valid, false)
})

test('bounded message protocol rejects oversized payloads exceeding byte limits', () => {
  const hugePayload = {
    data: 'A'.repeat(MAX_PREVIEW_MESSAGE_BYTES + 1024),
  }
  assert.throws(() => {
    createPreviewMessage('paper-preview', 'preview:event', hugePayload)
  }, /payload exceeds maximum/i)

  const rawOversized = {
    channel: PREVIEW_MESSAGE_CHANNEL,
    version: 1,
    source: 'paper-preview',
    type: 'preview:event',
    id: 'huge-1',
    timestamp: Date.now(),
    payload: { blob: 'B'.repeat(MAX_PREVIEW_MESSAGE_BYTES + 500) },
  }
  const result = parsePreviewMessage(rawOversized)
  assert.equal(result.valid, false)
  assert.match(result.error ?? '', /exceeds byte limit/i)
})

test('bounded message protocol prevents prototype pollution attacks', () => {
  const polluted = JSON.parse('{"channel":"paper-make-preview","version":1,"source":"paper-preview","type":"preview:event","id":"proto-1","timestamp":1000,"payload":{"__proto__":{"polluted":true}}}')
  const result = parsePreviewMessage(polluted)
  assert.equal(result.valid, false)
  assert.equal(({})['polluted'], undefined)
})

test('generatePreviewHtml wraps bundle with strict CSP and guest runtime bridge', () => {
  const html = generatePreviewHtml({
    js: 'console.log("preview js");',
    css: 'body { background: #080808; }',
    entryPoint: 'src/App.tsx',
    title: 'Custom Title',
  })

  assert.ok(html.includes('<title>Custom Title</title>'))
  assert.ok(html.includes('<meta http-equiv="Content-Security-Policy"'))
  assert.ok(html.includes(PREVIEW_CSP_HEADER))
  assert.ok(html.includes(PREVIEW_MESSAGE_CHANNEL))
  assert.ok(html.includes('id="root"'))
  assert.ok(html.includes('preview:ready'))
})

test('message validation rejects malformed typed payloads and bounded traversal attacks without throwing', () => {
  const base = { channel: PREVIEW_MESSAGE_CHANNEL, version: 1, source: 'paper-preview', type: 'preview:error', id: 'bad', timestamp: 1 }
  for (const payload of [null, {}, { message: 42 }, { message: 'ok', stack: {} }]) {
    assert.equal(parsePreviewMessage({ ...base, payload }).valid, false)
  }
  const cyclic = {}; cyclic.self = cyclic
  assert.equal(parsePreviewMessage({ ...base, type: 'preview:event', payload: { name: 'cycle', data: cyclic } }).valid, false)
  let deep = {}; for (let i = 0; i < 40; i++) deep = { child: deep }
  assert.equal(parsePreviewMessage({ ...base, type: 'preview:event', payload: { name: 'deep', data: deep } }).valid, false)
  assert.equal(parsePreviewMessage({ ...base, payload: { message: 'ok' }, padding: 'x'.repeat(MAX_PREVIEW_MESSAGE_BYTES) }).valid, false)
  assert.equal(isAllowedPreviewSandbox('allow-scripts allow-forms'), false)
  assert.equal(isAllowedPreviewSandbox('allow-scripts allow-downloads'), false)
})

test('untrusted document metadata and CSS cannot break out into the trusted HTML context', () => {
  const payload = '</style></title><script>top.location="https://attacker.invalid"</script>'
  const html = generatePreviewHtml({ js: payload, css: payload, extraBaseCss: payload, title: payload, entryPoint: payload })
  assert.equal(html.includes(payload), false)
  assert.ok(html.includes('&lt;/title&gt;'))
  assert.equal((html.match(/<script/g) ?? []).length, 2)
})

// These checks execute only the trusted protocol runtime with synthetic windows.
// Actual SOP, CSP and sandbox enforcement are covered by the Playwright suite.
function protocolRealm(script, documentOverrides = {}) {
  const events = []
  const listeners = {}
  const parent = { postMessage(message) { events.push(JSON.parse(JSON.stringify(message))) } }
  const styles = new Map()
  const frame = { contentWindow: { postMessage(message) { events.push(JSON.parse(JSON.stringify(message))) } }, srcdoc: '' }
  const realm = createContext({
    TextEncoder, parent, window: {}, document: {
      documentElement: { style: { setProperty(key, value) { styles.set(key, value) } }, dataset: {} },
      querySelector() { return frame },
      querySelectorAll() { return [] },
      addEventListener(type, listener) { listeners['document:' + type] = listener },
      ...documentOverrides,
    },
    addEventListener(type, listener) { listeners[type] = listener },
    listeners, frame, events,
  })
  new Script(script).runInContext(realm, { timeout: 1000 })
  return { realm, events, styles, frame }
}

function dispatch(realm, message, source = 'parent', origin = 'https://paper.test') {
  realm.messageJSON = JSON.stringify(message)
  new Script(`listeners.message({ data: JSON.parse(messageJSON), source: ${source}, origin: ${JSON.stringify(origin)} })`).runInContext(realm, { timeout: 1000 })
}

test('guest bridge enforces source, schema, Unicode byte limits and bounded diagnostics', () => {
  const { realm, events, styles } = protocolRealm(getPreviewGuestScript())
  const theme = createPreviewMessage('paper-host', 'preview:set-theme', { background: '#81adec' })
  dispatch(realm, theme, '{}')
  dispatch(realm, { ...theme, payload: { background: {} } })
  dispatch(realm, { ...theme, payload: { background: 'x'.repeat(MAX_PREVIEW_MESSAGE_BYTES + 1) } })
  assert.equal(styles.size, 0)
  dispatch(realm, theme)
  assert.equal(styles.get('--paper-bg'), '#81adec')
  dispatch(realm, createPreviewMessage('paper-host', 'preview:ping', { timestamp: 1 }, 'ping-1'))
  assert.equal(events[0].type, 'preview:pong')
  assert.equal(events[0].payload.pingId, 'ping-1')
  assert.equal(parsePreviewMessage(events[0], 'paper-preview').valid, true)
  new Script('window.__paperNotifyError({ message: "x".repeat(9000), stack: "s".repeat(20000) })').runInContext(realm)
  assert.equal(events[1].payload.message.length, 8192)
  assert.equal(events[1].payload.stack.length, 16384)
  const utf8 = { ...theme, type: 'preview:event', source: 'paper-preview', payload: { name: 'utf8', data: '🎨'.repeat(20000) } }
  assert.equal(parsePreviewMessage(utf8).valid, false)
})

test('trusted boundary contains generated HTML as data and only relays the exact guest window', () => {
  const hostile = '</script><script>parent.document.cookie</script>'
  const html = createIsolatedPreviewDocument(hostile)
  assert.equal(html.includes(hostile), false)
  assert.equal((html.match(/<script>/g) ?? []).length, 1)
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1]
  const { realm, events, frame } = protocolRealm(script)
  assert.equal(frame.srcdoc, hostile)
  const message = createPreviewMessage('paper-preview', 'preview:event', { name: 'event' })
  dispatch(realm, message, '{}', 'null')
  dispatch(realm, message, 'frame.contentWindow', 'https://attacker.invalid')
  dispatch(realm, { ...message, payload: null }, 'frame.contentWindow', 'null')
  assert.equal(events.length, 0)
  dispatch(realm, message, 'frame.contentWindow', 'null')
  assert.deepEqual(events, [message])
  for (let i = 0; i < MAX_PREVIEW_MESSAGES_PER_SECOND * 2; i++) dispatch(realm, message, 'frame.contentWindow', 'null')
  assert.ok(events.length <= MAX_PREVIEW_MESSAGES_PER_SECOND)
})


test('guest inspection is opt-in, emits one bounded target, and retains instance IDs after rerender and reorder', () => {
  class Element {
    constructor(text) { this.textContent = text; this.tagName = 'BUTTON'; this.isConnected = true; this.id = '' }
    getAttribute(name) { return name === 'data-paper-id' ? 'App-button-1' : null }
    closest() { return this }
    getBoundingClientRect() { return { left: 10, top: 20, width: 120, height: 32 } }
  }
  const a = new Element('Alpha <b>label</b>'), b = new Element('Beta')
  const nodes = [a, b]
  const root = { contains: node => nodes.includes(node) }
  const overlays = []
  const { realm, events } = protocolRealm(getPreviewGuestScript(), {
    querySelectorAll: () => nodes,
    getElementById: id => id === 'root' ? root : null,
    createElement: () => ({ style: {} }),
    documentElement: { appendChild: node => overlays.push(node) },
  })
  realm.Element = Element
  function click(target) {
    let prevented = 0, stopped = 0
    realm.listeners['document:click']({ target, preventDefault() { prevented++ }, stopImmediatePropagation() { stopped++ } })
    return [prevented, stopped]
  }
  assert.deepEqual(click(a), [0, 0], 'Normal preview interaction stays enabled by default')
  const inspect = createPreviewMessage('paper-host', 'preview:set-inspect', { enabled: true })
  dispatch(realm, inspect, '{}')
  assert.deepEqual(click(a), [0, 0], 'Sibling configuration is ignored')
  dispatch(realm, inspect)
  assert.deepEqual(click(a), [1, 1])
  const first = events.at(-1)
  assert.equal(first.type, 'preview:element-selected')
  assert.equal(first.payload.previewText, 'Alpha blabel/b')
  assert.equal(parsePreviewMessage(first, 'paper-preview').valid, true)
  assert.deepEqual(Object.keys(first.payload).sort(), ['bounds', 'elementId', 'previewText', 'tagName'])
  assert.equal(events.length, 1, 'Each click sends exactly one selection')
  click(b)
  assert.notEqual(events.at(-1).payload.elementId, first.payload.elementId)
  a.textContent = 'Alpha updated'
  nodes.reverse()
  click(a)
  assert.equal(events.at(-1).payload.elementId, first.payload.elementId, 'Rerender and keyed reorder preserve the target')
  assert.equal(overlays.length, 1)
  assert.equal(overlays[0].style.display, 'block')
  a.isConnected = false
  nodes.splice(nodes.indexOf(a), 1)
  dispatch(realm, createPreviewMessage('paper-host', 'preview:highlight-element', { elementId: first.payload.elementId }))
  assert.equal(overlays[0].style.display, 'none', 'Removed targets never select a different instance')
  dispatch(realm, createPreviewMessage('paper-host', 'preview:set-inspect', { enabled: false }))
  assert.deepEqual(click(b), [0, 0])
})
