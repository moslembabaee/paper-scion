import test from 'node:test'
import assert from 'node:assert/strict'
import { createAppProject } from '../src/make/manifest.ts'
import { compileAppProject, compileSourceFiles } from '../src/make/compiler.ts'
import * as workspace from '../src/make/workspace-model.ts'
const { createMakeWorkspaceStore } = workspace
import {
  inspectElementEligibility,
  applyVisualPropertyUpdate,
  ALLOWED_VISUAL_PROPERTIES,
  validateStyleValue,
} from '../src/make/visual-inspector.ts'
import { createPreviewMessage, parsePreviewMessage } from '../src/make/preview-sandbox.ts'

const sampleAppSource = `import React, { useState } from 'react'

export default function App() {
  const [count, setCount] = useState(0)
  return (
    <main className="container" style={{ padding: '24px', backgroundColor: '#080808' }}>
      <header className="header">
        <h1 className="title">Counter App</h1>
      </header>
      <div className="card">
        <p className="description" style={{ color: '#aaa99f', fontSize: '14px' }}>
          Current count: {count}
        </p>
        <button
          className="btn"
          onClick={() => setCount(c => c + 1)}
        >
          Increment
        </button>
      </div>
    </main>
  )
}
`

test('visual inspector preserves untouched numeric styles, quoted keys, comments and sibling source exactly', async () => {
  const source = `// style={{ color: 'red' }} is documentation, not a target
export default () => <main><p data-paper-id="exact" style={{ opacity: 0.6, zIndex: 2, '--accent': 'blue', /* keep */ color: 'red' }}>One</p><p style={{ color: 'red' }}>Two</p></main>`
  const project = createAppProject({ files: { 'src/App.tsx': source } })
  const result = await applyVisualPropertyUpdate(project, { elementId: 'exact~1', tagName: 'p' }, { color: '#81adec' })
  assert.equal(result.updatedProject.files['src/App.tsx'].content, source.replace("/* keep */ color: 'red'", '/* keep */ color: "#81adec"'))
})

test('visual inspector rejects ambiguous IDs and computed styles rather than editing another element', async () => {
  for (const source of [
    'export default () => <main><p data-paper-id="same">One</p><p data-paper-id="same">Two</p></main>',
    'export default () => <p data-paper-id="same" style={{ ["color"]: "red" }}>One</p>',
    'export default () => <p data-paper-id={"same"}>One</p>',
    'export default () => <main><p data-paper-id="s&#97;me">One</p><p data-paper-id="same">Two</p></main>',
  ]) {
    const project = createAppProject({ files: { 'src/App.tsx': source } })
    const target = { elementId: 'same~1', tagName: 'p' }
    assert.equal(inspectElementEligibility(project, target).readOnly, true)
    await assert.rejects(() => applyVisualPropertyUpdate(project, target, { color: '#81adec' }))
  }
})

test('visual inspector treats sanitized runtime ID collisions as ambiguous', async () => {
  const project = createAppProject({ files: { 'src/App.tsx': 'export default () => <main><p data-paper-id="a b">One</p><p data-paper-id="a_b">Two</p></main>' } })
  for (const elementId of ['a_b~1', 'a_b~2']) {
    assert.equal(inspectElementEligibility(project, { elementId, tagName: 'p' }).readOnly, true)
  }
})

test('visual inspector rejects runtime IDs made ambiguous by truncation or sanitization across files', async () => {
  for (const [first, second] of [['a~b', 'a_b'], ['x'.repeat(100), 'x'.repeat(100) + 'tail']]) {
    const project = createAppProject({ files: {
      'src/App.tsx': `export default () => <p data-paper-id="${first}">One</p>`,
      'src/Other.tsx': `export default () => <p data-paper-id="${second}">Two</p>`,
    } })
    const target = { elementId: `${first.replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 100)}~1`, tagName: 'p' }
    assert.equal(inspectElementEligibility(project, target).readOnly, true)
    await assert.rejects(() => applyVisualPropertyUpdate(project, target, { color: '#81adec' }), /read-only|ambiguous/i)
    assert.ok(!project.files['src/App.tsx'].content.includes('#81adec'))
  }
})

test('visual inspector removes overrides without dropping comments between properties', async () => {
  const project = createAppProject({ files: {
    'src/App.tsx': `export default () => <p data-paper-id="comments" style={{ color: 'red', /* retain this note */ margin: 4 /* and this note */ }}>One</p>`,
  } })
  const result = await applyVisualPropertyUpdate(project, { elementId: 'comments~1', tagName: 'p' }, { margin: '' })
  assert.match(result.updatedProject.files['src/App.tsx'].content, /retain this note/)
  assert.match(result.updatedProject.files['src/App.tsx'].content, /and this note/)
  assert.equal((await compileAppProject(result.updatedProject)).success, true)
})

test('visual inspector never falls back to layer ID or HTML id to resolve a source site', () => {
  const project = createAppProject({ files: { 'src/App.tsx': 'export default () => <p id="title" data-layer-id="layer">One</p>' } })
  assert.equal(inspectElementEligibility(project, { elementId: 'unknown~1', layerId: 'layer', tagName: 'p' }).readOnly, true)
  assert.equal(inspectElementEligibility(project, { elementId: 'title~1', tagName: 'p' }).readOnly, true)
})

test('unresolved source IDs cannot make an unsupported element alias an editable source site', async () => {
  for (const other of [
    '<p data-paper-id={"title"}>Dynamic identity</p>',
    '<p data-paper-id="other" {...{ "data-paper-id": "title" }}>Spread identity</p>',
    '<p data-paper-id="" id="title">Fallback identity</p>',
  ]) {
    const project = createAppProject({ files: { 'src/App.tsx': `export default () => <main><p data-paper-id="title">Static identity</p>${other}</main>` } })
    const target = { elementId: 'title~2', tagName: 'p' }
    assert.equal(inspectElementEligibility(project, target).readOnly, true)
    await assert.rejects(() => applyVisualPropertyUpdate(project, target, { color: '#81adec' }), /read-only/i)
  }
})

test('visual inspector rejects invalid CSS grammar and preserves unitless numeric meaning', async () => {
  for (const [property, value] of [['fontSize', '12 14'], ['fontSize', '-2px'], ['padding', '-2px'], ['gap', '1px 2px 3px'], ['color', '#12345'], ['color', 'banana'], ['fontWeight', 'banana'], ['textAlign', '700']]) {
    assert.throws(() => validateStyleValue(property, value), /invalid/i)
  }
  const project = createAppProject({ files: { 'src/App.tsx': 'export default () => <h1 data-paper-id="title">Title</h1>' } })
  const result = await applyVisualPropertyUpdate(project, { elementId: 'title~1', tagName: 'h1' }, { fontSize: '32', lineHeight: '1.5', fontWeight: '700' })
  assert.match(result.updatedProject.files['src/App.tsx'].content, /fontSize: 32/)
  assert.match(result.updatedProject.files['src/App.tsx'].content, /lineHeight: 1.5/)
})

test('preview selection accepts only bounded allowlisted computed styles', () => {
  const message = createPreviewMessage('paper-preview', 'preview:element-selected', {
    elementId: 'title~1', tagName: 'h1', styles: { color: 'rgb(129, 173, 236)', fontSize: '32px' },
  })
  assert.equal(parsePreviewMessage(message, 'paper-preview').valid, true)
  for (const styles of [{ color: '<script>' }, { backgroundImage: 'url(https://attacker.invalid)' }, { fontSize: 'x'.repeat(129) }, { fontSize: 32 }, [], null]) {
    assert.equal(parsePreviewMessage({ ...message, payload: { ...message.payload, styles } }, 'paper-preview').valid, false)
  }
})

test('visual edits preserve exact sibling modules and handle quoted keys, trailing commas, insertion and removal', async () => {
  const project = createAppProject({ files: {
    'src/App.tsx': `import Item from './Item'; export default () => <main><Item /><p>Sibling</p></main>`,
    'src/Item.tsx': `export default () => <p data-paper-id="item" style={{ /* note */ 'color': 'red', margin: 4, }}>Item</p>`,
  } })
  const updated = await applyVisualPropertyUpdate(project, { elementId: 'item~2', tagName: 'p' }, { color: '#81adec', margin: '', padding: '8px 12px' })
  assert.equal(updated.updatedProject.files['src/App.tsx'].content, project.files['src/App.tsx'].content)
  const content = updated.updatedProject.files['src/Item.tsx'].content
  assert.ok(content.includes('/* note */'))
  assert.ok(content.includes("'color': \"#81adec\""))
  assert.ok(!content.includes('margin'))
  assert.equal((await compileAppProject(updated.updatedProject)).success, true)
})

test('visual inspector: identifies eligible standard JSX elements with existing or absent styles', async () => {
  const project = createAppProject({
    id: 'test-inspector-app',
    name: 'Inspector Test App',
    files: {
      'src/App.tsx': sampleAppSource,
    },
  })

  // Compile to get data-paper-id attributes
  const compiled = await compileSourceFiles(project.files)
  assert.equal(compiled.success, true)
  const appCode = compiled.modules['src/App.tsx']?.code ?? ''

  // Extract data-paper-id for h1
  const h1Match = appCode.match(/data-paper-id":\s*["']([^"']*-h1-[^"']*)["']/)
  assert.ok(h1Match, 'h1 must receive data-paper-id')
  const h1Id = `${h1Match[1]}~1`

  // Inspect h1 (eligible, initially has no inline style)
  const h1Result = inspectElementEligibility(project, {
    elementId: h1Id,
    tagName: 'h1',
    previewText: 'Counter App',
  })

  assert.equal(h1Result.eligible, true, 'h1 should be eligible for direct visual inspection')
  assert.equal(h1Result.readOnly, false)
  assert.equal(h1Result.filePath, 'src/App.tsx')
  assert.equal(h1Result.tagName, 'h1')
  assert.deepEqual(h1Result.inlineStyles, {})

  // Inspect paragraph with existing inline styles: { color: '#aaa99f', fontSize: '14px' }
  const pMatch = appCode.match(/data-paper-id":\s*["']([^"']*-p-[^"']*)["']/)
  assert.ok(pMatch, 'p must receive data-paper-id')
  const pId = `${pMatch[1]}~1`

  const pResult = inspectElementEligibility(project, {
    elementId: pId,
    tagName: 'p',
    previewText: 'Current count: 0',
  })

  assert.equal(pResult.eligible, true)
  assert.equal(pResult.readOnly, false)
  assert.equal(pResult.inlineStyles.color, '#aaa99f')
  assert.equal(pResult.inlineStyles.fontSize, '14px')
})

test('visual inspector: unsupported elements with dynamic styles or spread props stay read-only', async () => {
  const complexSource = `import React from 'react'

export default function DynamicApp(props: any) {
  const dynamicStyle = { color: 'red' }
  return (
    <div>
      <h1 style={dynamicStyle}>Dynamic Header</h1>
      <button {...props}>Spread Button</button>
      <span style={(() => ({ fontSize: '12px' }))()}>Call Expression</span>
    </div>
  )
}
`
  const project = createAppProject({
    id: 'test-dynamic-app',
    files: { 'src/App.tsx': complexSource },
  })

  const compiled = await compileSourceFiles(project.files)
  assert.equal(compiled.success, true)
  const code = compiled.modules['src/App.tsx']?.code ?? ''

  const h1Id = `${code.match(/data-paper-id":\s*["']([^"']*-h1-[^"']*)["']/)?.[1]}~1`
  const btnId = `${code.match(/data-paper-id":\s*["']([^"']*-button-[^"']*)["']/)?.[1]}~1`
  const spanId = `${code.match(/data-paper-id":\s*["']([^"']*-span-[^"']*)["']/)?.[1]}~1`

  // Dynamic style expression -> read-only
  const h1Result = inspectElementEligibility(project, { elementId: h1Id, tagName: 'h1' })
  assert.equal(h1Result.eligible, false, 'Element with dynamic style identifier must not be editable')
  assert.equal(h1Result.readOnly, true)
  assert.match(h1Result.reason || '', /dynamic|unsupported/i)

  // Spread attribute -> read-only
  const btnResult = inspectElementEligibility(project, { elementId: btnId, tagName: 'button' })
  assert.equal(btnResult.eligible, false, 'Element with JSX spread attributes must be read-only')
  assert.equal(btnResult.readOnly, true)

  // Call expression in style -> read-only
  const spanResult = inspectElementEligibility(project, { elementId: spanId, tagName: 'span' })
  assert.equal(spanResult.eligible, false, 'Element with call expression in style must be read-only')
  assert.equal(spanResult.readOnly, true)

  // Unknown element ID not in source files -> read-only
  const unknownResult = inspectElementEligibility(project, { elementId: 'non-existent-id~1', tagName: 'div' })
  assert.equal(unknownResult.eligible, false)
  assert.equal(unknownResult.readOnly, true)
})

test('visual inspector: applyVisualPropertyUpdate deterministically updates TSX source and validates compiler output', async () => {
  const project = createAppProject({
    id: 'test-update-app',
    files: { 'src/App.tsx': sampleAppSource },
  })

  const compiled = await compileSourceFiles(project.files)
  const appCode = compiled.modules['src/App.tsx']?.code ?? ''
  const h1Id = `${appCode.match(/data-paper-id":\s*["']([^"']*-h1-[^"']*)["']/)?.[1]}~1`

  // Update typography and color on h1
  const updateResult = await applyVisualPropertyUpdate(
    project,
    { elementId: h1Id, tagName: 'h1' },
    {
      fontSize: '28px',
      fontWeight: '700',
      color: '#81adec',
      textAlign: 'center',
    }
  )

  assert.equal(updateResult.success, true, 'Visual property update must succeed')
  assert.ok(updateResult.updatedProject, 'Must return updated project')
  const newSource = updateResult.updatedProject.files['src/App.tsx']?.content ?? ''

  // Verify deterministic AST insertion of style attribute
  assert.ok(newSource.includes('fontSize: "28px"'), 'New source must contain updated fontSize')
  assert.ok(newSource.includes('color: "#81adec"'), 'New source must contain updated color')
  assert.ok(newSource.includes('fontWeight: 700'), 'New source must contain updated fontWeight')
  assert.ok(newSource.includes('textAlign: "center"'), 'New source must contain updated textAlign')

  // Verify surrounding code and comments are not corrupted
  assert.ok(newSource.includes('export default function App()'), 'Component header must be preserved')
  assert.ok(newSource.includes('className="title"'), 'Other attributes must be preserved')

  // Verify the updated project compiles cleanly
  const recompile = await compileSourceFiles(updateResult.updatedProject.files)
  assert.equal(recompile.success, true, 'Updated source must compile cleanly')
  assert.equal(recompile.diagnostics.length, 0)
})

test('visual inspector: merges with existing styles and removes properties set to empty string', async () => {
  const project = createAppProject({
    id: 'test-merge-app',
    files: { 'src/App.tsx': sampleAppSource },
  })

  const compiled = await compileSourceFiles(project.files)
  const appCode = compiled.modules['src/App.tsx']?.code ?? ''
  // Paragraph has: style={{ color: '#aaa99f', fontSize: '14px' }}
  const pId = `${appCode.match(/data-paper-id":\s*["']([^"']*-p-[^"']*)["']/)?.[1]}~1`

  // Update color and remove fontSize by passing empty string
  const updateResult = await applyVisualPropertyUpdate(
    project,
    { elementId: pId, tagName: 'p' },
    {
      color: '#edebe1',
      fontSize: '', // Delete property
      lineHeight: '1.6',
    }
  )

  assert.equal(updateResult.success, true)
  const newSource = updateResult.updatedProject?.files['src/App.tsx']?.content ?? ''
  assert.ok(newSource.includes('color: "#edebe1"'))
  assert.ok(newSource.includes('lineHeight: 1.6'))
  assert.ok(!newSource.includes('fontSize'), 'fontSize should be removed when passed empty string')
})

test('visual inspector: security rejects unsafe style values, code injection and disallowed properties', async () => {
  const project = createAppProject({
    id: 'test-security-app',
    files: { 'src/App.tsx': sampleAppSource },
  })

  const compiled = await compileSourceFiles(project.files)
  const appCode = compiled.modules['src/App.tsx']?.code ?? ''
  const h1Id = `${appCode.match(/data-paper-id":\s*["']([^"']*-h1-[^"']*)["']/)?.[1]}~1`

  // 1. Script injection
  await assert.rejects(
    async () => {
      await applyVisualPropertyUpdate(
        project,
        { elementId: h1Id, tagName: 'h1' },
        { color: 'red; } <script>alert("xss")</script>' }
      )
    },
    /unsafe|invalid/i,
    'Script injection in style value must be rejected'
  )

  // 2. Attribute breakout / quotes
  await assert.rejects(
    async () => {
      await applyVisualPropertyUpdate(
        project,
        { elementId: h1Id, tagName: 'h1' },
        { fontSize: '14px" onClick="alert(1)' }
      )
    },
    /unsafe|invalid/i,
    'Quotes and JSX breakout must be rejected'
  )

  // 3. JavaScript expression or function call
  await assert.rejects(
    async () => {
      await applyVisualPropertyUpdate(
        project,
        { elementId: h1Id, tagName: 'h1' },
        { backgroundColor: 'javascript:alert(1)' }
      )
    },
    /unsafe|invalid/i,
    'Javascript URI must be rejected'
  )

  // 4. Non-allowlisted CSS properties
  await assert.rejects(
    async () => {
      await applyVisualPropertyUpdate(
        project,
        { elementId: h1Id, tagName: 'h1' },
        { behavior: 'url(test.htc)' }
      )
    },
    /allowed|unsupported/i,
    'Arbitrary CSS properties like behavior must be rejected'
  )

  // 5. Attempting to update read-only unsupported element
  await assert.rejects(
    async () => {
      await applyVisualPropertyUpdate(
        project,
        { elementId: 'unsupported-id~1', tagName: 'div' },
        { color: '#81adec' }
      )
    },
    /read-only|unsupported|not found/i,
    'Updating unsupported or unmapped elements must be rejected'
  )
})

test('MakeWorkspaceStore: visual property changes survive rebuild, undo, and mobile view', async () => {
  let disk = createAppProject({
    id: 'store-visual-app',
    name: 'Visual Store App',
    files: {
      'src/App.tsx': `export default function App() {
  return (
    <main>
      <h1>Editable Heading</h1>
      <button>Click</button>
    </main>
  )
}`,
    },
  })

  const repository = {
    list: async () => [disk],
    read: async () => structuredClone(disk),
    create: async p => structuredClone(p),
    update: async (p, expectedRev) => {
      assert.equal(expectedRev, disk.revision)
      disk = { ...p, revision: expectedRev + 1 }
      return structuredClone(disk)
    },
    compile: compileAppProject,
    rollback: async (_id, expectedRev) => {
      assert.equal(expectedRev, disk.revision)
      disk = { ...disk, revision: expectedRev + 1, files: { 'src/App.tsx': { path: 'src/App.tsx', content: `export default function App() {
  return (
    <main>
      <h1>Editable Heading</h1>
      <button>Click</button>
    </main>
  )
}` } } }
      return { ok: true, project: disk, ...(await compileAppProject(disk)) }
    },
  }

  const store = createMakeWorkspaceStore({ repository, compiler: compileAppProject })
  await store.loadProjects()
  await store.openSavedProject(disk.id)
  await store.runPreview()

  assert.equal(store.getState().previewStatus, 'ready')
  const initialRevision = store.getState().activeProject.revision
  assert.equal(initialRevision, 1)

  // Find the h1 element ID
  const assets = store.getState().assets
  assert.ok(assets)
  const h1Id = `${assets.js.match(/data-paper-id":\s*["']([^"']*-h1-[^"']*)["']/)?.[1]}~1`

  // Select the element
  store.selectElement({
    elementId: h1Id,
    tagName: 'h1',
    previewText: 'Editable Heading',
  })

  // 1. Apply visual property change via store
  const updateResult = await store.applyVisualProperties(h1Id, {
    fontSize: '32px',
    color: '#81adec',
  })
  assert.equal(updateResult.success, true)

  // Check state updates: revision incremented, diff preview created, rollback point set
  assert.equal(store.getState().activeProject.revision, 2, 'Project revision must advance')
  assert.ok(store.getState().currentDiff, 'Diff preview must be computed and available')
  assert.equal(store.getState().currentDiff?.changedFilesCount, 1)
  assert.ok(store.getState().rollbackPoint, 'Rollback point must be set for undo')
  assert.equal(store.getState().rollbackPoint?.revision, 1)

  const updatedSource = store.getState().activeProject.files['src/App.tsx'].content
  assert.ok(updatedSource.includes('fontSize: "32px"'))
  assert.ok(updatedSource.includes('color: "#81adec"'))

  // 2. SURVIVE REBUILD: run preview again, changes must survive
  await store.runPreview()
  assert.equal(store.getState().previewStatus, 'ready')
  assert.ok(store.getState().assets?.js.includes('"32px"'), 'Rebuilt preview must contain new font size')

  // 3. SURVIVE MOBILE VIEW: switch device viewport to mobile, properties must remain
  store.setDeviceViewport('mobile')
  assert.equal(store.getState().deviceViewport, 'mobile')
  assert.equal(store.getState().activeProject.revision, 2)
  assert.ok(store.getState().activeProject.files['src/App.tsx'].content.includes('fontSize: "32px"'))

  // 4. SURVIVE UNDO: rollback to revision 1
  await store.rollback()
  assert.equal(store.getState().activeProject.revision, 3, 'Rollback restores source as a new immutable revision')
  assert.ok(!store.getState().activeProject.files['src/App.tsx'].content.includes('fontSize: "32px"'), 'Undone changes must be reverted')
  assert.equal(store.getState().currentDiff, null, 'Current diff must be cleared after rollback')

  // 5. Unsupported elements cannot be modified
  await assert.rejects(
    async () => {
      await store.applyVisualProperties('unsupported-element~1', { color: '#81adec' })
    },
    /unsupported|read-only|not found/i,
    'Modifying unsupported element must fail'
  )
  assert.equal(store.getState().activeProject.revision, 3, 'Revision must stay unchanged after rejected update')
})

test('visual store rejects failed validation, conflicts and mismatched revision responses without changing working source or preview', async () => {
  const initial = createAppProject({ id: 'guarded', files: { 'src/App.tsx': 'export default () => <h1 data-paper-id="title">Title</h1>' } })
  for (const failure of ['compile', 'conflict', 'revision', 'files', 'entryPoint', 'assetIds']) {
    let writes = 0
    const store = createMakeWorkspaceStore({ initialProject: initial, repository: {
      list: async () => [initial], read: async () => initial, create: async p => p,
      compile: compileAppProject,
      update: async p => {
        writes++
        if (failure === 'conflict') throw new Error('Revision conflict')
        return { ...p, revision: failure === 'revision' ? 99 : p.revision, files: failure === 'files' ? initial.files : p.files,
          preview: failure === 'entryPoint' ? { ...p.preview, entryPoint: 'src/Other.tsx' } : p.preview,
          assetIds: failure === 'assetIds' ? ['changed-asset'] : p.assetIds }
      },
    }, compiler: async p => failure === 'compile' && p.revision > 1 ? { success: false, diagnostics: [] } : compileAppProject(p) })
    await store.loadProjects()
    await store.runPreview()
    store.selectElement({ elementId: 'title~1', tagName: 'h1' })
    const assets = store.getState().assets
    await assert.rejects(() => store.applyVisualProperties('title~1', { color: '#81adec' }, 1), undefined, `Must reject ${failure}`)
    assert.equal(store.getState().activeProject, initial)
    assert.equal(store.getState().assets, assets)
    assert.equal(store.getState().rollbackPoint, null)
    assert.equal(writes, failure === 'compile' ? 0 : 1)
  }
})

test('visual store rejects stale drafts and late validation results after a project switch', async () => {
  const initial = createAppProject({ id: 'before', files: { 'src/App.tsx': 'export default () => <h1 data-paper-id="title">Title</h1>' } })
  let release
  const next = createAppProject({ id: 'next' })
  const store = createMakeWorkspaceStore({ initialProject: initial, compiler: () => new Promise(resolve => { release = resolve }) })
  store.selectElement({ elementId: 'title~1', tagName: 'h1' })
  await assert.rejects(() => store.applyVisualProperties('title~1', { color: '#81adec' }, 0), /stale|revision/i)
  const pending = store.applyVisualProperties('title~1', { color: '#81adec' }, 1)
  for (let attempt = 0; !release && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 5))
  assert.ok(release, 'Validation must be reached')
  await assert.rejects(() => store.applyVisualProperties('title~1', { color: 'red' }, 1), /operation|finish/i)
  store.selectProject(next)
  release({ success: true, assets: { js: '', css: '', html: '' }, diagnostics: [] })
  await assert.rejects(() => pending, /stale|changed|cancel/i)
  assert.equal(store.getState().activeProject.id, 'next')
  assert.equal(store.getState().assets, null)
})

test('visual store rejects reviewed source changed without a revision advance and ignores validation after an in-place source edit', async () => {
  const initial = createAppProject({ files: { 'src/App.tsx': 'export default () => <h1 data-paper-id="title">Title</h1>' } })
  const store = createMakeWorkspaceStore({ initialProject: initial })
  store.updateActiveFile('src/App.tsx', 'export default () => <h1 data-paper-id="title">Changed</h1>')
  store.selectElement({ elementId: 'title~1', tagName: 'h1' })
  await assert.rejects(() => store.applyVisualProperties('title~1', { color: '#81adec' }, 1, initial), /stale|source changed/i)
})

test('undo of a visual edit rejects invalid revision, source or diagnostic responses atomically', async () => {
  const initial = createAppProject({ id: 'undo-guards', files: { 'src/App.tsx': 'export default () => <h1 data-paper-id="title">Title</h1>' } })
  for (const failure of ['revision', 'identity', 'source', 'diagnostics']) {
    const store = createMakeWorkspaceStore({ initialProject: initial, compiler: compileAppProject, repository: {
      list: async () => [initial], read: async () => initial, create: async p => p,
      compile: compileAppProject, update: async p => p,
      rollback: async () => ({ ok: true, rolledBackTo: 1,
        project: { ...initial, id: failure === 'identity' ? 'another-app' : initial.id,
          revision: failure === 'revision' ? 99 : 3,
          files: failure === 'source' ? createAppProject().files : initial.files },
        ...(await compileAppProject(initial)),
        ...(failure === 'diagnostics' ? { diagnostics: [{ severity: 'error', message: 'Invalid restored build' }] } : {}),
      }),
    } })
    await store.loadProjects()
    await store.runPreview()
    store.selectElement({ elementId: 'title~1', tagName: 'h1' })
    await store.applyVisualProperties('title~1', { color: '#81adec' }, 1)
    const before = store.getState()
    await assert.rejects(() => store.rollback(), /revision|validat|match|build/i)
    assert.equal(store.getState().activeProject, before.activeProject)
    assert.equal(store.getState().assets, before.assets)
    assert.equal(store.getState().rollbackPoint, before.rollbackPoint)
    assert.equal(store.getState().currentDiff, before.currentDiff)
  }
})
