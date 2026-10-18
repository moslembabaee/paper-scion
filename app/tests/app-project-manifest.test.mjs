import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createAppProject,
  parseAppProject,
  serializeAppProject,
  validateAppProject,
  migrateAppProject,
  AppProjectValidationError,
  APP_PROJECT_LIMITS,
} from '../src/make/manifest.ts'
import { createProject, parseProject, serializeProject } from '../src/io/project.ts'
import { SceneStore } from '../src/scene/store.ts'

test('strict validation rejects unknown fields, coercion and missing required fields atomically', () => {
  const valid = createAppProject({ name: 'Strict' })
  const invalid = [
    { ...valid, unexpected: true },
    { ...valid, release: { status: 'draft', notes: 42 } },
    { ...valid, release: { status: 'draft', extra: true } },
    { ...valid, preview: { status: 'idle', entryPoint: 'src/App.tsx', error: false } },
    { ...valid, sceneReference: { sceneId: 'scene', extra: true } },
    { ...valid, files: { 'src/App.tsx': { ...valid.files['src/App.tsx'], executable: true } } },
    { ...valid, revision: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, createdAt: 'yesterday' }, { ...valid, updatedAt: null },
    { ...valid, release: { status: 'published', url: 'javascript:alert(1)' } },
    { ...valid, assetIds: ['a'.repeat(129)] },
  ]
  for (const input of invalid) {
    const before = structuredClone(input)
    assert.throws(() => validateAppProject(input), AppProjectValidationError)
    assert.deepEqual(input, before)
  }
  for (const key of ['sceneReference', 'preview', 'createdAt', 'updatedAt']) {
    const input = { ...valid }; delete input[key]
    assert.throws(() => validateAppProject(input), AppProjectValidationError, key)
  }
})

test('factories and migrations reject malformed inputs rather than silently repairing them', () => {
  for (const input of [
    { files: { 'src/App.tsx': { path: 'src/App.tsx', content: 42 } } },
    { files: [{ path: 'src/App.tsx', content: null }] },
    { assetIds: 'asset' }, { revision: '1' }, { name: 42 }, { release: null },
    { preview: { status: '' } }, { extra: true }, { files: null },
  ]) {
    assert.throws(() => createAppProject(input), AppProjectValidationError)
    assert.throws(() => migrateAppProject(input), AppProjectValidationError)
  }
  for (const input of [
    { format: 'paper', version: 1 }, { format: 'paper-app', version: 2 },
    { format: 'other', version: 0 }, { version: -1 },
    { files: { 'App.tsx': { path: 'Other.tsx', content: '' } } },
  ]) assert.throws(() => migrateAppProject(input), AppProjectValidationError)
})

test('path aliases, encoded separators and control characters reject', () => {
  for (const path of [' src/App.tsx', 'src/App.tsx ', 'src/.. /App.tsx', 'src/a\n.tsx',
    'src/%252e%252e/app.tsx', 'src/%5capp.tsx', 'src/App.tsx.', 'src/CON.tsx']) {
    assert.throws(() => createAppProject({ files: { [path]: '' } }), AppProjectValidationError, path)
  }
})

test('object and escaped serialization payloads obey the manifest byte limit', () => {
  const input = createAppProject({ name: 'Bounded' })
  assert.throws(() => validateAppProject({ ...input, description: 'x'.repeat(APP_PROJECT_LIMITS.MAX_MANIFEST_BYTES) }), AppProjectValidationError)
  const files = Object.fromEntries(Array.from({ length: 4 }, (_, i) => [
    `src/control${i}.txt`, { path: `src/control${i}.txt`, content: '\0'.repeat(APP_PROJECT_LIMITS.MAX_FILE_BYTES) },
  ]))
  assert.throws(() => createAppProject({ files }), AppProjectValidationError)
  assert.throws(() => serializeAppProject({ ...input, files }), AppProjectValidationError)
})

test('object boundaries reject accessors and cyclic/deep graphs without invoking code', () => {
  const input = createAppProject({ name: 'Atomic' })
  let invoked = false
  Object.defineProperty(input, 'description', { get() { invoked = true; return 'no' }, enumerable: true })
  assert.throws(() => validateAppProject(input), AppProjectValidationError)
  assert.equal(invoked, false)
  const cycle = {}; cycle.self = cycle
  assert.throws(() => validateAppProject(cycle), AppProjectValidationError)
  assert.throws(() => parseAppProject('['.repeat(10000) + '0' + ']'.repeat(10000)), AppProjectValidationError)
})

test('migration is idempotent and preserves all supported metadata', () => {
  const input = {
    format: 'paper-app', version: 0, id: 'app_legacy', name: 'Legacy', description: 'Keep me',
    revision: 3, files: { 'App.tsx': 'export default () => null' },
    preview: { status: 'ready', entryPoint: 'App.tsx' },
    release: { status: 'draft', notes: 'Keep these' },
    createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z',
  }
  const before = structuredClone(input)
  const migrated = migrateAppProject(input)
  assert.equal(migrated.description, input.description)
  assert.equal(migrated.preview.entryPoint, 'src/App.tsx')
  assert.equal(migrated.createdAt, input.createdAt)
  assert.deepEqual(migrateAppProject(migrated), migrated)
  assert.deepEqual(parseAppProject(serializeAppProject(migrated)), migrated)
  assert.deepEqual(input, before)
})

test('validated results are detached, canonical snapshots even with optional undefined values', () => {
  const input = createAppProject({
    release: { notes: undefined }, sceneReference: { sceneId: 'scene_1' },
  })
  assert.deepEqual(parseAppProject(serializeAppProject(input)), input)
  const result = validateAppProject(input)
  result.files['src/App.tsx'].content = 'changed'
  result.assetIds.push('asset_new')
  result.sceneReference.sceneId = 'changed'
  result.release.status = 'archived'
  assert.notEqual(input.files['src/App.tsx'].content, 'changed')
  assert.deepEqual(input.assetIds, [])
  assert.equal(input.sceneReference.sceneId, 'scene_1')
  assert.equal(input.release.status, 'draft')
})

test('non-JSON arrays, malformed JSON and escaped duplicate keys reject', () => {
  const valid = createAppProject()
  const extra = []; extra.secret = true
  for (const assetIds of [extra, new Array(2), Object.setPrototypeOf([], null)]) {
    assert.throws(() => validateAppProject({ ...valid, assetIds }), AppProjectValidationError)
  }
  const json = serializeAppProject(valid)
  for (const source of [
    json + ' trailing', json.replace('"version": 1', '"version": 01'),
    json.replace('"version": 1', '"version": 1e999'),
    json.replace('"assetIds": []', '"assetIds": ["asset",]'),
    json.replace('"version": 1', '"version": 1, "ver\\u0073ion": 1'),
    json.replace('"version": 1', '"version": 1, "\\u005f_proto__": {}'),
  ]) assert.throws(() => parseAppProject(source), AppProjectValidationError)
})

test('file limits count UTF-8 bytes and accept the exact boundary', () => {
  const content = 'é'.repeat(APP_PROJECT_LIMITS.MAX_FILE_BYTES / 2)
  const project = createAppProject({ files: { 'src/unicode.txt': content } })
  assert.deepEqual(parseAppProject(serializeAppProject(project)), project)
  assert.throws(() => createAppProject({ files: { 'src/unicode.txt': content + 'é' } }), AppProjectValidationError)
  const invalid = { files: [{ path: 'src/good.ts', content: '' }, { path: '../bad.ts', content: '' }] }
  const before = structuredClone(invalid)
  assert.throws(() => migrateAppProject(invalid), AppProjectValidationError)
  assert.deepEqual(invalid, before)
})

test('TDD: AppProject manifest creation and round-trip serialization', () => {
  const project = createAppProject({
    id: 'app_test_001',
    name: 'Paper Calculator',
    description: 'A precision desktop calculator inspired by Paper craft.',
    revision: 1,
    sceneReference: {
      projectId: 'proj_scene_99',
      sceneId: 'scene_artboard_1',
      revision: 4,
      frameId: 'frame_calc_root',
      snapshotAt: '2026-10-15T00:00:00.000Z',
    },
    files: {
      'src/App.tsx': {
        path: 'src/App.tsx',
        content: 'export default function App() { return <div className="p-4">Calculator</div> }',
      },
      'src/index.css': {
        path: 'src/index.css',
        content: '@tailwind base; @tailwind components; @tailwind utilities;',
      },
      'package.json': {
        path: 'package.json',
        content: JSON.stringify({ name: 'paper-calculator', private: true }),
      },
    },
    assetIds: ['asset_icon_calc', 'asset_font_inter'],
    release: {
      status: 'draft',
      channel: 'preview',
      notes: 'Initial draft build',
    },
    preview: {
      status: 'idle',
      entryPoint: 'src/App.tsx',
    },
  })

  assert.equal(project.format, 'paper-app')
  assert.equal(project.version, 1)
  assert.equal(project.id, 'app_test_001')
  assert.equal(project.name, 'Paper Calculator')
  assert.equal(project.revision, 1)
  assert.equal(project.sceneReference?.frameId, 'frame_calc_root')
  assert.equal(Object.keys(project.files).length, 3)
  assert.deepEqual(project.assetIds, ['asset_icon_calc', 'asset_font_inter'])
  assert.equal(project.release.status, 'draft')
  assert.equal(project.preview?.entryPoint, 'src/App.tsx')

  // Round-trip serialization
  const json = serializeAppProject(project)
  assert.equal(typeof json, 'string')
  const restored = parseAppProject(json)
  assert.deepEqual(restored, project)
})

test('TDD: default values for minimal createAppProject', () => {
  const project = createAppProject({
    name: '  Minimal App  ',
  })

  assert.equal(project.format, 'paper-app')
  assert.equal(project.version, 1)
  assert.match(project.id, /^app_[a-z0-9_-]+$/i)
  assert.equal(project.name, 'Minimal App')
  assert.equal(project.revision, 1)
  assert.equal(project.sceneReference, null)
  assert.deepEqual(project.assetIds, [])
  assert.equal(project.release.status, 'draft')
  assert.equal(project.preview?.status, 'idle')
  assert.equal(project.preview?.entryPoint, 'src/App.tsx')
  assert.ok(project.files['src/App.tsx'], 'has default starter App.tsx')
  assert.ok(project.createdAt)
  assert.ok(project.updatedAt)
})

test('TDD: prototype keys reject atomically at any depth', () => {
  const protoPayloads = [
    // Top-level __proto__
    `{"__proto__": {"polluted": true}, "format": "paper-app", "version": 1, "id": "a", "name": "Test", "revision": 1, "files": {}, "assetIds": [], "release": {"status": "draft"}}`,
    // Inside files map
    `{"format": "paper-app", "version": 1, "id": "a", "name": "Test", "revision": 1, "files": {"__proto__": {"path": "src/App.tsx", "content": "alert(1)"}}, "assetIds": [], "release": {"status": "draft"}}`,
    // Inside a file record
    `{"format": "paper-app", "version": 1, "id": "a", "name": "Test", "revision": 1, "files": {"src/App.tsx": {"path": "src/App.tsx", "content": "", "__proto__": {}}}, "assetIds": [], "release": {"status": "draft"}}`,
    // In release metadata
    `{"format": "paper-app", "version": 1, "id": "a", "name": "Test", "revision": 1, "files": {}, "assetIds": [], "release": {"status": "draft", "constructor": {}}}`,
    // In sceneReference
    `{"format": "paper-app", "version": 1, "id": "a", "name": "Test", "revision": 1, "files": {}, "assetIds": [], "release": {"status": "draft"}, "sceneReference": {"prototype": {}}}`,
  ]

  for (const payload of protoPayloads) {
    assert.throws(
      () => parseAppProject(payload),
      (err) => {
        assert.ok(err instanceof AppProjectValidationError || err instanceof Error)
        assert.match(err.message, /prototype|forbidden key|__proto__|constructor/i)
        return true
      },
      `Payload should reject prototype key: ${payload}`
    )
  }

  // Also test direct validateAppProject with an object having forbidden prototype properties
  const pollutedObj = Object.create(null)
  pollutedObj.format = 'paper-app'
  pollutedObj.version = 1
  pollutedObj.id = 'app_1'
  pollutedObj.name = 'Test'
  pollutedObj.revision = 1
  pollutedObj.files = Object.create(null)
  pollutedObj.files['__proto__'] = { path: '__proto__', content: 'hack' }
  pollutedObj.assetIds = []
  pollutedObj.release = { status: 'draft' }

  assert.throws(
    () => validateAppProject(pollutedObj),
    /prototype|forbidden key|__proto__|constructor/i
  )
})

test('TDD: path traversal attacks reject atomically', () => {
  const badPaths = [
    '../outside.tsx',
    '../../etc/passwd',
    'src/../../secret.ts',
    '/absolute/path.tsx',
    'C:\\Windows\\system32\\calc.exe',
    '..\\traversal.tsx',
    'src\\..\\traversal.tsx',
    'src/App.tsx\0.js',
    './src/../outside.tsx',
    'src//App.tsx',
    'src/./../App.tsx',
    '..',
    '.',
    '',
    '   ',
    'src/%2e%2e/secret.ts',
    'src/..%2fsecret.ts',
  ]

  for (const badPath of badPaths) {
    assert.throws(
      () =>
        createAppProject({
          name: 'Attack Study',
          files: {
            [badPath]: { path: badPath, content: '// evil' },
          },
        }),
      (err) => {
        assert.ok(err instanceof AppProjectValidationError || err instanceof Error)
        assert.match(err.message, /path|traversal|invalid/i)
        return true
      },
      `Should reject path traversal for: ${badPath}`
    )
  }
})

test('TDD: duplicate paths reject atomically', () => {
  // 1. Duplicate in normalized path resolution (e.g. './src/App.tsx' and 'src/App.tsx')
  assert.throws(
    () =>
      createAppProject({
        name: 'Dup Study',
        files: {
          'src/App.tsx': { path: 'src/App.tsx', content: 'code 1' },
          './src/App.tsx': { path: './src/App.tsx', content: 'code 2' },
        },
      }),
    (err) => {
      assert.ok(err instanceof AppProjectValidationError || err instanceof Error)
      assert.match(err.message, /duplicate/i)
      return true
    }
  )

  // 2. Duplicate raw keys in JSON text
  const duplicateKeyJson = `{"format":"paper-app","version":1,"id":"app_dup","name":"Dup","revision":1,"files":{"src/App.tsx":{"path":"src/App.tsx","content":"1"},"src/App.tsx":{"path":"src/App.tsx","content":"2"}},"assetIds":[],"release":{"status":"draft"}}`
  assert.throws(
    () => parseAppProject(duplicateKeyJson),
    (err) => {
      assert.ok(err instanceof AppProjectValidationError || err instanceof Error)
      assert.match(err.message, /duplicate/i)
      return true
    }
  )

  // 3. Duplicate paths in array during migration
  assert.throws(
    () =>
      migrateAppProject({
        name: 'Legacy Dup',
        files: [
          { path: 'src/App.tsx', content: 'first' },
          { path: 'src/App.tsx', content: 'second' },
        ],
      }),
    /duplicate/i
  )
})

test('TDD: oversized payloads and limit breaches reject atomically', () => {
  // 1. File size exceeds MAX_FILE_BYTES
  const hugeContent = 'x'.repeat(APP_PROJECT_LIMITS.MAX_FILE_BYTES + 10)
  assert.throws(
    () =>
      createAppProject({
        name: 'Huge File',
        files: {
          'src/Huge.tsx': { path: 'src/Huge.tsx', content: hugeContent },
        },
      }),
    (err) => {
      assert.match(err.message, /size|exceed|limit/i)
      return true
    }
  )

  // 2. Total source bytes exceeds MAX_TOTAL_FILES_BYTES
  const chunk = 'a'.repeat(300 * 1024)
  const manyFiles = {}
  for (let i = 0; i < 8; i++) {
    manyFiles[`src/File${i}.tsx`] = { path: `src/File${i}.tsx`, content: chunk }
  }
  assert.throws(
    () =>
      createAppProject({
        name: 'Huge Total Files',
        files: manyFiles,
      }),
    (err) => {
      assert.match(err.message, /total.*size|files.*limit/i)
      return true
    }
  )

  // 3. File count exceeds MAX_FILES_COUNT
  const tooManyFiles = {}
  for (let i = 0; i <= APP_PROJECT_LIMITS.MAX_FILES_COUNT + 1; i++) {
    tooManyFiles[`src/comp_${i}.tsx`] = { path: `src/comp_${i}.tsx`, content: 'export {}' }
  }
  assert.throws(
    () =>
      createAppProject({
        name: 'Too Many Files',
        files: tooManyFiles,
      }),
    /file count|too many files/i
  )

  // 4. Asset IDs count exceeds MAX_ASSET_IDS_COUNT
  const tooManyAssets = Array.from(
    { length: APP_PROJECT_LIMITS.MAX_ASSET_IDS_COUNT + 1 },
    (_, i) => `asset_${i}`
  )
  assert.throws(
    () =>
      createAppProject({
        name: 'Too Many Assets',
        assetIds: tooManyAssets,
      }),
    /asset.*count|too many assets/i
  )

  // 5. Oversized project name
  assert.throws(
    () =>
      createAppProject({
        name: 'A'.repeat(APP_PROJECT_LIMITS.MAX_NAME_LENGTH + 1),
      }),
    /name.*length|name.*limit/i
  )

  // 6. Oversized path length
  const veryLongPath = 'src/' + 'a'.repeat(APP_PROJECT_LIMITS.MAX_PATH_LENGTH) + '.tsx'
  assert.throws(
    () =>
      createAppProject({
        name: 'Long Path',
        files: {
          [veryLongPath]: { path: veryLongPath, content: 'export {}' },
        },
      }),
    /path.*length|path.*limit/i
  )

  // 7. Oversized JSON string in parseAppProject
  const oversizedRaw = '{"pad":"' + '0'.repeat(APP_PROJECT_LIMITS.MAX_MANIFEST_BYTES + 10) + '"}'
  assert.throws(() => parseAppProject(oversizedRaw), /smaller than|payload.*size/i)
})

test('TDD: legacy migrations convert v0/unversioned formats to strict v1 schema', () => {
  // Case 1: unversioned simple object with flat string file map
  const legacySimple = {
    name: 'Legacy Calculator',
    files: {
      'App.tsx': 'export default function App() { return <h1>Calc</h1> }',
      'style.css': 'body { background: #080808; }',
    },
    sceneId: 'scene_legacy_1',
    frameId: 'frame_root',
  }

  const migrated = migrateAppProject(legacySimple)
  assert.equal(migrated.format, 'paper-app')
  assert.equal(migrated.version, 1)
  assert.equal(migrated.name, 'Legacy Calculator')
  assert.equal(migrated.revision, 1)
  assert.equal(migrated.release.status, 'draft')
  assert.equal(migrated.sceneReference?.sceneId, 'scene_legacy_1')
  assert.equal(migrated.sceneReference?.frameId, 'frame_root')
  assert.ok(migrated.files['src/App.tsx'], 'normalizes App.tsx to src/App.tsx')
  assert.equal(
    migrated.files['src/App.tsx'].content,
    'export default function App() { return <h1>Calc</h1> }'
  )
  assert.ok(migrated.files['src/style.css'])

  // Case 2: legacy format with array of files
  const legacyArray = {
    version: 0,
    name: 'Array Files App',
    files: [
      { path: 'src/App.tsx', content: 'export default () => <div>Hi</div>' },
      { path: 'src/data.json', content: '{"items": [1, 2, 3]}' },
    ],
    assetIds: ['legacy_asset_1'],
  }

  const migratedArray = migrateAppProject(legacyArray)
  assert.equal(migratedArray.version, 1)
  assert.equal(migratedArray.name, 'Array Files App')
  assert.deepEqual(Object.keys(migratedArray.files).sort(), ['src/App.tsx', 'src/data.json'])
  assert.deepEqual(migratedArray.assetIds, ['legacy_asset_1'])

  // Case 3: legacy migration rejects invalid inputs atomically
  assert.throws(() => migrateAppProject(null), /invalid|object/i)
  assert.throws(() => migrateAppProject([]), /invalid|object/i)
  assert.throws(
    () =>
      migrateAppProject({
        name: 'Evil Legacy',
        files: { '../evil.ts': 'danger' },
      }),
    /path|traversal/i
  )
})

test('TDD: scene document semantics are preserved and completely unaltered', () => {
  const store = new SceneStore()
  store.add('frame', { id: 'frame_1', x: 0, y: 0, width: 400, height: 300 })
  store.add('text', { id: 'txt_1', parentId: 'frame_1', x: 20, y: 20, text: 'Keep Clean' })
  const sceneProject = createProject(store, 'Canvas Project', { x: 0, y: 0, zoom: 1 }, true)

  // Paper scene project remains format 'paper'
  assert.equal(sceneProject.format, 'paper')
  assert.equal(sceneProject.version, 1)

  // Serializing scene project works as before
  const sceneJson = serializeProject(sceneProject)
  const parsedScene = parseProject(sceneJson)
  assert.deepEqual(parsedScene, sceneProject)

  // AppProject parser explicitly rejects a Paper scene project (not confusing the two formats)
  assert.throws(
    () => parseAppProject(sceneJson),
    /unsupported format|not a paper app/i
  )

  // Scene parser explicitly rejects an AppProject (not confusing the two formats)
  const appProject = createAppProject({ name: 'Make Project' })
  const appJson = serializeAppProject(appProject)
  assert.throws(
    () => parseProject(appJson),
    /unsupported paper project version|not a paper project/i
  )
})
