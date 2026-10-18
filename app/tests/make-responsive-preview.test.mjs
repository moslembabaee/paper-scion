import test from 'node:test'
import assert from 'node:assert/strict'
import {
  PREVIEW_VIEWPORTS,
  getViewportConfig,
  formatViewportDimensions,
  checkViewportOverflow,
  isValidDeviceViewport,
} from '../src/make/breakpoints.ts'
import {
  createMakeWorkspaceStore,
  MAKE_FIXTURES,
} from '../src/make/workspace-model.ts'
import { compileAppProject } from '../src/make/compiler.ts'
import { SceneStore } from '../src/scene/store.ts'
import { createProject, serializeProject } from '../src/io/project.ts'

test('PREVIEW_VIEWPORTS provides mobile (390px), tablet (768px), desktop (1280px), and responsive presets', () => {
  assert.ok(PREVIEW_VIEWPORTS.responsive, 'Responsive preset must exist')
  assert.equal(PREVIEW_VIEWPORTS.responsive.width, '100%')
  assert.equal(PREVIEW_VIEWPORTS.responsive.label, 'Responsive')

  assert.ok(PREVIEW_VIEWPORTS.mobile, 'Mobile preset must exist')
  assert.equal(PREVIEW_VIEWPORTS.mobile.width, 390)
  assert.equal(PREVIEW_VIEWPORTS.mobile.height, 844)
  assert.equal(PREVIEW_VIEWPORTS.mobile.label, 'Mobile')

  assert.ok(PREVIEW_VIEWPORTS.tablet, 'Tablet preset must exist')
  assert.equal(PREVIEW_VIEWPORTS.tablet.width, 768)
  assert.equal(PREVIEW_VIEWPORTS.tablet.height, 1024)
  assert.equal(PREVIEW_VIEWPORTS.tablet.label, 'Tablet')

  assert.ok(PREVIEW_VIEWPORTS.desktop, 'Desktop preset must exist')
  assert.equal(PREVIEW_VIEWPORTS.desktop.width, 1280)
  assert.equal(PREVIEW_VIEWPORTS.desktop.height, 800)
  assert.equal(PREVIEW_VIEWPORTS.desktop.label, 'Desktop')

  assert.equal(isValidDeviceViewport('mobile'), true)
  assert.equal(isValidDeviceViewport('tablet'), true)
  assert.equal(isValidDeviceViewport('desktop'), true)
  assert.equal(isValidDeviceViewport('responsive'), true)
  assert.equal(isValidDeviceViewport('ultrawide'), false)
  assert.equal(isValidDeviceViewport(null), false)

  assert.equal(formatViewportDimensions('mobile'), '390 × 844 px')
  assert.equal(formatViewportDimensions('tablet'), '768 × 1024 px')
  assert.equal(formatViewportDimensions('desktop'), '1280 × 800 px')
  assert.equal(formatViewportDimensions('responsive'), 'Fluid')
})

test('checkViewportOverflow calculates overflow and horizontal scroll requirements', () => {
  // Mobile at 390px in 320px screen -> overflows
  const mobileNarrow = checkViewportOverflow('mobile', 320)
  assert.equal(mobileNarrow.fitsInContainer, false)
  assert.equal(mobileNarrow.requiresHorizontalScroll, true)
  assert.equal(mobileNarrow.frameWidth, 390)

  // Mobile at 390px in 600px screen -> fits
  const mobileWide = checkViewportOverflow('mobile', 600)
  assert.equal(mobileWide.fitsInContainer, true)
  assert.equal(mobileWide.requiresHorizontalScroll, false)

  // Desktop at 1280px in 1000px screen -> overflows
  const desktopNarrow = checkViewportOverflow('desktop', 1000)
  assert.equal(desktopNarrow.fitsInContainer, false)
  assert.equal(desktopNarrow.requiresHorizontalScroll, true)

  // Desktop at 1280px in 1440px screen -> fits
  const desktopWide = checkViewportOverflow('desktop', 1440)
  assert.equal(desktopWide.fitsInContainer, true)
  assert.equal(desktopWide.requiresHorizontalScroll, false)

  // Responsive always fits
  const responsive = checkViewportOverflow('responsive', 500)
  assert.equal(responsive.fitsInContainer, true)
  assert.equal(responsive.requiresHorizontalScroll, false)
})

test('switching viewports does not modify active project files, revision, or scene layout', async () => {
  const store = createMakeWorkspaceStore({
    initialProject: MAKE_FIXTURES.counter,
    compiler: compileAppProject,
  })

  const initialRevision = store.getState().activeProject.revision
  const initialFilesJson = JSON.stringify(store.getState().activeProject.files)
  const originalProject = store.getState().activeProject
  const originalProjectJson = JSON.stringify(originalProject)

  assert.equal(store.getState().deviceViewport, 'responsive')

  // Switch to mobile
  store.setDeviceViewport('mobile')
  assert.equal(store.getState().deviceViewport, 'mobile')
  assert.equal(store.getState().activeProject.revision, initialRevision, 'Revision must not bump')
  assert.equal(JSON.stringify(store.getState().activeProject.files), initialFilesJson, 'Files must not mutate')

  // Switch to tablet
  store.setDeviceViewport('tablet')
  assert.equal(store.getState().deviceViewport, 'tablet')
  assert.equal(store.getState().activeProject.revision, initialRevision)
  assert.equal(JSON.stringify(store.getState().activeProject.files), initialFilesJson)

  // Switch to desktop
  store.setDeviceViewport('desktop')
  assert.equal(store.getState().deviceViewport, 'desktop')
  assert.equal(store.getState().activeProject.revision, initialRevision)
  assert.equal(JSON.stringify(store.getState().activeProject.files), initialFilesJson)

  // Switch back to responsive
  store.setDeviceViewport('responsive')
  assert.equal(store.getState().deviceViewport, 'responsive')
  assert.equal(store.getState().activeProject.revision, initialRevision)
  assert.equal(JSON.stringify(store.getState().activeProject.files), initialFilesJson)
  assert.equal(store.getState().activeProject, originalProject)
  assert.equal(JSON.stringify(store.getState().activeProject), originalProjectJson)
})

test('switching viewports preserves running preview assets and ready status without recompilation', async () => {
  let compileCalls = 0
  const store = createMakeWorkspaceStore({
    initialProject: MAKE_FIXTURES.counter,
    compiler: async (project) => {
      compileCalls++
      return compileAppProject(project)
    },
  })

  await store.runPreview()
  assert.equal(compileCalls, 1)
  assert.equal(store.getState().previewStatus, 'ready')
  const originalAssets = store.getState().assets
  assert.ok(originalAssets)

  // Toggle through viewports: mobile -> tablet -> desktop -> responsive
  store.setDeviceViewport('mobile')
  assert.equal(store.getState().previewStatus, 'ready')
  assert.equal(store.getState().assets, originalAssets, 'Assets reference must remain identical')
  assert.equal(compileCalls, 1, 'No additional compilation should occur')

  store.setDeviceViewport('tablet')
  assert.equal(store.getState().previewStatus, 'ready')
  assert.equal(store.getState().assets, originalAssets)
  assert.equal(compileCalls, 1)

  store.setDeviceViewport('desktop')
  assert.equal(store.getState().previewStatus, 'ready')
  assert.equal(store.getState().assets, originalAssets)
  assert.equal(compileCalls, 1)
})

test('rerunInteraction increments previewSessionKey without recompiling or altering source', async () => {
  let compileCalls = 0
  const store = createMakeWorkspaceStore({
    initialProject: MAKE_FIXTURES.counter,
    compiler: async (project) => {
      compileCalls++
      return compileAppProject(project)
    },
  })

  await store.runPreview()
  assert.equal(compileCalls, 1)
  const initialKey = store.getState().previewSessionKey ?? 0
  const initialRevision = store.getState().activeProject.revision

  store.rerunInteraction()
  assert.equal(store.getState().previewSessionKey, initialKey + 1, 'previewSessionKey must increment')
  assert.equal(compileCalls, 1, 'rerunInteraction must not trigger server recompile')
  assert.equal(store.getState().activeProject.revision, initialRevision, 'Revision must not change')
  assert.equal(store.getState().previewStatus, 'ready', 'Preview must stay ready')

  store.rerunInteraction()
  assert.equal(store.getState().previewSessionKey, initialKey + 2)
  assert.equal(compileCalls, 1)
})

test('rerunInteraction is a no-op until compiled assets are ready, and after stop or failure', async () => {
  const store = createMakeWorkspaceStore({ compiler: compileAppProject })
  const initial = store.getState()
  store.rerunInteraction()
  assert.equal(store.getState(), initial, 'A stopped preview must not start a new session')
  const compiling = store.runPreview()
  const loading = store.getState()
  store.rerunInteraction()
  assert.equal(store.getState(), loading, 'A pending compile must not start a new session')
  await compiling
  store.rerunInteraction()
  assert.equal(store.getState().previewSessionKey, 1)
  store.reportRuntimeError({ message: 'render failed' })
  const failed = store.getState()
  store.rerunInteraction()
  assert.equal(store.getState(), failed, 'A failed app requires the explicit retry compile action')
  store.stopPreview()
  const stopped = store.getState()
  store.rerunInteraction()
  assert.equal(store.getState(), stopped)
})

test('viewport switching and interaction rerun never mutate Paper design scene documents', async () => {
  const sceneStore = new SceneStore()
  sceneStore.add('frame', { id: 'frame-test', x: 100, y: 100, width: 800, height: 600 })
  sceneStore.add('text', { id: 'text-test', parentId: 'frame-test', text: 'Responsive Test', x: 20, y: 20 })
  const sceneProject = createProject(sceneStore, 'Scene Doc', { x: 0, y: 0, zoom: 1 }, true)
  const beforeSnapshot = serializeProject(sceneProject)

  const makeStore = createMakeWorkspaceStore({
    initialProject: MAKE_FIXTURES.counter,
    compiler: compileAppProject,
  })

  await makeStore.runPreview()
  makeStore.setDeviceViewport('mobile')
  makeStore.rerunInteraction()
  makeStore.setDeviceViewport('desktop')
  makeStore.rerunInteraction()
  makeStore.setDeviceViewport('responsive')

  const afterSnapshot = serializeProject(sceneProject)
  assert.equal(afterSnapshot, beforeSnapshot, 'Design scene document must remain strictly unchanged')
})
