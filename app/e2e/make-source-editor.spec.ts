import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { mockStudioSession } from './studio-session'
import { createAppProject } from '../src/make/manifest'
import { compileAppProject } from '../src/make/compiler'

const source = `import { useState } from 'react'
import './styles.css'
export default function App() {
  const [count, setCount] = useState(0)
  return <main><h1>Source study</h1><button onClick={() => setCount(c => c + 1)}>Count: {count}</button></main>
}`
const initial = createAppProject({ id: 'source-app', name: 'Source study', files: {
  'src/App.tsx': source,
  'src/styles.css': 'main { color: #edebe1; background: #080808; padding: 24px; }',
} })

async function setup(page: Page) {
  let disk = structuredClone(initial), writes = 0
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('http://127.0.0.1:4173/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path.startsWith('/api/')) return route.fallback()
    await route.fulfill({ body: await readFile(new URL(`../dist${path === '/' ? '/index.html' : path}`, import.meta.url)), contentType: path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html' })
  })
  await mockStudioSession(page)
  await page.route('**/api/model/budget', route => route.fulfill({ json: { remainingTurns: 20 } }))
  await page.route('**/api/apps', route => route.fulfill({ json: { apps: [disk] } }))
  await page.route('**/api/apps/source-app', async route => {
    if (route.request().method() === 'PUT') {
      const input = route.request().postDataJSON()
      if (input.expectedRevision !== disk.revision) return route.fulfill({ status: 409, json: { error: 'Revision conflict' } })
      disk = { ...input.project, revision: disk.revision + 1 }
      writes++
    }
    await route.fulfill({ json: disk })
  })
  await page.route('**/api/apps/compile', async route => route.fulfill({ json: await compileAppProject(route.request().postDataJSON().project) }))
  await page.goto('/')
  await expect(page).toHaveTitle(/Paper/i)
  await page.getByRole('button', { name: 'Make workspace', exact: true }).click()
  await page.getByRole('combobox', { name: 'Make project' }).selectOption(initial.id)
  await page.getByRole('button', { name: 'Run preview', exact: true }).click()
  const preview = page.frameLocator('iframe').frameLocator('iframe')
  await expect(preview.getByRole('heading', { name: 'Source study' })).toBeVisible()
  const editor = page.getByRole('region', { name: 'Source files', exact: true })
  return { preview, editor, errors, disk: () => disk, writes: () => writes,
    advance: () => { disk = { ...disk, revision: disk.revision + 1, files: { ...disk.files, 'src/App.tsx': { path: 'src/App.tsx', content: source.replace('Source study', 'Model revision') } } } } }
}

test('switching files keeps drafts separate from the runnable revision; saving TSX and CSS rebuilds', async ({ page }) => {
  const f = await setup(page)
  await f.preview.getByRole('button', { name: 'Count: 0' }).click()
  await f.editor.getByRole('textbox', { name: 'Editing src/App.tsx', exact: true }).fill(source.replace('Source study', 'Manual revision'))
  await f.editor.getByRole('button', { name: 'src/styles.css', exact: true }).click()
  await expect(f.preview.getByRole('button', { name: 'Count: 1' })).toBeVisible()
  expect(f.writes()).toBe(0)
  await f.editor.getByRole('textbox', { name: 'Editing src/styles.css', exact: true }).fill('main { color: #81adec; }')
  await f.editor.getByRole('button', { name: 'src/App.tsx', exact: true }).click()
  await expect(f.editor.getByRole('textbox')).toHaveValue(source.replace('Source study', 'Manual revision'))
  await f.editor.getByRole('button', { name: 'Save source', exact: true }).click()
  await expect(f.preview.getByRole('heading', { name: 'Manual revision' })).toBeVisible()
  await f.editor.getByRole('button', { name: 'src/styles.css', exact: true }).click()
  await expect(f.editor.getByRole('textbox')).toHaveValue('main { color: #81adec; }')
  await f.editor.getByRole('button', { name: 'Save source', exact: true }).click()
  await expect(f.preview.getByRole('heading')).toHaveCSS('color', 'rgb(129, 173, 236)')
  expect(f.disk().revision).toBe(3)
  await f.editor.scrollIntoViewIfNeeded()
  await page.screenshot({ path: '/tmp/paper-source-editor-desktop.png' })
  await page.reload()
  await page.getByRole('button', { name: 'Make workspace', exact: true }).click()
  await page.getByRole('combobox', { name: 'Make project' }).selectOption(initial.id)
  await expect(page.getByText('APP PROJECT / REV 3', { exact: true })).toBeVisible()
  expect(f.errors).toEqual([])
})

test('syntax and policy errors preserve interactive preview and draft, then a corrected save recovers', async ({ page }) => {
  const f = await setup(page)
  for (const [invalid, diagnostic] of [
    ['export default function App() { return <main>', 'SYNTAX_ERROR'],
    ["import fs from 'node:fs'; export default () => <main />", 'DENIED_IMPORT'],
  ]) {
    await f.editor.getByRole('textbox').fill(invalid)
    await f.editor.getByRole('button', { name: 'Save source', exact: true }).click()
    await expect(f.editor.getByLabel('File diagnostics')).toContainText(diagnostic)
    await expect(f.editor.getByRole('textbox')).toHaveValue(invalid)
    await expect(page.getByTestId('make-preview-status')).toHaveText('Running')
    expect(f.disk().revision).toBe(1)
    expect(f.writes()).toBe(0)
  }
  await f.preview.getByRole('button', { name: 'Count: 0' }).click()
  await expect(f.preview.getByRole('button', { name: 'Count: 1' })).toBeVisible()
  await f.editor.getByRole('textbox').fill(source.replace('Source study', 'Recovered'))
  await f.editor.getByRole('textbox').press('Control+s')
  await expect(f.preview.getByRole('heading', { name: 'Recovered' })).toBeVisible()
  await expect(f.editor.getByLabel('File diagnostics')).toHaveCount(0)
  expect(f.errors).toEqual([])
})

test('stale save keeps the manual draft and model revision, reload is explicit', async ({ page }) => {
  const f = await setup(page)
  const draft = source.replace('Source study', 'My stale draft')
  await f.editor.getByRole('textbox').fill(draft)
  f.advance()
  await f.editor.getByRole('button', { name: 'Save source', exact: true }).click()
  await expect(f.editor.getByRole('alert')).toContainText(/conflict/i)
  await expect(f.editor.getByRole('textbox')).toHaveValue(draft)
  expect(f.disk().files['src/App.tsx'].content).toContain('Model revision')
  expect(f.writes()).toBe(0)
  await expect(page.getByTestId('make-preview-status')).toHaveText('Running')
  await f.editor.getByRole('button', { name: 'Reload latest source', exact: true }).click()
  await expect(f.editor.getByRole('textbox')).toHaveValue(draft)
  await expect(f.editor.getByRole('button', { name: 'Save source', exact: true })).toBeDisabled()
  await f.editor.getByRole('button', { name: 'Discard changes', exact: true }).click()
  await expect(f.editor.getByRole('textbox')).toHaveValue(f.disk().files['src/App.tsx'].content)
  expect(f.errors).toEqual([])
})

test('format is draft-only and editor stays usable on mobile', async ({ page }) => {
  const f = await setup(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.route('**/api/apps/format', route => route.fulfill({ json: { content: "export default function App() {\n  return <h1>Formatted</h1>\n}\n" } }))
  await f.editor.getByRole('textbox').fill('export default function App(){return <h1>Formatted</h1>}')
  await f.editor.getByRole('button', { name: 'Format source', exact: true }).click()
  await expect(f.editor.getByRole('textbox')).toHaveValue("export default function App() {\n  return <h1>Formatted</h1>\n}\n")
  expect(f.writes()).toBe(0)
  await expect(f.preview.getByRole('heading', { name: 'Source study' })).toBeAttached()
  await expect(f.editor.getByRole('button', { name: 'Save source', exact: true })).toBeEnabled()
  await f.editor.scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect(page.locator('vite-error-overlay')).toHaveCount(0)
  await page.screenshot({ path: '/tmp/paper-source-editor-mobile.png' })
  expect(f.errors).toEqual([])
})

test('a local visual revision makes an existing manual draft stale before any save request', async ({ page }) => {
  const f = await setup(page)
  const draft = source.replace('Source study', 'Manual draft before visual edit')
  await f.editor.getByRole('textbox').fill(draft)
  await page.getByRole('button', { name: 'Select element', exact: true }).click()
  await f.preview.getByRole('heading').click()
  await page.getByRole('textbox', { name: 'Font size', exact: true }).fill('32px')
  await page.getByRole('button', { name: 'Review changes', exact: true }).click()
  await page.getByRole('button', { name: 'Apply visual changes', exact: true }).click()
  await expect(f.preview.getByRole('heading')).toHaveCSS('font-size', '32px')
  await expect(f.editor.getByRole('alert')).toContainText('Revision conflict')
  await expect(f.editor.getByRole('textbox')).toHaveValue(draft)
  await expect(f.editor.getByRole('button', { name: 'Save source', exact: true })).toBeDisabled()
  expect(f.writes()).toBe(1)
  expect(f.disk().files['src/App.tsx'].content).not.toContain('Manual draft')
  expect(f.errors).toEqual([])
})

test('a reviewed merge saves against the reloaded revision instead of forcing a stale write', async ({ page }) => {
  const f = await setup(page)
  await f.editor.getByRole('textbox').fill(source.replace('Source study', 'My draft'))
  f.advance()
  await f.editor.getByRole('button', { name: 'Save source', exact: true }).click()
  await expect(f.editor.getByRole('alert')).toContainText('Revision conflict')
  await f.editor.getByRole('button', { name: 'Reload latest source', exact: true }).click()
  await f.editor.locator('summary').filter({ hasText: 'Compare latest source' }).click()
  await expect(f.editor.locator('.make-source-latest pre')).toContainText('Model revision')
  await f.editor.getByRole('textbox').fill(source.replace('Source study', 'Model revision + manual merge'))
  await f.editor.getByRole('button', { name: 'Mark conflict resolved', exact: true }).click()
  await f.editor.getByRole('button', { name: 'Save source', exact: true }).click()
  await expect(f.preview.getByRole('heading', { name: 'Model revision + manual merge' })).toBeVisible()
  expect(f.disk().revision).toBe(3)
  expect(f.writes()).toBe(1)
  expect(f.errors).toEqual([])
})
