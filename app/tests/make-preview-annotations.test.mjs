import test from 'node:test'
import assert from 'node:assert/strict'
import {
  compileAppProject,
  compileSourceFiles,
} from '../src/make/compiler.ts'
import {
  createAppProject,
  validateAppProject,
  serializeAppProject,
  parseAppProject,
} from '../src/make/manifest.ts'
import {
  createPreviewMessage,
  parsePreviewMessage,
} from '../src/make/preview-sandbox.ts'
import * as workspace from '../src/make/workspace-model.ts'
const { createMakeWorkspaceStore } = workspace

test('compiler assigns deterministic stable data-paper-id attributes to JSX elements', async () => {
  const source = `import React, { useState } from 'react'

export default function CounterApp() {
  const [count, setCount] = useState(0)
  return (
    <main className="container">
      <header className="header">
        <h1 className="title">Counter</h1>
      </header>
      <div className="card">
        <p className="display">Current: {count}</p>
        <button className="btn" onClick={() => setCount(c => c + 1)}>Increment</button>
      </div>
    </main>
  )
}
`
  const res = await compileSourceFiles({
    'src/App.tsx': source,
  })

  assert.equal(res.success, true, 'Compilation must succeed')
  const code = res.modules['src/App.tsx']?.code ?? ''
  assert.ok(code.includes('data-paper-id'), 'Compiled code must inject data-paper-id attributes')

  // Check stability across multiple runs
  const res2 = await compileSourceFiles({
    'src/App.tsx': source,
  })
  const code2 = res2.modules['src/App.tsx']?.code ?? ''
  assert.equal(code, code2, 'Compiler output with stable IDs must be deterministic across runs')
})

test('compiler preserves explicit data-paper-id and data-layer-id without overwriting', async () => {
  const source = `import React from 'react'

export default function ExplicitApp() {
  return (
    <div data-paper-id="custom-root-id" data-layer-id="layer-123">
      <button data-paper-id="explicit-button-id">Click</button>
    </div>
  )
}
`
  const res = await compileSourceFiles({
    'src/App.tsx': source,
  })

  assert.equal(res.success, true)
  const code = res.modules['src/App.tsx']?.code ?? ''
  assert.ok(code.includes('"custom-root-id"'), 'Must preserve explicit custom-root-id')
  assert.ok(code.includes('"explicit-button-id"'), 'Must preserve explicit explicit-button-id')
  assert.ok(code.includes('"layer-123"'), 'Must preserve explicit layer-123')
})

test('preview message protocol accepts valid element-selected payload and rejects arbitrary DOM HTML', () => {
  const validPayload = {
    elementId: 'App-btn-1',
    tagName: 'button',
    selector: 'main > div.card > button.btn',
    previewText: 'Increment',
    layerId: 'layer-btn-42',
    bounds: { x: 40, y: 120, width: 100, height: 36 },
  }

  const validMessage = createPreviewMessage('paper-preview', 'preview:element-selected', validPayload)
  const parsed = parsePreviewMessage(validMessage, 'paper-preview')
  assert.equal(parsed.valid, true, 'Valid element selection envelope must pass validation')

  // Malicious / spoofed payload containing arbitrary DOM HTML or script tags
  const xssPayload = {
    elementId: '<script>alert("xss")</script>',
    tagName: 'button',
    html: '<img src=x onerror=alert(1)>',
    previewText: 'Malicious <div onclick="...">click</div>',
  }

  assert.throws(() => {
    createPreviewMessage('paper-preview', 'preview:element-selected', xssPayload)
  }, /invalid|exceeds/i, 'Payload with HTML tags or unexpected properties must be rejected')

  const rawSpoofedWithHtml = {
    channel: 'paper-make-preview',
    version: 1,
    source: 'paper-preview',
    type: 'preview:element-selected',
    id: 'test-spoof-1',
    timestamp: Date.now(),
    payload: {
      elementId: 'btn-1',
      tagName: 'button',
      innerHTML: '<script>stealTokens()</script>',
    },
  }
  const parsedSpoof = parsePreviewMessage(rawSpoofedWithHtml, 'paper-preview')
  assert.equal(parsedSpoof.valid, false, 'Spoofed message with arbitrary DOM HTML must fail validation')

  // Cross-origin / spoofed host source
  const rawSpoofedSource = {
    ...validMessage,
    source: 'paper-host',
  }
  const parsedSource = parsePreviewMessage(rawSpoofedSource, 'paper-preview')
  assert.equal(parsedSource.valid, false, 'Message with mismatched source must fail validation')
})

test('annotations survive project serialization and reload', () => {
  const initialAnnotations = [
    {
      id: 'ann_1',
      elementId: 'App-btn-1',
      tagName: 'button',
      text: 'Make button primary style with #81adec background',
      selector: 'button.btn',
      previewText: 'Increment',
      createdAt: '2026-10-15T08:00:00.000Z',
    },
    {
      id: 'ann_2',
      elementId: 'App-title-2',
      tagName: 'h1',
      text: 'Increase title font size and change font weight to 700',
      selector: 'h1.title',
      previewText: 'Counter',
      createdAt: '2026-10-15T08:05:00.000Z',
    },
  ]

  const project = createAppProject({
    name: 'Annotated App',
    annotations: initialAnnotations,
  })

  assert.ok(project.annotations, 'Project must contain annotations')
  assert.equal(project.annotations.length, 2)
  assert.equal(project.annotations[0].elementId, 'App-btn-1')
  assert.equal(project.annotations[0].text, 'Make button primary style with #81adec background')

  // Validate manifest serialization and reload round-trip
  const serialized = serializeAppProject(project)
  const parsed = parseAppProject(serialized)

  assert.equal(parsed.annotations?.length, 2, 'Annotations must survive JSON serialization')
  assert.equal(parsed.annotations?.[0].id, 'ann_1')
  assert.equal(parsed.annotations?.[0].elementId, 'App-btn-1')
  assert.equal(parsed.annotations?.[1].id, 'ann_2')
  assert.equal(parsed.annotations?.[1].elementId, 'App-title-2')
})

test('MakeWorkspaceStore manages selected element, annotations and prompt inclusion', async () => {
  const store = createMakeWorkspaceStore({
    compiler: compileAppProject,
  })

  assert.equal(store.getState().selectedElement, null)
  assert.deepEqual(store.getState().activeProject.annotations ?? [], [])

  // Select element
  store.selectElement({
    elementId: 'App-btn-1',
    tagName: 'button',
    selector: 'button.btn',
    previewText: 'Click me',
    bounds: { x: 50, y: 100, width: 80, height: 32 },
  })

  assert.ok(store.getState().selectedElement)
  assert.equal(store.getState().selectedElement?.elementId, 'App-btn-1')

  // Add annotation for selected element
  const annotation = store.addAnnotation({
    elementId: 'App-btn-1',
    tagName: 'button',
    text: 'Change button color to #81adec and round corners to 8px',
    selector: 'button.btn',
    previewText: 'Click me',
  })

  assert.ok(annotation.id)
  assert.equal(store.getState().activeProject.annotations?.length, 1)
  assert.equal(store.getState().activeProject.annotations?.[0].text, 'Change button color to #81adec and round corners to 8px')

  // Format annotation into prompt
  const promptPart = workspace.formatAnnotationPrompt(annotation)
  assert.ok(promptPart.includes('[Target: <button> #App-btn-1]'))
  assert.ok(promptPart.includes('Change button color to #81adec and round corners to 8px'))

  // Attach annotation to prompt in store
  store.attachAnnotationToPrompt(annotation.id)
  assert.ok(store.getState().planPrompt.includes(promptPart))

  // Delete annotation
  store.deleteAnnotation(annotation.id)
  assert.equal(store.getState().activeProject.annotations?.length, 0)
})


test('saving annotations persists a revision and reopening restores them without replacing preview assets', async () => {
  let disk = createAppProject({ id: 'annotated-saved', files: { 'src/App.tsx': 'export default () => <button>Save</button>' } })
  const repository = {
    list: async () => [disk], read: async () => structuredClone(disk),
    create: async project => structuredClone(project), compile: compileAppProject,
    update: async (project, expectedRevision) => {
      assert.equal(expectedRevision, disk.revision)
      disk = validateAppProject({ ...project, revision: expectedRevision + 1 })
      return structuredClone(disk)
    },
  }
  const store = createMakeWorkspaceStore({ repository })
  await store.loadProjects()
  await store.openSavedProject(disk.id)
  await store.runPreview()
  const assets = store.getState().assets
  const annotation = store.addAnnotation({ elementId: 'button-1', tagName: 'button', text: 'Use blue' })
  await store.saveAnnotations()
  assert.equal(store.getState().annotationDirty, false)
  assert.equal(store.getState().assets, assets)
  const reloaded = createMakeWorkspaceStore({ repository })
  await reloaded.openSavedProject(disk.id)
  assert.deepEqual(reloaded.getState().activeProject.annotations, [annotation])
  reloaded.attachAnnotationToPrompt(annotation.id)
  reloaded.attachAnnotationToPrompt(annotation.id)
  assert.equal(reloaded.getState().planPrompt.split('Use blue').length, 2, 'Attach is idempotent')
  reloaded.deleteAnnotation(annotation.id)
  await reloaded.loadProjects()
  await reloaded.saveAnnotations()
  assert.deepEqual(disk.annotations, [])
})

test('failed annotation writes preserve notes and successful copies include them', async () => {
  const project = createAppProject({ id: 'notes-failure' })
  let copied
  const store = createMakeWorkspaceStore({ initialProject: project, repository: {
    list: async () => [project], read: async () => project, compile: compileAppProject,
    create: async copy => { copied = copy; return copy },
    update: async () => { throw new Error('Revision conflict') },
  } })
  await store.loadProjects()
  const note = store.addAnnotation({ elementId: 'button-1', tagName: 'button', text: 'Keep this' })
  await store.saveAnnotations()
  assert.equal(store.getState().annotationDirty, true)
  assert.match(store.getState().projectError, /Revision conflict/)
  assert.equal(store.getState().activeProject.annotations[0].id, note.id)
  await store.saveCopy()
  assert.equal(copied.annotations[0].id, note.id)
  assert.equal(store.getState().selectedElement, null)
})

test('selection payload is strictly bounded, including nested bounds, and annotations reject duplicate IDs', () => {
  const payload = { elementId: 'button-1', tagName: 'button', bounds: { x: 0, y: 0, width: 10, height: 20 } }
  for (const extra of [{ width: -1 }, { innerHTML: '<img src=x>' }, { x: Infinity }]) {
    assert.throws(() => createPreviewMessage('paper-preview', 'preview:element-selected', { ...payload, bounds: { ...payload.bounds, ...extra } }))
  }
  const note = { id: 'duplicate', elementId: 'button-1', tagName: 'button', text: 'Blue', createdAt: new Date().toISOString() }
  assert.throws(() => createAppProject({ annotations: [note, note] }), /duplicate/i)
  assert.throws(() => createAppProject({ annotations: [{ ...note, tagName: '<script>' }] }), /invalid/i)
})


test('source IDs distinguish modules with the same basename without passing inspector props to components', async () => {
  const result = await compileSourceFiles({
    'src/App.tsx': `import Left from './left/Item'; import Right from './right/Item'; export default () => <main><Left /><Right /></main>`,
    'src/left/Item.tsx': 'export default () => <button>Left</button>',
    'src/right/Item.tsx': 'export default () => <button>Right</button>',
  })
  assert.equal(result.success, true)
  const ids = ['src/left/Item.tsx', 'src/right/Item.tsx'].map(path => result.modules[path].code.match(/"data-paper-id": ['"]([^'"]+)['"]/ )[1])
  assert.notEqual(ids[0], ids[1])
  assert.equal((result.modules['src/App.tsx'].code.match(/data-paper-id/g) ?? []).length, 1, 'Custom component props remain unchanged')
})
