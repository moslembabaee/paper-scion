import { test, expect } from '@playwright/test'
import { compileAppProject, compileSourceFiles } from '../src/make/compiler.ts'
import { createAppProject } from '../src/make/manifest.ts'
import { SceneStore } from '../src/scene/store.ts'
import { createProject, serializeProject } from '../src/io/project.ts'

test('compiler rejects unsafe sources and preserves the scene and working revision', async () => {
  const store = new SceneStore()
  store.add('frame', { id: 'compiler-frame', width: 120, height: 120 })
  const scene = createProject(store, 'Existing scene', { x: 0, y: 0, zoom: 1 }, true)
  const before = serializeProject(scene)
  const project = createAppProject()
  const working = JSON.stringify(project)
  for (const [source, code] of [
    ["import 'node:fs'; export default () => <div />", 'DENIED_IMPORT'],
    ["import('react')", 'DYNAMIC_IMPORT_FORBIDDEN'],
    ['export default () => <div><span>', 'SYNTAX_ERROR'],
    ['x'.repeat(600 * 1024), 'OVERSIZED_SOURCE'],
  ]) {
    const result = await compileSourceFiles({ 'src/App.tsx': source })
    expect(result.success).toBe(false)
    expect(result.assets).toBeNull()
    expect(result.modules).toEqual({})
    expect(result.diagnostics.some(d => d.code === code && d.file === 'src/App.tsx' && d.line! > 0 && d.column! > 0)).toBe(true)
  }
  expect(serializeProject(scene)).toBe(before)
  expect(JSON.stringify(project)).toBe(working)
})

test('standalone assets mount real React, CSS and icons and update state without network dependencies', async ({ page }, testInfo) => {
  const result = await compileAppProject(createAppProject({
    name: 'Interactive Browser Fixture',
    files: {
      'src/App.tsx': `
import { Counter } from './components'
import './styles.css'
export default function App() {
  return <main><h1>Paper Interactive Fixture</h1><p>Compiled from editable TSX and CSS</p><Counter /></main>
}`,
      'src/components/index.ts': `export { Counter } from './Counter'`,
      'src/components/Counter.tsx': `
import { useState } from 'react'
import { Plus } from 'lucide-react'
import config from '../config.json'
export function Counter() {
  const [count, setCount] = useState(config.initial)
  return <button onClick={() => setCount(c => c + 1)}><Plus size={16} />Count: {count}</button>
}`,
      'src/config.json': '{"initial":0}',
      'src/styles.css': `
main { min-height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center;
background-image:linear-gradient(#222222 1px,transparent 1px),linear-gradient(90deg,#222222 1px,transparent 1px); background-size:120px 120px; }
h1 { font-size:24px; letter-spacing:-.5px; margin:0; } p { opacity:.65; font-size:14px; }
button { display:flex; align-items:center; gap:8px; background:#81adec; color:#080808; border:1px solid #222222; padding:12px 20px; border-radius:6px; font-size:14px; cursor:pointer; }`,
    },
  }))
  expect(result.success, JSON.stringify(result.diagnostics)).toBe(true)
  const errors: string[] = []
  const requests: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()) })
  await page.setContent('<title>Paper Compiler Test</title><iframe title="Compiled preview" sandbox="allow-scripts" style="width:100%;height:90vh;border:0"></iframe>')
  await page.locator('iframe').evaluate((element, html) => { (element as HTMLIFrameElement).srcdoc = html }, result.assets!.html)
  const preview = page.frameLocator('iframe')
  await expect(preview.locator('h1')).toHaveText('Paper Interactive Fixture')
  const counter = preview.getByRole('button', { name: 'Count: 0' })
  await expect(counter).toBeVisible()
  await expect(counter.locator('svg')).toBeVisible()
  await expect(counter).toHaveCSS('background-color', 'rgb(129, 173, 236)')
  await counter.click()
  await expect(preview.getByRole('button', { name: 'Count: 1' })).toBeVisible()
  await preview.getByRole('button', { name: 'Count: 1' }).click()
  await expect(preview.getByRole('button', { name: 'Count: 2' })).toBeVisible()
  expect(errors).toEqual([])
  expect(requests).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('interactive-preview.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(preview.getByRole('button', { name: 'Count: 2' })).toBeVisible()
})
