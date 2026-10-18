import { test, expect, type Page } from '@playwright/test'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Duplex } from 'node:stream'
import type { Socket } from 'node:net'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createService } from '../server/service'
import { createAppProject } from '../src/make/manifest'
import { mockStudioSession } from './studio-session'

type Service = Awaited<ReturnType<typeof createService>>
type Identity = Awaited<ReturnType<Service['auth']['login']>>
async function mount(page: Page, service: Service, identity: Identity) {
  await page.context().addCookies([{ name: 'paper_session', value: identity.session, url: 'http://127.0.0.1:4173' }])
  await page.route('http://127.0.0.1:4173/**', async route => {
    const pathname = new URL(route.request().url()).pathname
    if (pathname.startsWith('/api/')) { await route.fallback(); return }
    const file = new URL(`../dist${pathname === '/' ? '/index.html' : pathname}`, import.meta.url)
    await route.fulfill({ contentType: pathname.endsWith('.js') ? 'text/javascript' : pathname.endsWith('.css') ? 'text/css' : 'text/html', body: await readFile(file) })
  })
  await mockStudioSession(page)
  await page.route('**/api/auth/session', route => route.fulfill({ json: { user: identity.user, providers: { google: true, github: true } } }))
  await page.route(/\/api\/(?:apps|shared-apps|model)(?:\/|$)/, async route => {
    const socket = new Duplex({ read() {}, write(_chunk, _encoding, callback) { callback() } }) as Socket
    const req = new IncomingMessage(socket), url = new URL(route.request().url())
    req.url = url.pathname + url.search; req.method = route.request().method()
    req.headers = await route.request().allHeaders()
    const res = new ServerResponse(req); res.assignSocket(socket)
    const chunks: Buffer[] = []
    const end = res.end.bind(res)
    res.end = ((chunk?: unknown) => { if (chunk) chunks.push(Buffer.from(chunk as string)); return end(chunk as never) }) as typeof res.end
    await service.handler(req, res, route.request().postData() ?? '{}')
    const headers: Record<string, string> = {}
    for (const line of ((res as unknown as { _header: string })._header ?? '').split('\r\n').slice(1)) {
      const split = line.indexOf(':'); if (split > 0) headers[line.slice(0, split).toLowerCase()] = line.slice(split + 1).trim()
    }
    await route.fulfill({ status: res.statusCode, headers, body: Buffer.concat(chunks) })
    res.emit('close')
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Make workspace', exact: true }).click()
}

test('two accounts grant, review, edit, downgrade and revoke without leaking private revisions or assets', async ({ page, browser }) => {
  test.setTimeout(90_000)
  const root = await mkdtemp(join(tmpdir(), 'paper-sharing-e2e-'))
  const service = await createService({ root, secret: 'sharing-browser-test-secret-at-least-32-characters', origin: 'http://127.0.0.1:4173' })
  const login = (sub: string) => service.auth.login('github', { sub, email: `${sub}@paper.test`, name: sub, avatar: '' })
  const owner = await login('Owner'), reviewer = await login('Reviewer')
  const reviewerContext = await browser.newContext(), reviewPage = await reviewerContext.newPage()
  try {
    const project = await service.storage.apps.put(owner.user.id, 'review-app', createAppProject({ id: 'review-app', name: 'Shared counter', files: {
      'src/App.tsx': `import {useState} from 'react'; export default function App(){const[n,setN]=useState(0);return <main><h1>For review</h1><button onClick={()=>setN(n+1)}>Count {n}</button></main>}`,
    } }), null)
    await mount(page, service, owner)
    await page.getByRole('combobox', { name: 'Make project', exact: true }).selectOption(project.id)
    const panel = page.getByRole('region', { name: 'Project sharing' })
    await expect(panel.getByLabel('Your Paper account ID')).toHaveValue(owner.user.id)
    await panel.getByLabel('Reviewer Paper account ID').fill(reviewer.user.id)
    await panel.getByRole('button', { name: 'Grant access' }).click()
    await expect(panel.getByText('viewer · r1', { exact: true })).toBeVisible()
    await service.storage.apps.put(owner.user.id, project.id, { ...project, name: 'Private next draft' }, 1)
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><text>Private bytes</text></svg>')
    const secretAsset = await service.storage.apps.uploadAsset(owner.user.id, project.id, 'private.svg', svg, 2)
    await mount(reviewPage, service, reviewer)
    const sharedValue = `shared:${owner.user.id}:${project.id}`
    await reviewPage.getByRole('combobox', { name: 'Make project', exact: true }).selectOption(sharedValue)
    const source = reviewPage.getByRole('textbox', { name: 'Shared source code' })
    await expect(source).toHaveAttribute('readonly', '')
    const preview = reviewPage.frameLocator('iframe')
    await expect(preview.getByRole('heading', { name: 'For review' })).toBeVisible()
    await preview.getByRole('button', { name: 'Count 0' }).click()
    await expect(preview.getByRole('button', { name: 'Count 1' })).toBeVisible()
    await expect(reviewPage.getByText('Private next draft', { exact: true })).toHaveCount(0)
    const base = `/api/shared-apps/${owner.user.id}/${project.id}`
    const request = (suffix: string, method = 'GET', body?: object) => reviewPage.evaluate(async ({ url, method, body }) => {
      const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-Paper-Client': 'web' }, ...(body ? { body: JSON.stringify(body) } : {}) })
      return { status: response.status, text: await response.text() }
    }, { url: base + suffix, method, body })
    expect((await request('', 'PUT', { project, expectedRevision: 1 })).status).toBe(403)
    expect((await request(`/assets/${secretAsset.asset.id}`)).status).toBe(404)
    expect((await request('/release', 'POST')).status).toBe(403)
    // Changing a role must preserve the previously shared snapshot. Sharing
    // newer source and assets requires the separate, explicit Share rN action.
    await page.reload(); await page.getByRole('button', { name: 'Make workspace', exact: true }).click()
    await page.getByRole('combobox', { name: 'Make project', exact: true }).selectOption(project.id)
    await panel.getByRole('combobox', { name: `Role for ${reviewer.user.id}` }).selectOption('editor')
    await expect(panel.getByText('editor · r1', { exact: true })).toBeVisible()
    await reviewPage.getByRole('button', { name: 'Refresh access' }).click()
    await expect(source).not.toHaveAttribute('readonly', '')
    expect((await request('', 'PUT', { project, expectedRevision: 1 })).status).toBe(409)
    expect((await request(`/assets/${secretAsset.asset.id}`)).status).toBe(404)
    expect((await request('')).text).not.toContain('Private next draft')
    await expect(preview.getByRole('heading', { name: 'For review' })).toBeVisible()
    await panel.getByRole('button', { name: 'Share r3', exact: true }).click()
    await expect(panel.getByText('editor · r3', { exact: true })).toBeVisible()
    await reviewPage.getByRole('button', { name: 'Refresh access' }).click()
    await expect(source).not.toHaveAttribute('readonly', '')
    await source.fill(project.files['src/App.tsx'].content.replace('For review', 'Edited together'))
    await reviewPage.getByRole('button', { name: 'Save shared source' }).click()
    await expect(preview.getByRole('heading', { name: 'Edited together' })).toBeVisible()
    expect((await service.storage.apps.read(owner.user.id, project.id))!.revision).toBe(4)
    await page.reload(); await page.getByRole('button', { name: 'Make workspace', exact: true }).click()
    await page.getByRole('combobox', { name: 'Make project', exact: true }).selectOption(project.id)
    await panel.getByRole('combobox', { name: `Role for ${reviewer.user.id}` }).selectOption('viewer')
    await expect(panel.getByText('viewer · r4', { exact: true })).toBeVisible()
    await reviewPage.getByRole('button', { name: 'Refresh access' }).click()
    await expect(source).toHaveAttribute('readonly', '')
    await panel.getByRole('button', { name: 'Revoke', exact: true }).click()
    await expect(panel.getByText('Only you can access this project.')).toBeVisible()
    await reviewPage.getByRole('button', { name: 'Refresh access' }).click()
    await expect(reviewPage.getByRole('alert')).toContainText('Access is no longer available')
    await expect(source).toHaveCount(0)
    await expect(reviewPage.locator('iframe')).toHaveCount(0)
    for (const suffix of ['', '/assets', `/assets/${secretAsset.asset.id}`]) expect((await request(suffix)).status).toBe(404)
    expect((await request('/compile', 'POST')).status).toBe(404)
    expect(await service.storage.apps.publication(owner.user.id, project.id)).toBeNull()
  } finally { await reviewerContext.close(); service.close(); await rm(root, { recursive: true, force: true }) }
})
