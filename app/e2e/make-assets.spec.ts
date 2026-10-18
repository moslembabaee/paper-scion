import { test, expect, type Page } from '@playwright/test'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Duplex } from 'node:stream'
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createService } from '../server/service'
import { parseAppPackage } from '../src/make/assets'
import { compileAppProject } from '../src/make/compiler'
import { mockStudioSession } from './studio-session'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=', 'base64')
async function setup(page: Page) {
  const root = await mkdtemp(join(tmpdir(), 'paper-assets-e2e-'))
  const service = await createService({ root, secret: 'assets-browser-test-secret-at-least-32-characters', origin: 'http://127.0.0.1:4173' })
  const { user, session } = await service.auth.login('github', { sub: 'asset-browser', email: 'assets@paper.test', name: 'Designer', avatar: '' })
  const responses: ServerResponse[] = []
  // Route built frontend files in-process: the restricted runner cannot bind sockets.
  await page.route('http://127.0.0.1:4173/**', async route => {
    const pathname = new URL(route.request().url()).pathname
    if (pathname.startsWith('/api/')) { await route.fallback(); return }
    const file = new URL(`../dist${pathname === '/' ? '/index.html' : pathname}`, import.meta.url)
    const contentType = pathname.endsWith('.js') ? 'text/javascript' : pathname.endsWith('.css') ? 'text/css' : pathname.endsWith('.json') ? 'application/json' : 'text/html'
    await route.fulfill({ contentType, body: await readFile(file) })
  })
  await mockStudioSession(page)
  await page.route('**/api/auth/session', route => route.fulfill({ json: { user: service.auth.profile(user), providers: { google: true, github: true } } }))
  await page.route(/\/api\/apps(?:\/|$)|\/api\/model\//, async route => {
    const socket = new Duplex({ read() {}, write(_chunk, _encoding, callback) { callback() } })
    const req = new IncomingMessage(socket)
    const u = new URL(route.request().url())
    req.url = u.pathname + u.search
    req.method = route.request().method()
    req.headers = { ...route.request().headers(), cookie: `paper_session=${session}` }
    const res = new ServerResponse(req)
    res.assignSocket(socket); responses.push(res)
    const chunks: Buffer[] = []
    const origWrite = res.write.bind(res)
    res.write = ((chunk: unknown, encoding?: unknown, callback?: unknown) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
      return origWrite(chunk as never, encoding as never, callback as never)
    }) as typeof res.write
    const origEnd = res.end.bind(res)
    res.end = ((chunk?: unknown, encoding?: unknown, callback?: unknown) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
      return origEnd(chunk as never, encoding as never, callback as never)
    }) as typeof res.end
    await service.handler(req, res, route.request().postData() ?? '{}')
    const headers: Record<string, string> = {}
    if ((res as unknown as { _header?: string })._header) {
      for (const line of (res as unknown as { _header: string })._header.split('\r\n').slice(1)) {
        const split = line.indexOf(':')
        if (split > 0) headers[line.slice(0, split).toLowerCase()] = line.slice(split + 1).trim()
      }
    }
    for (const [k, v] of Object.entries(res.getHeaders())) {
      if (v !== undefined) headers[k.toLowerCase()] = String(v)
    }
    await route.fulfill({ status: res.statusCode, headers, body: Buffer.concat(chunks) })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Make workspace', exact: true }).click()
  return { service, user, async close() {
    service.close(); for (const res of responses) res.emit('close')
    await rm(root, { recursive: true, force: true })
  } }
}

test('uploads real images and fonts, renders privately, exports and compiles the package offline', async ({ page }, testInfo) => {
  const f = await setup(page)
  try {
    const panel = page.getByRole('region', { name: 'Project assets', exact: true })
    await expect(panel.getByRole('button', { name: 'Attach asset' })).toBeDisabled()
    await page.getByRole('button', { name: 'New app', exact: true }).click()
    await page.getByRole('button', { name: 'Save a copy', exact: true }).click()
    await expect(page.getByText('Saved to your account', { exact: true })).toBeVisible()
    const id = await page.getByRole('combobox', { name: 'Make project' }).inputValue()
    const upload = page.getByLabel('Upload image or font')
    await upload.setInputFiles({ name: 'logo.png', mimeType: 'text/plain', buffer: png })
    await expect(panel.getByText('logo.png', { exact: true })).toBeVisible()
    await expect(panel.locator('img')).toHaveJSProperty('naturalWidth', 1)
    const fontDirectory = new URL('../node_modules/playwright-core/lib/vite/recorder/assets/', import.meta.url)
    const fontName = (await readdir(fontDirectory)).find(name => name.endsWith('.ttf'))!
    const font = await readFile(new URL(fontName, fontDirectory))
    await upload.setInputFiles({ name: 'Paper.ttf', mimeType: 'font/ttf', buffer: font })
    await expect(panel.getByText('Paper.ttf', { exact: true })).toBeVisible()
    const project = (await f.service.storage.apps.read(f.user.id, id))!
    const [image] = project.assetIds
    await f.service.storage.apps.put(f.user.id, id, { ...project, files: {
      'src/App.tsx': { path: 'src/App.tsx', content: `import './styles.css'; export default () => <main><h1>Private assets</h1><img alt="Uploaded logo" src="paper-asset:${image}"/><img alt="External tracker" src="https://assets-attacker.invalid/tracker.png"/></main>` },
      'src/styles.css': { path: 'src/styles.css', content: 'body{font-family:Paper;background:#080808;color:#edebe1}main{padding:24px}img{width:48px;height:48px}h1{color:#81adec}' },
    } }, project.revision)
    await page.reload()
    await page.getByRole('button', { name: 'Make workspace', exact: true }).click()
    await page.getByRole('combobox', { name: 'Make project' }).selectOption(id)
    await expect(page.getByText('APP PROJECT / REV 4', { exact: true })).toBeVisible()
    let outbound = 0
    await page.route('https://assets-attacker.invalid/**', route => { outbound++; return route.abort() })
    await page.getByRole('button', { name: 'Run preview', exact: true }).click()
    const preview = page.frameLocator('iframe').frameLocator('iframe')
    await expect(preview.getByRole('heading', { name: 'Private assets' })).toBeVisible()
    await expect(preview.getByAltText('Uploaded logo')).toHaveJSProperty('naturalWidth', 1)
    expect(await preview.locator('body').evaluate(async () => {
      const loaded = await document.fonts.load('16px Paper')
      return loaded.length === 1 && loaded[0].status === 'loaded'
    })).toBe(true)
    await expect(page.getByTestId('make-preview-status')).toHaveText('Running')
    expect(outbound).toBe(0)
    const downloadEvent = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export app with assets' }).click()
    const download = await downloadEvent
    const pkg = parseAppPackage(await readFile((await download.path())!, 'utf8'))
    expect(pkg.assets).toHaveLength(2)
    expect(Buffer.from(pkg.assets[0].dataBase64, 'base64')).toEqual(png)
    expect(Buffer.from(pkg.assets[1].dataBase64, 'base64')).toEqual(font)
    const compiled = await compileAppProject(pkg.project, {}, pkg.assets)
    expect(compiled.success).toBe(true)
    expect(compiled.assets!.js).toContain('data:image/png;base64,')
    expect(compiled.assets!.css).toContain('data:font/ttf;base64,')
    await page.screenshot({ path: testInfo.outputPath('private-assets.png') })
    const before = await f.service.storage.apps.read(f.user.id, id)
    await upload.setInputFiles({ name: 'unsafe.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg onload="alert(1)"/>') })
    await expect(panel.getByRole('alert')).toContainText(/SVG|active/)
    expect(await f.service.storage.apps.read(f.user.id, id)).toEqual(before)
    await expect(preview.getByAltText('Uploaded logo')).toHaveJSProperty('naturalWidth', 1)
  } finally { await f.close() }
})
