import { mockStudioSession } from './studio-session'
import { test, expect, type APIRequestContext } from '@playwright/test'
import { waitForCanvasReady } from './helpers'

async function mcp(request: APIRequestContext) {
  const initialized = await request.post('/mcp', { data: { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'paper-live-test', version: '1' } } } })
  expect(initialized.ok()).toBeTruthy()
  const headers = { 'MCP-Session-Id': initialized.headers()['mcp-session-id'] }
  await request.post('/mcp', { headers, data: { jsonrpc: '2.0', method: 'notifications/initialized' } })
  let id = 1
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const response = await request.post('/mcp', { headers, data: { jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name, arguments: args } } })
    expect(response.ok()).toBeTruthy()
    return (await response.json()).result
  }
  return { call, success: async (name: string, args: Record<string, unknown> = {}) => {
    const result = await call(name, args)
    expect(result.isError, JSON.stringify(result)).toBe(false)
    return result.structuredContent
  } }
}

test('HTTP agent edits push to canvas, glow, preserve selection, undo and survive reload', async ({ page, request }) => {
  await waitForCanvasReady(page)
  await expect(page.getByTestId('bridge-status')).toHaveAttribute('data-connected', 'true')
  const { call, success } = await mcp(request)
  const info = await success('get_basic_info')
  expect(info.fileName).toBe('Space to think')
  expect(info.gridSize).toBe(120)
  expect(info.artboards.length).toBeGreaterThan(0)
  const frame = await success('create_frame', { id: 'live-frame', name: 'Agent study', x: 120, y: 240, expected_revision: info.revision })
  await expect(page.locator('[data-element-id="live-frame"]')).toBeAttached()
  await expect(page.locator('[data-agent-element-id="live-frame"]')).toBeAttached()
  const frameBounds = await page.locator('[data-element-id="live-frame"]').boundingBox()
  const indicatorBounds = await page.locator('[data-agent-element-id="live-frame"]').boundingBox()
  expect(frameBounds).toBeTruthy()
  expect(indicatorBounds).toBeTruthy()
  expect(Math.abs(frameBounds!.x - indicatorBounds!.x)).toBeLessThan(1)
  expect(Math.abs(frameBounds!.y - indicatorBounds!.y)).toBeLessThan(1)
  await expect(page.getByTestId('bridge-status')).toHaveText('Agent editing')
  const stale = await call('update_element', { element_id: 'live-frame', expected_revision: info.revision, patch: { width: 900 } })
  expect(stale.isError).toBe(true)
  await success('add_shader_shape', { id: 'live-shader', parentId: 'live-frame', shader_kind: 'mesh-gradient', width: 240, height: 240 })
  await expect(page.locator('[data-element-id="live-shader"] .shader-surface')).toBeAttached()
  await success('update_element', { element_id: 'live-frame', patch: { name: 'Live from MCP', rotation: 15 } })
  await expect(page.locator('[data-agent-element-id="live-frame"]')).toHaveAttribute('style', /matrix/)
  await page.getByTestId('history-undo').click()
  let canvas = await success('get_canvas_elements')
  expect(canvas.elements.find((node: { id: string }) => node.id === 'live-frame').name).toBe(frame.element.name)
  await page.getByTestId('history-redo').click()
  await success('create_token', { id: 'blue-token', name: 'agent-blue', type: 'color', value: '#81adec' })
  expect((await success('list_tokens', { type: 'color' })).tokens.some((token: { id: string }) => token.id === 'blue-token')).toBe(true)
  await expect(page.getByTestId('bridge-status')).toHaveText('MCP live', { timeout: 5000 })
  await expect(page.getByTestId('agent-overlay')).toHaveCount(0)
  await page.reload()
  await expect(page.getByTestId('bridge-status')).toHaveAttribute('data-connected', 'true')
  canvas = await success('get_canvas_elements')
  expect(canvas.elements.find((node: { id: string }) => node.id === 'live-frame').name).toBe('Live from MCP')
})

test('BroadcastChannel mirrors agent and human edits across tabs, with active-project isolation', async ({ page, context, request }) => {
  await waitForCanvasReady(page)
  await expect(page.getByTestId('bridge-status')).toHaveAttribute('data-connected', 'true')
  const { call, success } = await mcp(request)
  const original = await success('get_basic_info')
  const peer = await context.newPage()
  await mockStudioSession(peer)
  await peer.goto('/')
  await expect(peer.getByTestId('bridge-status')).toHaveAttribute('data-connected', 'true')
  await success('create_frame', { id: 'shared-frame', name: 'Shared frame' })
  await expect(page.locator('[data-element-id="shared-frame"]')).toBeAttached()
  await expect(peer.locator('[data-element-id="shared-frame"]')).toBeAttached()
  await page.bringToFront()
  await page.getByTestId('tool-rectangle').click()
  const humanId = await page.locator('.scene-node.is-selected').getAttribute('data-element-id')
  await expect(peer.locator(`[data-element-id="${humanId}"]`)).toBeAttached()
  await peer.bringToFront()
  await peer.getByRole('button', { name: 'Switch project', exact: true }).click()
  const projects = peer.getByRole('dialog', { name: 'Your projects', exact: true })
  await projects.getByRole('button', { name: 'New project', exact: false }).click()
  await projects.getByRole('textbox', { name: 'New project name' }).fill('Separate MCP canvas')
  await projects.getByRole('button', { name: 'Create project', exact: true }).click()
  await expect(peer.getByTestId('bridge-status')).toHaveAttribute('data-connected', 'true')
  await expect.poll(async () => {
    const res = await call('get_basic_info')
    return res.structuredContent?.fileName
  }).toBe('Separate MCP canvas')
  const active = await success('get_basic_info')
  expect(active.projectId).not.toBe(original.projectId)
  await success('create_frame', { id: 'isolated-frame' })
  await expect(peer.locator('[data-element-id="isolated-frame"]')).toBeAttached()
  await expect(page.locator('[data-element-id="isolated-frame"]')).toHaveCount(0)
  await page.bringToFront()
  await page.getByTestId('canvas-viewport').focus()
  await expect.poll(async () => {
    const res = await call('get_basic_info')
    return res.structuredContent?.projectId
  }).toBe(original.projectId)
})

test('atomic MCP preview, guarded apply, retry and one undo preserve human selection', async ({ page, request }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await waitForCanvasReady(page)
  await expect(page.getByTestId('bridge-status')).toHaveAttribute('data-connected', 'true')
  await page.getByTestId('tool-rectangle').click()
  const { call, success } = await mcp(request)
  const context = await success('get_selection_context')
  expect(context.elements).toHaveLength(1)
  const selection = (await success('get_basic_info')).selection
  const plan = { expected_revision: context.revision, idempotency_key: 'browser-atomic-plan', operations: [
    { action: 'create', type: 'frame', id: 'atomic-frame', name: 'Atomic card', x: 120, y: 120, width: 360, height: 240 },
    { action: 'create', type: 'text', id: 'atomic-title', parentId: '$0', text: 'One complete edit', fontSize: 24 },
    { action: 'create_token', id: 'atomic-blue', name: 'atomic-blue', type: 'color', value: '#81adec' },
    { action: 'bind_token', element_id: '$1', property: 'fill', token_id: '$2' },
  ] }
  const preview = await success('apply_changes', { ...plan, dry_run: true })
  expect(preview.dry_run).toBe(true)
  expect(preview.revision).toBe(context.revision)
  expect(preview.summary.after['atomic-title'].style.fill).toBe('#81adec')
  await expect(page.locator('[data-element-id="atomic-frame"]')).toHaveCount(0)
  expect((await success('get_basic_info')).selection).toEqual(selection)
  const failed = await call('apply_changes', { ...plan, operations: [plan.operations[0], { action: 'update', element_id: 'missing', patch: { text: 'Invalid' } }] })
  expect(failed.isError).toBe(true)
  expect((await success('get_basic_info')).revision).toBe(context.revision)
  const applied = await success('apply_changes', plan)
  expect(applied.applied).toBe(true)
  expect(applied.revision).not.toBe(context.revision)
  await expect(page.locator('[data-element-id="atomic-title"]')).toContainText('One complete edit')
  expect((await success('get_basic_info')).selection).toEqual(selection)
  expect(await success('apply_changes', plan)).toEqual(applied)
  expect((await call('apply_changes', { ...plan, idempotency_key: 'different-plan' })).isError).toBe(true)
  await page.getByTestId('history-undo').click()
  await expect(page.locator('[data-element-id="atomic-frame"]')).toHaveCount(0)
  expect((await success('list_tokens')).tokens.some((token: { id: string }) => token.id === 'atomic-blue')).toBe(false)
  expect((await success('get_basic_info')).selection).toEqual(selection)
  await page.getByTestId('history-redo').click()
  await expect(page.locator('[data-element-id="atomic-title"]')).toBeAttached()
  expect((await success('list_tokens')).tokens.some((token: { id: string }) => token.id === 'atomic-blue')).toBe(true)
  await page.screenshot({ path: '/tmp/paper-atomic-edit.png' })
  await page.reload()
  await expect(page.getByTestId('bridge-status')).toHaveAttribute('data-connected', 'true')
  expect((await success('get_selection_context', { element_ids: ['atomic-title'] })).linkedTokens.some((token: { id: string }) => token.id === 'atomic-blue')).toBe(true)
  expect(errors).toEqual([])
})
