import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { mockStudioSession } from './studio-session'
import { createAppProject } from '../src/make/manifest'
import { compileAppProject } from '../src/make/compiler'
import { computeBoundedDiff } from '../src/make/diff'
import type { AppProject, AppRevisionRecord, AppCheckpointSource } from '../src/make/types'

const source = `import { useState } from 'react'
export default function App() {
  const [count, setCount] = useState(0)
  return <main><h1>Original study</h1><button onClick={() => setCount(c => c + 1)}>Count: {count}</button></main>
}`

async function setup(page: Page) {
  let disk = createAppProject({ id: 'history-app', name: 'History study', files: { 'src/App.tsx': source } })
  const records = new Map<number, AppRevisionRecord>()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  function checkpoint(project: AppProject, origin: AppCheckpointSource, restoredFromRevision?: number) {
    const before = records.get(project.revision - 1)?.project
    records.set(project.revision, { revision: project.revision, timestamp: project.updatedAt, hash: `hash-${project.revision}`,
      project: structuredClone(project), checkpoint: { source: origin, baseRevision: project.revision - 1, restoredFromRevision },
      diff: computeBoundedDiff(before?.files ?? {}, project.files, { baseRevision: project.revision - 1, targetRevision: project.revision }) })
    disk = structuredClone(project)
  }
  checkpoint(disk, 'initial')
  await page.route('http://127.0.0.1:4173/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path.startsWith('/api/')) return route.fallback()
    await route.fulfill({ body: await readFile(new URL(`../dist${path === '/' ? '/index.html' : path}`, import.meta.url)), contentType: path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html' })
  })
  await mockStudioSession(page)
  await page.route('**/api/model/budget', route => route.fulfill({ json: { remainingTurns: 20 } }))
  await page.route('**/api/apps', route => route.fulfill({ json: { apps: [disk] } }))
  await page.route('**/api/apps/compile', async route => route.fulfill({ json: await compileAppProject(route.request().postDataJSON().project) }))
  await page.route('**/api/apps/history-app**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/revisions')) return route.fulfill({ json: { revisions: [...records.values()].map(({ project: _project, ...record }) => record) } })
    if (path.includes('/revisions/')) return route.fulfill({ json: records.get(Number(path.split('/').at(-1))) })
    if (path.endsWith('/rollback')) {
      const input = route.request().postDataJSON()
      if (input.expectedRevision !== disk.revision) return route.fulfill({ status: 409, json: { error: 'Revision conflict. Reload the saved app before restoring.' } })
      const target = records.get(input.targetRevision)!.project
      const restored = { ...target, revision: disk.revision + 1, updatedAt: new Date().toISOString() }
      const compiled = await compileAppProject(restored)
      checkpoint(restored, 'restore', input.targetRevision)
      return route.fulfill({ json: { ok: true, project: disk, rolledBackTo: input.targetRevision, assets: compiled.assets, diagnostics: compiled.diagnostics } })
    }
    if (route.request().method() === 'PUT') {
      const input = route.request().postDataJSON()
      if (input.expectedRevision !== disk.revision) return route.fulfill({ status: 409, json: { error: 'Revision conflict' } })
      checkpoint({ ...input.project, revision: disk.revision + 1, updatedAt: new Date().toISOString() }, input.source ?? 'manual')
    }
    return route.fulfill({ json: disk })
  })
  async function open() {
    await page.goto('/')
    await page.getByRole('button', { name: 'Make workspace', exact: true }).click()
    await page.getByRole('combobox', { name: 'Make project' }).selectOption(disk.id)
    await page.getByRole('button', { name: 'Run preview', exact: true }).click()
  }
  await open()
  const history = page.getByRole('region', { name: 'Version history', exact: true })
  const editor = page.getByRole('region', { name: 'Source files', exact: true })
  const preview = page.frameLocator('iframe').frameLocator('iframe')
  await expect(preview.getByRole('heading', { name: 'Original study' })).toBeVisible()
  return { history, editor, preview, open, errors, disk: () => disk, records,
    advance: () => checkpoint({ ...disk, revision: disk.revision + 1, name: 'Concurrent revision' }, 'chat') }
}

test('inspect immutable manual and inspector checkpoints, restore, re-edit and reload', async ({ page }) => {
  const f = await setup(page)
  await f.editor.getByRole('textbox').fill(source.replace('Original study', 'Manual study'))
  await f.editor.getByRole('button', { name: 'Save source', exact: true }).click()
  await expect(f.preview.getByRole('heading', { name: 'Manual study' })).toBeVisible()
  await page.getByRole('button', { name: 'Select element', exact: true }).click()
  await f.preview.getByRole('heading').click()
  await page.getByRole('textbox', { name: 'Font size', exact: true }).fill('32px')
  await page.getByRole('button', { name: 'Review changes', exact: true }).click()
  await page.getByRole('button', { name: 'Apply visual changes', exact: true }).click()
  await expect(f.preview.getByRole('heading')).toHaveCSS('font-size', '32px')
  await f.history.getByRole('button', { name: 'Version history', exact: true }).click()
  await expect(f.history.getByRole('button', { name: 'Inspect revision 2', exact: true })).toContainText('Manual edit')
  await expect(f.history.getByRole('button', { name: 'Inspect revision 3', exact: true })).toContainText('Inspector edit')
  await f.history.getByRole('button', { name: 'Inspect revision 1', exact: true }).click()
  await f.history.locator('summary').filter({ hasText: 'Checkpoint source' }).click()
  await expect(f.history.getByLabel('Revision 1 source src/App.tsx', { exact: true })).toContainText('Original study')
  await f.history.getByRole('button', { name: 'Restore revision 1', exact: true }).click()
  await expect(f.preview.getByRole('heading', { name: 'Original study' })).toBeVisible()
  expect(f.disk().revision).toBe(4)
  await f.editor.getByRole('textbox').fill(source.replace('Original study', 'After restore'))
  await f.editor.getByRole('button', { name: 'Save source', exact: true }).click()
  await expect(f.preview.getByRole('heading', { name: 'After restore' })).toBeVisible()
  await f.open()
  await expect(f.preview.getByRole('heading', { name: 'After restore' })).toBeVisible()
  await f.history.getByRole('button', { name: 'Version history', exact: true }).click()
  await expect(f.history.getByRole('button', { name: 'Inspect revision 5', exact: true })).toBeVisible()
  await f.history.getByRole('button', { name: 'Inspect revision 4', exact: true }).click()
  await expect(f.history.getByLabel('Revision 4 details', { exact: true })).toContainText('Restored rev 1')
  await f.history.getByRole('button', { name: 'Inspect revision 2', exact: true }).click()
  await f.history.locator('summary').filter({ hasText: 'Checkpoint source' }).click()
  await expect(f.history.getByLabel('Revision 2 source src/App.tsx', { exact: true })).toContainText('Manual study')
  await f.history.scrollIntoViewIfNeeded()
  await page.screenshot({ path: '/tmp/paper-version-history-desktop.png' })
  expect(f.errors).toEqual([])
})

test('a stale restore preserves the current source and running preview', async ({ page }) => {
  const f = await setup(page)
  await f.editor.getByRole('textbox').fill(source.replace('Original study', 'Manual study'))
  await f.editor.getByRole('button', { name: 'Save source', exact: true }).click()
  await expect(f.preview.getByRole('heading', { name: 'Manual study' })).toBeVisible()
  await f.history.getByRole('button', { name: 'Version history', exact: true }).click()
  await f.history.getByRole('button', { name: 'Inspect revision 1', exact: true }).click()
  f.advance()
  await f.history.getByRole('button', { name: 'Restore revision 1', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Revision conflict' })).toBeVisible()
  await expect(f.preview.getByRole('heading', { name: 'Manual study' })).toBeVisible()
  expect(f.disk().revision).toBe(3)
  expect(f.disk().name).toBe('Concurrent revision')
  expect(f.records.size).toBe(3)
  expect(f.errors).toEqual([])
})

test('mobile history stays within the viewport and inspection never changes source', async ({ page }) => {
  const f = await setup(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await f.history.getByRole('button', { name: 'Version history', exact: true }).click()
  await f.history.getByRole('button', { name: 'Inspect revision 1', exact: true }).click()
  await expect(f.history.getByRole('button', { name: 'Restore revision 1', exact: true })).toBeDisabled()
  await f.history.locator('summary').filter({ hasText: 'Checkpoint diff' }).click()
  await f.history.locator('summary').filter({ hasText: 'Checkpoint source' }).click()
  await f.history.scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(f.disk().revision).toBe(1)
  await page.screenshot({ path: '/tmp/paper-version-history-mobile.png' })
  expect(f.errors).toEqual([])
})
