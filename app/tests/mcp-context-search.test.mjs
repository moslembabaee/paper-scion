import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SceneStore } from '../src/scene/store.ts'
import { createProject } from '../src/io/project.ts'
import { LiveCanvas } from '../src/mcp/live.ts'
import { PaperFiles } from '../mcp/files.ts'
import { paperTools, validateSchema } from '../src/mcp/schema.ts'

function createRichScene() {
  const store = new SceneStore()
  // Add tokens
  const blueToken = store.addToken({ name: 'brand-blue', type: 'color', value: '#81adec' })
  const fontToken = store.addToken({ name: 'heading-font', type: 'fontFamily', value: 'Inter' })
  // Add shared style
  const typographyStyle = store.addSharedStyle({
    kind: 'typography',
    name: 'Heading',
    value: {
      fontFamily: 'Inter',
      fontSize: 24,
      fontWeight: 700,
      lineHeight: 32,
      letterSpacing: 0,
      textAlign: 'left',
      tokenBindings: { fontFamily: fontToken.id },
    },
  })

  // Root frame
  const root = store.add('frame', {
    id: 'root-frame',
    name: 'Canvas Root',
    x: 0,
    y: 0,
    width: 1000,
    height: 800,
    rotation: 0,
  })

  // Rotated nested frame
  const nested = store.add('frame', {
    id: 'nested-frame',
    name: 'Card Container',
    parentId: root.id,
    x: 100,
    y: 100,
    width: 400,
    height: 300,
    rotation: 45,
  })

  // Children inside nested frame
  const btnBg = store.add('rectangle', {
    id: 'btn-bg',
    name: 'Button Background',
    parentId: nested.id,
    x: 20,
    y: 20,
    width: 160,
    height: 48,
    style: { fill: '#81adec' },
    tokenBindings: { fill: blueToken.id },
  })

  const btnLabel = store.add('text', {
    id: 'btn-label',
    name: 'Button Text',
    parentId: nested.id,
    x: 40,
    y: 30,
    width: 100,
    height: 24,
    text: 'Submit Order',
    sharedStyleBindings: { typography: typographyStyle.id },
  })

  const btnIcon = store.add('ellipse', {
    id: 'btn-icon',
    name: 'Status Dot',
    parentId: nested.id,
    x: 190,
    y: 28,
    width: 16,
    height: 16,
  })

  // Another branch under root with hidden and locked elements
  const sidebar = store.add('frame', {
    id: 'sidebar-frame',
    name: 'Sidebar Navigation',
    parentId: root.id,
    x: 600,
    y: 50,
    width: 250,
    height: 500,
  })

  const hiddenItem = store.add('text', {
    id: 'hidden-item',
    name: 'Secret Navigation Note',
    parentId: sidebar.id,
    x: 10,
    y: 10,
    width: 200,
    height: 30,
    text: 'Internal Preview Only',
    visible: false,
  })

  const lockedItem = store.add('rectangle', {
    id: 'locked-badge',
    name: 'Verified Badge',
    parentId: sidebar.id,
    x: 10,
    y: 60,
    width: 80,
    height: 24,
    locked: true,
  })

  // Component master & instance
  const master = store.add('frame', {
    id: 'card-master',
    name: 'Card Component',
    x: 1200,
    y: 0,
    width: 300,
    height: 200,
  })
  store.createComponent('card-master')
  const instance = store.createComponentInstance('card-master', {
    parentId: root.id,
    x: 50,
    y: 450,
  })

  return { store, blueToken, fontToken, typographyStyle, root, nested, btnBg, btnLabel, btnIcon, sidebar, hiddenItem, lockedItem, master, instance }
}

function liveFixture(t, store) {
  const activities = []
  const live = new LiveCanvas({
    projectId: 'test-project',
    store,
    getProject: () => createProject(store, 'Smart Context Study', { x: 0, y: 0, zoom: 1 }, true),
    onSettings() {},
    onActivity: a => activities.push(a),
  })
  live.start()
  t.after(() => live.close())
  return { live, store, activities }
}

test('get_selection_context and search_layers are registered in paperTools with valid schema', () => {
  const getContext = paperTools.find(tool => tool.name === 'get_selection_context')
  const search = paperTools.find(tool => tool.name === 'search_layers')
  assert.ok(getContext, 'get_selection_context tool must be defined in paperTools')
  assert.ok(search, 'search_layers tool must be defined in paperTools')
  assert.equal(getContext.annotations.readOnlyHint, true)
  assert.equal(search.annotations.readOnlyHint, true)
})

test('get_selection_context: returns compact summaries, ancestor chain, siblings, effective bounds, and linked resources for live selection', t => {
  const fixture = createRichScene()
  const { live, store } = liveFixture(t, fixture.store)

  // Select btn-label inside rotated nested frame
  store.select(['btn-label'])
  const res = live.call('get_selection_context', {})

  assert.equal(res.empty, false)
  assert.equal(res.projectId, 'test-project')
  assert.ok(res.revision)
  assert.equal(res.elements.length, 1)

  const el = res.elements[0]
  assert.equal(el.id, 'btn-label')
  assert.equal(el.name, 'Button Text')
  assert.equal(el.type, 'text')
  assert.equal(el.text, 'Submit Order')
  assert.ok(el.effectiveBounds, 'Each element summary should include its effective bounds')

  // Ancestor chain should be ordered root-to-parent: [root-frame, nested-frame]
  assert.deepEqual(res.ancestors.map(a => a.id), ['root-frame', 'nested-frame'])
  assert.equal(res.ancestors[1].rotation, 45, 'Ancestor rotation should be retained')

  // Siblings: immediate siblings of btn-label inside nested-frame (btn-bg and btn-icon), NOT including btn-label itself
  assert.deepEqual(res.siblings.map(s => s.id), ['btn-bg', 'btn-icon'])

  // Effective bounds: should be non-null and reflect world transform through 45-degree parent
  assert.ok(res.effectiveBounds)
  assert.ok(Number.isFinite(res.effectiveBounds.x))
  assert.ok(Number.isFinite(res.effectiveBounds.y))
  assert.ok(res.effectiveBounds.width > 0)
  assert.ok(res.effectiveBounds.height > 0)

  // Linked resources: typographyStyle is linked, which in turn links heading-font token
  assert.ok(res.sharedStyles.some(s => s.id === fixture.typographyStyle.id))
  assert.ok(res.linkedTokens.some(tok => tok.id === fixture.fontToken.id))
})

test('get_selection_context: handles tokens and components on selected nodes', t => {
  const fixture = createRichScene()
  const { live, store } = liveFixture(t, fixture.store)

  // Select btn-bg which has brand-blue token bound
  store.select(['btn-bg'])
  const bgRes = live.call('get_selection_context', {})
  assert.ok(bgRes.linkedTokens.some(tok => tok.id === fixture.blueToken.id))

  // Select component instance
  store.select([fixture.instance.id])
  const compRes = live.call('get_selection_context', {})
  assert.equal(compRes.components.length >= 1, true)
  const compInfo = compRes.components.find(c => c.masterId === fixture.master.id || c.id === fixture.master.id)
  assert.ok(compInfo, 'Should include component definition/master info')
})

test('get_selection_context: handles locked and hidden nodes', t => {
  const fixture = createRichScene()
  const { live, store } = liveFixture(t, fixture.store)

  const res = live.call('get_selection_context', { element_ids: ['hidden-item', 'locked-badge'] })
  assert.equal(res.elements.length, 2)
  const hidden = res.elements.find(e => e.id === 'hidden-item')
  const locked = res.elements.find(e => e.id === 'locked-badge')
  assert.equal(hidden.visible, false)
  assert.equal(locked.locked, true)
  assert.ok(res.effectiveBounds)
})

test('get_selection_context: distinguishes empty selection from invalid IDs', t => {
  const fixture = createRichScene()
  const { live, store } = liveFixture(t, fixture.store)

  // Empty selection
  store.select([])
  const emptyRes = live.call('get_selection_context', {})
  assert.equal(emptyRes.empty, true)
  assert.deepEqual(emptyRes.elements, [])
  assert.deepEqual(emptyRes.ancestors, [])
  assert.deepEqual(emptyRes.siblings, [])
  assert.equal(emptyRes.effectiveBounds, null)

  // Explicit invalid ID must throw an error
  assert.throws(
    () => live.call('get_selection_context', { element_ids: ['nonexistent-node-id'] }),
    /Unknown element/
  )
})

test('get_selection_context: explicit element_ids in headless/file mode', async t => {
  const workspace = await mkdtemp(join(tmpdir(), 'paper-context-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))

  const fixture = createRichScene()
  const files = await PaperFiles.create({ workspace, file: 'study.paper.json' })
  // Initialize file with rich scene
  await files.call('create_frame', { id: 'init-frame', project_name: 'File Study' })
  // Save fixture scene by mutating through files or creating project
  const project = createProject(fixture.store, 'File Study', { x: 0, y: 0, zoom: 1 }, true)
  const { writeFile } = await import('node:fs/promises')
  await writeFile(join(workspace, 'study.paper.json'), JSON.stringify(project, null, 2), 'utf8')

  // Empty selection in file mode (no element_ids passed)
  const emptyRes = await files.call('get_selection_context', {})
  assert.equal(emptyRes.empty, true)
  assert.deepEqual(emptyRes.elements, [])

  // Explicit element_ids
  const res = await files.call('get_selection_context', { element_ids: ['btn-label'] })
  assert.equal(res.empty, false)
  assert.equal(res.elements[0].id, 'btn-label')
  assert.deepEqual(res.ancestors.map(a => a.id), ['root-frame', 'nested-frame'])
  assert.deepEqual(res.siblings.map(s => s.id), ['btn-bg', 'btn-icon'])

  // Stale / invalid ID in file mode
  await assert.rejects(
    () => files.call('get_selection_context', { element_ids: ['missing-id'] }),
    /Unknown element/
  )
})

test('search_layers: case-insensitive search by name, text, and type with parent paths', t => {
  const fixture = createRichScene()
  const { live } = liveFixture(t, fixture.store)

  // Search by name (case-insensitive)
  const nameRes = live.call('search_layers', { query: 'BUTTON' })
  assert.equal(nameRes.total, 2) // Button Background, Button Text
  assert.ok(nameRes.results.every(r => r.name.toLowerCase().includes('button')))
  const textItem = nameRes.results.find(r => r.id === 'btn-label')
  assert.deepEqual(textItem.parentPath, ['Canvas Root', 'Card Container'])

  // Search by text content
  const textRes = live.call('search_layers', { query: 'Submit Order' })
  assert.equal(textRes.total, 1)
  assert.equal(textRes.results[0].id, 'btn-label')

  // Search by type
  const ellipseRes = live.call('search_layers', { type: 'ellipse' })
  assert.equal(ellipseRes.total, 1)
  assert.equal(ellipseRes.results[0].id, 'btn-icon')

  // Nonmatching query returns empty result
  const noneRes = live.call('search_layers', { query: 'Nonexistent query 12345' })
  assert.equal(noneRes.total, 0)
  assert.deepEqual(noneRes.results, [])
  assert.equal(noneRes.hasMore, false)
  assert.equal(noneRes.nextCursor, null)
})

test('search_layers: filters by locked, visible, and parentId', t => {
  const fixture = createRichScene()
  const { live } = liveFixture(t, fixture.store)

  // Filter visible: false
  const hiddenRes = live.call('search_layers', { visible: false })
  assert.equal(hiddenRes.total, 1)
  assert.equal(hiddenRes.results[0].id, 'hidden-item')

  // Filter locked: true
  const lockedRes = live.call('search_layers', { locked: true })
  assert.equal(lockedRes.total, 1)
  assert.equal(lockedRes.results[0].id, 'locked-badge')

  // Filter parentId: 'nested-frame'
  const parentRes = live.call('search_layers', { parentId: 'nested-frame' })
  assert.equal(parentRes.total, 3)
  assert.deepEqual(parentRes.results.map(r => r.id).sort(), ['btn-bg', 'btn-icon', 'btn-label'])
})

test('search_layers: deterministic pagination with limit and continuation cursor', t => {
  const fixture = createRichScene()
  const { live } = liveFixture(t, fixture.store)

  // Query matching multiple layers with limit: 2
  const page1 = live.call('search_layers', { parentId: 'nested-frame', limit: 2 })
  assert.equal(page1.results.length, 2)
  assert.equal(page1.total, 3)
  assert.equal(page1.hasMore, true)
  assert.ok(page1.nextCursor)

  // Fetch page 2 using cursor
  const page2 = live.call('search_layers', { parentId: 'nested-frame', limit: 2, cursor: page1.nextCursor })
  assert.equal(page2.results.length, 1)
  assert.equal(page2.hasMore, false)
  assert.equal(page2.nextCursor, null)

  // Ensure no duplicate IDs across pages and all items covered
  const combined = [...page1.results.map(r => r.id), ...page2.results.map(r => r.id)]
  assert.deepEqual(combined.sort(), ['btn-bg', 'btn-icon', 'btn-label'])
})

test('large scene: search default bounded page size and selection context stays bounded', t => {
  const store = new SceneStore()
  const root = store.add('frame', { id: 'large-root', name: 'Large Root', x: 0, y: 0, width: 2000, height: 2000 })
  for (let i = 0; i < 150; i++) {
    store.add('rectangle', {
      id: `item-${i.toString().padStart(3, '0')}`,
      name: `Layer Item ${i}`,
      parentId: root.id,
      x: (i % 10) * 100,
      y: Math.floor(i / 10) * 100,
      width: 80,
      height: 80,
    })
  }

  const live = new LiveCanvas({
    projectId: 'large-project',
    store,
    getProject: () => createProject(store, 'Large Scene', { x: 0, y: 0, zoom: 1 }, true),
    onSettings() {},
    onActivity() {},
  })
  live.start()
  t.after(() => live.close())

  // Default search should be bounded (default limit <= 25)
  const searchRes = live.call('search_layers', { query: 'Layer Item' })
  assert.equal(searchRes.total, 150)
  assert.equal(searchRes.results.length <= 25, true)
  assert.equal(searchRes.hasMore, true)

  // Selection context on a single item in a large frame should not dump all 150 siblings
  store.select(['item-050'])
  const selRes = live.call('get_selection_context', {})
  assert.equal(selRes.elements.length, 1)
  assert.equal(selRes.elements[0].id, 'item-050')
  // Siblings should be bounded to immediate neighbors, far fewer than 150
  assert.equal(selRes.siblings.length <= 20, true)
  assert.ok(selRes.siblings.some(s => s.id === 'item-049' || s.id === 'item-051'))
})

// Regression contracts written before repairing the partial implementation.
test('browser pagination runs without Node Buffer; continuations bind filters, project and revision', t => {
  const { live, store } = liveFixture(t, createRichScene().store)
  const args = { parentId: 'nested-frame', limit: 1 }
  const saved = globalThis.Buffer
  let first
  try {
    globalThis.Buffer = undefined
    first = live.call('search_layers', args)
    assert.equal(live.call('search_layers', { ...args, cursor: first.nextCursor }).offset, 1)
  } finally { globalThis.Buffer = saved }
  assert.equal(first.nextCursor, live.call('search_layers', args).nextCursor)
  for (const cursor of ['garbage', '1junk', '999999', first.nextCursor + 'x']) {
    assert.throws(() => live.call('search_layers', { ...args, cursor }), /cursor/i)
  }
  assert.throws(() => live.call('search_layers', { ...args, query: 'Button', cursor: first.nextCursor }), /cursor/i)
  const other = new LiveCanvas({ projectId: 'other-project', store, getProject: () => createProject(store, 'Other', { x: 0, y: 0, zoom: 1 }, true), onSettings() {}, onActivity() {} })
  t.after(() => other.close())
  assert.throws(() => other.call('search_layers', { ...args, cursor: first.nextCursor }), /cursor/i)
  store.update('btn-label', 'text', { text: 'Changed' })
  assert.throws(() => live.call('search_layers', { ...args, cursor: first.nextCursor }), /cursor|revision/i)
})

test('invalid search scope/parent IDs are errors; root and subtree filtering is explicit', t => {
  const { live } = liveFixture(t, createRichScene().store)
  for (const args of [{ scope_id: 'missing' }, { parentId: 'missing' }, { scope_id: 'btn-label' }, { parentId: 'btn-label' }]) {
    assert.throws(() => live.call('search_layers', args), /Unknown element|frame/)
  }
  assert.ok(live.call('search_layers', { parentId: null }).results.every(n => n.parentId === null))
  assert.deepEqual(live.call('search_layers', { scope_id: 'nested-frame' }).results.map(n => n.id), ['btn-bg', 'btn-label', 'btn-icon'])
})

test('context excludes unrelated ancestor children, orders IDs deterministically and never mutates the scene', t => {
  const { live, store } = liveFixture(t, createRichScene().store)
  const a = live.call('get_selection_context', { element_ids: ['btn-icon', 'btn-label', 'btn-label'] })
  assert.deepEqual(a, live.call('get_selection_context', { element_ids: ['btn-label', 'btn-icon'] }))
  assert.ok(a.ancestors.every(n => !Object.hasOwn(n, 'children')))
  assert.ok(!JSON.stringify(a).includes('hidden-item'))
  assert.throws(() => live.call('get_selection_context', { element_ids: ['btn-label', 'deleted-id'] }), /Unknown element/)
  store.select(['btn-label'])
  const before = store.getSnapshot(), history = store.getHistorySnapshot(), revision = live.revision
  live.call('get_selection_context', {})
  live.call('search_layers', {})
  assert.equal(store.getSnapshot(), before)
  assert.deepEqual(store.getHistorySnapshot(), history)
  assert.equal(live.revision, revision)
})

test('effective bounds and flags include nested center rotations and inherited visibility/locking', t => {
  const store = new SceneStore()
  store.add('frame', { id: 'outer', x: 100, y: 200, width: 200, height: 100, rotation: 90 })
  store.add('frame', { id: 'inner', parentId: 'outer', x: 20, y: 10, width: 80, height: 40, rotation: -90 })
  store.add('rectangle', { id: 'leaf', parentId: 'inner', x: 5, y: 6, width: 10, height: 20 })
  store.setVisible('outer', false)
  store.setLocked('inner', true)
  const { live } = liveFixture(t, store)
  const result = live.call('get_selection_context', { element_ids: ['leaf'] })
  for (const [key, expected] of Object.entries({ x: 185, y: 196, width: 10, height: 20 })) {
    assert.ok(Math.abs(result.elements[0].effectiveBounds[key] - expected) < 1e-8, key)
  }
  assert.equal(result.elements[0].effectiveVisible, false)
  assert.equal(result.elements[0].effectiveLocked, true)
})

test('linked resources include token aliases and effect preset dependencies', t => {
  const { store, blueToken } = createRichScene()
  const alias = store.addToken({ name: 'accent-alias', type: 'color', value: '#000000', aliasId: blueToken.id })
  const style = store.addSharedStyle({ name: 'Glow', kind: 'effects', value: [{ id: 'glow', enabled: true, type: 'drop-shadow', color: '#81adec', colorTokenId: alias.id, x: 0, y: 1, blur: 4, spread: 0 }] })
  store.bindSharedStyle('btn-label', 'effects', style.id)
  const { live } = liveFixture(t, store)
  const result = live.call('get_selection_context', { element_ids: ['btn-label'] })
  assert.ok(result.linkedTokens.some(token => token.id === alias.id))
  assert.equal(result.linkedTokens.find(token => token.id === alias.id).resolvedValue, '#81adec')
  assert.ok(result.linkedTokens.some(token => token.id === blueToken.id))
  assert.ok(result.sharedStyles.some(link => link.id === style.id))
})

test('long UTF-8 text and names stay inside the payload cap with explicit truncation', t => {
  const { store } = createRichScene()
  store.update('btn-label', 'text', { text: '紙'.repeat(30000), name: 'Long '.repeat(10000) })
  const { live } = liveFixture(t, store)
  const result = live.call('get_selection_context', { element_ids: ['btn-label'] })
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 32768)
  assert.equal(result.truncated, true)
  assert.ok(result.elements[0].text.length <= 256)
  const search = live.call('search_layers', { query: '紙' })
  assert.ok(Buffer.byteLength(JSON.stringify(search)) <= 32768)
  assert.equal(search.results[0].textTruncated, true)
})

test('file-backed reads match live semantics and leave both files unchanged', async t => {
  const { writeFile, readFile } = await import('node:fs/promises')
  const workspace = await mkdtemp(join(tmpdir(), 'paper-context-parity-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const fixture = createRichScene(), { live } = liveFixture(t, fixture.store)
  const source = JSON.stringify(createProject(fixture.store, 'Smart Context Study', { x: 0, y: 0, zoom: 1 }, true))
  await writeFile(join(workspace, 'a.paper.json'), source)
  await writeFile(join(workspace, 'b.paper.json'), source)
  const files = await PaperFiles.create({ workspace, file: 'a.paper.json' })
  const strip = value => { const { file, revision, projectId, live, nextCursor, ...rest } = value; return rest }
  for (const [tool, args] of [['get_selection_context', { element_ids: ['btn-label'] }], ['search_layers', { query: 'Button', limit: 1 }]]) {
    const offline = await files.call(tool, args)
    assert.equal(offline.projectId, 'a.paper.json')
    assert.deepEqual(strip(offline), strip(live.call(tool, args)))
    if (offline.nextCursor) {
      assert.equal((await files.call(tool, { ...args, cursor: offline.nextCursor })).offset, 1)
      await assert.rejects(() => files.call(tool, { ...args, file: 'b.paper.json', cursor: offline.nextCursor }), /cursor/i)
      await writeFile(join(workspace, 'a.paper.json'), source + '\n')
      await assert.rejects(() => files.call(tool, { ...args, cursor: offline.nextCursor }), /cursor|revision/i)
      await writeFile(join(workspace, 'a.paper.json'), source)
    }
  }
  assert.equal(await readFile(join(workspace, 'a.paper.json'), 'utf8'), source)
  assert.equal(await readFile(join(workspace, 'b.paper.json'), 'utf8'), source)
})

test('new tools publish exact output schemas and reject oversized inputs', t => {
  const { live } = liveFixture(t, createRichScene().store)
  for (const name of ['get_selection_context', 'search_layers']) {
    const tool = paperTools.find(tool => tool.name === name)
    assert.equal(tool.outputSchema?.type, 'object')
    assert.equal(tool.outputSchema.additionalProperties, false)
    validateSchema(live.call(name, {}), tool.outputSchema)
    validateSchema(live.call(name, name === 'get_selection_context' ? { element_ids: ['btn-label'] } : { limit: 1 }), tool.outputSchema)
  }
  assert.throws(() => live.call('get_selection_context', { element_ids: Array(201).fill('btn-label') }), /too many/)
  assert.throws(() => live.call('search_layers', { query: 'x'.repeat(513) }), /too long/)
})

test('large documents return one compact page without exposing distant layers', t => {
  const store = new SceneStore()
  const root = store.add('frame', { id: 'root' })
  const base = store.add('rectangle', { id: 'base', parentId: 'root' })
  const count = 5000
  const children = Array.from({ length: count }, (_, i) => `item-${String(i).padStart(5, '0')}`)
  const elements = Object.fromEntries(children.map((id, zIndex) => [id, { ...base, id, name: `Item ${zIndex}`, zIndex }]))
  store.load({ version: 1, rootIds: ['root'], elements: { root: { ...root, children }, ...elements } })
  const { live } = liveFixture(t, store)
  const search = live.call('search_layers', { query: 'ITEM' })
  assert.equal(search.total, count)
  assert.equal(search.results.length, 20)
  assert.ok(Buffer.byteLength(JSON.stringify(search)) < 12000)
  const context = live.call('get_selection_context', { element_ids: ['item-02500'] })
  assert.equal(context.siblings.length, 10)
  assert.ok(!JSON.stringify(context).includes('item-00000'))
  assert.ok(!JSON.stringify(context).includes('item-04999'))
  store.select(children.slice(0, 150))
  const many = live.call('get_selection_context', {})
  assert.equal(many.selectionCount, 150)
  assert.equal(many.empty, false)
  assert.equal(many.truncated, true)
  assert.equal(many.omitted.elements, 150 - many.elements.length)
  assert.ok(Buffer.byteLength(JSON.stringify(many)) <= 32768)
  validateSchema(many, paperTools.find(t => t.name === 'get_selection_context').outputSchema)
})

test('deep paths and byte-limited pages report truncation and continue without dropping matches', t => {
  const store = new SceneStore()
  let parentId = null
  for (let i = 0; i < 55; i++) {
    const node = store.add('frame', { id: `frame-${i}`, parentId, name: '紙'.repeat(200) })
    parentId = node.id
  }
  for (let i = 0; i < 12; i++) store.add('text', { id: `text-${i}`, parentId, text: 'Sample text', name: '葉'.repeat(200) })
  const { live } = liveFixture(t, store)
  const args = { type: 'text', limit: 100 }
  const seen = []
  let cursor
  do {
    const page = live.call('search_layers', { ...args, ...(cursor ? { cursor } : {}) })
    assert.equal(page.total, 12)
    assert.ok(page.results.length > 0 && page.results.length < 12)
    assert.ok(page.results.every(n => n.parentPath.length === 20 && n.pathTruncated))
    assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 32768)
    validateSchema(page, paperTools.find(t => t.name === 'search_layers').outputSchema)
    seen.push(...page.results.map(n => n.id))
    cursor = page.nextCursor
  } while (cursor)
  assert.deepEqual(seen, Array.from({ length: 12 }, (_, i) => `text-${i}`))
  const context = live.call('get_selection_context', { element_ids: ['text-0'] })
  assert.ok(context.omitted.ancestors > 0)
  assert.ok(context.truncated)
  assert.ok(Buffer.byteLength(JSON.stringify(context)) <= 32768)
})

test('component summaries do not include large override text or descendant geometry', t => {
  const store = new SceneStore()
  const master = store.add('frame', { id: 'master' })
  store.add('text', { id: 'master-text', parentId: master.id, text: '紙'.repeat(30000) })
  store.createComponent(master.id)
  const instance = store.createComponentInstance(master.id)
  const { live } = liveFixture(t, store)
  const result = live.call('get_selection_context', { element_ids: [instance.id] })
  assert.ok(result.components.some(n => n.id === master.id))
  assert.ok(!JSON.stringify(result).includes('紙'.repeat(300)))
  assert.ok(!Object.hasOwn(result.elements[0].component, 'overrides'))
  assert.ok(!Object.hasOwn(result.elements[0], 'children'))
  validateSchema(result, paperTools.find(t => t.name === 'get_selection_context').outputSchema)
})
