import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SceneStore } from '../src/scene/store.ts'
import { createProject, parseProject } from '../src/io/project.ts'
import { LiveCanvas } from '../src/mcp/live.ts'
import { PaperFiles } from '../mcp/files.ts'
import { executeTransaction } from '../src/mcp/transaction.ts'
import { paperTools, validateSchema } from '../src/mcp/schema.ts'

function createLiveFixture(t, name = 'Atomic Study') {
  const store = new SceneStore()
  const activities = []
  const live = new LiveCanvas({
    projectId: 'test-project',
    store,
    getProject: () => createProject(store, name, { x: 0, y: 0, zoom: 1 }, true),
    onSettings() {},
    onActivity: value => activities.push(value),
  })
  live.start()
  t.after(() => live.close())
  return { live, store, activities }
}

async function createFileFixture(t) {
  const workspace = await mkdtemp(join(tmpdir(), 'paper-atomic-file-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const files = await PaperFiles.create({ workspace, file: 'study.paper.json' })
  return { workspace, files }
}

test('TDD: partial mutation rolls back entire batch when middle step fails', t => {
  const { live, store } = createLiveFixture(t)
  const initialRevision = live.revision
  const initialUndoCount = store.getHistorySnapshot().undoCount

  assert.throws(() => {
    live.call('apply_changes', {
      expected_revision: initialRevision,
      operations: [
        { action: 'create', type: 'frame', id: 'frame-1', name: 'Frame 1', x: 0, y: 0, width: 300, height: 200 },
        { action: 'create', type: 'rectangle', id: 'rect-invalid', parentId: 'frame-1', width: -50, height: 100 },
        { action: 'create', type: 'text', id: 'text-1', parentId: 'frame-1', text: 'Hello' },
      ],
    })
  }, /must be greater than 0|exclusiveMinimum|width|supported value/)

  // Verify that frame-1 was NOT created - complete rollback!
  assert.equal(store.getSnapshot().elements['frame-1'], undefined)
  assert.equal(store.getSnapshot().elements['rect-invalid'], undefined)
  assert.equal(store.getSnapshot().elements['text-1'], undefined)
  assert.equal(store.getHistorySnapshot().undoCount, initialUndoCount)
  assert.equal(live.revision, initialRevision)
})

test('dry-run never edits caller arguments and rejects ignored or malformed fields', t => {
  const { live, store } = createLiveFixture(t)
  live.call('create_frame', { id: 'seed' })
  const plan = { expected_revision: live.revision, dry_run: true, operations: [
    { action: 'update', element_id: 'seed', patch: {}, name: 'Preview only' },
  ] }
  const original = structuredClone(plan)
  live.call('apply_changes', plan)
  assert.deepEqual(plan, original)
  for (const operation of [
    { action: 'create', type: 'ellipse', text: 'ignored' },
    { action: 'create', type: 'text', typo: 'ignored' },
    { action: 'update_token', token_id: 'missing', patch: { type: 'color' } },
    { action: 'reparent', element_id: 'seed' },
    { action: 'set_layout', element_id: 'seed', layout: { direction: 'invalid' } },
  ]) {
    const before = store.getSnapshot()
    assert.throws(() => executeTransaction(createProject(store, 'Test', { x: 0, y: 0, zoom: 1 }, true), { expected_revision: live.revision, operations: [operation] }))
    assert.equal(store.getSnapshot(), before)
  }
})

test('idempotency keys reject different plans instead of silently claiming success', t => {
  const { live, store } = createLiveFixture(t)
  const plan = { expected_revision: live.revision, idempotency_key: 'same-key', operations: [{ action: 'create', type: 'text', text: 'First' }] }
  const response = live.call('apply_changes', plan)
  assert.deepEqual(live.call('apply_changes', structuredClone(plan)), response)
  assert.throws(() => live.call('apply_changes', { ...plan, operations: [{ action: 'create', type: 'text', text: 'Second' }] }), /idempotency/i)
  assert.equal(Object.keys(store.getSnapshot().elements).length, 1)
})

test('conflicting operation aliases reject the whole plan instead of choosing a target silently', t => {
  const { live, store } = createLiveFixture(t)
  live.call('create_frame', { id: 'seed' })
  live.call('create_frame', { id: 'other' })
  live.call('create_token', { id: 'blue', name: 'blue', type: 'color', value: '#81adec' })
  live.call('create_token', { id: 'black', name: 'black', type: 'color', value: '#080808' })
  const revision = live.revision, before = store.getSnapshot(), history = store.getHistorySnapshot()
  for (const operation of [
    { action: 'update', element_id: 'seed', id: 'other', patch: { name: 'Wrong target' } },
    { action: 'bind_token', element_id: 'seed', property: 'fill', token_id: 'blue', tokenId: 'black' },
    { action: 'update_token', token_id: 'blue', id: 'black', value: '#222222' },
    { action: 'create_instance', master_id: 'seed', masterId: 'other' },
  ]) {
    assert.throws(() => live.call('apply_changes', { expected_revision: revision, operations: [
      { action: 'create', type: 'text', id: 'temporary' }, operation,
    ] }), /conflicting.*aliases/i)
    assert.equal(store.getSnapshot(), before)
    assert.deepEqual(store.getHistorySnapshot(), history)
    assert.equal(live.revision, revision)
  }
})

test('file retries are scoped by canonical file path and malformed plans preserve disk bytes', async t => {
  const { files, workspace } = await createFileFixture(t)
  await files.call('create_frame', { id: 'seed' })
  await files.call('create_frame', { file: 'other.paper.json', id: 'other' })
  const revision = (await files.call('get_basic_info', {})).revision
  const plan = { expected_revision: revision, idempotency_key: 'shared-key', operations: [{ action: 'create', type: 'text', text: 'First' }] }
  const first = await files.call('apply_changes', plan)
  const otherRev = (await files.call('get_basic_info', { file: 'other.paper.json' })).revision
  const other = await files.call('apply_changes', { ...plan, file: 'other.paper.json', expected_revision: otherRev })
  assert.equal(other.file, 'other.paper.json')
  assert.notEqual(first.revision, other.revision)
  const before = await readFile(join(workspace, 'study.paper.json'))
  for (const bad of [
    { operations: [{ action: 'create', type: 'text' }] },
    { expected_revision: first.revision, operations: [{ action: 'create', type: 'text', id: 'temporary' }, { action: 'update', element_id: 'missing', patch: { name: 'Fail' } }] },
  ]) await assert.rejects(files.call('apply_changes', bad))
  assert.deepEqual(await readFile(join(workspace, 'study.paper.json')), before)
})

test('component, auto-layout, nested locks, image and shape operations use SceneStore invariants', t => {
  const { live, store } = createLiveFixture(t)
  const layout = { direction: 'vertical', gap: 8, padding: { top: 12, right: 12, bottom: 12, left: 12 }, justify: 'start', align: 'start' }
  const result = live.call('apply_changes', { expected_revision: live.revision, operations: [
    { action: 'create', type: 'frame', id: 'master' },
    { action: 'create', type: 'text', parentId: '$0', text: 'Default' },
    { action: 'set_layout', element_id: '$0', layout },
    { action: 'create_component', element_id: '$0' },
    { action: 'set_component_properties', master_id: '$0', properties: [{ id: 'title', name: 'Title', kind: 'text', sourceId: '$1', defaultValue: 'Default' }] },
    { action: 'create_instance', master_id: '$0' },
    { action: 'set_component_property', element_id: '$5', property_id: 'title', value: 'Instance' },
    { action: 'create', type: 'image', id: 'photo', src: 'https://example.test/photo.png' },
    { action: 'create', type: 'ellipse', id: 'circle' },
    { action: 'reparent', element_id: 'circle', parentId: 'master' },
  ] })
  assert.equal(store.getSnapshot().elements.master.layout.gap, 8)
  const instance = store.getSnapshot().elements[result.actionResults[5].id]
  assert.equal(store.getSnapshot().elements[instance.children[0]].text, 'Instance')
  assert.equal(store.getHistorySnapshot().undoCount, 1)
  validateSchema(result, paperTools.find(tool => tool.name === 'apply_changes').outputSchema)
  live.call('update_element', { element_id: 'master', patch: { locked: true } })
  const revision = live.revision
  assert.throws(() => live.call('apply_changes', { expected_revision: revision, operations: [{ action: 'update', element_id: result.actionResults[1].id, patch: { text: 'Blocked' } }] }), /locked/i)
  assert.throws(() => live.call('apply_changes', { expected_revision: revision, operations: [{ action: 'update', element_id: result.actionResults[1].id, patch: { locked: false, text: 'Blocked' } }] }), /locked/i)
  live.call('apply_changes', { expected_revision: revision, operations: [{ action: 'update', element_id: 'master', patch: { locked: false }, parentId: null }] })
})

test('payload limits and compact preview warn about omitted content without touching history', t => {
  const { live, store } = createLiveFixture(t)
  const revision = live.revision
  assert.throws(() => live.call('apply_changes', { expected_revision: revision, operations: [{ action: 'create', type: 'text', text: 'x'.repeat(513 * 1024) }] }), /payload|size|limit/i)
  assert.equal(live.revision, revision)
  const preview = live.call('apply_changes', { expected_revision: revision, dry_run: true, operations: [{ action: 'create', type: 'text', text: 'x'.repeat(50000) }] })
  assert.ok(JSON.stringify(preview.summary).length < 32768)
  assert.ok(preview.warnings.length > 0)
  assert.equal(store.getHistorySnapshot().undoCount, 0)
})

test('TDD: stale revision rejects without any side effects', t => {
  const { live, store } = createLiveFixture(t)
  const initialRevision = live.revision

  // Advance revision by adding a frame
  live.call('create_frame', { id: 'seed-frame' })
  const newRevision = live.revision
  assert.notEqual(newRevision, initialRevision)

  const beforeElements = { ...store.getSnapshot().elements }
  const beforeUndo = store.getHistorySnapshot().undoCount

  assert.throws(() => {
    live.call('apply_changes', {
      expected_revision: initialRevision, // Stale!
      operations: [
        { action: 'create', type: 'rectangle', id: 'rect-stale', parentId: 'seed-frame', width: 100, height: 100 },
      ],
    })
  }, /Revision mismatch/)

  assert.deepEqual(store.getSnapshot().elements, beforeElements)
  assert.equal(store.getHistorySnapshot().undoCount, beforeUndo)
  assert.equal(live.revision, newRevision)
})

test('TDD: dry_run returns before/after summary and warnings without mutating state, revisions, history, or selection', t => {
  const { live, store } = createLiveFixture(t)
  live.call('create_frame', { id: 'base-frame', width: 400, height: 300 })
  store.select(['base-frame'])
  const beforeSnapshot = store.getSnapshot()
  const beforeRevision = live.revision
  const beforeUndo = store.getHistorySnapshot().undoCount
  const beforeSelection = [...store.getSnapshot().selection]

  const result = live.call('apply_changes', {
    expected_revision: beforeRevision,
    dry_run: true,
    operations: [
      { action: 'create', type: 'text', id: 'headline', parentId: 'base-frame', text: 'Dry Run Text', x: 20, y: 20, width: 200, height: 40 },
      { action: 'create_token', name: 'accent-color', type: 'color', value: '#81adec' },
      { action: 'bind_token', element_id: 'headline', property: 'fill', token_id: 'accent-color' },
    ],
  })

  // Assert result structure
  assert.equal(result.dry_run, true)
  assert.equal(result.revision, beforeRevision)
  assert.ok(result.summary, 'Summary should be returned')
  assert.ok(result.summary.changedIds.includes('headline'))
  assert.ok(Array.isArray(result.warnings))
  assert.equal(result.actionResults.length, 3)

  // Assert NO state mutation
  assert.equal(store.getSnapshot().elements.headline, undefined)
  assert.equal(store.getSnapshot().tokens.find(t => t.name === 'accent-color'), undefined)
  assert.equal(store.getHistorySnapshot().undoCount, beforeUndo)
  assert.equal(live.revision, beforeRevision)
  assert.deepEqual(store.getSnapshot().selection, beforeSelection)
  assert.deepEqual(store.getSnapshot(), beforeSnapshot)
})

test('TDD: retry duplication prevents duplicate layers and respects idempotency key', t => {
  const { live, store } = createLiveFixture(t)
  const initialRevision = live.revision

  const plan = {
    expected_revision: initialRevision,
    idempotency_key: 'idem-key-12345',
    operations: [
      { action: 'create', type: 'frame', id: 'idem-frame', width: 300, height: 300 },
      { action: 'create', type: 'rectangle', id: 'idem-rect', parentId: 'idem-frame', width: 100, height: 100 },
    ],
  }

  const firstResult = live.call('apply_changes', plan)
  assert.equal(firstResult.applied, true)
  assert.ok(store.getSnapshot().elements['idem-frame'])
  assert.ok(store.getSnapshot().elements['idem-rect'])
  const intermediateUndo = store.getHistorySnapshot().undoCount
  const updatedRevision = live.revision

  // Retry with same idempotency key and original expected_revision
  const retryResult = live.call('apply_changes', plan)
  assert.equal(retryResult.applied, true)
  assert.deepEqual(retryResult.changedIds, firstResult.changedIds)
  // History count should NOT increase on retry
  assert.equal(store.getHistorySnapshot().undoCount, intermediateUndo)
  // Elements count should NOT increase or duplicate
  assert.equal(Object.keys(store.getSnapshot().elements).length, 2)
})

test('TDD: undo boundaries create exactly one undo entry for a multi-step batch', t => {
  const { live, store } = createLiveFixture(t)
  const initialRevision = live.revision
  const beforeUndo = store.getHistorySnapshot().undoCount

  const result = live.call('apply_changes', {
    expected_revision: initialRevision,
    operations: [
      { action: 'create', type: 'frame', id: 'card', width: 400, height: 300 },
      { action: 'create', type: 'text', id: 'card-title', parentId: 'card', text: 'Card Title' },
      { action: 'create', type: 'rectangle', id: 'card-badge', parentId: 'card', width: 60, height: 24 },
      { action: 'create_token', name: 'badge-bg', type: 'color', value: '#edebe1' },
      { action: 'bind_token', element_id: 'card-badge', property: 'fill', token_id: 'badge-bg' },
    ],
  })

  assert.equal(result.applied, true)
  assert.equal(store.getHistorySnapshot().undoCount, beforeUndo + 1, 'Exactly one undo step created')

  // One undo rolls back EVERYTHING
  store.undo()
  assert.equal(store.getSnapshot().elements.card, undefined)
  assert.equal(store.getSnapshot().elements['card-title'], undefined)
  assert.equal(store.getSnapshot().elements['card-badge'], undefined)
  assert.equal(store.getSnapshot().tokens.find(t => t.name === 'badge-bg'), undefined)

  // Redo brings everything back
  store.redo()
  assert.ok(store.getSnapshot().elements.card)
  assert.ok(store.getSnapshot().elements['card-title'])
  assert.ok(store.getSnapshot().elements['card-badge'])
  assert.ok(store.getSnapshot().tokens.find(t => t.name === 'badge-bg'))
})

test('TDD: valid multi-step frame + text + token binding and explicit ordering reference', t => {
  const { live, store } = createLiveFixture(t)
  const rev = live.revision

  const result = live.call('apply_changes', {
    expected_revision: rev,
    operations: [
      {
        action: 'create',
        type: 'frame',
        id: 'auto-card',
        name: 'Auto Card',
        width: 320,
        height: 240,
        layout: { direction: 'vertical', gap: 12, padding: { top: 16, right: 16, bottom: 16, left: 16 }, justify: 'start', align: 'center' },
      },
      {
        action: 'create',
        type: 'text',
        parentId: 'auto-card',
        text: 'Dynamic Header',
        fontSize: 20,
      },
      {
        action: 'create_token',
        name: 'header-token',
        type: 'color',
        value: '#222222',
      },
      {
        action: 'bind_token',
        element_id: '$1', // Referencing step 1 created text element!
        property: 'fill',
        token_id: '$2', // Referencing step 2 created token!
      },
    ],
  })

  assert.equal(result.applied, true)
  const card = store.getSnapshot().elements['auto-card']
  assert.ok(card)
  assert.equal(card.layout.direction, 'vertical')
  assert.equal(card.children.length, 1)

  const textId = card.children[0]
  const textElem = store.getSnapshot().elements[textId]
  assert.ok(textElem)
  assert.equal(textElem.text, 'Dynamic Header')

  const token = store.getSnapshot().tokens.find(t => t.name === 'header-token')
  assert.ok(token)
  assert.equal(textElem.tokenBindings.fill, token.id)
})

test('TDD: nested and locked nodes reject unauthorized changes and rollback', t => {
  const { live, store } = createLiveFixture(t)
  live.call('create_frame', { id: 'parent-frame', width: 400, height: 400, locked: true })
  const rev = live.revision

  assert.throws(() => {
    live.call('apply_changes', {
      expected_revision: rev,
      operations: [
        { action: 'create', type: 'rectangle', parentId: 'parent-frame', width: 50, height: 50 },
      ],
    })
  }, /locked/i)

  assert.equal(store.getSnapshot().elements['parent-frame'].children.length, 0)
})

test('TDD: limit breaches reject before mutation', t => {
  const { live } = createLiveFixture(t)
  const rev = live.revision

  // Breach 1: > 100 operations
  const tooManyOps = Array.from({ length: 101 }, (_, i) => ({
    action: 'create_token',
    name: `token-${i}`,
    type: 'color',
    value: '#000000',
  }))

  assert.throws(() => {
    live.call('apply_changes', {
      expected_revision: rev,
      operations: tooManyOps,
    })
  }, /too many items|limit of 100 operations/i)

  // Breach 2: empty operations
  assert.throws(() => {
    live.call('apply_changes', {
      expected_revision: rev,
      operations: [],
    })
  }, /too few items|must not be empty/i)
})

test('TDD: two simultaneous agents racing on same revision', t => {
  const { live } = createLiveFixture(t)
  const baseRevision = live.revision

  // Agent A succeeds
  const resA = live.call('apply_changes', {
    expected_revision: baseRevision,
    operations: [{ action: 'create', type: 'frame', id: 'agent-a-frame', width: 200, height: 200 }],
  })
  assert.equal(resA.applied, true)

  // Agent B submits concurrently with the initial baseRevision
  assert.throws(() => {
    live.call('apply_changes', {
      expected_revision: baseRevision,
      operations: [{ action: 'create', type: 'frame', id: 'agent-b-frame', width: 200, height: 200 }],
    })
  }, /Revision mismatch/)
})

test('TDD: offline file mode supports atomic apply_changes, dry_run, rollback, and retries', async t => {
  const { workspace, files } = await createFileFixture(t)
  const filePath = join(workspace, 'study.paper.json')

  // Create initial frame via standard tool to establish file
  await files.call('create_frame', { id: 'root-frame', width: 500, height: 500 })
  const info = await files.call('get_basic_info', {})
  const initialRev = info.revision

  // 1. Dry run
  const dryResult = await files.call('apply_changes', {
    expected_revision: initialRev,
    dry_run: true,
    operations: [
      { action: 'create', type: 'text', id: 'offline-text', parentId: 'root-frame', text: 'Offline Text' },
    ],
  })
  assert.equal(dryResult.dry_run, true)
  assert.equal(dryResult.revision, initialRev)

  // Verify file on disk was NOT mutated
  let fileContent = parseProject(await readFile(filePath, 'utf8'))
  assert.equal(fileContent.scene.elements['offline-text'], undefined)

  // 2. Real apply with idempotency key
  const applyResult = await files.call('apply_changes', {
    expected_revision: initialRev,
    idempotency_key: 'offline-key-1',
    operations: [
      { action: 'create', type: 'text', id: 'offline-text', parentId: 'root-frame', text: 'Offline Text' },
      { action: 'create_token', name: 'offline-token', type: 'color', value: '#111111' },
      { action: 'bind_token', element_id: 'offline-text', property: 'fill', token_id: 'offline-token' },
    ],
  })
  assert.equal(applyResult.applied, true)
  assert.notEqual(applyResult.revision, initialRev)

  // Verify disk has mutated
  fileContent = parseProject(await readFile(filePath, 'utf8'))
  assert.ok(fileContent.scene.elements['offline-text'])
  assert.ok(fileContent.scene.tokens.find(t => t.name === 'offline-token'))

  // 3. Retry with same key returns cached result without duplicating or failing
  const retryResult = await files.call('apply_changes', {
    expected_revision: initialRev,
    idempotency_key: 'offline-key-1',
    operations: [
      { action: 'create', type: 'text', id: 'offline-text', parentId: 'root-frame', text: 'Offline Text' },
      { action: 'create_token', name: 'offline-token', type: 'color', value: '#111111' },
      { action: 'bind_token', element_id: 'offline-text', property: 'fill', token_id: 'offline-token' },
    ],
  })
  assert.equal(retryResult.applied, true)
  assert.equal(retryResult.revision, applyResult.revision)
})

test('semantic failure after valid steps, forward references and cycles preserve live history and activity', t => {
  const { live, store, activities } = createLiveFixture(t)
  live.call('create_frame', { id: 'outer' })
  live.call('create_frame', { id: 'inner', parentId: 'outer' })
  store.select(['inner'])
  const before = store.getSnapshot(), revision = live.revision, history = store.getHistorySnapshot(), activityCount = activities.length
  const middleFailures = [
    { action: 'bind_token', element_id: 'inner', property: 'fontSize', token_id: '$0' },
    { action: 'reparent', element_id: 'outer', parentId: 'inner' },
    { action: 'create', type: 'text', parentId: '$2' },
    { action: 'set_layout', element_id: 'missing', layout: null },
  ]
  for (const bad of middleFailures) {
    assert.throws(() => live.call('apply_changes', { expected_revision: revision, operations: [
      { action: 'create_token', name: 'temporary', type: 'color', value: '#81adec' }, bad,
      { action: 'create', type: 'frame' },
    ] }))
    assert.equal(store.getSnapshot(), before)
    assert.deepEqual(store.getHistorySnapshot(), history)
    assert.equal(live.revision, revision)
    assert.equal(activities.length, activityCount)
  }
  store.beginTransaction('Human drag')
  assert.throws(() => live.call('apply_changes', { expected_revision: revision, operations: [{ action: 'create', type: 'text' }] }), /gesture/i)
  store.cancelTransaction()
})

test('independent offline agents race under an exclusive lock and retries can reconnect to the same process', async t => {
  const { workspace, files } = await createFileFixture(t)
  await files.call('create_frame', { id: 'seed' })
  const peer = await PaperFiles.create({ workspace, file: 'study.paper.json' })
  const revision = (await files.call('get_basic_info', {})).revision
  const results = await Promise.allSettled([files, peer].map((agent, index) => agent.call('apply_changes', {
    expected_revision: revision, operations: [{ action: 'create', type: 'text', id: `agent-${index}` }],
  })))
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(results.filter(result => result.status === 'rejected').length, 1)
  const project = parseProject(await readFile(join(workspace, 'study.paper.json'), 'utf8'))
  assert.equal(Object.keys(project.scene.elements).length, 2)
  const plan = { expected_revision: (await files.call('get_basic_info', {})).revision, idempotency_key: 'reconnect', operations: [{ action: 'create', type: 'text' }] }
  const applied = await files.call('apply_changes', plan)
  assert.deepEqual(await peer.call('apply_changes', plan), applied)
})

test('a preview with the eventual apply key does not reserve it; no-op apply creates no undo entry', t => {
  const { live, store } = createLiveFixture(t)
  live.call('create_frame', { id: 'seed', name: 'Seed' })
  const revision = live.revision, history = store.getHistorySnapshot().undoCount
  const plan = { expected_revision: revision, idempotency_key: 'preview-then-apply', operations: [{ action: 'update', element_id: 'seed', patch: { name: 'Seed' } }] }
  live.call('apply_changes', { ...plan, dry_run: true })
  const result = live.call('apply_changes', plan)
  assert.equal(result.applied, true)
  assert.equal(result.revision, revision)
  assert.deepEqual(result.changedIds, [])
  assert.equal(store.getHistorySnapshot().undoCount, history)
})

test('summaries distinguish token and layer namespaces and report bounded omissions', t => {
  const { live } = createLiveFixture(t)
  const preview = live.call('apply_changes', { expected_revision: live.revision, dry_run: true, operations: [
    { action: 'create', type: 'text', id: 'shared', text: 'Layer' },
    { action: 'create_token', id: 'shared', name: 'shared', type: 'color', value: '#81adec' },
    { action: 'bind_token', element_id: 'shared', property: 'fill', token_id: 'shared' },
  ] })
  assert.equal(preview.summary.createdCount, 2)
  assert.equal(preview.summary.created.length, 2)
  assert.equal(preview.summary.after.shared.element.text, 'Layer')
  assert.equal(preview.summary.after.shared.token.value, '#81adec')
  const many = live.call('apply_changes', { expected_revision: live.revision, dry_run: true, operations: Array.from({ length: 100 }, (_, i) => ({ action: 'create', type: 'text', id: `text-${i}`, name: 'x'.repeat(1000), text: '長'.repeat(1000) })) })
  assert.ok(Buffer.byteLength(JSON.stringify(many.summary)) <= 32768)
  assert.equal(many.summary.createdCount, 100)
  assert.equal(many.summary.omittedCount, 100 - many.summary.changedIds.length)
  assert.ok(many.summary.omittedCount > 0)
  assert.ok(many.warnings.length > 0)
})
