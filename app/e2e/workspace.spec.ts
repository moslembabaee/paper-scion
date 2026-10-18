import { mockStudioSession } from './studio-session'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { waitForViewportSettled } from './helpers'

async function openProjects(page: Page) {
  await page.getByRole('button', { name: 'Switch project', exact: true }).click()
  return page.getByRole('dialog', { name: 'Your projects', exact: true })
}

async function openProfile(page: Page) {
  await page.getByRole('button', { name: 'User profile menu' }).click()
  await page.getByRole('menuitem', { name: 'Profile & account' }).click()
  return page.getByRole('dialog', { name: 'Profile & account', exact: true })
}

async function records(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('paper.workspaces', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise<Array<{ id: string; name: string; document: { scene: { rootIds: string[] }; grid: boolean; viewport: { x: number; y: number; zoom: number } } }>>((resolve, reject) => {
        const request = db.transaction('projects').objectStore('projects').getAll()
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    } finally { db.close() }
  })
}

test('creates, renames, switches and restores independent IndexedDB projects', async ({ page }) => {
  test.setTimeout(60000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await mockStudioSession(page)
  await page.goto('/')
  await expect(page.locator('[data-element-id="space"]')).toBeVisible()
  await waitForViewportSettled(page)
  const originalCamera = await page.getByTestId('viewport-world').getAttribute('style')
  await page.getByRole('textbox', { name: 'Project name', exact: true }).fill('Original study')
  await page.getByRole('button', { name: 'Toggle engineering grid' }).click()
  let projects = await openProjects(page)
  await projects.getByRole('button', { name: 'New project', exact: false }).click()
  await projects.getByRole('textbox', { name: 'New project name' }).fill('Shader experiments')
  await projects.getByRole('button', { name: 'Create project', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Project name', exact: true })).toHaveValue('Shader experiments')
  await expect(page.locator('[data-element-id="space"]')).toHaveCount(0)
  await expect(page.getByTestId('viewport-grid')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled()
  await page.getByRole('button', { name: 'Add rectangle', exact: true }).click()
  const elementId = await page.locator('.scene-node[data-element-id]').first().getAttribute('data-element-id')
  // Switch immediately: the outgoing document must be saved before the debounce.
  projects = await openProjects(page)
  await projects.getByRole('button', { name: /Original study.*Edited/ }).click()
  await expect(page.locator('[data-element-id="space"]')).toBeVisible()
  await expect(page.getByTestId('viewport-grid')).toBeHidden()
  await expect(page.getByTestId('viewport-world')).toHaveAttribute('style', originalCamera!)
  projects = await openProjects(page)
  await projects.getByRole('button', { name: 'Rename Shader experiments', exact: true }).click()
  await projects.getByRole('textbox', { name: 'Rename project' }).fill('Material lab')
  await projects.getByRole('button', { name: 'Save name', exact: true }).click()
  await projects.getByRole('button', { name: /Material lab.*Edited/ }).click()
  await expect(page.getByRole('textbox', { name: 'Project name', exact: true })).toHaveValue('Material lab')
  await expect(page.locator(`[data-element-id="${elementId}"]`)).toBeVisible()
  projects = await openProjects(page)
  await projects.getByRole('button', { name: 'Rename Material lab', exact: true }).click()
  await projects.getByRole('textbox', { name: 'Rename project' }).fill('Final materials')
  await projects.getByRole('button', { name: 'Save name', exact: true }).click()
  await projects.getByRole('button', { name: 'Close projects' }).click()
  await expect(page.getByRole('textbox', { name: 'Project name', exact: true })).toHaveValue('Final materials')
  await expect.poll(async () => (await records(page)).map(record => record.name).sort()).toEqual(['Final materials', 'Original study'])
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Project name', exact: true })).toHaveValue('Final materials')
  await expect(page.locator(`[data-element-id="${elementId}"]`)).toBeVisible()
  expect(errors).toEqual([])
})

test('profile drafts cancel and saved account avatar and local preferences survive reload', async ({ page }) => {
  test.setTimeout(60000)
  await mockStudioSession(page)
  await page.goto('/')
  let profile = await openProfile(page)
  await profile.getByRole('textbox', { name: 'Display name' }).fill('Discarded name')
  await profile.getByRole('button', { name: 'Cancel', exact: true }).click()
  profile = await openProfile(page)
  await expect(profile.getByRole('textbox', { name: 'Display name' })).toHaveValue('Paper Designer')
  await profile.getByRole('textbox', { name: 'Display name' }).fill('Ada Designer')
  await profile.getByRole('textbox', { name: 'Workspace name' }).fill('Ada’s studio')
  await profile.getByRole('button', { name: 'Light', exact: true }).click()
  await profile.getByRole('checkbox', { name: /Engineering grid/ }).uncheck()
  await profile.getByLabel('Upload profile image').setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNoXPvmPwAG5wMaPGE1WAAAAABJRU5ErkJggg==', 'base64') })
  await expect(profile.locator('.account-avatar img')).toBeVisible()
  await profile.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.reload()
  profile = await openProfile(page)
  await expect(profile.getByRole('textbox', { name: 'Display name' })).toHaveValue('Ada Designer')
  await expect(profile.getByRole('textbox', { name: 'Workspace name' })).toHaveValue('Ada’s studio')
  await expect(profile.locator('.account-avatar img')).toBeVisible()
  await profile.getByRole('button', { name: 'Close account settings' }).click()
  const projects = await openProjects(page)
  await expect(projects.getByText('Ada’s studio', { exact: true })).toBeVisible()
  await projects.getByRole('button', { name: 'New project', exact: false }).click()
  await projects.getByRole('textbox', { name: 'New project name' }).fill('Quiet canvas')
  await projects.getByRole('button', { name: 'Create project', exact: true }).click()
  await expect(page.getByTestId('viewport-grid')).toBeHidden()
})

test('migrates the existing local document without overwriting its recovery copy', async ({ page }) => {
  const legacy = { format: 'paper', version: 1, name: 'Legacy canvas', scene: { version: 1, elements: {}, rootIds: [] }, viewport: { x: 120, y: -240, zoom: .75 }, grid: false }
  await page.addInitScript(project => { localStorage.setItem('paper.project.v1', JSON.stringify(project)) }, legacy)
  await mockStudioSession(page)
  await page.goto('/')
  await expect(page.getByRole('textbox', { name: 'Project name', exact: true })).toHaveValue('Legacy canvas')
  await expect(page.getByTestId('viewport-grid')).toBeHidden()
  await expect.poll(async () => (await records(page)).length).toBe(1)
  const saved = (await records(page))[0]
  expect(saved.document.viewport).toEqual(legacy.viewport)
  await page.getByRole('textbox', { name: 'Project name', exact: true }).fill('Migrated canvas')
  await openProjects(page)
  await page.getByRole('dialog').getByRole('button', { name: 'Close projects' }).click()
  await expect.poll(async () => (await records(page))[0].name).toBe('Migrated canvas')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('paper.project.v1')!))).toEqual(legacy)
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Project name', exact: true })).toHaveValue('Migrated canvas')
})

test('storage failures retain an editable canvas and JSON export', async ({ page }) => {
  await page.addInitScript(() => { indexedDB.open = () => { throw new Error('IndexedDB unavailable') } })
  await mockStudioSession(page)
  await page.goto('/')
  await expect(page.getByTestId('canvas-viewport')).toBeVisible()
  await expect(page.getByText(/Changes are in memory/)).toBeVisible()
  const projects = await openProjects(page)
  await expect(projects.getByRole('button', { name: 'New project', exact: false })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(projects).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Switch project', exact: true })).toBeFocused()
  await page.getByRole('button', { name: 'Add rectangle', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save project JSON', exact: true }).click()
  expect((await download).suggestedFilename()).toBe('Space to think.paper.json')
})
