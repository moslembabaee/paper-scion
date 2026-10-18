import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PaperFiles } from '../dist/mcp/files.js'
import { PaperMcpServer, PROTOCOL_VERSIONS } from '../dist/mcp/server.js'
import { parseProject } from '../dist/src/io/project.js'
import { createShader } from '../dist/src/shaders/catalog.js'
import { getWorldMatrix } from '../dist/src/scene/geometry.js'
import { paperTools, projectSchema, validateSchema } from '../dist/src/mcp/schema.js'

const binary = fileURLToPath(new URL('../bin/paper-mcp.mjs', import.meta.url))
function launch(args = []) {
  // POSIX pipes exercise the actual stdio transport even in managed workspaces
  // whose nested Node processes replace inherited socket streams with stubs.
  if (process.platform === 'win32') return spawn(process.execPath, [binary, ...args], { stdio: ['pipe', 'pipe', 'pipe'] })
  return spawn('bash', ['-c', 'set -o pipefail\ncat | "$@" 2> >(cat >&2) | cat', 'paper-mcp-test', process.execPath, binary, ...args], { stdio: ['pipe', 'pipe', 'pipe'] })
}
const init = version => ({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: version, capabilities: {}, clientInfo: { name: 'paper-test', version: '1.0.0' } } })
const ready = { jsonrpc: '2.0', method: 'notifications/initialized' }

async function fixture(t) {
  const workspace = await mkdtemp(join(tmpdir(), 'paper-mcp-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const files = await PaperFiles.create({ workspace, file: 'study.paper.json' })
  const server = new PaperMcpServer(files)
  await server.handle(init('2025-11-25'))
  await server.handle(ready)
  let nextId = 1
  const call = async (name, args = {}) => {
    const response = await server.handle({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } })
    assert.equal(response.error, undefined, JSON.stringify(response))
    return response.result
  }
  const success = async (name, args = {}) => {
    const result = await call(name, args)
    assert.equal(result.isError, false, JSON.stringify(result))
    assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent)
    return result.structuredContent
  }
  return { workspace, files, server, call, success }
}

test('all five tools work over a real child-process stdio connection and survive restart', { timeout: 10000 }, async t => {
  const workspace = await mkdtemp(join(tmpdir(), 'paper-stdio-'))
  t.after(() => rm(workspace, { recursive: true, force: true }))
  const child = launch(['--workspace', workspace, '--file', 'stdio.paper.json'])
  t.after(() => child.kill())
  let stderr = ''
  child.stderr.setEncoding('utf8').on('data', text => { stderr += text })
  const responses = []
  let pending = ''
  child.stdout.setEncoding('utf8').on('data', chunk => {
    pending += chunk
    let newline
    while ((newline = pending.indexOf('\n')) !== -1) {
      responses.push(JSON.parse(pending.slice(0, newline)))
      pending = pending.slice(newline + 1)
    }
  })
  const messages = [
    init('2025-06-18'), ready,
    { id: 1, method: 'tools/list' },
    { id: 2, method: 'tools/call', params: { name: 'create_frame', arguments: { id: 'frame', name: 'Étude — 紙', x: 120, y: 240, project_name: 'Paper studio' } } },
    { id: 3, method: 'tools/call', params: { name: 'add_shader_shape', arguments: { id: 'shader', parentId: 'frame', shader_kind: 'mesh-gradient', params: { distortion: .2 }, motion: { animated: false } } } },
    { id: 4, method: 'tools/call', params: { name: 'update_element', arguments: { element_id: 'shader', patch: { x: 24, style: { opacity: .5 } } } } },
    { id: 5, method: 'tools/call', params: { name: 'get_canvas_elements', arguments: {} } },
    { id: 6, method: 'tools/call', params: { name: 'export_selection', arguments: { element_ids: ['frame'], output: 'export.paper.json' } } },
    { id: 7, method: 'tools/call', params: { name: 'get_basic_info', arguments: {} } },
    { id: 8, method: 'tools/call', params: { name: 'get_selection_context', arguments: { element_ids: ['shader'] } } },
    { id: 9, method: 'tools/call', params: { name: 'search_layers', arguments: { query: 'RECTANGLE', limit: 1 } } },
  ].map(message => JSON.stringify({ jsonrpc: '2.0', ...message })).join('\n') + '\n'
  // Deliberately split a UTF-8 character across writes, then send many messages
  // in one chunk. This catches transport framing and mutation ordering errors.
  const bytes = Buffer.from(messages)
  const split = bytes.indexOf(Buffer.from('紙')) + 1
  child.stdin.write(bytes.subarray(0, split))
  child.stdin.end(bytes.subarray(split))
  const [code] = await once(child, 'close')
  assert.equal(code, 0, stderr)
  assert.equal(stderr, '')
  assert.equal(pending, '')
  assert.equal(responses.length, 10)
  assert.equal(responses[0].result.protocolVersion, '2025-06-18')
  assert.deepEqual(responses[1].result.tools.map(tool => tool.name), paperTools.map(tool => tool.name))
  for (const response of responses.slice(2)) assert.equal(response.result.isError, false, JSON.stringify(response))
  const context = responses[8].result.structuredContent
  assert.equal(context.projectId, 'stdio.paper.json')
  assert.equal(context.elements[0].id, 'shader')
  assert.equal(context.ancestors[0].id, 'frame')
  assert.equal(responses[9].result.structuredContent.results[0].id, 'shader')
  for (const [index, name] of [[8, 'get_selection_context'], [9, 'search_layers']]) {
    const tool = responses[1].result.tools.find(tool => tool.name === name)
    validateSchema(responses[index].result.structuredContent, tool.outputSchema)
  }
  const project = parseProject(await readFile(join(workspace, 'stdio.paper.json'), 'utf8'))
  assert.equal(project.name, 'Paper studio')
  assert.equal(project.scene.elements.frame.name, 'Étude — 紙')
  assert.equal(project.scene.elements.shader.x, 24)
  assert.equal(project.scene.elements.shader.style.shader.params.distortion, .2)
  assert.equal(project.scene.elements.shader.style.opacity, .5)
  const exported = parseProject(await readFile(join(workspace, 'export.paper.json'), 'utf8'))
  assert.deepEqual(exported.scene, project.scene)
  const restarted = await PaperFiles.create({ workspace, file: 'stdio.paper.json' })
  const read = await restarted.call('get_canvas_elements', {})
  assert.equal(read.elements.length, 2)
  assert.equal(read.gridSize, 120)
  assert.equal(read.revision, responses[5].result.structuredContent.revision)
})

test('handshake, discovery, resources and JSON-RPC errors follow the MCP contract', async t => {
  const { files } = await fixture(t)
  for (const version of [...PROTOCOL_VERSIONS, 'future-version']) {
    const server = new PaperMcpServer(files)
    const blocked = await server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    assert.equal(blocked.error.code, -32002)
    assert.equal((await server.handle(init(version))).result.protocolVersion, version === 'future-version' ? PROTOCOL_VERSIONS[0] : version)
    assert.equal(await server.handle(ready), undefined)
    assert.equal((await server.handle({ jsonrpc: '2.0', id: 2, method: 'ping' })).result.constructor, Object)
    const list = await server.handle({ jsonrpc: '2.0', id: 3, method: 'resources/list' })
    assert.deepEqual(list.result.resources.map(resource => resource.uri), ['paper://schema', 'paper://shaders'])
    const schema = await server.handle({ jsonrpc: '2.0', id: 4, method: 'resources/read', params: { uri: 'paper://schema' } })
    assert.deepEqual(JSON.parse(schema.result.contents[0].text), JSON.parse(JSON.stringify(projectSchema)))
    const unknown = await server.handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'missing' } })
    assert.equal(unknown.error.code, -32602)
    assert.equal((await server.handle({ jsonrpc: '2.0', id: 6, method: 'missing' })).error.code, -32601)
    assert.equal((await server.handle([])).error.code, -32600)
    assert.equal((await server.handle({ jsonrpc: '2.0', id: null, method: 'ping' })).error.code, -32600)
    // A tools/call notification must never edit the file.
    assert.equal(await server.handle({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'create_frame' } }), undefined)
  }
})

test('invalid edits, stale revisions and cyclic reparenting leave the file untouched', async t => {
  const { workspace, call, success } = await fixture(t)
  await success('create_frame', { id: 'outer' })
  await success('create_frame', { id: 'inner', parentId: 'outer' })
  await success('add_shader_shape', { id: 'shape', parentId: 'inner', shader_kind: 'dithering' })
  const before = await readFile(join(workspace, 'study.paper.json'), 'utf8')
  const failures = [
    ['create_frame', { width: -1 }],
    ['create_frame', { id: 'outer' }],
    ['create_frame', { id: '__proto__' }],
    ['create_frame', { expected_revision: 'stale' }],
    ['add_shader_shape', { shader_kind: 'missing' }],
    ['add_shader_shape', { shader_kind: 'dithering', params: { size: 999 } }],
    ['add_shader_shape', { shader_kind: 'dithering', params: { extra: 1 } }],
    ['add_shader_shape', { shader_kind: 'dithering', parentId: 'shape' }],
    ['update_element', { element_id: 'outer', parentId: 'inner', patch: { name: 'Cyclic' } }],
    ['update_element', { element_id: 'inner', parentId: null, patch: { width: 0 } }],
    ['update_element', { element_id: 'shape', patch: { clipContent: false } }],
    ['update_element', { element_id: 'shape', patch: { id: 'changed' } }],
    ['update_element', { element_id: 'missing', patch: {} }],
    ['update_element', { element_id: 'shape', patch: { style: { opacity: 2 } } }],
    ['get_canvas_elements', { element_ids: ['missing'] }],
  ]
  for (const [name, args] of failures) {
    const result = await call(name, args)
    assert.equal(result.isError, true, JSON.stringify({ name, args, result }))
    assert.equal(await readFile(join(workspace, 'study.paper.json'), 'utf8'), before)
  }
  assert.deepEqual((await readdir(workspace)).filter(name => /lock$|tmp$/.test(name)), [])
  const revision = (await success('get_canvas_elements')).revision
  await success('update_element', { expected_revision: revision, element_id: 'shape', patch: { x: 48 } })
  assert.equal((await call('update_element', { expected_revision: revision, element_id: 'shape', patch: { x: 72 } })).isError, true)
})

test('valid structural edits preserve hierarchy, ordering, settings and shader paint', async t => {
  const { workspace, success, call } = await fixture(t)
  await success('create_frame', { id: 'one' })
  await success('create_frame', { id: 'two' })
  for (const [index, kind] of Object.keys((await import('../dist/src/shaders/catalog.js')).shaderCatalog).entries()) {
    await success('add_shader_shape', { id: `shader-${index}`, parentId: 'one', shader_kind: kind, shape: index % 2 ? 'ellipse' : 'rectangle' })
  }
  const path = join(workspace, 'study.paper.json')
  const project = parseProject(await readFile(path, 'utf8'))
  project.viewport = { x: -400, y: 600, zoom: .75 }
  project.grid = false
  project.scene.backgroundShader = createShader('neuro-noise')
  await writeFile(path, JSON.stringify(project))
  await success('update_element', { element_id: 'shader-0', parentId: 'two', index: 0, patch: { x: 120, style: { fill: null } } })
  await success('update_element', { element_id: 'shader-1', index: 4, patch: { visible: false, locked: true } })
  assert.equal((await call('update_element', { element_id: 'shader-1', patch: { x: 5 } })).isError, true)
  await success('update_element', { element_id: 'shader-1', patch: { locked: false, visible: true, x: 24 } })
  await success('update_element', { element_id: 'two', patch: { locked: true } })
  assert.equal((await call('add_shader_shape', { parentId: 'two', shader_kind: 'dithering' })).isError, true)
  const restored = parseProject(await readFile(path, 'utf8'))
  validateSchema(restored, projectSchema)
  assert.deepEqual(restored.viewport, project.viewport)
  assert.equal(restored.grid, false)
  assert.deepEqual(restored.scene.backgroundShader, project.scene.backgroundShader)
  assert.deepEqual(restored.scene.elements.two.children, ['shader-0'])
  assert.equal(restored.scene.elements['shader-0'].style.shader.kind, 'mesh-gradient')
  assert.equal(restored.scene.elements['shader-0'].style.fill, null)
  assert.equal((await success('get_canvas_elements', { element_ids: ['two'] })).elements.length, 2)
})

test('selection exports deduplicate, preserve world transforms, and open in Paper', async t => {
  const { workspace, success, call } = await fixture(t)
  await success('create_frame', { id: 'one', x: 120, y: 240, rotation: 90, style: { opacity: .5 } })
  await success('create_frame', { id: 'two', x: 1200 })
  await success('add_shader_shape', { id: 'shape', parentId: 'one', x: 48, y: 72, shader_kind: 'dot-orbit', style: { opacity: .5 } })
  const before = await readFile(join(workspace, 'study.paper.json'), 'utf8')
  const selected = await success('export_selection', { element_ids: ['shape'] })
  const imported = parseProject(selected.content)
  const original = parseProject(before)
  const world = getWorldMatrix({ ...original.scene, selection: [] }, 'shape')
  const restored = getWorldMatrix({ ...imported.scene, selection: [] }, 'shape')
  world.forEach((n, index) => assert.ok(Math.abs(n - restored[index]) < 1e-8))
  assert.equal(imported.scene.elements.shape.style.opacity, .25)
  const all = await success('export_selection', { element_ids: ['two', 'one', 'shape', 'one'] })
  assert.deepEqual(parseProject(all.content).scene.rootIds, ['one', 'two'])
  assert.equal((await call('export_selection', { element_ids: ['one'], format: 'svg' })).isError, true)
  await success('update_element', { element_id: 'shape', patch: { style: { shader: null } } })
  const svg = await success('export_selection', { element_ids: ['one'], format: 'svg', output: 'one.svg' })
  assert.equal(svg.mimeType, 'image/svg+xml')
  assert.match(svg.content, /viewBox="240 120 480 720"/)
  assert.equal(await readFile(join(workspace, 'one.svg'), 'utf8'), svg.content)
  assert.equal((await call('export_selection', { element_ids: ['one'], format: 'svg', output: 'one.svg' })).isError, true)
  assert.equal((await call('export_selection', { output: 'study.paper.json' })).isError, true)
})

test('workspace confinement rejects traversal and symlink escapes; locks coordinate processes', async t => {
  const { workspace, call, success } = await fixture(t)
  await success('create_frame', { id: 'frame' })
  const outside = await mkdtemp(join(tmpdir(), 'paper-outside-'))
  t.after(() => rm(outside, { recursive: true, force: true }))
  await writeFile(join(outside, 'outside.json'), '{}')
  await symlink(join(outside, 'outside.json'), join(workspace, 'link.json'))
  await symlink(outside, join(workspace, 'outside'))
  for (const file of ['../escape.json', join(outside, 'outside.json'), 'link.json', 'outside/new.json']) {
    assert.equal((await call('create_frame', { file })).isError, true, file)
  }
  assert.equal((await call('export_selection', { output: '../escape.json' })).isError, true)
  const path = join(workspace, 'study.paper.json')
  const before = await readFile(path, 'utf8')
  await writeFile(`${path}.paper-mcp.lock`, 'another process')
  assert.equal((await call('create_frame')).isError, true)
  assert.equal(await readFile(path, 'utf8'), before)
  await rm(`${path}.paper-mcp.lock`)
  const [a, b] = await Promise.all([call('create_frame', { id: 'a' }), call('create_frame', { id: 'b' })])
  assert.equal([a, b].filter(result => !result.isError).length, 1)
  assert.equal(parseProject(await readFile(path, 'utf8')).scene.rootIds.length, 2)
  assert.deepEqual((await readdir(workspace)).filter(name => /lock$|tmp$/.test(name)), [])
})

test('legacy scenes remain legacy and unsupported documents stay untouched', async t => {
  const { workspace, success, call } = await fixture(t)
  await success('create_frame', { id: 'frame' })
  const path = join(workspace, 'study.paper.json')
  const project = parseProject(await readFile(path, 'utf8'))
  await writeFile(path, JSON.stringify(project.scene))
  await success('update_element', { element_id: 'frame', patch: { name: 'Legacy frame' } })
  const legacy = JSON.parse(await readFile(path, 'utf8'))
  assert.equal(legacy.format, undefined)
  assert.equal(legacy.elements.frame.name, 'Legacy frame')
  for (const source of ['{broken', '{"format":"paper","version":99}', '{"version":1,"elements":{},"rootIds":["missing"]}']) {
    await writeFile(path, source)
    assert.equal((await call('create_frame')).isError, true)
    assert.equal(await readFile(path, 'utf8'), source)
  }
})

test('stdio recovers from malformed JSON and reports startup errors only on stderr', async () => {
  const child = launch()
  const output = []
  child.stdout.setEncoding('utf8').on('data', chunk => output.push(chunk))
  child.stdin.end('{broken\n' + JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' }) + '\n')
  assert.equal((await once(child, 'close'))[0], 0)
  const responses = output.join('').trim().split('\n').map(JSON.parse)
  assert.equal(responses[0].error.code, -32700)
  assert.deepEqual(responses[1].result, {})
  const invalid = launch(['--unknown'])
  invalid.stdin.end()
  let stdout = '', stderr = ''
  invalid.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
  invalid.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
  assert.equal((await once(invalid, 'close'))[0], 1)
  assert.equal(stdout, '')
  assert.match(stderr, /Unknown option/)
})

test('apply_changes executes atomic transactions with dry-run, rollback, and idempotency over MCP', async t => {
  const { workspace, success, call } = await fixture(t)
  await success('create_frame', { id: 'base-frame' })
  const initial = await success('get_canvas_elements')
  const rev = initial.revision
  const filePath = join(workspace, 'study.paper.json')
  const beforeFile = await readFile(filePath, 'utf8')

  // 1. Dry run returns compact before/after summary without mutating file
  const dryRun = await success('apply_changes', {
    expected_revision: rev,
    dry_run: true,
    operations: [
      { action: 'create', type: 'frame', id: 'mcp-frame', width: 300, height: 200 },
      { action: 'create', type: 'text', id: 'mcp-title', parentId: 'mcp-frame', text: 'MCP Art' },
      { action: 'create_token', name: 'mcp-blue', type: 'color', value: '#81adec' },
      { action: 'bind_token', element_id: 'mcp-title', property: 'fill', token_id: 'mcp-blue' },
    ],
  })
  assert.equal(dryRun.dry_run, true)
  assert.equal(dryRun.revision, rev)
  assert.ok(dryRun.summary.createdCount >= 3)
  assert.equal(await readFile(filePath, 'utf8'), beforeFile)

  // 2. Middle operation failure rolls back entirely
  const failed = await call('apply_changes', {
    expected_revision: rev,
    operations: [
      { action: 'create', type: 'frame', id: 'rollback-frame', width: 300, height: 200 },
      { action: 'create', type: 'rectangle', id: 'bad-rect', width: -100, height: 100 },
      { action: 'create', type: 'text', id: 'rollback-text', text: 'Never created' },
    ],
  })
  assert.equal(failed.isError, true)
  assert.equal(await readFile(filePath, 'utf8'), beforeFile)

  // 3. Successful apply with idempotency key
  const applied = await success('apply_changes', {
    expected_revision: rev,
    idempotency_key: 'idem-mcp-tx-1',
    operations: [
      { action: 'create', type: 'frame', id: 'mcp-frame', width: 300, height: 200 },
      { action: 'create', type: 'text', id: 'mcp-title', parentId: 'mcp-frame', text: 'MCP Art' },
      { action: 'create_token', name: 'mcp-blue', type: 'color', value: '#81adec' },
      { action: 'bind_token', element_id: 'mcp-title', property: 'fill', token_id: 'mcp-blue' },
    ],
  })
  assert.equal(applied.applied, true)
  assert.notEqual(applied.revision, rev)

  const updatedFile = parseProject(await readFile(filePath, 'utf8'))
  assert.ok(updatedFile.scene.elements['mcp-frame'])
  assert.ok(updatedFile.scene.elements['mcp-title'])
  assert.ok(updatedFile.scene.tokens.find(token => token.name === 'mcp-blue'))

  // 4. Retrying with identical idempotency key returns cached result
  const retried = await success('apply_changes', {
    expected_revision: rev,
    idempotency_key: 'idem-mcp-tx-1',
    operations: [
      { action: 'create', type: 'frame', id: 'mcp-frame', width: 300, height: 200 },
      { action: 'create', type: 'text', id: 'mcp-title', parentId: 'mcp-frame', text: 'MCP Art' },
      { action: 'create_token', name: 'mcp-blue', type: 'color', value: '#81adec' },
      { action: 'bind_token', element_id: 'mcp-title', property: 'fill', token_id: 'mcp-blue' },
    ],
  })
  assert.equal(retried.applied, true)
  assert.equal(retried.revision, applied.revision)
})
