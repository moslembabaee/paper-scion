import { test, expect } from '@playwright/test'

test('app manifests round-trip and reject malicious imports in the browser without changing a scene', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    // Vite serves the real browser module; no Node-only validation substitutes.
    const manifest = await import('/src/make/manifest.ts')
    const sceneIO = await import('/src/io/project.ts')
    const { SceneStore } = await import('/src/scene/store.ts')
    const store = new SceneStore()
    store.add('frame', { id: 'manifest-scene', width: 120, height: 120 })
    const scene = sceneIO.createProject(store, 'Untouched scene', { x: 0, y: 0, zoom: 1 }, true)
    const before = sceneIO.serializeProject(scene)
    const app = manifest.migrateAppProject({ name: 'Browser draft', files: { 'App.tsx': 'export default () => null' } })
    const serialized = manifest.serializeAppProject(app)
    const attacks = [
      serialized.replace('"version": 1', '"version": 99'),
      serialized.replace('"name": "Browser draft"', '"name": "Browser draft", "name": "Duplicate"'),
      serialized.replace('"name": "Browser draft"', '"__proto__": {}, "name": "Browser draft"'),
      serialized.replaceAll('src/App.tsx', '../App.tsx'),
      serialized.replace('"status": "draft"', '"status": "draft", "notes": 42'),
      ' '.repeat(manifest.APP_PROJECT_LIMITS.MAX_MANIFEST_BYTES + 1),
    ]
    const rejected = attacks.map(source => {
      try { manifest.parseAppProject(source); return false }
      catch (error) { return error instanceof manifest.AppProjectValidationError }
    })
    return {
      roundTrip: JSON.stringify(manifest.parseAppProject(serialized)) === JSON.stringify(app),
      rejected,
      sceneUnchanged: before === sceneIO.serializeProject(scene),
      sceneRoundTrip: JSON.stringify(sceneIO.parseProject(before)) === JSON.stringify(scene),
      polluted: Object.hasOwn(Object.prototype, 'polluted'),
    }
  })
  expect(result.roundTrip).toBe(true)
  expect(result.rejected).toEqual([true, true, true, true, true, true])
  expect(result.sceneUnchanged).toBe(true)
  expect(result.sceneRoundTrip).toBe(true)
  expect(result.polluted).toBe(false)
})
