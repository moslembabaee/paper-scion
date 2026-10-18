import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MODEL_GATEWAY_LIMITS,
  redactSensitiveText,
  redactSensitiveObject,
  requestModelGeneration,
} from '../src/make/model-gateway.ts'
import { createMakeWorkspaceStore } from '../src/make/workspace-model.ts'

test('redactSensitiveText sanitizes API keys, bearer tokens and custom secrets', () => {
  const secretKey = 'sk-proj-1234567890abcdef'
  const bearerToken = 'Bearer eyJhbGciOiJIUzI1NiJ9.customsecrettoken'
  const googleKey = 'AIzaSyD1234567890123456789012345678901'
  const customSecret = 'my-private-database-password'

  const raw = `Error connecting to upstream: ${secretKey} using auth ${bearerToken} and key ${googleKey} and secret=${customSecret}`
  const sanitized = redactSensitiveText(raw, [customSecret])

  assert.ok(!sanitized.includes(secretKey), 'OpenAI/Anthropic key must be redacted')
  assert.ok(!sanitized.includes('customsecrettoken'), 'Bearer token must be redacted')
  assert.ok(!sanitized.includes(googleKey), 'Google API key must be redacted')
  assert.ok(!sanitized.includes(customSecret), 'Custom secret must be redacted')
  assert.ok(sanitized.includes('[REDACTED]'), 'Replacement tag must be present')
  assert.equal(redactSensitiveText('Short credential abc', ['abc']), 'Short credential [REDACTED]')
})

test('model client sends only a same-origin authenticated request and propagates cancellation', async t => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  let wire
  globalThis.fetch = async (url, options) => {
    wire = { url, ...options }
    return new Response(JSON.stringify({ turnId: 'turn_test', content: 'Safe content' }), { headers: { 'Content-Type': 'application/json' } })
  }
  const controller = new AbortController()
  const result = await requestModelGeneration({ prompt: 'Hello', appId: 'draft' }, { signal: controller.signal })
  assert.equal(wire.url, '/api/apps/draft/generate')
  assert.equal(wire.credentials, 'same-origin')
  assert.equal(wire.headers['X-Paper-Client'], 'web')
  assert.equal(wire.headers.Authorization, undefined)
  assert.equal(JSON.parse(wire.body).prompt, 'Hello')
  assert.equal(result.turnId, 'turn_test')
  controller.abort()
  assert.equal(wire.signal.aborted, true)
})

test('model requests and budgets remain bound to the workspace account', async t => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url, ...options })
    return new Response(JSON.stringify({ budget: { remainingTurns: 45 } }), { headers: { 'Content-Type': 'application/json' } })
  }
  const store = createMakeWorkspaceStore({ accountId: 'alice' })
  await store.loadBudget()
  await requestModelGeneration({ prompt: 'Hello' }, { accountId: 'alice' })
  assert.equal(requests.length, 2)
  for (const request of requests) assert.equal(request.headers['X-Paper-Account'], 'alice')
})

test('the development proxy routes model requests to the authenticated API', async t => {
  const { loadConfigFromFile } = await import('vite')
  const originalTarget = process.env.PAPER_API_URL
  t.after(() => {
    if (originalTarget === undefined) delete process.env.PAPER_API_URL
    else process.env.PAPER_API_URL = originalTarget
  })
  process.env.PAPER_API_URL = 'http://127.0.0.1:3001'
  const loaded = await loadConfigFromFile({ command: 'serve', mode: 'test' }, new URL('../vite.config.ts', import.meta.url).pathname)
  const routes = loaded.config.server.proxy
  for (const path of ['/api/model/generate', '/api/model/budget', '/api/model/turns', '/api/model/cancel']) {
    const prefix = Object.keys(routes).find(prefix => path.startsWith(prefix))
    assert.ok(prefix, `${path} must reach the API rather than Vite's HTML fallback`)
    assert.equal(routes[prefix].target, process.env.PAPER_API_URL)
    assert.equal(routes[prefix].changeOrigin, false)
  }
})

test('budget loads for unsaved drafts and suspended workspaces ignore late account data', async t => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  let release, wire
  const response = new Promise(resolve => { release = resolve })
  globalThis.fetch = async (url, options) => { wire = { url, ...options }; return response }
  const store = createMakeWorkspaceStore()
  const loading = store.loadBudget()
  assert.equal(wire.url, '/api/model/budget')
  store.suspend()
  assert.equal(wire.signal.aborted, true)
  release(new Response(JSON.stringify({ budget: { remainingTurns: 45 } }), { headers: { 'Content-Type': 'application/json' } }))
  await loading
  assert.equal(store.getState().budget, null)
})

test('redactSensitiveObject deep-sanitizes nested objects and arrays', () => {
  const payload = {
    apiKey: 'secret-key-12345678',
    headers: {
      authorization: 'Bearer token-secret-here',
      'x-api-key': 'another-secret-key-value',
    },
    items: [
      { prompt: 'Hello world' },
      { error: 'Failed with sk-1234567890abcdef' },
    ],
  }

  const redacted = redactSensitiveObject(payload)
  assert.equal(redacted.apiKey, '[REDACTED]')
  assert.equal(redacted.headers.authorization, '[REDACTED]')
  assert.equal(redacted.headers['x-api-key'], '[REDACTED]')
  assert.equal(redacted.items[0].prompt, 'Hello world')
  assert.ok(!redacted.items[1].error.includes('sk-1234567890abcdef'))
  assert.ok(redacted.items[1].error.includes('[REDACTED]'))
})

test('MODEL_GATEWAY_LIMITS conforms to production safety contracts', () => {
  assert.equal(MODEL_GATEWAY_LIMITS.MAX_PROMPT_BYTES, 64 * 1024, 'Max prompt 64 KiB')
  assert.equal(MODEL_GATEWAY_LIMITS.MAX_REQUEST_BYTES, 128 * 1024, 'Max request 128 KiB')
  assert.equal(MODEL_GATEWAY_LIMITS.MAX_OUTPUT_TOKENS, 8192, 'Max output tokens 8192')
  assert.equal(MODEL_GATEWAY_LIMITS.MAX_OUTPUT_BYTES, 256 * 1024, 'Max output 256 KiB')
  assert.equal(MODEL_GATEWAY_LIMITS.DEFAULT_TIMEOUT_MS, 30_000, 'Default timeout 30s')
  assert.equal(MODEL_GATEWAY_LIMITS.DEFAULT_RATE_LIMIT_PER_MINUTE, 20, 'Default rate limit 20 req/min')
})

test('Make workspace store tracks budget state and updates subscribers', () => {
  const store = createMakeWorkspaceStore()
  assert.equal(store.getState().budget, null)

  let notified = false
  const unsubscribe = store.subscribe(() => {
    notified = true
  })

  const sampleBudget = {
    usedTurns: 5,
    remainingTurns: 45,
    limitTurns: 50,
    usedTokens: 1200,
    remainingTokens: 198800,
    limitTokens: 200000,
  }

  store.setBudget(sampleBudget)
  assert.equal(notified, true)
  assert.deepEqual(store.getState().budget, sampleBudget)
  assert.equal(store.getState().budget.remainingTurns, 45)

  unsubscribe()
})
