import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const guest = { user: null, providers: { google: true, github: true } }
const user = { id: 'designer', name: 'Paper Designer', email: 'designer@paper.test', avatar: '', createdAt: 1, hasMcpToken: false }
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const settle = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)) }

// Exercise the real account hook without network sockets or a browser process.
async function harness(api, search = '') {
  const slots = [], effects = [], requests = [], timeouts = [], urls = []
  let cursor = 0
  const changed = (previous, next) => !previous || next.some((value, i) => value !== previous[i])
  const react = {
    useState(initial) {
      const index = cursor++
      slots[index] ??= { value: typeof initial === 'function' ? initial() : initial }
      return [slots[index].value, value => { slots[index].value = typeof value === 'function' ? value(slots[index].value) : value }]
    },
    useRef(initial) {
      const index = cursor++
      slots[index] ??= { current: initial }
      return slots[index]
    },
    useCallback(callback, deps) {
      const index = cursor++
      if (changed(slots[index]?.deps, deps)) slots[index] = { deps, callback }
      return slots[index].callback
    },
    useEffect(callback, deps) {
      const index = cursor++
      if (changed(slots[index]?.deps, deps)) {
        effects.push(() => { slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: callback() } })
      }
    },
  }
  const mockedApi = (path, options) => { requests.push({ path, options }); return api(path, options) }
  const signals = {
    any: AbortSignal.any.bind(AbortSignal),
    timeout(ms) { const controller = new AbortController(); timeouts.push({ ms, controller }); return controller.signal },
  }
  const window = { location: { pathname: '/', search, hash: '#room=test' }, history: { replaceState: (_state, _title, url) => urls.push(url) } }
  const source = ts.transpileModule(await readFile(new URL('../src/cloud/useCloudAccount.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
  }).outputText
  const exports = {}
  const require = name => {
    if (name === 'react') return react
    if (name === './api') return { api: mockedApi }
    throw new Error(`Unexpected import: ${name}`)
  }
  new Function('require', 'exports', 'window', 'AbortSignal', source)(require, exports, window, signals)
  const render = () => {
    cursor = 0
    const account = exports.useCloudAccount()
    while (effects.length) effects.shift()()
    return account
  }
  const dispose = () => { for (const slot of slots) slot?.cleanup?.() }
  return { render, requests, timeouts, urls, dispose }
}

test('startup holds the guard until the uncached session resolves', async () => {
  const pending = deferred()
  const h = await harness(() => pending.promise)
  assert.equal(h.render().checked, false)
  assert.equal(h.requests[0].path, '/auth/session')
  assert.equal(h.requests[0].options.cache, 'no-store')
  pending.resolve(guest)
  await settle()
  assert.equal(h.render().checked, true)
  assert.equal(h.render().user, null)
  assert.equal(h.render().available, true)
  h.dispose()
})

test('a retry cancels the old request and ignores its late result', async () => {
  const old = deferred(), current = deferred()
  const h = await harness(() => h.requests.length === 1 ? old.promise : current.promise)
  void h.render().refresh()
  assert.equal(h.requests[0].options.signal.aborted, true)
  current.resolve(guest)
  await settle()
  old.resolve({ ...guest, user })
  await settle()
  assert.equal(h.render().user, null)
  assert.equal(h.render().checked, true)
  h.dispose()
})

test('timeout exits the loader, fails closed and permits a successful retry', async () => {
  let retry = false
  const h = await harness((_path, { signal }) => retry ? Promise.resolve({ ...guest, user }) : new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  }))
  h.render()
  assert.equal(h.timeouts[0].ms, 4000)
  h.timeouts[0].controller.abort(new DOMException('Timed out', 'TimeoutError'))
  await settle()
  assert.equal(h.render().checked, true)
  assert.equal(h.render().user, null)
  assert.match(h.render().sessionError, /couldn’t connect/)
  retry = true
  await h.render().refresh()
  assert.equal(h.render().user.id, user.id)
  assert.equal(h.render().sessionError, null)
  h.dispose()
})

test('malformed successful responses cannot unlock or crash the studio', async () => {
  for (const response of [null, {}, { ...guest, user: true }, { ...guest, user: { id: 'partial' } }, { user, providers: null }]) {
    const h = await harness(async () => response)
    h.render()
    await settle()
    assert.equal(h.render().user, null)
    assert.equal(h.render().checked, true)
    assert.equal(h.render().available, false)
    assert.ok(h.render().sessionError)
    h.dispose()
  }
})

test('successful sign out clears identity and failed sign out preserves it', async () => {
  let fail = true
  const h = await harness(async path => {
    if (path === '/auth/session') return { ...guest, user }
    if (fail) throw new Error('Offline')
    return { ok: true }
  })
  h.render()
  await settle()
  await assert.rejects(h.render().logout(), /Offline/)
  assert.equal(h.render().user.id, user.id)
  fail = false
  await h.render().logout()
  assert.equal(h.render().user, null)
  assert.equal(h.requests.at(-1).options.method, 'POST')
  assert.equal(h.requests.at(-1).options.headers['X-Paper-Account'], user.id)
  h.dispose()
})

test('unmount aborts authentication and callback cleanup preserves other URL state', async () => {
  const pending = deferred()
  const h = await harness(() => pending.promise, '?auth_error=Access%20denied&keep=1')
  h.render()
  assert.equal(h.render().authNotice, 'Access denied')
  assert.deepEqual(h.urls, ['/?keep=1#room=test'])
  h.dispose()
  assert.equal(h.requests[0].options.signal.aborted, true)
  pending.resolve({ ...guest, user })
  await settle()
  assert.equal(h.render().user, null)
})
