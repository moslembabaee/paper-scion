import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import * as icons from 'lucide-react'
import * as jsx from 'react/jsx-runtime'

const settle = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)) }
const text = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : ''
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  return tree?.props ? [tree, ...nodes(tree.props.children)] : []
}

// Follow the auth-session harness pattern to exercise real handlers without browser sockets.
async function harness(overrides = {}) {
  const slots = [], copied = [], calls = []
  let cursor = 0
  const account = {
    user: { id: 'designer', hasMcpToken: true },
    revealToken: async () => { calls.push('reveal'); return 'server-secret' },
    rotate: async () => { calls.push('rotate'); return 'rotated-secret' },
    revoke: async () => { calls.push('revoke'); account.user.hasMcpToken = false },
    regenerate: async () => { calls.push('generate'); account.user.hasMcpToken = true; return 'generated-secret' },
    ...overrides,
  }
  const react = {
    useState(initial) {
      const index = cursor++
      slots[index] ??= { value: typeof initial === 'function' ? initial() : initial }
      return [slots[index].value, value => { slots[index].value = typeof value === 'function' ? value(slots[index].value) : value }]
    },
    useRef(initial) { const index = cursor++; slots[index] ??= { current: initial }; return slots[index] },
    useEffect(callback) { const index = cursor++; slots[index] ??= { cleanup: callback() } },
  }
  const source = ts.transpileModule(await readFile(new URL('../src/cloud/CloudAccount.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const exports = {}
  const require = name => {
    if (name === 'react') return react
    if (name === 'react/jsx-runtime') return jsx
    if (name === 'lucide-react') return icons
    if (name === '../workspace/Dialog') return { Dialog: () => null }
    throw new Error(`Unexpected import: ${name}`)
  }
  new Function('require', 'exports', 'navigator', source)(require, exports, { clipboard: { writeText: async value => copied.push(value) } })
  const render = () => { cursor = 0; return exports.AiAgentAccess({ account }) }
  const find = predicate => nodes(render()).find(predicate)
  const button = label => find(node => node.type === 'button' && (node.props['aria-label'] === label || text(node) === label))
  const field = () => find(node => node.type === 'input').props
  const click = async label => { const control = button(label); assert.ok(control, label); assert.ok(!control.props.disabled, label); control.props.onClick(); await settle() }
  return { account, calls, copied, render, find, button, field, click, dispose: () => slots.forEach(slot => slot?.cleanup?.()) }
}

test('agent token controls fetch server secrets, hide, copy, rotate, revoke and regenerate', async () => {
  const h = await harness()
  assert.equal(h.field().type, 'password')
  assert.notEqual(h.field().value, 'server-secret')
  await h.click('Reveal token')
  assert.equal(h.field().value, 'server-secret')
  await h.click('Hide token')
  assert.equal(h.field().type, 'password')
  await h.click('Copy token')
  assert.deepEqual(h.copied, ['server-secret'])
  assert.equal(h.field().type, 'password')
  await h.click('Rotate token')
  assert.equal(h.field().value, 'rotated-secret')
  await h.click('Revoke token')
  assert.equal(h.field().value, '')
  assert.equal(h.button('Reveal token').props.disabled, true)
  assert.equal(h.button('Copy token').props.disabled, true)
  await h.click('Generate MCP token')
  assert.equal(h.field().value, 'generated-secret')
  assert.deepEqual(h.calls, ['reveal', 'reveal', 'rotate', 'revoke', 'generate'])
  h.dispose()
})

test('each client copies its own valid configuration with the public endpoint and a token placeholder', async () => {
  const h = await harness()
  await h.click('Reveal token')
  for (const client of ['Claude Code', 'Codex', 'Cursor']) {
    await h.click(client)
    await h.click('Copy configuration snippet')
    const config = h.copied.at(-1)
    assert.match(config, /https:\/\/paper\.141\.11\.32\.213\.nip\.io\/mcp/)
    assert.match(config, /<YOUR_PAPER_TOKEN>/)
    assert.ok(!config.includes('server-secret'))
    if (client === 'Codex') {
      assert.match(config, /\[mcp_servers\.paper\]/)
      assert.match(config, /http_headers = \{ Authorization = "Bearer <YOUR_PAPER_TOKEN>" \}/)
    } else {
      const server = JSON.parse(config).mcpServers.paper
      assert.equal(server.headers.Authorization, 'Bearer <YOUR_PAPER_TOKEN>')
      if (client === 'Claude Code') assert.equal(server.type, 'http')
    }
  }
  h.dispose()
})

test('failed and duplicate token operations preserve the token and allow retry', async () => {
  let reject
  const pending = new Promise((_resolve, no) => { reject = no })
  let requests = 0
  const h = await harness({ rotate: () => { requests++; return pending } })
  await h.click('Reveal token')
  const rotate = h.button('Rotate token')
  rotate.props.onClick()
  rotate.props.onClick()
  assert.equal(requests, 1)
  assert.equal(h.button('Copy token').props.disabled, true)
  reject(new Error('Server unavailable'))
  await settle()
  assert.equal(text(h.find(node => node.props.role === 'alert')), 'Server unavailable')
  assert.equal(h.field().value, 'server-secret')
  assert.equal(h.button('Rotate token').props.disabled, false)
  h.account.rotate = async () => 'retry-secret'
  await h.click('Rotate token')
  assert.equal(h.field().value, 'retry-secret')
  assert.equal(h.find(node => node.props.role === 'alert'), undefined)
  h.dispose()
})
