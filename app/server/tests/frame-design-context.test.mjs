import test from 'node:test'
import assert from 'node:assert/strict'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Duplex } from 'node:stream'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createService } from '../dist/server/service.js'
import { SceneStore } from '../dist/src/scene/store.js'
import { createProject } from '../dist/src/io/project.js'
import { approvePlan } from '../dist/src/make/plan.js'
import { createAppProject } from '../dist/src/make/manifest.js'

import { browserPass } from './fixtures/browser-validation.mjs'

const secret = 'test-secret-for-frame-design-context-tests-12345'

async function fixture(t, extra = {}) {
  const root = await mkdtemp(join(tmpdir(), 'paper-frame-context-'))
  let lastModelRequest = null

  const service = await createService({
    root,
    secret,
    origin: 'http://localhost:3000',
    appValidator: browserPass,
    ...extra,
    modelGateway: {
      provider: 'mock',
      rateLimitPerMinute: 20,
      turnBudget: 10,
      tokenBudget: 50000,
      timeoutMs: 2000,
      ...extra.modelGateway,
      customAdapter: async request => {
          lastModelRequest = request
          if (request.context?.mode === 'plan') {
            return {
              content: JSON.stringify({
                summary: 'App generated from bounded design context',
                files: [
                  { path: 'src/App.tsx', description: 'Main app component with mapped layer IDs', action: 'modify' },
                  { path: 'src/styles.css', description: 'Styles with frame tokens', action: 'modify' },
                ],
                interactions: ['Click action buttons'],
                risks: ['Preserve layout and styling constraints'],
              }),
              usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150, durationMs: 10 },
            }
          }
          return {
            content: JSON.stringify({
              summary: 'Generated app markup',
              files: [
                {
                  path: 'src/App.tsx',
                  content: 'import React from "react"\nexport default function App() { return <div data-layer-id="frame_root">Hello</div> }',
                },
                {
                  path: 'src/styles.css',
                  content: '.make-app { background: #111; }',
                },
              ],
            }),
            usage: { promptTokens: 120, completionTokens: 60, totalTokens: 180, durationMs: 10 },
          }
      },
    },
  })

  const responses = []
  t.after(async () => {
    service.close()
    for (const res of responses) res.emit('close')
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
    await service.handler(req, res, options.rawBody ? undefined : options.body ? JSON.parse(options.body) : {})
    const headers = new Headers()
    for (const line of res._header.split('\r\n').slice(1)) {
      const split = line.indexOf(':')
      if (split > 0) headers.append(line.slice(0, split), line.slice(split + 1).trim())
    }
    return { status: res.statusCode, headers, res, text: () => text }
  }

  const request = async (path, options = {}) => {
    const res = await open(path, options)
    return {
      status: res.status,
      headers: res.headers,
      data: res.headers.get('content-type')?.includes('json') ? JSON.parse(res.text()) : res.text(),
    }
  }

  const login = async sub => {
    const { user, session } = await service.auth.login('github', { sub, email: `${sub}@test.local`, name: sub, avatar: '' })
    return { user, session, headers: { Cookie: `paper_session=${session}`, 'X-Paper-Client': 'web' } }
  }

  return { service, open, request, login, getLastModelRequest: () => lastModelRequest }
}

function buildSceneFixture() {
  const store = new SceneStore()
  store.addTokens([
    { id: 'tok_card_bg', name: 'card-background', type: 'color', value: '#18181b' },
    { id: 'tok_accent', name: 'card-accent', type: 'color', value: '#81adec' },
    { id: 'tok_unrelated', name: 'secret-unrelated', type: 'color', value: '#ff0000' },
  ])

  let cardId = ''
  let buttonId = ''
  let titleId = ''
  store.batch(() => {
    const card = store.add('frame', {
      name: 'FixtureCard',
      width: 400,
      height: 250,
      cornerRadius: 8,
      layout: {
        direction: 'vertical',
        gap: 12,
        padding: { top: 16, right: 16, bottom: 16, left: 16 },
        justify: 'start',
        align: 'start',
      },
    })
    cardId = card.id
    store.bindToken(cardId, 'fill', 'tok_card_bg')

    const title = store.add('text', {
      name: 'CardHeading',
      parentId: cardId,
      width: 368,
      height: 24,
      text: 'Design Context Fixture',
      fontSize: 18,
      fontWeight: 600,
    })
    titleId = title.id

    const btn = store.add('frame', {
      name: 'ConfirmButton',
      parentId: cardId,
      width: 100,
      height: 36,
      cornerRadius: 6,
      layout: {
        direction: 'horizontal',
        gap: 0,
        padding: { top: 8, right: 12, bottom: 8, left: 12 },
        justify: 'center',
        align: 'center',
      },
    })
    buttonId = btn.id
    store.bindToken(buttonId, 'fill', 'tok_accent')
  })

  // Unrelated frame in the same scene
  let unrelatedId = ''
  store.batch(() => {
    const unrelated = store.add('frame', {
      name: 'OtherUnrelatedFrame',
      width: 500,
      height: 400,
    })
    unrelatedId = unrelated.id
    store.bindToken(unrelatedId, 'fill', 'tok_unrelated')
    store.add('text', {
      name: 'OtherUnrelatedText',
      parentId: unrelatedId,
      width: 200,
      height: 20,
      text: 'SECRET_UNRELATED_DATA',
    })
  })

  return {
    document: createProject(store, 'Design Project', { x: 0, y: 0, zoom: 1 }, true),
    cardId,
    buttonId,
    titleId,
    unrelatedId,
  }
}

test('server: frame design context endpoint returns bounded snapshot and rejects other accounts or invalid IDs', async t => {
  const { request, login } = await fixture(t)
  const userA = await login('alice')
  const userB = await login('bob')

  const { document, cardId, titleId } = buildSceneFixture()

  // Save project for user A
  const createRes = await request('/api/projects/proj-alice-1', {
    method: 'PUT',
    headers: userA.headers,
    body: JSON.stringify({ document, expectedRevision: null, updatedAt: Date.now() }),
  })
  assert.equal(createRes.status, 200)

  // 1. User A can read bounded frame context
  const contextRes = await request(`/api/projects/proj-alice-1/frames/${cardId}/context`, {
    headers: userA.headers,
  })
  assert.equal(contextRes.status, 200)
  assert.equal(contextRes.data.frameId, cardId)
  assert.equal(contextRes.data.frameName, 'FixtureCard')
  assert.equal(contextRes.data.bounds.width, 400)
  assert.equal(contextRes.data.bounds.height, 250)
  assert.equal(contextRes.data.layout.direction, 'vertical')
  assert.ok(contextRes.data.elements.length >= 3)
  assert.ok(contextRes.data.tokens.some(tok => tok.name === 'card-background'))
  // Must NOT include unrelated tokens or elements
  assert.ok(!contextRes.data.tokens.some(tok => tok.name === 'secret-unrelated'))
  assert.ok(!contextRes.data.elements.some(el => el.name === 'OtherUnrelatedFrame'))

  // 2. User B cannot access User A's frame context (cross-account isolation)
  const crossAccountRes = await request(`/api/projects/proj-alice-1/frames/${cardId}/context`, {
    headers: userB.headers,
  })
  assert.equal(crossAccountRes.status, 404)

  // 3. Invalid frame ID rejects with 404
  const invalidFrameRes = await request('/api/projects/proj-alice-1/frames/non-existent-frame/context', {
    headers: userA.headers,
  })
  assert.equal(invalidFrameRes.status, 404)

  // 4. Non-frame element ID rejects with 400
  const nonFrameRes = await request(`/api/projects/proj-alice-1/frames/${titleId}/context`, {
    headers: userA.headers,
  })
  assert.equal(nonFrameRes.status, 400)
})

test('server: planning with sceneReference attaches bounded design context and keeps unrelated scene contents out', async t => {
  const { request, login, getLastModelRequest } = await fixture(t)
  const userA = await login('alice')
  const userB = await login('bob')

  const { document, cardId, buttonId, unrelatedId } = buildSceneFixture()

  // Save project for user A
  await request('/api/projects/proj-alice-design', {
    method: 'PUT',
    headers: userA.headers,
    body: JSON.stringify({ document, expectedRevision: null, updatedAt: Date.now() }),
  })

  // 1. User A plans with sceneReference
  const planRes = await request('/api/model/plan', {
    method: 'POST',
    headers: userA.headers,
    body: JSON.stringify({
      prompt: 'Build a settings card inspired by the selected frame',
      context: {
        sceneReference: {
          projectId: 'proj-alice-design',
          frameId: cardId,
        },
      },
    }),
  })
  assert.equal(planRes.status, 200)

  // Inspect the actual request sent to the model adapter
  const modelReq = getLastModelRequest()
  assert.ok(modelReq, 'Model request must have been dispatched')

  // Prompt must contain frame info, layout, and layer IDs
  assert.match(modelReq.prompt, /FixtureCard/i)
  assert.match(modelReq.prompt, /data-layer-id/i)
  assert.match(modelReq.prompt, new RegExp(cardId))
  assert.match(modelReq.prompt, new RegExp(buttonId))
  assert.match(modelReq.prompt, /card-background/i)

  // Prompt must NEVER contain unrelated scene contents
  assert.ok(!modelReq.prompt.includes(unrelatedId))
  assert.ok(!modelReq.prompt.includes('OtherUnrelatedFrame'))
  assert.ok(!modelReq.prompt.includes('SECRET_UNRELATED_DATA'))
  assert.ok(!modelReq.prompt.includes('secret-unrelated'))

  // 2. User B trying to plan with User A's sceneReference rejects with 404
  const stolenPlanRes = await request('/api/model/plan', {
    method: 'POST',
    headers: userB.headers,
    body: JSON.stringify({
      prompt: 'Try to sneakily read alice design frame',
      context: {
        sceneReference: {
          projectId: 'proj-alice-design',
          frameId: cardId,
        },
      },
    }),
  })
  assert.equal(stolenPlanRes.status, 404)
})

test('server: rejected references and client-supplied snapshots never dispatch a model turn', async t => {
  const { request, login, getLastModelRequest } = await fixture(t)
  const alice = await login('alice'), bob = await login('bob')
  const { document, cardId, titleId } = buildSceneFixture()
  const scene = await request('/api/projects/private-design', { method: 'PUT', headers: alice.headers,
    body: JSON.stringify({ document, expectedRevision: null, updatedAt: Date.now() }) })
  const app = createAppProject({ id: 'owned-app', name: 'Test app', sceneReference: { projectId: 'private-design', frameId: cardId } })
  assert.equal((await request('/api/apps', { method: 'POST', headers: bob.headers, body: JSON.stringify({ project: app }) })).status, 201)
  const invalid = [
    [{ projectId: 'private-design', frameId: cardId }, bob, 404],
    [{ projectId: 'private-design', frameId: 'missing' }, alice, 404],
    [{ projectId: 'private-design', frameId: titleId }, alice, 400],
    [{ projectId: '../private-design', frameId: cardId }, alice, 400],
    [{ projectId: 'private-design', frameId: cardId, revision: 'stale' }, alice, 409],
    [{ projectId: 'private-design' }, alice, 400],
  ]
  for (const [reference, user, status] of invalid) {
    const result = await request('/api/model/plan', { method: 'POST', headers: user.headers,
      body: JSON.stringify({ prompt: 'Build', sceneReference: reference }) })
    assert.equal(result.status, status, JSON.stringify(result.data))
  }
  for (const payload of [{ designContext: { frameId: cardId } }, { context: { designContext: { frameId: cardId } } }]) {
    const result = await request('/api/model/plan', { method: 'POST', headers: alice.headers,
      body: JSON.stringify({ prompt: 'Build', ...payload }) })
    assert.equal(result.status, 400)
  }
  const saved = await request('/api/apps/owned-app/plan', { method: 'POST', headers: bob.headers,
    body: JSON.stringify({ prompt: 'Build', expectedRevision: 1 }) })
  assert.equal(saved.status, 404, 'Saved app references must also be account scoped')
  assert.equal(getLastModelRequest(), null)
  assert.equal(scene.status, 200)
})

test('server: generation uses the exact approved snapshot, rejects tampering, and preserves provenance', async t => {
  const { request, login, getLastModelRequest } = await fixture(t)
  const alice = await login('alice')
  const { document, cardId } = buildSceneFixture()
  const scene = await request('/api/projects/frozen-design', { method: 'PUT', headers: alice.headers,
    body: JSON.stringify({ document, expectedRevision: null, updatedAt: Date.now() }) })
  const project = createAppProject({ id: 'frozen-app', name: 'Frame app' })
  const planned = await request('/api/model/plan', { method: 'POST', headers: alice.headers,
    body: JSON.stringify({ prompt: 'Build frame app', project, sceneReference: { projectId: 'frozen-design', frameId: cardId, revision: scene.data.revision } }) })
  assert.equal(planned.status, 200, JSON.stringify(planned.data))
  assert.equal(planned.data.plan.designContext.frameId, cardId)
  const plan = approvePlan({ ...planned.data.plan, appId: project.id, baseRevision: project.revision }, project.revision)
  const modified = structuredClone(document)
  modified.scene.elements[cardId].name = 'CHANGED_AFTER_PLANNING'
  await request('/api/projects/frozen-design', { method: 'PUT', headers: alice.headers,
    body: JSON.stringify({ document: modified, expectedRevision: scene.data.revision, updatedAt: Date.now() }) })
  const tampered = structuredClone(plan)
  tampered.designContext.frameName = 'INJECTED_SNAPSHOT'
  assert.equal((await request('/api/model/generate', { method: 'POST', headers: alice.headers,
    body: JSON.stringify({ project, plan: tampered }) })).status, 409)
  const generated = await request('/api/model/generate', { method: 'POST', headers: alice.headers,
    body: JSON.stringify({ project, plan }) })
  assert.equal(generated.status, 200, JSON.stringify(generated.data))
  assert.equal(generated.data.success, true, JSON.stringify(generated.data))
  assert.equal(generated.data.project.sceneReference.frameId, cardId)
  assert.equal(generated.data.project.sceneReference.revision, scene.data.revision)
  const prompt = getLastModelRequest().prompt
  assert.match(prompt, /FixtureCard/)
  assert.match(prompt, /data-layer-id/)
  assert.ok(!prompt.includes('CHANGED_AFTER_PLANNING'))
  assert.ok(!prompt.includes('SECRET_UNRELATED_DATA'))
  const turns = await request('/api/model/turns', { headers: alice.headers })
  const generation = turns.data.turns.find(turn => turn.generation)
  assert.equal(generation.generation.plan.designContext.frameId, cardId)
})
