import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import * as jsx from 'react/jsx-runtime'
import * as icons from 'lucide-react'
import { initials } from '../src/workspace/profile.ts'
import { roomFromHash } from '../src/collaboration/room.ts'

// Exercise the real hook and invitation handlers, following the account test
// harness, without requiring browser processes or server sockets.
function hooks() {
  const slots = [], effects = []
  let cursor = 0
  const react = {
    Activity: 'activity',
    Suspense: 'suspense',
    lazy: () => () => null,
    useState(initial) {
      const index = cursor++
      slots[index] ??= { value: typeof initial === 'function' ? initial() : initial }
      return [slots[index].value, value => { slots[index].value = typeof value === 'function' ? value(slots[index].value) : value }]
    },
    useRef(initial) { const index = cursor++; slots[index] ??= { current: initial }; return slots[index] },
    useId: () => 'presence-test',
    useCallback: callback => callback,
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
    useEffect(callback, deps) {
      const index = cursor++
      if (!slots[index] || deps.some((value, i) => value !== slots[index].deps[i])) {
        effects.push(() => { slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: callback() } })
      }
    },
  }
  return {
    react,
    render(callback) { cursor = 0; const result = callback(); while (effects.length) effects.shift()(); return result },
    dispose() { slots.forEach(slot => { slot?.cleanup?.(); if (slot) slot.cleanup = undefined }) },
  }
}

async function load(path, imports, globals = {}) {
  const source = ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const exports = {}
  const require = name => {
    if (Object.hasOwn(imports, name)) return imports[name]
    throw new Error(`Unexpected import: ${name}`)
  }
  new Function('require', 'exports', ...Object.keys(globals), source)(require, exports, ...Object.values(globals))
  return exports
}

async function sessionHarness(t) {
  const h = hooks(), sessions = []
  class Session {
    constructor(room, store, controller, name) {
      Object.assign(this, { room, store, controller, name, starts: 0, stops: 0 })
      sessions.push(this)
    }
    start() { this.starts++ }
    stop() { this.stops++ }
    setName(name) { this.name = name }
  }
  const { useCollaboration } = await load('../src/collaboration/useCollaboration.ts', { react: h.react, './session': { CollaborationSession: Session } })
  const store = {}, controller = {}
  t.after(() => h.dispose())
  return { sessions, render: (room, name = 'Ada', enabled) => h.render(() => useCollaboration(room, store, controller, name, enabled)), dispose: h.dispose }
}

test('solo mode never constructs or starts a session, including rerenders and profile changes', async t => {
  const h = await sessionHarness(t), room = crypto.randomUUID()
  assert.equal(h.render(room), null)
  assert.equal(h.render(room, 'Mira', false), null)
  assert.equal(h.render(crypto.randomUUID(), 'Mira', false), null)
  assert.deepEqual(h.sessions, [])
})

test('enabling connects once with the current document; profile changes retain that session', async t => {
  const h = await sessionHarness(t), room = crypto.randomUUID()
  h.render(room, 'Ada', false)
  h.render(room, 'Ada', true)
  const session = h.render(room, 'Ada', true)
  assert.equal(h.sessions.length, 1)
  assert.equal(session.room, room)
  assert.equal(session.starts, 1)
  assert.equal(h.render(room, 'Mira', true), session)
  assert.equal(session.name, 'Mira')
  assert.equal(session.stops, 0)
  h.dispose()
  assert.equal(session.stops, 1)
})

test('changing rooms or returning to solo mode stops the previous connection', async t => {
  const h = await sessionHarness(t), first = crypto.randomUUID(), second = crypto.randomUUID()
  h.render(first, 'Ada', true)
  h.render(second, 'Ada', true)
  assert.equal(h.sessions[0].stops, 1)
  assert.equal(h.sessions[1].starts, 1)
  assert.equal(h.sessions[1].room, second)
  h.render(second, 'Ada', false)
  assert.equal(h.render(second, 'Ada', false), null)
  assert.equal(h.sessions[1].stops, 1)
  assert.equal(h.sessions.length, 2)
})

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  return tree?.props ? [tree, ...nodes(tree.props.children)] : []
}

async function presenceHarness(t, navigator = {}) {
  const h = hooks(), activations = [], copied = [], shared = [], room = crypto.randomUUID()
  const { PresenceBar } = await load('../src/collaboration/PresenceBar.tsx', {
    react: h.react, 'react/jsx-runtime': jsx, 'lucide-react': icons, '../workspace/profile': { initials }, './collaboration.css': {},
  }, {
    window: { location: { href: 'https://paper.test/studio?theme=light' } },
    document: new EventTarget(),
    navigator: {
      clipboard: { writeText: async url => copied.push(url) },
      share: async data => shared.push(data),
      ...navigator,
    },
  })
  let session = null
  const render = () => h.render(() => PresenceBar({ session, room, onActivate: () => activations.push(room) }))
  const find = predicate => nodes(render()).find(predicate)
  const click = async label => {
    const button = find(node => node.type === 'button' && node.props['aria-label'] === label)
    assert.ok(button, label)
    await button.props.onClick()
  }
  t.after(() => h.dispose())
  return { render, find, click, room, activations, copied, shared, setSession: value => { session = value } }
}

test('opening and closing presence leaves the solo canvas disconnected', async t => {
  const h = await presenceHarness(t)
  await h.click('Canvas collaborators')
  assert.equal(h.find(node => node.props.className === 'presence-connection').props.children, 'Solo')
  assert.equal(h.find(node => node.type === 'input').props.value, `https://paper.test/studio?theme=light#room=${h.room}`)
  await h.click('Canvas collaborators')
  assert.deepEqual(h.activations, [])
  assert.deepEqual(h.copied, [])
})

for (const action of ['Invite', 'Copy invite link', 'Share']) {
  test(`${action} explicitly activates the room and shares its invitation`, async t => {
    const h = await presenceHarness(t)
    await h.click('Canvas collaborators')
    await h.click(action)
    assert.deepEqual(h.activations, [h.room])
    if (action === 'Share') assert.equal(h.shared[0].url, `https://paper.test/studio?theme=light#room=${h.room}`)
    else assert.deepEqual(h.copied, [`https://paper.test/studio?theme=light#room=${h.room}`])
  })
}

test('denied clipboard permission still starts collaboration and offers a manual copy fallback', async t => {
  const h = await presenceHarness(t, { clipboard: { writeText: async () => { throw new Error('Permission denied') } } })
  await h.click('Canvas collaborators')
  await h.click('Copy invite link')
  assert.deepEqual(h.activations, [h.room])
  assert.equal(h.find(node => node.type === 'small' && node.props.role === 'status').props.children, 'Select and copy the invite link above.')
})

test('native sharing failure falls back to copying without activating twice', async t => {
  const h = await presenceHarness(t, { share: async () => { throw new Error('Sharing unavailable') } })
  await h.click('Canvas collaborators')
  await h.click('Share')
  assert.deepEqual(h.activations, [h.room])
  assert.deepEqual(h.copied, [`https://paper.test/studio?theme=light#room=${h.room}`])
})

test('the solo snapshot can transition to live presence without losing the invite panel', async t => {
  const h = await presenceHarness(t)
  await h.click('Canvas collaborators')
  h.setSession({ room: h.room, subscribe: () => () => {}, getSnapshot: () => ({ status: 'live', peers: [], following: null, error: '' }) })
  assert.equal(h.find(node => node.props.className === 'presence-connection').props.children, 'Live')
  await h.click('Canvas collaborators')
  assert.deepEqual(h.activations, [])
})

async function editorHarness(t, hash = '') {
  const calls = [], h = hooks(), room = crypto.randomUUID()
  const window = Object.assign(new EventTarget(), { location: { hash, pathname: '/', search: '' } })
  const workspace = { record: { id: `owner_with_underscores_${room}`, cloud: { projectId: room } }, project: { name: 'Study', grid: true }, store: {}, controller: { stop() {} } }
  const opened = []
  const manager = { active: workspace, projects: [], save() {}, persistent: true, open: async id => opened.push({ id, hash: window.location.hash }) }
  const io = { persistProject: async () => {}, getProject() {}, setMessage() {} }
  const noOp = () => {}
  const comments = { setOpen: noOp, setDraft: noOp, setActiveId: noOp, unread: new Set() }
  const imports = {}
  // Unrendered child components remain placeholders; the Editor itself runs.
  const source = await readFile(new URL('../src/Studio.tsx', import.meta.url), 'utf8')
  for (const [, path] of source.matchAll(/from '([^']+)'/g)) imports[path] = new Proxy({}, { get: () => noOp })
  for (const [, path] of source.matchAll(/import '([^']+)'/g)) imports[path] = {}
  const PresenceBar = () => null, ProjectSwitcher = () => null
  Object.assign(imports, {
    react: h.react, 'react/jsx-runtime': jsx, 'lucide-react': icons,
    './workspace/useWorkspace': { useWorkspace: () => manager },
    './workspace/profile': { readProfile: () => ({ name: 'Ada' }) },
    './io/useProjectIO': { useProjectIO: () => io },
    './cloud/useCloudSync': { useCloudSync: () => ({}) },
    './mcp/useLiveBridge': { useLiveBridge: () => ({}) },
    './comments/useComments': { useComments: () => comments },
    './collaboration/useCollaboration': { useCollaboration: (...args) => { calls.push(args); return null } },
    './collaboration/PresenceBar': { PresenceBar },
    './workspace/ProjectSwitcher': { ProjectSwitcher },
    './collaboration/room': { roomFromHash },
  })
  const history = { replaceState: () => { window.location.hash = '' } }
  const { default: Studio } = await load('../src/Studio.tsx', imports, { window, document: new EventTarget(), history })
  const outer = hooks()
  // Use separate hook slots for Studio and its keyed Editor.
  const originalState = h.react.useState
  h.react.useState = outer.react.useState
  const tree = outer.render(() => Studio({ account: {} }))
  const editor = nodes(tree).find(node => typeof node.type === 'function' && node.type.name === 'Editor')
  assert.ok(editor, 'Studio retains the design Editor inside its workspace boundary')
  h.react.useState = originalState
  const render = () => h.render(() => editor.type(editor.props))
  const presence = () => nodes(render()).find(node => node.type === PresenceBar).props
  const projectSwitcher = () => nodes(render()).find(node => node.type === ProjectSwitcher).props
  const setHash = value => { window.location.hash = value; window.dispatchEvent(new Event('hashchange')); render() }
  t.after(() => { h.dispose(); outer.dispose() })
  return { room, calls, opened, render, presence, projectSwitcher, setHash, window }
}

test('the Editor keeps cloud projects solo until invited and uses their unprefixed cloud room ID', async t => {
  const h = await editorHarness(t)
  h.render()
  assert.equal(h.calls.at(-1)[4], false)
  assert.equal(h.presence().room, h.room)
  h.presence().onActivate()
  h.render()
  assert.equal(h.calls.at(-1)[0], h.room)
  assert.equal(h.calls.at(-1)[4], true)
})

test('the Editor immediately enables hash rooms and responds to new, removed and invalid hashes', async t => {
  const first = crypto.randomUUID(), second = crypto.randomUUID()
  const h = await editorHarness(t, `#room=${first}`)
  h.render()
  assert.equal(h.calls.at(-1)[0], first)
  assert.equal(h.calls.at(-1)[4], true)
  h.setHash(`#room=${second}`)
  assert.equal(h.calls.at(-1)[0], second)
  assert.equal(h.calls.at(-1)[4], true)
  h.setHash('')
  assert.equal(h.calls.at(-1)[4], false)
  h.setHash('#room=invalid')
  assert.equal(h.calls.at(-1)[4], false)
})

test('project transitions clear invitation hashes before mounting the next editor', async t => {
  const h = await editorHarness(t, `#room=${crypto.randomUUID()}`)
  await h.projectSwitcher().onSwitch('private-study')
  assert.deepEqual(h.opened, [{ id: 'private-study', hash: '' }])
})
