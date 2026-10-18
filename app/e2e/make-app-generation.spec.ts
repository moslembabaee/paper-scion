import { test, expect, type Page } from '@playwright/test'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Duplex } from 'node:stream'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createService } from '../server/service'
import { mockStudioSession } from './studio-session'

// Only the model transport is deterministic. Requests exercise the real authenticated
// service, approval registry, safe compiler and durable revision storage.
async function setup(page: Page, runtime?: 'repair' | 'persistent') {
  const root = await mkdtemp(join(tmpdir(), 'paper-generation-e2e-'))
  let invalid = false
  let styleOnly = false
  const service = await createService({
    root, secret: 'generation-browser-test-secret-at-least-32-characters', origin: 'http://127.0.0.1:4173',
    modelGateway: { provider: 'mock', turnBudget: 30, tokenBudget: 500000, customAdapter: async request => ({ content: JSON.stringify(
      request.context?.mode === 'plan' ? styleOnly ? {
        summary: 'Update canvas accent',
        files: [{ path: 'src/styles.css', description: 'Change background to blue', action: 'modify' }],
        interactions: ['Counter retains its behavior'], risks: [],
      } : {
        summary: 'Interactive counter',
        files: [{ path: 'src/App.tsx', description: 'Interactive counter', action: 'modify' }, { path: 'src/styles.css', description: 'Paper grid', action: 'modify' }],
        interactions: ['Increment increases the counter', 'Reset returns to zero'], risks: [],
      } : styleOnly ? {
        summary: 'Canvas accent updated',
        files: [{ path: 'src/styles.css', content: 'body { background: #81adec; color: #080808; }' }],
      } : {
        summary: 'Counter generated from approved plan',
        files: [{ path: 'src/App.tsx', content: invalid ? 'export default function App() { return <main>' : runtime && (request.context?.mode !== 'repair' || runtime === 'persistent') ? 'export default function App() { throw new Error("runtime fixture crash") }' : `
          import { useState } from 'react'; import './styles.css'
          export default function App() {
            const [count, setCount] = useState(0)
            return <main><h1>Made with Paper</h1><output aria-label="Count">{count}</output>
              <button onClick={() => setCount(c => c + 1)}>Increment</button>
              <button onClick={() => setCount(0)}>Reset</button></main>
          }` }, { path: 'src/styles.css', content: `
          body { margin:0; font:14px system-ui; background:#080808; color:#edebe1; }
          main { min-height:100vh; display:grid; place-content:center; gap:16px; padding:24px; box-sizing:border-box;
            background-image:linear-gradient(#222222 1px,transparent 1px),linear-gradient(90deg,#222222 1px,transparent 1px); background-size:120px 120px; }
          h1 { font-size:24px; } output { font:48px monospace; text-align:center; }
          button { padding:12px; background:#81adec; color:#080808; border:0; border-radius:6px; cursor:pointer; }
        ` }],
      }
    ) }) },
  })
  const { user, session } = await service.auth.login('github', { sub: 'generation-browser', email: 'generation@paper.test', name: 'Designer', avatar: '' })
  const responses: ServerResponse[] = []
  await mockStudioSession(page)
  const relay = async (route: import('@playwright/test').Route) => {
    const socket = new Duplex({ read() {}, write(_chunk, _encoding, callback) { callback() } })
    socket.remoteAddress = '127.0.0.1'
    const req = new IncomingMessage(socket)
    req.url = new URL(route.request().url()).pathname
    req.method = route.request().method()
    req.headers = { ...route.request().headers(), cookie: `paper_session=${session}` }
    const res = new ServerResponse(req)
    res.assignSocket(socket)
    responses.push(res)
    let responseBody = ''
    const end = res.end.bind(res)
    res.end = ((chunk?: unknown) => { if (chunk) responseBody += String(chunk); return end() }) as typeof res.end
    await service.handler(req, res, route.request().postData() ?? '{}')
    await route.fulfill({ status: res.statusCode, contentType: 'application/json', body: responseBody })
  }
  await page.route(/\/api\/apps(?:\/|$)/, relay)
  await page.route('**/api/model/**', relay)
  await page.goto('/')
  await page.getByRole('button', { name: 'Make workspace', exact: true }).click()
  return {
    service, user,
    failNextGeneration() { invalid = true },
    editStylesOnly() { styleOnly = true },
    async close() {
      service.close()
      for (const response of responses) response.emit('close')
      await rm(root, { recursive: true, force: true })
    },
  }
}

async function planAndGenerate(page: Page) {
  await page.getByRole('textbox', { name: 'Prompt for app planning' }).fill('Build an interactive counter')
  await page.getByRole('button', { name: 'Generate plan', exact: true }).click()
  await page.getByRole('button', { name: 'Approve plan', exact: true }).click()
  await expect(page.getByRole('region', { name: 'App plan', exact: true }).getByRole('status')).toHaveText('Approved')
  await page.getByRole('button', { name: 'Generate app', exact: true }).click()
}

test('creates a versioned app from an approved plan, renders and interacts at desktop/mobile, and rejects invalid replacement', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const f = await setup(page)
  try {
    await expect(page).toHaveTitle(/Paper/)
    await page.getByRole('button', { name: 'New app', exact: true }).click()
    await page.getByRole('button', { name: 'Save a copy', exact: true }).click()
    await expect(page.getByText('Saved to your account', { exact: true })).toBeVisible()
    const id = await page.getByRole('combobox', { name: 'Make project' }).inputValue()
    await planAndGenerate(page)
    await expect(page.getByText('APP PROJECT / REV 2', { exact: true })).toBeVisible()
    const preview = page.frameLocator('iframe').frameLocator('iframe')
    await expect(preview.getByRole('heading', { name: 'Made with Paper' })).toBeVisible()
    await expect(page.getByTestId('make-preview-status')).toHaveText('Running')
    await page.getByRole('button', { name: 'Dismiss plan' }).click()
    await preview.getByRole('button', { name: 'Increment' }).click()
    await expect(preview.getByLabel('Count')).toHaveText('1')
    await preview.getByRole('button', { name: 'Reset', exact: true }).click()
    await expect(preview.getByLabel('Count')).toHaveText('0')
    await page.screenshot({ path: '/tmp/paper-generation-desktop.png' })
    await page.setViewportSize({ width: 390, height: 844 })
    await preview.getByRole('button', { name: 'Increment' }).click()
    await expect(preview.getByLabel('Count')).toHaveText('1')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: '/tmp/paper-generation-mobile.png' })
    await page.setViewportSize({ width: 1440, height: 900 })
    const usable = await f.service.storage.apps.read(f.user.id, id)
    f.failNextGeneration()
    await planAndGenerate(page)
    await expect(page.getByTestId('make-diagnostics')).toContainText('Syntax Error')
    await expect(page.getByRole('alert')).toContainText('last usable preview')
    await page.getByRole('button', { name: 'Dismiss plan' }).click()
    // The same browsing context survives: count remains one and still responds.
    await expect(preview.getByLabel('Count')).toHaveText('1')
    await preview.getByRole('button', { name: 'Increment' }).click()
    await expect(preview.getByLabel('Count')).toHaveText('2')
    expect(await f.service.storage.apps.read(f.user.id, id)).toEqual(usable)
    expect(await f.service.storage.apps.listRevisions(f.user.id, id)).toHaveLength(2)
    const failed = f.service.modelGateway.listTurns(f.user.id, id).find(turn => turn.generation?.validation === 'failed')
    expect(failed?.generation?.plan.status).toBe('approved')
    expect(failed?.generation?.diagnostics[0].code).toBe('SYNTAX_ERROR')
    await page.screenshot({ path: '/tmp/paper-generation-recovery.png' })
    await page.reload()
    await page.getByRole('button', { name: 'Make workspace', exact: true }).click()
    await page.getByRole('combobox', { name: 'Make project' }).selectOption(id)
    await expect(page.getByText('APP PROJECT / REV 2', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Run preview', exact: true }).click()
    await expect(preview.getByRole('heading', { name: 'Made with Paper' })).toBeVisible()
    await expect(page.locator('vite-error-overlay')).toHaveCount(0)
    expect(errors).toEqual([])
  } finally { await f.close() }
})

test('unsaved draft generation goes through the same approved plan/compiler pipeline', async ({ page }) => {
  const f = await setup(page)
  try {
    await planAndGenerate(page)
    await expect(page.getByText('APP PROJECT / REV 2', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Dismiss plan' }).click()
    const preview = page.frameLocator('iframe').frameLocator('iframe')
    await preview.getByRole('button', { name: 'Increment' }).click()
    await expect(preview.getByLabel('Count')).toHaveText('1')
    expect(await f.service.storage.apps.list(f.user.id)).toEqual([])
  } finally { await f.close() }
})


test('chat follow-up changes only targeted CSS, shows bounded diff and restores one rollback point', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const f = await setup(page)
  try {
    await page.getByRole('button', { name: 'Save a copy', exact: true }).click()
    await expect(page.getByText('Saved to your account', { exact: true })).toBeVisible()
    const id = await page.getByRole('combobox', { name: 'Make project' }).inputValue()
    await planAndGenerate(page)
    await expect(page.getByText('APP PROJECT / REV 2', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Dismiss plan' }).click()
    const before = await f.service.storage.apps.read(f.user.id, id)
    f.editStylesOnly()
    await page.getByRole('textbox', { name: 'Prompt for app planning' }).fill('Change only the canvas background to blue')
    await page.getByRole('button', { name: 'Generate plan', exact: true }).click()
    await page.getByRole('button', { name: 'Approve plan', exact: true }).click()
    await expect(page.getByRole('region', { name: 'App plan', exact: true }).getByRole('status')).toHaveText('Approved')
    await page.getByRole('button', { name: 'Generate app', exact: true }).click()
    await expect(page.getByText('APP PROJECT / REV 3', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Dismiss plan' }).click()
    const changes = page.getByRole('region', { name: 'Applied changes' })
    await expect(changes).toContainText('Validated and applied · 1 file')
    await expect(changes).toContainText('Rollback point · Rev 2')
    await changes.locator('summary').filter({ hasText: 'src/styles.css' }).click()
    await expect(changes.getByLabel('Diff for src/styles.css')).toContainText('#81adec')
    const after = await f.service.storage.apps.read(f.user.id, id)
    expect(after?.files['src/App.tsx']).toEqual(before?.files['src/App.tsx'])
    const preview = page.frameLocator('iframe').frameLocator('iframe')
    await expect(preview.locator('body')).toHaveCSS('background-color', 'rgb(129, 173, 236)')
    await preview.getByRole('button', { name: 'Increment' }).click()
    await expect(preview.getByLabel('Count')).toHaveText('1')
    await expect(page.getByTestId('make-preview-status')).toHaveText('Running')
    await page.screenshot({ path: '/tmp/paper-iterative-desktop.png' })
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(changes.getByRole('button', { name: 'Undo last edit' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: '/tmp/paper-iterative-mobile.png' })
    await changes.getByRole('button', { name: 'Undo last edit' }).click()
    await expect(page.getByText('APP PROJECT / REV 4', { exact: true })).toBeVisible()
    await expect(changes).toHaveCount(0)
    expect((await f.service.storage.apps.read(f.user.id, id))?.files).toEqual(before?.files)
    await expect(preview.getByRole('heading', { name: 'Made with Paper' })).toBeVisible()
    await expect(page.locator('vite-error-overlay')).toHaveCount(0)
    expect(errors).toEqual([])
  } finally { await f.close() }
})

test('agent repairs a runtime error once and shows both validation attempts', async ({ page }) => {
  const f = await setup(page, 'repair')
  try {
    await page.getByRole('button', { name: 'Save a copy', exact: true }).click()
    await expect(page.getByText('Saved to your account', { exact: true })).toBeVisible()
    const id = await page.getByRole('combobox', { name: 'Make project' }).inputValue()
    await planAndGenerate(page)
    await expect(page.getByText('APP PROJECT / REV 2', { exact: true })).toBeVisible({ timeout: 15000 })
    const validation = page.getByTestId('make-validation')
    await expect(validation).toContainText('Candidate 1 · failed')
    await expect(validation).toContainText('Candidate 2 · passed')
    await expect(validation).toContainText('Interaction behavior still needs review')
    await page.getByRole('button', { name: 'Dismiss plan' }).click()
    const preview = page.frameLocator('iframe').frameLocator('iframe')
    await preview.getByRole('button', { name: 'Increment' }).click()
    await expect(preview.getByLabel('Count')).toHaveText('1')
    expect(await f.service.storage.apps.listRevisions(f.user.id, id)).toHaveLength(2)
  } finally { await f.close() }
})

test('persistent runtime error stops at two candidates and retains the working preview', async ({ page }) => {
  const f = await setup(page, 'persistent')
  try {
    await page.getByRole('button', { name: 'Save a copy', exact: true }).click()
    await expect(page.getByText('Saved to your account', { exact: true })).toBeVisible()
    const id = await page.getByRole('combobox', { name: 'Make project' }).inputValue()
    const original = await f.service.storage.apps.read(f.user.id, id)
    await page.getByRole('button', { name: 'Run preview', exact: true }).click()
    await expect(page.getByTestId('make-preview-status')).toHaveText('Running')
    await planAndGenerate(page)
    await expect(page.getByTestId('make-validation')).toContainText('Repair budget exhausted', { timeout: 20000 })
    await expect(page.getByTestId('make-validation')).toContainText('Candidate 2 · failed')
    await expect(page.getByText('APP PROJECT / REV 1', { exact: true })).toBeVisible()
    await expect(page.getByTestId('make-preview-status')).toHaveText('Running')
    expect(await f.service.storage.apps.read(f.user.id, id)).toEqual(original)
    expect(await f.service.storage.apps.listRevisions(f.user.id, id)).toHaveLength(1)
    expect(f.service.modelGateway.listTurns(f.user.id, id).filter(t => t.generation)).toHaveLength(2)
  } finally { await f.close() }
})
