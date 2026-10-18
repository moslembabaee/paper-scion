import { mockStudioSession } from './studio-session'
import { test, expect } from '@playwright/test'
import { getViewportTransform, waitForCanvasReady, waitForViewportSettled } from './helpers'

test('solo editing, cloud autosave and opening presence send no collaboration requests', async ({ page }) => {
  const requests: string[] = [], errors: string[] = []
  page.on('request', request => { if (request.url().includes('/__paper_collaboration/')) requests.push(request.url()) })
  page.on('pageerror', error => errors.push(error.message))
  await waitForCanvasReady(page)
  await page.getByRole('button', { name: 'Canvas collaborators', exact: true }).click()
  await expect(page.locator('.presence-connection')).toHaveText('Solo')
  await page.getByRole('button', { name: 'Canvas collaborators', exact: true }).click()
  const saved = page.waitForResponse(response => {
    const request = response.request()
    return response.url().includes('/api/projects/') && request.method() === 'PUT'
      && request.postData()?.includes('Solo study') === true && response.ok()
  })
  await page.getByRole('textbox', { name: 'Project name', exact: true }).fill('Solo study')
  await page.getByTestId('tool-rectangle').click()
  const id = await page.locator('.scene-node.is-selected').getAttribute('data-element-id')
  await saved
  await page.reload()
  await expect(page.getByRole('textbox', { name: 'Project name', exact: true })).toHaveValue('Solo study')
  await expect(page.locator(`[data-element-id="${id}"]`)).toBeAttached()
  expect(requests).toEqual([])
  expect(errors).toEqual([])
})

for (const action of ['Share', 'Invite', 'Copy invite link']) {
  test(`${action} activates collaboration only after an explicit invitation`, async ({ page }) => {
    const joins: string[] = []
    page.on('request', request => {
      if (request.url().includes('/__paper_collaboration/') && new URL(request.url()).pathname.endsWith('/join')) joins.push(request.url())
    })
    if (action === 'Share') await page.addInitScript(() => {
      Object.defineProperty(navigator, 'share', { configurable: true, value: async () => {} })
    })
    await waitForCanvasReady(page)
    await page.getByRole('button', { name: 'Canvas collaborators', exact: true }).click()
    await expect(page.locator('.presence-connection')).toHaveText('Solo')
    expect(joins).toEqual([])
    await page.getByRole('button', { name: action, exact: true }).click()
    await expect(page.locator('.presence-connection')).toHaveText('Live')
    expect(joins).toHaveLength(1)
    const invite = new URL(await page.getByRole('textbox', { name: 'Canvas invite link' }).inputValue())
    const room = new URLSearchParams(invite.hash.slice(1)).get('room')
    expect(room).toMatch(/^[a-f0-9-]{36}$/)
    expect(new URL(joins[0]).pathname).toBe(`/__paper_collaboration/${room}/join`)
    // Repeated invitation actions keep the same live session.
    await page.getByRole('button', { name: action, exact: true }).click()
    await expect(page.locator('.presence-connection')).toHaveText('Live')
    expect(joins).toHaveLength(1)
  })
}

test('a room URL joins immediately, switches rooms on hash changes and stops when cleared', async ({ page }) => {
  const first = crypto.randomUUID(), second = crypto.randomUUID()
  const requests: string[] = []
  page.on('request', request => { if (request.url().includes('/__paper_collaboration/')) requests.push(request.url()) })
  await mockStudioSession(page)
  await page.goto(`/#room=${first}`)
  await expect(page.getByTestId('canvas-viewport')).toBeVisible()
  await page.getByRole('button', { name: 'Canvas collaborators', exact: true }).click()
  await expect(page.locator('.presence-connection')).toHaveText('Live')
  expect(requests.some(url => new URL(url).pathname === `/__paper_collaboration/${first}/join`)).toBe(true)
  await page.evaluate(room => { window.location.hash = `room=${room}` }, second)
  await expect(page.getByRole('textbox', { name: 'Canvas invite link' })).toHaveValue(new RegExp(second))
  await expect(page.locator('.presence-connection')).toHaveText('Live')
  expect(requests.some(url => new URL(url).pathname === `/__paper_collaboration/${second}/join`)).toBe(true)
  expect(requests.some(url => new URL(url).pathname === `/__paper_collaboration/${first}/leave`)).toBe(true)
  await page.evaluate(() => { window.location.hash = '' })
  await expect(page.locator('.presence-connection')).toHaveText('Solo')
  await expect.poll(() => requests.some(url => new URL(url).pathname === `/__paper_collaboration/${second}/leave`)).toBe(true)
  const stopped = requests.length
  await page.getByTestId('tool-rectangle').click()
  // Observe beyond the relay's 30 Hz write interval and local autosave debounce.
  await page.waitForTimeout(1000)
  expect(requests).toHaveLength(stopped)
})

test('a malformed room hash keeps collaboration disabled', async ({ page }) => {
  const requests: string[] = []
  page.on('request', request => { if (request.url().includes('/__paper_collaboration/')) requests.push(request.url()) })
  await mockStudioSession(page)
  await page.goto('/#room=invalid')
  await expect(page.getByTestId('canvas-viewport')).toBeVisible()
  await page.getByRole('button', { name: 'Canvas collaborators', exact: true }).click()
  await expect(page.locator('.presence-connection')).toHaveText('Solo')
  expect(requests).toEqual([])
})

test('creating a project from an invited room returns to solo mode', async ({ page }) => {
  const room = crypto.randomUUID(), joins: string[] = []
  page.on('request', request => {
    if (request.url().includes('/__paper_collaboration/') && new URL(request.url()).pathname.endsWith('/join')) joins.push(request.url())
  })
  await mockStudioSession(page)
  await page.goto(`/#room=${room}`)
  await page.getByRole('button', { name: 'Canvas collaborators', exact: true }).click()
  await expect(page.locator('.presence-connection')).toHaveText('Live')
  const activeJoins = joins.length
  await page.getByRole('button', { name: 'Switch project', exact: true }).click()
  const projects = page.getByRole('dialog', { name: 'Your projects', exact: true })
  await projects.getByRole('button', { name: 'New project', exact: false }).click()
  await projects.getByRole('textbox', { name: 'New project name' }).fill('Private study')
  await projects.getByRole('button', { name: 'Create project', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Project name', exact: true })).toHaveValue('Private study')
  await expect(page).toHaveURL(/\/$/)
  await page.getByRole('button', { name: 'Canvas collaborators', exact: true }).click()
  await expect(page.locator('.presence-connection')).toHaveText('Solo')
  expect(joins).toHaveLength(activeJoins)
})

test('invited browsers share edits, live cursors, selection outlines and viewport following', async ({ page, browser }) => {
  await waitForCanvasReady(page)
  await page.getByRole('button', { name: 'Canvas collaborators' }).click()
  await page.getByRole('button', { name: 'Copy invite link', exact: true }).click()
  await expect(page.locator('.presence-connection')).toHaveText('Live')
  const invite = await page.getByRole('textbox', { name: 'Canvas invite link' }).inputValue()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  try {
    await context.addInitScript(() => localStorage.setItem('paper.profile.v1', JSON.stringify({ version: 1, name: 'Mira Chen' })))
    const peer = await context.newPage()
    await mockStudioSession(peer)
    await peer.goto(invite)
    await expect(peer.getByTestId('canvas-viewport')).toBeVisible()
    await expect(peer.locator('[data-element-id="space"]')).toBeAttached()
    await expect(page.locator('[data-peer-name="Mira Chen"]')).toBeVisible()
    await peer.getByRole('button', { name: 'Canvas collaborators' }).click()
    await expect(peer.getByTestId('presence-peer')).toHaveCount(1)
    await page.getByRole('button', { name: 'Canvas collaborators' }).click()

    await page.getByTestId('tool-rectangle').click()
    const id = await page.locator('.scene-node.is-selected').getAttribute('data-element-id')
    const remoteNode = peer.locator(`[data-element-id="${id}"]`)
    await expect(remoteNode).toBeAttached()
    const outline = peer.locator(`[data-remote-element-id="${id}"]`)
    await expect(outline).toBeVisible()
    const bounds = await remoteNode.boundingBox(), selectedBounds = await outline.boundingBox()
    expect(bounds).toBeTruthy(); expect(selectedBounds).toBeTruthy()
    expect(Math.abs(bounds!.x - selectedBounds!.x)).toBeLessThan(1)
    expect(Math.abs(bounds!.y - selectedBounds!.y)).toBeLessThan(1)
    // Local selection is private even though the remote selection is visible.
    await expect(peer.locator('.scene-node.is-selected')).toHaveCount(0)

    const viewport = await page.getByTestId('canvas-viewport').boundingBox()
    await page.mouse.move(viewport!.x + viewport!.width / 2, viewport!.y + viewport!.height / 2)
    await expect(peer.getByTestId('remote-cursor')).toBeVisible()
    const previous = await peer.getByTestId('remote-cursor').getAttribute('style')
    await page.mouse.move(viewport!.x + viewport!.width / 2 + 120, viewport!.y + viewport!.height / 2 + 80, { steps: 8 })
    await expect(peer.getByTestId('remote-cursor')).not.toHaveAttribute('style', previous!)

    await peer.getByRole('button', { name: 'Follow Paper Designer', exact: true }).click()
    await expect(peer.locator('.follow-banner')).toBeVisible()
    await page.getByTestId('canvas-viewport').focus()
    await page.keyboard.press('+')
    await waitForViewportSettled(page)
    const leader = await getViewportTransform(page)
    await expect.poll(async () => (await getViewportTransform(peer)).zoom).toBeCloseTo(leader.zoom, 3)
    await peer.getByTestId('canvas-viewport').focus()
    await peer.keyboard.press('Escape')
    await expect(peer.locator('.follow-banner')).toHaveCount(0)

    await context.setOffline(true)
    await expect(peer.locator('.presence-connection')).toHaveText(/Offline|Reconnecting/)
    await peer.getByTestId('tool-ellipse').click()
    const offlineId = await peer.locator('.scene-node.is-selected').getAttribute('data-element-id')
    await expect(page.locator(`[data-element-id="${offlineId}"]`)).toHaveCount(0)
    await context.setOffline(false)
    await expect(peer.locator('.presence-connection')).toHaveText('Live', { timeout: 10000 })
    await expect(page.locator(`[data-element-id="${offlineId}"]`)).toBeAttached()
  } finally { await context.close() }
})
