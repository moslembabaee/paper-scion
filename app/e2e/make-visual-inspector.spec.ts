import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { mockStudioSession } from './studio-session'
import { createAppProject } from '../src/make/manifest'
import { compileAppProject } from '../src/make/compiler'

const source = `import { useState } from 'react'
export default function App() {
  const [count, setCount] = useState(0)
  return <main style={{ padding: 24, color: '#edebe1', backgroundColor: '#080808', minHeight: '100vh' }}>
    <h1 style={{ fontSize: 24, margin: 0, opacity: 0.9 }}>Visual study</h1>
    <button onClick={() => setCount(c => c + 1)}>Count: {count}</button>
    <p style={{ color: count ? 'red' : 'blue' }}>Dynamic style</p>
  </main>
}`
const initial = createAppProject({ id: 'visual-app', name: 'Visual study', files: { 'src/App.tsx': source } })

async function setup(page: Page) {
  let disk = structuredClone(initial), conflict = false, failBuild = false
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    const text = message.text()
    if (message.type() === 'error' && !text.includes('503') && !text.includes('409') && !text.includes('ERR_CONNECTION_REFUSED') && !text.includes('Content-Security-Policy')) {
      errors.push(text)
    }
  })
  await page.route('http://127.0.0.1:4173/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path.startsWith('/api/')) return route.fallback()
    await route.fulfill({ body: await readFile(new URL(`../dist${path === '/' ? '/index.html' : path}`, import.meta.url)), contentType: path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html' })
  })
  await mockStudioSession(page)
  await page.route('**/api/model/budget', route => route.fulfill({ status: 503, json: { error: 'Offline' } }))
  await page.route('**/api/apps', route => route.fulfill({ json: { apps: [disk] } }))
  await page.route('**/api/apps/visual-app', async route => {
    if (route.request().method() === 'PUT') {
      const input = route.request().postDataJSON()
      expect(input.expectedRevision).toBe(disk.revision)
      if (conflict) return route.fulfill({ status: 409, json: { error: 'Revision conflict' } })
      disk = { ...input.project, revision: disk.revision + 1 }
    }
    await route.fulfill({ json: disk })
  })
  await page.route('**/api/apps/visual-app/rollback', async route => {
    expect(route.request().postDataJSON()).toMatchObject({ expectedRevision: disk.revision, targetRevision: 1 })
    disk = { ...disk, revision: disk.revision + 1, files: initial.files }
    await route.fulfill({ json: { ok: true, project: disk, ...(await compileAppProject(disk)) } })
  })
  await page.route('**/api/apps/compile', async route => route.fulfill({ json: failBuild ? { success: false, assets: null, diagnostics: [] } : await compileAppProject(route.request().postDataJSON().project) }))
  await page.goto('/')
  await page.getByRole('button', { name: 'Make workspace', exact: true }).click()
  await page.getByRole('combobox', { name: 'Make project' }).selectOption(initial.id)
  await page.getByRole('button', { name: 'Run preview', exact: true }).click()
  await expect(page.getByTestId('make-preview-status')).toHaveText('Running')
  const preview = page.frameLocator('iframe').frameLocator('iframe')
  await page.getByRole('button', { name: 'Select element', exact: true }).click()
  await preview.getByRole('heading', { name: 'Visual study' }).click()
  return { preview, errors, disk: () => disk, conflict: () => { conflict = true }, failBuild: () => { failBuild = true } }
}

test('reviews source diff, applies typography/spacing/color, rebuilds, reloads and undoes in mobile preview', async ({ page }) => {
  const f = await setup(page)
  const inspector = page.getByRole('region', { name: 'Visual properties', exact: true })
  await expect(inspector).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Font size', exact: true })).toHaveValue('24')
  await page.getByRole('textbox', { name: 'Font size', exact: true }).fill('32px')
  await page.getByRole('textbox', { name: 'Text color', exact: true }).fill('#81adec')
  await page.getByRole('textbox', { name: 'Padding', exact: true }).fill('12px')
  await page.getByRole('button', { name: 'Review changes', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Proposed visual changes' })).toContainText('32px')
  expect(f.disk().revision).toBe(1)
  await expect(f.preview.getByRole('heading')).toHaveCSS('font-size', '24px')
  await page.getByRole('button', { name: 'Apply visual changes', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Applied changes' })).toContainText('REV 1 → 2')
  await expect(f.preview.getByRole('heading')).toHaveCSS('font-size', '32px')
  await expect(f.preview.getByRole('heading')).toHaveCSS('color', 'rgb(129, 173, 236)')
  await expect(f.preview.getByRole('heading')).toHaveCSS('padding', '12px')
  await expect(f.preview.getByRole('heading')).toHaveCSS('opacity', '0.9')
  await page.getByRole('combobox', { name: 'Preview size', exact: true }).selectOption('mobile')
  await expect(f.preview.getByRole('heading')).toHaveCSS('font-size', '32px')
  await page.screenshot({ path: '/tmp/paper-visual-inspector-desktop.png' })
  await page.getByRole('button', { name: 'Stop preview', exact: true }).click()
  await page.getByRole('button', { name: 'Run preview', exact: true }).click()
  await expect(f.preview.getByRole('heading')).toHaveCSS('font-size', '32px')
  await page.getByRole('button', { name: 'Undo last edit', exact: true }).click()
  await expect(f.preview.getByRole('heading')).toHaveCSS('font-size', '24px')
  expect(f.disk().revision).toBe(3)
  await page.reload()
  await page.getByRole('button', { name: 'Make workspace', exact: true }).click()
  await page.getByRole('combobox', { name: 'Make project' }).selectOption(initial.id)
  await expect(page.getByText('APP PROJECT / REV 3', { exact: true })).toBeVisible()
  expect(f.errors).toEqual([])
})

test('small screen inspector remains usable and rejects injection while dynamic elements stay read-only', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const f = await setup(page)
  await page.getByRole('textbox', { name: 'Text color', exact: true }).fill('red; } <script>alert(1)</script>')
  await page.getByRole('button', { name: 'Review changes', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Visual properties', exact: true }).getByRole('alert')).toContainText(/unsafe|invalid/i)
  expect(f.disk().revision).toBe(1)
  await page.getByRole('textbox', { name: 'Font size', exact: true }).fill('28px')
  await page.getByRole('textbox', { name: 'Text color', exact: true }).fill('#81adec')
  await page.getByRole('button', { name: 'Review changes', exact: true }).click()
  await page.getByRole('button', { name: 'Apply visual changes', exact: true }).click()
  await expect(f.preview.getByRole('heading')).toHaveCSS('font-size', '28px')
  await page.getByRole('region', { name: 'Visual properties', exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: '/tmp/paper-visual-inspector-mobile.png' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await f.preview.getByText('Dynamic style', { exact: true }).click()
  await expect(page.getByRole('region', { name: 'Visual properties', exact: true })).toContainText(/read-only/i)
  await expect(page.getByRole('button', { name: 'Review changes', exact: true })).toHaveCount(0)
  expect(f.errors).toEqual([])
})

for (const failure of ['conflict', 'build'] as const) test(`failed ${failure} keeps the validated working revision and preview`, async ({ page }) => {
  const f = await setup(page)
  if (failure === 'conflict') f.conflict(); else f.failBuild()
  await page.getByRole('textbox', { name: 'Font size', exact: true }).fill('40px')
  await page.getByRole('button', { name: 'Review changes', exact: true }).click()
  await page.getByRole('button', { name: 'Apply visual changes', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Visual properties', exact: true }).getByRole('alert')).toContainText(/conflict|validation/i)
  await expect(f.preview.getByRole('heading')).toHaveCSS('font-size', '24px')
  expect(f.disk().revision).toBe(1)
  await expect(page.getByRole('region', { name: 'Applied changes' })).toHaveCount(0)
})
