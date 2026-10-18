import test from 'node:test'
import assert from 'node:assert/strict'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Duplex } from 'node:stream'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createService } from '../dist/server/service.js'
import { createAppProject } from '../dist/src/make/manifest.js'
import { createAppPlan, approvePlan } from '../dist/src/make/plan.js'
import { ServerModelGateway } from '../dist/server/model-gateway.js'

const secret = 'a-persistent-secret-for-model-gateway-tests-12345'
import { viewports, screenshots, browserPass, runtimeFailure } from './fixtures/browser-validation.mjs'

const FAKE_SERVER_KEY = 'sk-live-paper-secret-server-model-key-xyz987'

async function fixture(t, extra = {}) {
  const root = await mkdtemp(join(tmpdir(), 'paper-model-gateway-'))
  const service = await createService({
    root,
    secret,
    origin: 'http://localhost:3000',
    appValidator: browserPass,
    ...extra,
    modelGateway: {
      provider: 'mock',
      apiKey: FAKE_SERVER_KEY,
      rateLimitPerMinute: 5,
      turnBudget: 3,
      tokenBudget: 10000,
      timeoutMs: 500,
      ...extra.modelGateway,
    },
  })
  const responses = []
  t.after(async () => {
    service.close()
    for (const response of responses) response.emit('close')
    await rm(root, { recursive: true, force: true })
  })

  const open = async (path, options = {}) => {
    const socket = new Duplex({ read() {}, write(_chunk, _encoding, callback) { callback() } })
    socket.remoteAddress = '127.0.0.1'
    const req = new IncomingMessage(socket)
    req.url = path
    req.method = options.method ?? 'GET'
    req.headers = Object.fromEntries(
      Object.entries({ 'Content-Type': 'application/json', ...options.headers }).map(([k, v]) => [k.toLowerCase(), v])
    )
    const res = new ServerResponse(req)
    res.assignSocket(socket)
    responses.push(res)
    let text = ''
    const write = res.write.bind(res), end = res.end.bind(res)
    res.write = chunk => { text += String(chunk); return write(chunk) }
    res.end = chunk => { if (chunk) text += String(chunk); return end(chunk) }
    if (options.rawBody) {
      req.push(options.body ?? '')
      req.push(null)
    }
    options.onOpen?.(req, res)
    await service.handler(req, res, Object.hasOwn(options, 'parsedBody') ? options.parsedBody : options.rawBody ? undefined : options.body ? JSON.parse(options.body) : {})
    const headers = new Headers()
    for (const line of res._header.split('\r\n').slice(1)) {
      const split = line.indexOf(':')
      if (split > 0) headers.append(line.slice(0, split), line.slice(split + 1).trim())
    }
    return { status: res.statusCode, headers, res, text: () => text, req }
  }

  const request = async (path, options = {}) => {
    const response = await open(path, options)
    return {
      status: response.status,
      headers: response.headers,
      data: response.headers.get('content-type')?.includes('json') ? JSON.parse(response.text()) : response.text(),
    }
  }

  const login = async sub => {
    const { user, session } = await service.auth.login('github', {
      sub,
      email: `${sub}@test.local`,
      name: sub,
      avatar: '',
    })
    return {
      user,
      session,
      headers: { Cookie: `paper_session=${session}`, 'X-Paper-Client': 'web' },
    }
  }

  return { ...service, root, open, request, login }
}

test('model gateway enforces session authentication, CSRF guards, and origin validation', async t => {
  const f = await fixture(t)
  const a = await f.login('alice')

  // Unauthenticated requests must reject with 401
  assert.equal((await f.request('/api/model/generate', { method: 'POST', body: JSON.stringify({ prompt: 'Hello' }) })).status, 401)
  assert.equal((await f.request('/api/model/budget')).status, 401)

  // Mutating requests without CSRF guard ('X-Paper-Client: web') must reject with 403
  assert.equal((await f.request('/api/model/generate', {
    method: 'POST',
    headers: { Cookie: a.headers.Cookie },
    body: JSON.stringify({ prompt: 'Hello' }),
  })).status, 403)

  // Untrusted Origin must reject with 403
  assert.equal((await f.request('/api/model/generate', {
    method: 'POST',
    headers: { ...a.headers, Origin: 'https://evil.attacker.com' },
    body: JSON.stringify({ prompt: 'Hello' }),
  })).status, 403)
})

test('production app routes accept the raw JSON body supplied by Fastify', async t => {
  const f = await fixture(t)
  const a = await f.login('alice')
  const { data: app } = await f.request('/api/apps', {
    method: 'POST', headers: a.headers, body: JSON.stringify({ project: createAppProject({ name: 'Wire app' }) }),
  })
  const result = await f.request(`/api/apps/${app.id}/generate`, {
    method: 'POST', headers: a.headers, parsedBody: JSON.stringify({ prompt: 'Plan a counter' }),
  })
  assert.equal(result.status, 200)
})

test('timeout bounds an adapter that ignores abort and never accepts late content', { timeout: 1000 }, async () => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  const gateway = new ServerModelGateway({ timeoutMs: 20, customAdapter: () => pending })
  await assert.rejects(gateway.executeTurn({ userId: 'alice', request: { prompt: 'Hello' } }), { status: 504 })
  release({ content: 'Late content' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(gateway.listTurns('alice')[0].status, 'cancelled')
})

test('client cancellation aborts even an uncooperative adapter', async () => {
  const controller = new AbortController()
  const gateway = new ServerModelGateway({ customAdapter: async () => {
    controller.abort()
    return { content: 'Must not return this' }
  } })
  await assert.rejects(gateway.executeTurn({ userId: 'alice', request: { prompt: 'Hello' }, signal: controller.signal }), { status: 499 })
  assert.equal(gateway.listTurns('alice')[0].status, 'cancelled')
})

test('concurrent requests reserve the remaining turn budget before dispatch', async () => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  let calls = 0
  const gateway = new ServerModelGateway({ turnBudget: 1, customAdapter: async () => {
    calls++
    await pending
    return { content: 'OK' }
  } })
  const first = gateway.executeTurn({ userId: 'alice', request: { prompt: 'First' } })
  const second = gateway.executeTurn({ userId: 'alice', request: { prompt: 'Second' } })
  release()
  await first
  await assert.rejects(second, { status: 429 })
  assert.equal(calls, 1)
})

test('model and output limits cannot be overridden by the browser', async () => {
  let received
  const gateway = new ServerModelGateway({ defaultModel: 'approved-model', customAdapter: async request => {
    received = request
    return { content: 'OK', usage: { promptTokens: 1, completionTokens: 1 } }
  } })
  await gateway.executeTurn({ userId: 'alice', request: { prompt: 'Hello', maxTokens: 999999 } })
  assert.equal(received.maxTokens, 8192)
  await assert.rejects(gateway.executeTurn({ userId: 'alice', request: { prompt: 'Hello', model: 'expensive-unapproved-model' } }), { status: 400 })
  for (const maxTokens of [-1, 0, '100', 1.5]) {
    await assert.rejects(gateway.executeTurn({ userId: 'alice', request: { prompt: 'Hello', maxTokens } }), { status: 400 })
  }
})

test('oversized output and invalid usage never succeed or poison account metering', async () => {
  for (const result of [
    { content: 'x'.repeat(256 * 1024 + 1) },
    { content: 'Hello', usage: { promptTokens: -100, completionTokens: -10 } },
    { content: 'Hello', usage: { promptTokens: 1, completionTokens: 8193 } },
  ]) {
    const gateway = new ServerModelGateway({ customAdapter: async () => result })
    await assert.rejects(gateway.executeTurn({ userId: 'alice', request: { prompt: 'Hello' } }), { status: 502 })
    assert.equal(gateway.listTurns('alice')[0].status, 'error')
    assert.ok(gateway.getBudget('alice').usedTokens >= 0)
  }
})

test('cross-account isolation prevents generating against another user app', async t => {
  const f = await fixture(t)
  const a = await f.login('alice')
  const b = await f.login('bob')

  // Alice creates an app project
  const app = createAppProject({ name: 'Alice App' })
  const created = await f.request('/api/apps', {
    method: 'POST',
    headers: a.headers,
    body: JSON.stringify({ project: app }),
  })
  assert.equal(created.status, 201)
  const appId = created.data.id

  // Bob attempts to generate against Alice's app -> 404 (not found in Bob's scope)
  const bobGen = await f.request(`/api/apps/${appId}/generate`, {
    method: 'POST',
    headers: b.headers,
    body: JSON.stringify({ prompt: 'Add button' }),
  })
  assert.equal(bobGen.status, 404)
})

test('normal request completion is not cancellation; response disconnect is', async t => {
  for (const disconnect of [false, true]) {
    let started
    const ready = new Promise(resolve => { started = resolve })
    let release
    const pending = new Promise(resolve => { release = resolve })
    let signal
    const f = await fixture(t, { modelGateway: { customAdapter: async (_request, context) => {
      signal = context.signal
      started()
      await pending
      return { content: 'Complete' }
    } } })
    const a = await f.login('alice')
    let request, response
    const result = f.request('/api/model/generate', {
      method: 'POST', headers: a.headers, body: JSON.stringify({ prompt: 'Hello' }),
      onOpen: (req, res) => { request = req; response = res },
    })
    await ready
    request.emit('close')
    assert.equal(signal.aborted, false, 'A fully read body must not abort the provider')
    if (disconnect) response.emit('close')
    release()
    assert.equal((await result).status, disconnect ? 499 : 200)
    assert.equal(signal.aborted, disconnect)
    assert.equal(response.listenerCount('close'), 0)
  }
})

test('account-scoped turn discovery and cancellation cannot cancel another account', async t => {
  let started
  const ready = new Promise(resolve => { started = resolve })
  const f = await fixture(t, { modelGateway: { customAdapter: async () => {
    started()
    return new Promise(() => {})
  } } })
  const a = await f.login('alice'), b = await f.login('bob')
  const pending = f.request('/api/model/generate', {
    method: 'POST', headers: a.headers, body: JSON.stringify({ prompt: 'Hello' }),
  })
  await ready
  const turns = await f.request('/api/model/turns', { headers: a.headers })
  assert.equal(turns.data.turns.length, 1)
  assert.equal(turns.data.turns[0].status, 'pending')
  const { turnId } = turns.data.turns[0]
  assert.deepEqual((await f.request('/api/model/turns', { headers: b.headers })).data.turns, [])
  const cancel = headers => f.request('/api/model/cancel', { method: 'POST', headers, body: JSON.stringify({ turnId }) })
  assert.equal((await cancel(b.headers)).data.cancelled, false)
  assert.equal((await cancel(a.headers)).data.cancelled, true)
  assert.equal((await pending).status, 499)
  assert.equal((await f.request('/api/model/turns', { headers: a.headers })).data.turns.length, 1)
})

test('metering survives a service restart and never stores provider credentials or content', async t => {
  const f = await fixture(t)
  const a = await f.login('alice')
  await f.request('/api/model/generate', { method: 'POST', headers: a.headers, body: JSON.stringify({ prompt: 'Private customer prompt' }) })
  const original = f.modelGateway.getBudget(a.user.id)
  f.close()
  const restarted = await createService({ root: f.root, secret, origin: 'http://localhost:3000', modelGateway: { provider: 'mock', turnBudget: 3, tokenBudget: 10000 } })
  t.after(() => restarted.close())
  assert.deepEqual(restarted.modelGateway.getBudget(a.user.id), original)
  assert.equal(restarted.modelGateway.listTurns(a.user.id).length, 1)
  const ledger = await readFile(join(f.root, 'model-usage.json'), 'utf8')
  assert.ok(!ledger.includes(FAKE_SERVER_KEY))
  assert.ok(!ledger.includes('Private customer prompt'))
})

test('token reservations limit concurrent output and failed turns remain metered', async () => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  let request
  const gateway = new ServerModelGateway({ tokenBudget: 100, customAdapter: async input => {
    request = input
    await pending
    throw new Error('Billed upstream failure')
  } })
  const first = gateway.executeTurn({ userId: 'alice', request: { prompt: 'Hello', maxTokens: 8192 } })
  const checked = assert.rejects(first, { status: 502 })
  await assert.rejects(gateway.executeTurn({ userId: 'alice', request: { prompt: 'Hello' } }), { status: 429 })
  release()
  await checked
  assert.ok(request.maxTokens < 100)
  assert.equal(gateway.getBudget('alice').remainingTokens, 0)
  assert.equal(gateway.listTurns('alice')[0].usage.totalTokens, 100)
})

test('HTTP adapter limits response buffering, sends only server credentials and redacts success metadata', async () => {
  let cancelled = false
  let wire
  const gateway = new ServerModelGateway({ provider: 'http', baseUrl: 'https://provider.test/generate', apiKey: FAKE_SERVER_KEY, fetch: async (url, init) => {
    wire = { url, ...init }
    return new Response(JSON.stringify({ content: `Echo ${FAKE_SERVER_KEY}`, model: FAKE_SERVER_KEY, usage: { promptTokens: 1, completionTokens: 1 } }))
  } })
  const response = await gateway.executeTurn({ userId: 'alice', request: { prompt: 'Hello' } })
  assert.equal(wire.headers.Authorization, `Bearer ${FAKE_SERVER_KEY}`)
  assert.equal(wire.redirect, 'error')
  assert.ok(!JSON.stringify(response).includes(FAKE_SERVER_KEY))
  assert.ok(!JSON.stringify(gateway.listTurns('alice')).includes(FAKE_SERVER_KEY))
  const oversized = new ServerModelGateway({ provider: 'http', baseUrl: 'https://provider.test', apiKey: FAKE_SERVER_KEY, fetch: async () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(400 * 1024)) },
    cancel() { cancelled = true },
  })) })
  await assert.rejects(oversized.executeTurn({ userId: 'alice', request: { prompt: 'Hello' } }), { status: 502 })
  assert.equal(cancelled, true)
})

test('timeout cancels a stalled HTTP response body even when fetch ignores abort', async () => {
  let bodyCancelled = false
  const gateway = new ServerModelGateway({
    provider: 'http', baseUrl: 'https://provider.test/generate', apiKey: FAKE_SERVER_KEY,
    timeoutMs: 20,
    fetch: async () => new Response(new ReadableStream({
      cancel() { bodyCancelled = true },
    })),
  })
  await assert.rejects(gateway.executeTurn({ userId: 'alice', request: { prompt: 'Hello' } }), { status: 504 })
  assert.equal(bodyCancelled, true, 'The gateway must release the upstream stream at its deadline')
  assert.equal(gateway.listTurns('alice')[0].status, 'cancelled')
})

test('missing provider usage retains the conservative reservation rather than guessing tokens', async () => {
  const gateway = new ServerModelGateway({
    tokenBudget: 100,
    customAdapter: async () => ({ content: 'OK' }),
  })
  const result = await gateway.executeTurn({ userId: 'alice', request: { prompt: 'Hello' } })
  assert.equal(result.usage.totalTokens, 100)
  assert.equal(result.budget.remainingTokens, 0)
  await assert.rejects(gateway.executeTurn({ userId: 'alice', request: { prompt: 'Hello' } }), { status: 429 })
})

test('cancellable adapter and timeout aborts model call and returns timeout error', async t => {
  let adapterCalled = false
  let adapterSignalAborted = false

  const f = await fixture(t, {
    modelGateway: {
      timeoutMs: 80,
      customAdapter: async (_req, { signal }) => {
        adapterCalled = true
        return new Promise((resolve, reject) => {
          signal?.addEventListener('abort', () => {
            adapterSignalAborted = true
            reject(new Error('AbortError'))
          })
          setTimeout(() => resolve({ content: 'Finished too late' }), 300)
        })
      },
    },
  })
  const a = await f.login('alice')

  const res = await f.request('/api/model/generate', {
    method: 'POST',
    headers: a.headers,
    body: JSON.stringify({ prompt: 'Slow request' }),
  })

  assert.equal(adapterCalled, true)
  assert.equal(adapterSignalAborted, true)
  assert.equal(res.status, 504)
  assert.match(res.data.error, /timed out/i)
})

test('rate limiting rejects rapid model requests beyond configured limit', async t => {
  const f = await fixture(t, {
    modelGateway: {
      rateLimitPerMinute: 2,
    },
  })
  const a = await f.login('alice')

  // Request 1: OK
  const r1 = await f.request('/api/model/generate', {
    method: 'POST',
    headers: a.headers,
    body: JSON.stringify({ prompt: 'Turn 1' }),
  })
  assert.equal(r1.status, 200)

  // Request 2: OK
  const r2 = await f.request('/api/model/generate', {
    method: 'POST',
    headers: a.headers,
    body: JSON.stringify({ prompt: 'Turn 2' }),
  })
  assert.equal(r2.status, 200)

  // Request 3: Rate limited -> 429
  const r3 = await f.request('/api/model/generate', {
    method: 'POST',
    headers: a.headers,
    body: JSON.stringify({ prompt: 'Turn 3' }),
  })
  assert.equal(r3.status, 429)
  assert.match(r3.data.error, /too many model requests/i)
})

test('redaction prevents server-only credentials from leaking into responses or error messages', async t => {
  const f = await fixture(t, {
    modelGateway: {
      apiKey: FAKE_SERVER_KEY,
      customAdapter: async () => {
        // Provider throws an error containing the secret key and bearer token
        throw new Error(`Upstream rejected key ${FAKE_SERVER_KEY} and token Bearer eyJhbGciOiJIUzI1NiJ9.secret`)
      },
    },
  })
  const a = await f.login('alice')

  const res = await f.request('/api/model/generate', {
    method: 'POST',
    headers: a.headers,
    body: JSON.stringify({ prompt: 'Test redaction' }),
  })

  assert.equal(res.status, 502)
  assert.ok(!JSON.stringify(res.data).includes(FAKE_SERVER_KEY), 'Response must not contain fake server API key')
  assert.ok(!JSON.stringify(res.data).includes('eyJhbGciOiJIUzI1NiJ9.secret'), 'Response must not contain bearer secret')
  assert.equal(res.data.error, 'Model provider error: Provider request failed', 'Untrusted upstream diagnostics must be replaced entirely')
})

test('provider diagnostics cannot persist echoed private prompts or partial source', async t => {
  const privatePrompt = 'Private customer design: internal launch notes'
  const partialSource = 'export const password = "private-context-value"'
  const f = await fixture(t, { modelGateway: { customAdapter: async request => {
    throw new Error(`Rejected ${request.prompt}: ${partialSource}`)
  } } })
  const a = await f.login('alice')
  const result = await f.request('/api/model/generate', {
    method: 'POST', headers: a.headers, body: JSON.stringify({ prompt: privatePrompt }),
  })
  assert.equal(result.status, 502)
  const ledger = await readFile(join(f.root, 'model-usage.json'), 'utf8')
  for (const serialized of [JSON.stringify(result.data), JSON.stringify(f.modelGateway.listTurns(a.user.id)), ledger]) {
    assert.ok(!serialized.includes(privatePrompt), 'Upstream diagnostic text must not escape the provider boundary')
    assert.ok(!serialized.includes('private-context-value'), 'Partial source must not enter the usage ledger')
  }
})

test('provider failure does not persist partial edits or corrupt existing revisions', async t => {
  const f = await fixture(t, {
    modelGateway: {
      customAdapter: async () => {
        throw new Error('Provider 500 internal crash')
      },
    },
  })
  const a = await f.login('alice')

  // Create an app project
  const initialApp = createAppProject({
    name: 'Stable App',
    files: {
      'src/App.tsx': 'export default function App() { return <h1>Original Content</h1> }',
    },
  })
  const created = await f.request('/api/apps', {
    method: 'POST',
    headers: a.headers,
    body: JSON.stringify({ project: initialApp }),
  })
  assert.equal(created.status, 201)
  const appId = created.data.id
  const originalRevision = created.data.revision
  const originalFiles = created.data.files

  // Call generate with expectedRevision
  const failedGen = await f.request(`/api/apps/${appId}/generate`, {
    method: 'POST',
    headers: a.headers,
    body: JSON.stringify({
      prompt: 'Refactor everything into a dashboard',
      expectedRevision: originalRevision,
    }),
  })
  assert.equal(failedGen.status, 502)

  // Verify app project is completely untouched in storage
  const current = await f.request(`/api/apps/${appId}`, { headers: a.headers })
  assert.equal(current.status, 200)
  assert.equal(current.data.revision, originalRevision, 'Revision must not increment on failed generation')
  assert.deepEqual(current.data.files, originalFiles, 'Files must not be modified on failed generation')

  // Verify revision history has not recorded a partial revision
  const revisions = await f.request(`/api/apps/${appId}/revisions`, { headers: a.headers })
  assert.equal(revisions.status, 200)
  assert.equal(revisions.data.revisions.length, 1)
})

test('request size and output limits: oversized prompt rejects with 413', async t => {
  const f = await fixture(t)
  const a = await f.login('alice')

  // Prompt exceeding 64 KiB
  const oversizedPrompt = 'x'.repeat(65 * 1024)
  const res = await f.request('/api/model/generate', {
    method: 'POST',
    headers: a.headers,
    body: JSON.stringify({ prompt: oversizedPrompt }),
  })
  assert.equal(res.status, 413)
  assert.match(res.data.error, /prompt exceeds maximum allowed size/i)
})

test('invalid, oversized context and stale requests never dispatch a provider', async t => {
  let calls = 0
  const f = await fixture(t, { modelGateway: { customAdapter: async () => { calls++; return { content: 'OK' } } } })
  const a = await f.login('alice')
  for (const [payload, status] of [
    [{ prompt: ' ' }, 400],
    [{ prompt: 'Hello', apiKey: 'browser-key' }, 400],
    [{ prompt: 'Hello', context: { data: 'x'.repeat(128 * 1024) } }, 413],
    [{ prompt: '🙂'.repeat(20 * 1024) }, 413],
    [{ prompt: 'Hello', temperature: 'high' }, 400],
    [{ prompt: 'Hello', context: [] }, 400],
    [{ prompt: 'Hello', expectedRevision: -1 }, 400],
  ]) {
    const res = await f.request('/api/model/generate', { method: 'POST', headers: a.headers, body: JSON.stringify(payload) })
    assert.equal(res.status, status)
  }
  const { data: app } = await f.request('/api/apps', { method: 'POST', headers: a.headers, body: JSON.stringify({ project: createAppProject({ name: 'Stable' }) }) })
  const stale = await f.request(`/api/apps/${app.id}/generate`, { method: 'POST', headers: a.headers, body: JSON.stringify({ prompt: 'Hello', expectedRevision: app.revision + 1 }) })
  assert.equal(stale.status, 409)
  assert.equal(stale.data.current, app.revision)
  assert.equal(calls, 0)
})

test('already cancelled requests do not dispatch or spend budget', async () => {
  let called = false
  const gateway = new ServerModelGateway({ customAdapter: async () => { called = true; return { content: 'Late' } } })
  await assert.rejects(gateway.executeTurn({ userId: 'alice', request: { prompt: 'Hello' }, signal: AbortSignal.abort() }), { status: 499 })
  assert.equal(called, false)
  assert.equal(gateway.getBudget('alice').usedTurns, 0)
})

test('per-turn metering and budget enforcement decrement turns and reject when budget is exhausted', async t => {
  const f = await fixture(t, {
    modelGateway: {
      turnBudget: 2,
    },
  })
  const a = await f.login('alice')

  // Initial budget
  const b0 = await f.request('/api/model/budget', { headers: a.headers })
  assert.equal(b0.status, 200)
  assert.equal(b0.data.budget.remainingTurns, 2)
  assert.equal(b0.data.budget.usedTurns, 0)

  // Turn 1
  const t1 = await f.request('/api/model/generate', {
    method: 'POST',
    headers: a.headers,
    body: JSON.stringify({ prompt: 'Turn 1 prompt' }),
  })
  assert.equal(t1.status, 200)
  assert.ok(t1.data.turnId.startsWith('turn_'))
  assert.equal(t1.data.budget.usedTurns, 1)
  assert.equal(t1.data.budget.remainingTurns, 1)
  assert.ok(t1.data.usage.promptTokens > 0)
  assert.ok(t1.data.usage.completionTokens > 0)

  // Turn 2
  const t2 = await f.request('/api/model/generate', {
    method: 'POST',
    headers: a.headers,
    body: JSON.stringify({ prompt: 'Turn 2 prompt' }),
  })
  assert.equal(t2.status, 200)
  assert.equal(t2.data.budget.usedTurns, 2)
  assert.equal(t2.data.budget.remainingTurns, 0)

  // Turn 3: Budget exhausted -> 429
  const t3 = await f.request('/api/model/generate', {
    method: 'POST',
    headers: a.headers,
    body: JSON.stringify({ prompt: 'Turn 3 prompt' }),
  })
  assert.equal(t3.status, 429)
  assert.match(t3.data.error, /budget exceeded/i)

  // Check turn records endpoint
  const turns = await f.request('/api/model/turns', { headers: a.headers })
  assert.equal(turns.status, 200)
  assert.equal(turns.data.turns.length, 3) // 2 success + 1 budget_exceeded
})

const planOutput = {
  summary: 'Add a reset control',
  files: [{ path: 'src/App.tsx', description: 'Reset state', action: 'modify' }],
  interactions: ['Reset clears the count'], risks: [],
}

test('planning and approval preserve stored artifacts and enforce ownership, CSRF and stale revisions', async t => {
  const f = await fixture(t)
  const a = await f.login('plan-alice'), b = await f.login('plan-bob')
  const { data: app } = await f.request('/api/apps', { method: 'POST', headers: a.headers, body: JSON.stringify({ project: createAppProject({ name: 'Plan app' }) }) })
  const path = `/api/apps/${app.id}/plan`
  const post = (url, body, headers = a.headers) => f.request(url, { method: 'POST', headers, body: JSON.stringify(body) })
  assert.equal((await post(path, { prompt: 'Reset' }, {})).status, 401)
  assert.equal((await post(path, { prompt: 'Reset' }, { Cookie: a.headers.Cookie })).status, 403)
  assert.equal((await post(path, { prompt: 'Reset' }, b.headers)).status, 404)
  const planned = await post(path, { prompt: 'Reset', expectedRevision: app.revision })
  assert.equal(planned.status, 200)
  const plan = planned.data.plan
  assert.equal(plan.status, 'draft')
  assert.deepEqual((await f.request(`/api/apps/${app.id}`, { headers: a.headers })).data, app)
  assert.equal((await post(`${path}/approve`, { plan: { ...plan, summary: 'Tampered plan' } })).status, 409)
  assert.equal((await post(`${path}/approve`, { plan: { ...plan, files: [] } })).status, 400)
  assert.equal((await post(`${path}/approve`, { plan }, b.headers)).status, 404)
  const approved = await post(`${path}/approve`, { plan, expectedRevision: app.revision })
  assert.equal(approved.status, 200)
  assert.equal(approved.data.plan.status, 'approved')
  assert.equal((await post(`${path}/approve`, { plan })).status, 409, 'approval cannot be replayed')
  assert.deepEqual((await f.request(`/api/apps/${app.id}`, { headers: a.headers })).data, app)
  const second = await post(path, { prompt: 'Add undo', expectedRevision: app.revision })
  const updated = await f.request(`/api/apps/${app.id}`, { method: 'PUT', headers: a.headers, body: JSON.stringify({ project: { ...app, name: 'Edited' }, expectedRevision: app.revision }) })
  assert.equal(updated.status, 200)
  assert.equal((await post(`${path}/approve`, { plan: second.data.plan })).status, 409)
})

test('malformed provider planning output fails validation without updating the app', async t => {
  const f = await fixture(t, { modelGateway: { customAdapter: async () => ({ content: '{}' }) } })
  const a = await f.login('malformed-planner')
  const { data: app } = await f.request('/api/apps', { method: 'POST', headers: a.headers, body: JSON.stringify({ project: createAppProject({ name: 'Untouched' }) }) })
  const result = await f.request(`/api/apps/${app.id}/plan`, { method: 'POST', headers: a.headers, body: JSON.stringify({ prompt: 'Reset', expectedRevision: app.revision }) })
  assert.equal(result.status, 502)
  assert.match(result.data.error, /plan/i)
  assert.deepEqual((await f.request(`/api/apps/${app.id}`, { headers: a.headers })).data, app)
})

test('draft planning reads supplied context without creating an app or permitting output artifacts', async t => {
  let observed
  const f = await fixture(t, { modelGateway: { customAdapter: async request => { observed = request; return { content: JSON.stringify(planOutput) } } } })
  const a = await f.login('draft-planner')
  const project = createAppProject({ name: 'Unsaved', files: { 'src/App.tsx': 'export default function App() { return null }', 'src/Timer.tsx': 'export const Timer = () => null' } })
  const result = await f.request('/api/model/plan', { method: 'POST', headers: a.headers, body: JSON.stringify({ prompt: 'Add reset', project }) })
  assert.equal(result.status, 200)
  assert.match(observed.systemPrompt, /src\/Timer.tsx/)
  assert.equal(observed.appId, undefined)
  assert.deepEqual((await f.request('/api/apps', { headers: a.headers })).data.apps, [])
})

test('POST /api/apps/:id/generate with approved plan compiles and advances revision in storage', async t => {
  const f = await fixture(t)
  const a = await f.login('gen-alice')
  const { data: app } = await f.request('/api/apps', {
    method: 'POST',
    headers: a.headers,
    body: JSON.stringify({ project: createAppProject({ name: 'Counter Demo' }) }),
  })
  assert.equal(app.revision, 1)

  const plan = await approvedGenerationPlan(f, a.headers, app)

  // Unapproved plan should be rejected
  const unapproved = createAppPlan({
    appId: app.id,
    baseRevision: 1,
    prompt: 'Add counter buttons',
    summary: 'Draft',
    files: [{ path: 'src/App.tsx', description: 'Counter' }],
    interactions: ['Click'],
  })
  const unapprovedRes = await f.request(`/api/apps/${app.id}/generate`, {
    method: 'POST',
    headers: a.headers,
    body: JSON.stringify({ plan: unapproved }),
  })
  assert.equal(unapprovedRes.status, 400)

  // Stale plan (revision mismatch) should be rejected with 409
  const staleRes = await f.request(`/api/apps/${app.id}/generate`, {
    method: 'POST',
    headers: a.headers,
    body: JSON.stringify({ plan: { ...plan, baseRevision: 99 } }),
  })
  assert.equal(staleRes.status, 409)

  // Generate with valid approved plan
  const genRes = await f.request(`/api/apps/${app.id}/generate`, {
    method: 'POST',
    headers: a.headers,
    body: JSON.stringify({ plan }),
  })
  assert.equal(genRes.status, 200)
  assert.equal(genRes.data.success, true)
  assert.equal(genRes.data.project.revision, 2)
  assert.ok(genRes.data.assets)
  assert.ok(genRes.data.assets.js.includes('Generated Prototype'))
  assert.equal(genRes.data.diagnostics.length, 0)

  // Verify storage updated to revision 2
  const updated = (await f.request(`/api/apps/${app.id}`, { headers: a.headers })).data
  assert.equal(updated.revision, 2)
})

test('POST /api/apps/:id/generate: invalid compilation DOES NOT overwrite last usable revision', async t => {
  const f = await fixture(t, {
    modelGateway: {
      tokenBudget: 100000,
      customAdapter: async request => ({
        content: JSON.stringify(request.context?.mode === 'plan' ? planOutput : {
          summary: 'Broken code',
          files: [
            { path: 'src/App.tsx', content: 'export default function App() { return <div><span> unclosed }' },
          ],
        }),
      }),
    },
  })
  const a = await f.login('fail-gen-alice')
  const originalProject = createAppProject({ name: 'Safe Stable App' })
  const { data: app } = await f.request('/api/apps', {
    method: 'POST',
    headers: a.headers,
    body: JSON.stringify({ project: originalProject }),
  })
  assert.equal(app.revision, 1)

  const plan = await approvedGenerationPlan(f, a.headers, app)

  const genRes = await f.request(`/api/apps/${app.id}/generate`, {
    method: 'POST',
    headers: a.headers,
    body: JSON.stringify({ plan }),
  })
  assert.equal(genRes.status, 200)
  assert.equal(genRes.data.success, false)
  assert.equal(genRes.data.assets, null)
  assert.ok(genRes.data.diagnostics.length > 0)
  assert.equal(genRes.data.diagnostics[0].code, 'SYNTAX_ERROR')

  // Storage MUST NOT be overwritten!
  const current = (await f.request(`/api/apps/${app.id}`, { headers: a.headers })).data
  assert.equal(current.revision, 1)
  assert.deepEqual(current.files, originalProject.files)
})

async function approvedGenerationPlan(f, headers, app) {
  const draft = await f.request(`/api/apps/${app.id}/plan`, { method: 'POST', headers, body: JSON.stringify({ prompt: 'Build an interactive counter', expectedRevision: app.revision }) })
  assert.equal(draft.status, 200)
  const approval = await f.request(`/api/apps/${app.id}/plan/approve`, { method: 'POST', headers, body: JSON.stringify({ plan: draft.data.plan, expectedRevision: app.revision }) })
  assert.equal(approval.status, 200)
  return approval.data.plan
}

test('generation rejects forged approvals before dispatching or spending budget', async t => {
  const f = await fixture(t)
  const a = await f.login('forged-alice')
  const { data: app } = await f.request('/api/apps', { method: 'POST', headers: a.headers, body: JSON.stringify({ project: createAppProject() }) })
  const forged = approvePlan(createAppPlan({ appId: app.id, baseRevision: app.revision, prompt: 'Counter', summary: 'Counter', files: [{ path: 'src/App.tsx', description: 'Counter' }], interactions: ['Increment'] }), app.revision)
  const result = await f.request(`/api/apps/${app.id}/generate`, { method: 'POST', headers: a.headers, body: JSON.stringify({ plan: forged }) })
  assert.equal(result.status, 409)
  assert.equal(f.modelGateway.getBudget(a.user.id).usedTurns, 0)
  assert.equal((await f.storage.apps.read(a.user.id, app.id)).revision, 1)
})

test('generation durably preserves approved plan, validation diagnostics and rollback revision', async t => {
  const f = await fixture(t, { modelGateway: { turnBudget: 10, tokenBudget: 100000 } })
  const a = await f.login('provenance-alice')
  const { data: app } = await f.request('/api/apps', { method: 'POST', headers: a.headers, body: JSON.stringify({ project: createAppProject() }) })
  const plan = await approvedGenerationPlan(f, a.headers, app)
  const result = await f.request(`/api/apps/${app.id}/generate`, { method: 'POST', headers: a.headers, body: JSON.stringify({ plan }) })
  assert.equal(result.status, 200)
  assert.equal(result.data.success, true)
  const persisted = new ServerModelGateway({ provider: 'mock' })
  await persisted.initialize(f.root)
  const turn = persisted.listTurns(a.user.id, app.id).find(turn => turn.turnId === result.data.turnId)
  assert.deepEqual(turn.generation.plan, plan)
  assert.equal(turn.generation.sourceRevision, 1)
  assert.equal(turn.generation.resultRevision, 2)
  assert.equal(turn.generation.validation, 'passed')
  const checkpoint = await f.storage.apps.readRevision(a.user.id, app.id, 2)
  assert.equal(checkpoint.checkpoint.source, 'chat')
  assert.equal(checkpoint.checkpoint.turnId, result.data.turnId)
  assert.equal(checkpoint.diff.baseRevision, 1)
  assert.deepEqual(turn.generation.diagnostics, [])
  assert.equal((await f.storage.apps.readRevision(a.user.id, app.id, 1)).project.revision, 1)
})

test('untrusted generation fails closed for malformed output, imports and unplanned files with durable diagnostics', async t => {
  const cases = [
    ['not json', 'INVALID_INPUT'],
    [JSON.stringify({ files: [{ path: '../outside.tsx', content: 'export default () => null' }] }), 'INVALID_INPUT'],
    [JSON.stringify({ files: [{ path: 'src/App.tsx', content: "import fs from 'node:fs'; export default () => <p>Denied</p>" }] }), 'DENIED_IMPORT'],
    [JSON.stringify({ files: [{ path: 'src/App.tsx', content: 'export default () => <p>OK</p>' }, { path: 'src/unplanned.ts', content: 'export const extra = 1' }] }), 'INVALID_INPUT'],
  ]
  for (const [content, code] of cases) {
    await t.test(code, async t => {
      const f = await fixture(t, { modelGateway: { tokenBudget: 100000, customAdapter: async request => ({ content: request.context?.mode === 'plan' ? JSON.stringify(planOutput) : content }) } })
      const a = await f.login('invalid-generation')
      const { data: app } = await f.request('/api/apps', { method: 'POST', headers: a.headers, body: JSON.stringify({ project: createAppProject() }) })
      const plan = await approvedGenerationPlan(f, a.headers, app)
      const result = await f.request(`/api/apps/${app.id}/generate`, { method: 'POST', headers: a.headers, body: JSON.stringify({ plan }) })
      assert.equal(result.status, 200)
      assert.equal(result.data.success, false)
      assert.equal(result.data.assets, null)
      assert.equal(result.data.diagnostics[0].code, code)
      assert.deepEqual(await f.storage.apps.read(a.user.id, app.id), app)
      assert.equal((await f.storage.apps.listRevisions(a.user.id, app.id)).length, 1)
      const persisted = new ServerModelGateway({ provider: 'mock' })
      await persisted.initialize(f.root)
      const record = persisted.listTurns(a.user.id, app.id).find(turn => turn.turnId === result.data.turnId).generation
      assert.deepEqual(record.plan, plan)
      assert.equal(record.validation, 'failed')
      assert.equal(record.diagnostics[0].code, code)
    })
  }
})

test('source updates during generation reject the late commit and retain manual edits', async t => {
  let release, started
  const pending = new Promise(resolve => { release = resolve })
  const dispatched = new Promise(resolve => { started = resolve })
  const f = await fixture(t, { modelGateway: { tokenBudget: 100000, timeoutMs: 3000, customAdapter: async request => {
    if (request.context?.mode === 'plan') return { content: JSON.stringify(planOutput) }
    started()
    await pending
    return { content: JSON.stringify({ files: [{ path: 'src/App.tsx', content: 'export default () => <p>Generated</p>' }] }) }
  } } })
  const a = await f.login('concurrent-generation')
  const { data: app } = await f.request('/api/apps', { method: 'POST', headers: a.headers, body: JSON.stringify({ project: createAppProject() }) })
  const plan = await approvedGenerationPlan(f, a.headers, app)
  const generating = f.request(`/api/apps/${app.id}/generate`, { method: 'POST', headers: a.headers, body: JSON.stringify({ plan }) })
  await dispatched
  const manual = await f.storage.apps.put(a.user.id, app.id, { ...app, files: { 'src/App.tsx': { path: 'src/App.tsx', content: 'export default () => <p>Manual edit</p>' } } }, 1)
  release()
  assert.equal((await generating).status, 409)
  assert.deepEqual(await f.storage.apps.read(a.user.id, app.id), manual)
  assert.equal(f.modelGateway.listTurns(a.user.id, app.id)[0].generation.validation, 'conflict')
})

test('approved generation enforces authentication, CSRF, ownership and unchanged plan content', async t => {
  const f = await fixture(t, { modelGateway: { tokenBudget: 100000 } })
  const a = await f.login('generation-owner'), b = await f.login('generation-stranger')
  const { data: app } = await f.request('/api/apps', { method: 'POST', headers: a.headers, body: JSON.stringify({ project: createAppProject() }) })
  const plan = await approvedGenerationPlan(f, a.headers, app)
  const path = `/api/apps/${app.id}/generate`
  const post = (headers, candidate = plan) => f.request(path, { method: 'POST', headers, body: JSON.stringify({ plan: candidate }) })
  assert.equal((await post({})).status, 401)
  assert.equal((await post({ Cookie: a.headers.Cookie })).status, 403)
  assert.equal((await post(b.headers)).status, 404)
  assert.equal((await post(a.headers, { ...plan, summary: 'Tampered approved content' })).status, 409)
  assert.equal(f.modelGateway.getBudget(a.user.id).usedTurns, 1)
  assert.equal((await f.storage.apps.read(a.user.id, app.id)).revision, 1)
})

test('draft generation binds to issued plan and exact source without creating an account artifact', async t => {
  const f = await fixture(t, { modelGateway: { tokenBudget: 100000 } })
  const a = await f.login('draft-generation')
  const project = createAppProject()
  const draft = await f.request('/api/model/plan', { method: 'POST', headers: a.headers, body: JSON.stringify({ prompt: 'Interactive counter', project }) })
  assert.equal(draft.status, 200)
  const plan = approvePlan({ ...draft.data.plan, appId: project.id, baseRevision: project.revision }, project.revision)
  const post = input => f.request('/api/model/generate', { method: 'POST', headers: a.headers, body: JSON.stringify(input) })
  const tampered = await post({ plan, project: { ...project, name: 'Changed since planning' } })
  assert.equal(tampered.status, 409)
  const result = await post({ plan, project })
  assert.equal(result.status, 200)
  assert.equal(result.data.success, true)
  assert.equal(result.data.project.id, project.id)
  assert.equal(result.data.project.revision, project.revision + 1)
  assert.equal(result.data.project.preview.status, 'ready')
  assert.ok(result.data.assets.js.includes('Generated Prototype'))
  assert.deepEqual(await f.storage.apps.list(a.user.id), [])
})

test('follow-up edits target CSS alone, preserve other files and durably record one diff/rollback revision', async t => {
  const f = await fixture(t, { modelGateway: { tokenBudget: 100000, customAdapter: async request => ({ content: JSON.stringify(request.context?.mode === 'plan' ? {
    summary: 'Change the canvas color', files: [{ path: 'src/styles.css', action: 'modify', description: 'Use blue' }], interactions: ['Counter still works'], risks: [],
  } : { files: [{ path: 'src/styles.css', content: 'body { background: #81adec; }' }] }) }) } })
  const a = await f.login('css-follow-up')
  const { data: app } = await f.request('/api/apps', { method: 'POST', headers: a.headers, body: JSON.stringify({ project: createAppProject({ files: {
    'src/App.tsx': "import './styles.css'; export default () => <button>Counter</button>",
    'src/styles.css': 'body { background: #080808; }',
    'src/unrelated.ts': 'export const untouched = 123',
  } }) }) })
  const plan = await approvedGenerationPlan(f, a.headers, app)
  const result = await f.request(`/api/apps/${app.id}/generate`, { method: 'POST', headers: a.headers, body: JSON.stringify({ plan, expectedRevision: 1 }) })
  assert.equal(result.data.success, true)
  assert.equal(result.data.project.files['src/App.tsx'].content, app.files['src/App.tsx'].content)
  assert.deepEqual(result.data.project.files['src/unrelated.ts'], app.files['src/unrelated.ts'])
  assert.match(result.data.assets.css, /#81adec/)
  assert.equal(result.data.diff.changedFilesCount, 1)
  assert.equal(result.data.diff.files[0].path, 'src/styles.css')
  assert.equal(result.data.rollbackRevision, 1)
  const persisted = new ServerModelGateway({ provider: 'mock' })
  await persisted.initialize(f.root)
  const record = persisted.listTurns(a.user.id, app.id).find(turn => turn.turnId === result.data.turnId).generation
  assert.deepEqual(record.diff, result.data.diff)
  assert.equal(record.rollbackRevision, 1)
  assert.equal(record.sourceRevision, 1)
  assert.equal(record.resultRevision, 2)
  assert.equal(record.plan.prompt, plan.prompt)
  assert.equal((await f.storage.apps.listRevisions(a.user.id, app.id)).length, 2)
})

test('delete-only follow-up needs no replacement entry point and preserves unrelated sources', async t => {
  const f = await fixture(t, { modelGateway: { tokenBudget: 100000, customAdapter: async request => ({ content: JSON.stringify(request.context?.mode === 'plan' ? {
    summary: 'Remove unused file', files: [{ path: 'src/unused.ts', action: 'delete', description: 'Unused' }], interactions: ['App still runs'], risks: [],
  } : { files: [] }) }) } })
  const a = await f.login('delete-follow-up')
  const { data: app } = await f.request('/api/apps', { method: 'POST', headers: a.headers, body: JSON.stringify({ project: createAppProject({ files: {
    'src/App.tsx': 'export default () => <p>Preserved</p>', 'src/unused.ts': 'export const unused = 1',
  } }) }) })
  const plan = await approvedGenerationPlan(f, a.headers, app)
  const result = await f.request(`/api/apps/${app.id}/generate`, { method: 'POST', headers: a.headers, body: JSON.stringify({ plan }) })
  assert.equal(result.data.success, true)
  assert.equal(result.data.project.files['src/unused.ts'], undefined)
  assert.deepEqual(result.data.project.files['src/App.tsx'], app.files['src/App.tsx'])
  assert.equal(result.data.diff.files[0].action, 'delete')
})

test('rollback requires ownership and expected revision, validates before atomic restore', async t => {
  const f = await fixture(t)
  const a = await f.login('rollback-owner'), b = await f.login('rollback-stranger')
  const original = createAppProject({ files: { 'src/App.tsx': 'export default () => <p>Original</p>' } })
  const app = await f.storage.apps.put(a.user.id, original.id, original, null)
  const current = await f.storage.apps.put(a.user.id, app.id, { ...app, files: { 'src/App.tsx': { path: 'src/App.tsx', content: 'export default () => <p>Updated</p>' } } }, 1)
  const post = (headers, input) => f.request(`/api/apps/${app.id}/rollback`, { method: 'POST', headers, body: JSON.stringify(input) })
  assert.equal((await post(b.headers, { expectedRevision: 2 })).status, 404)
  assert.equal((await post(a.headers, {})).status, 409)
  assert.equal((await post(a.headers, { expectedRevision: 1 })).status, 409)
  assert.deepEqual(await f.storage.apps.read(a.user.id, app.id), current)
  const restored = await post(a.headers, { expectedRevision: 2, targetRevision: 1 })
  assert.equal(restored.status, 200)
  assert.equal(restored.data.project.revision, 3)
  assert.deepEqual(restored.data.project.files, app.files)
  assert.ok(restored.data.assets.js.includes('Original'))
  const invalidProject = createAppProject({ files: { 'src/App.tsx': 'export default () => <p>' } })
  const broken = await f.storage.apps.put(a.user.id, invalidProject.id, invalidProject, null)
  const usable = await f.storage.apps.put(a.user.id, broken.id, { ...broken, files: app.files }, 1)
  const rejected = await f.request(`/api/apps/${broken.id}/rollback`, { method: 'POST', headers: a.headers, body: JSON.stringify({ expectedRevision: 2 }) })
  assert.equal(rejected.status, 422)
  assert.deepEqual(await f.storage.apps.read(a.user.id, broken.id), usable)
  assert.equal((await f.storage.apps.listRevisions(a.user.id, broken.id)).length, 2)
})

test('disconnect after model output cancels follow-up before commit and preserves the usable revision', async t => {
  const f = await fixture(t, { modelGateway: { tokenBudget: 100000 } })
  const a = await f.login('cancel-follow-up')
  const { data: app } = await f.request('/api/apps', { method: 'POST', headers: a.headers, body: JSON.stringify({ project: createAppProject() }) })
  const plan = await approvedGenerationPlan(f, a.headers, app)
  let release, started, response
  const pending = new Promise(resolve => { release = resolve })
  const dispatched = new Promise(resolve => { started = resolve })
  const record = f.modelGateway.recordGeneration.bind(f.modelGateway)
  let first = true
  f.modelGateway.recordGeneration = async (...args) => {
    if (first) { first = false; started(); await pending }
    return record(...args)
  }
  t.after(() => release())
  const generating = f.request(`/api/apps/${app.id}/generate`, {
    method: 'POST', headers: a.headers, body: JSON.stringify({ plan }), onOpen(_req, res) { response = res },
  })
  await dispatched
  response.emit('close')
  release()
  assert.equal((await generating).status, 499)
  assert.deepEqual(await f.storage.apps.read(a.user.id, app.id), app)
  assert.equal((await f.storage.apps.listRevisions(a.user.id, app.id)).length, 1)
  const turn = f.modelGateway.listTurns(a.user.id, app.id).find(turn => turn.generation)
  assert.equal(turn.generation.validation, 'cancelled')
  assert.equal(turn.generation.rollbackRevision, undefined)
})

test('runtime diagnostics trigger one repair before saving with bounded private desktop/mobile feedback', async t => {
  const requests = []
  let validations = 0
  const f = await fixture(t, { appValidator: () => ++validations === 1 ? runtimeFailure() : browserPass(), modelGateway: { tokenBudget: 200000, timeoutMs: 3000, customAdapter: async request => {
    requests.push(request)
    return { content: JSON.stringify(request.context?.mode === 'plan' ? planOutput : {
      summary: 'Runtime fixture', files: [{ path: 'src/App.tsx', content: request.context?.mode === 'repair'
        ? 'export default () => <main>Repaired app</main>'
        : 'export default function App() { throw new Error("runtime fixture crash"); }' }],
    }) }
  } } })
  const a = await f.login('runtime-repair')
  const original = createAppProject()
  const app = await f.storage.apps.put(a.user.id, original.id, original, null)
  const plan = await approvedGenerationPlan(f, a.headers, app)
  const result = await f.request(`/api/apps/${app.id}/generate`, { method: 'POST', headers: a.headers, body: JSON.stringify({ plan }) })
  assert.equal(result.status, 200)
  assert.equal(result.data.success, true)
  assert.match(result.data.project.files['src/App.tsx'].content, /Repaired app/)
  assert.equal(result.data.validation.attempts.length, 2)
  assert.equal(result.data.validation.attempts[0].status, 'failed')
  assert.equal(result.data.validation.attempts[1].status, 'passed')
  const repair = requests.find(request => request.context?.mode === 'repair')
  assert.match(JSON.stringify(repair.context.feedback.diagnostics), /runtime fixture crash/)
  assert.deepEqual(repair.context.feedback.screenshots.map(s => s.viewport), ['desktop', 'mobile'])
  assert.ok(repair.context.feedback.screenshots.every(s => s.dataUrl.startsWith('data:image/jpeg;base64,') && s.dataUrl.length < 17000))
  assert.equal((await f.storage.apps.listRevisions(a.user.id, app.id)).length, 2)
  const ledger = await readFile(join(f.root, 'model-usage.json'), 'utf8')
  assert.doesNotMatch(ledger, /data:image|\/9j\//)
  assert.doesNotMatch(JSON.stringify(result.data.validation), /data:image|\/9j\//)
})

test('incomplete or contradictory browser success blocks generation without writing a revision', async t => {
  for (const invalid of [
    { status: 'passed', diagnostics: [], viewports: [], screenshots: [] },
    { ...await browserPass(), diagnostics: (await runtimeFailure()).diagnostics },
    { ...await browserPass(), screenshots: screenshots.slice(0, 1) },
    { ...await browserPass(), screenshots: screenshots.map(s => ({ ...s, dataUrl: 'data:image/jpeg;base64,' + 'A'.repeat(20000) })) },
  ]) {
    const f = await repairFixture(t, { appValidator: async () => invalid })
    const result = await f.generate()
    assert.equal(result.data.success, false)
    assert.equal(result.data.validation.status, 'blocked')
    assert.equal(f.requests.length, 2, 'infrastructure failures must not spend a repair turn')
    assert.deepEqual(await f.storage.apps.read(f.a.user.id, f.app.id), f.app)
    assert.doesNotMatch(JSON.stringify(result.data.validation), /data:image/)
  }
})

async function repairFixture(t, options = {}) {
  const requests = []
  const f = await fixture(t, { appValidator: options.appValidator ?? runtimeFailure, modelGateway: {
    tokenBudget: 200000, turnBudget: options.turnBudget ?? 10, rateLimitPerMinute: 20,
    customAdapter: async request => {
      requests.push(request)
      if (options.adapter) return options.adapter(request)
      return { content: JSON.stringify(request.context?.mode === 'plan' ? planOutput : { summary: 'Runtime fixture', files: [{ path: 'src/App.tsx', content: 'export default () => <main>Candidate</main>' }] }) }
    },
  } })
  const a = await f.login('bounded-repair')
  const original = createAppProject(options.project)
  const app = await f.storage.apps.put(a.user.id, original.id, original, null)
  const plan = await approvedGenerationPlan(f, a.headers, app)
  const generate = () => f.request(`/api/apps/${app.id}/generate`, { method: 'POST', headers: a.headers, body: JSON.stringify({ plan }) })
  return { ...f, a, app, plan, generate, requests }
}

test('persistent runtime error exhausts exactly two candidates; replay cannot reset the budget', async t => {
  const f = await repairFixture(t)
  const result = await f.generate()
  assert.equal(result.status, 200)
  assert.equal(result.data.success, false)
  assert.equal(result.data.validation.status, 'failed')
  assert.equal(result.data.validation.attempts.length, 2)
  assert.match(result.data.error, /budget exhausted/)
  assert.equal(f.requests.length, 3)
  assert.deepEqual(await f.storage.apps.read(f.a.user.id, f.app.id), f.app)
  assert.equal((await f.storage.apps.listRevisions(f.a.user.id, f.app.id)).length, 1)
  assert.equal((await f.generate()).status, 409)
  assert.equal(f.requests.length, 3)
})

test('compiler failure feeds bounded diagnostics to repair and saves only the validated candidate', async t => {
  let browserCalls = 0
  const f = await repairFixture(t, { appValidator: async () => { browserCalls++; return browserPass() }, adapter: async request => ({ content: JSON.stringify(request.context?.mode === 'plan' ? planOutput : {
    summary: 'Compile fixture', files: [{ path: 'src/App.tsx', content: request.context?.mode === 'repair' ? 'export default () => <main>Fixed</main>' : 'export default () => <main>' }],
  }) }) })
  const result = await f.generate()
  assert.equal(result.data.success, true)
  assert.equal(result.data.project.revision, 2)
  assert.equal(browserCalls, 1)
  const feedback = f.requests.find(r => r.context?.mode === 'repair').context.feedback
  assert.equal(feedback.diagnostics[0].code, 'SYNTAX_ERROR')
  assert.deepEqual(feedback.screenshots, [])
})

test('model budget exhaustion stops repair with a blocker and no source write', async t => {
  const f = await repairFixture(t, { turnBudget: 2 })
  const result = await f.generate()
  assert.equal(result.data.success, false)
  assert.equal(result.data.validation.status, 'blocked')
  assert.match(result.data.error, /model budget exhausted/)
  assert.equal(f.requests.length, 2)
  assert.deepEqual(await f.storage.apps.read(f.a.user.id, f.app.id), f.app)
})

test('browser infrastructure failure blocks without repair or leaking exception details', async t => {
  const f = await repairFixture(t, { appValidator: async () => { throw new Error(`private content ${FAKE_SERVER_KEY}`) } })
  const result = await f.generate()
  assert.equal(result.data.success, false)
  assert.equal(result.data.validation.status, 'blocked')
  assert.equal(f.requests.length, 2)
  assert.doesNotMatch(JSON.stringify(result.data), /private content|sk-live-paper-secret/)
  assert.deepEqual(await f.storage.apps.read(f.a.user.id, f.app.id), f.app)
})

test('sensitive untouched source blocks screenshots and is redacted from provider input', async t => {
  let captures = 0
  const f = await repairFixture(t, { project: { files: { 'src/App.tsx': 'export default () => <main>Original</main>', 'src/private.ts': 'export const password = "very-private-password123"' } },
    appValidator: async () => { captures++; return browserPass() },
  })
  const result = await f.generate()
  assert.equal(result.data.success, false)
  assert.equal(result.data.validation.status, 'blocked')
  assert.equal(captures, 0)
  assert.doesNotMatch(JSON.stringify(f.requests), /very-private-password123/)
  assert.equal(f.requests.length, 2)
  assert.deepEqual(await f.storage.apps.read(f.a.user.id, f.app.id), f.app)
})

test('diagnostic floods and credentials are bounded before feedback, response and durable history', async t => {
  const f = await repairFixture(t, { appValidator: async () => ({ status: 'failed', diagnostics: Array.from({ length: 40 }, () => ({
    file: 'src/App.tsx', line: 1, column: 1, severity: 'error', code: 'RUNTIME_ERROR', message: `Error ${FAKE_SERVER_KEY} Bearer abcdefghijklmnop ${'x'.repeat(10000)}`,
  })), viewports, screenshots }) })
  const result = await f.generate()
  assert.equal(result.data.success, false)
  assert.equal(result.data.diagnostics.length, 8)
  assert.ok(result.data.diagnostics.every(d => d.message.length <= 500))
  const feedback = f.requests.find(r => r.context?.mode === 'repair').context.feedback
  assert.equal(feedback.diagnostics.length, 8)
  for (const value of [JSON.stringify(feedback.diagnostics), JSON.stringify(result.data.validation), await readFile(join(f.root, 'model-usage.json'), 'utf8')]) {
    assert.doesNotMatch(value, /sk-live-paper-secret|abcdefghijklmnop|data:image|\/9j\//)
  }
})

test('known server secrets are redacted before truncating runtime feedback', async t => {
  const f = await repairFixture(t, { appValidator: async () => ({ ...await runtimeFailure(), diagnostics: [{
    file: 'src/App.tsx', line: 1, column: 1, code: 'RUNTIME_ERROR', severity: 'error',
    message: 'x'.repeat(490) + secret,
  }] }) })
  const result = await f.generate()
  const feedback = f.requests.find(r => r.context?.mode === 'repair').context.feedback
  for (const value of [JSON.stringify(feedback.diagnostics), JSON.stringify(result.data.validation), await readFile(join(f.root, 'model-usage.json'), 'utf8')]) {
    assert.doesNotMatch(value, /a-persistent/)
  }
  assert.equal(result.data.success, false)
})
