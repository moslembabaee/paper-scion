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

test('owner manages encrypted handles and the opaque app can only request scoped signatures', async ({ page }) => {
  test.setTimeout(90_000)
  const root = await mkdtemp(join(tmpdir(), 'paper-secrets-e2e-'))
  const service = await createService({ root, secret: 'secrets-browser-test-master-key-at-least-32-bytes', origin: 'http://127.0.0.1:4173' })
  const owner = await service.auth.login('github', { sub: 'Owner', email: 'owner@paper.test', name: 'Owner', avatar: '' })
  const first = 'browser-only-provisioning-value-at-least-32-bytes'
  const second = 'browser-only-rotated-value-at-least-32-bytes'
  const logs: string[] = [], responses: string[] = []
  let capabilityCalls = 0
  page.on('console', message => logs.push(message.text()))
  page.on('response', response => { if (response.url().includes('/api/apps/')) void response.text().then(text => responses.push(text)).catch(() => {}) })
  page.on('request', request => { if (request.url().includes('/capabilities/')) capabilityCalls++ })
  try {
    await service.storage.apps.put(owner.user.id, 'signer', createAppProject({ id: 'signer', name: 'Private signer', files: {
      'src/App.tsx': `import {useState} from 'react'; export default function App(){
        const[handle,setHandle]=useState(''),[result,setResult]=useState('Ready');
        async function sign(){try{const value=await window.paperCapabilities.invoke(handle,{operation:'hmac-sha256',message:'Hello Paper'});setResult(value.signature)}catch{setResult('Unavailable')}}
        return <main><h1>Private signer</h1><input aria-label="Signing handle" value={handle} onChange={e=>setHandle(e.target.value)}/><button onClick={sign}>Sign message</button><output aria-label="Signature">{result}</output></main>
      }`,
    } }), null)
    await mount(page, service, owner)
    await page.getByRole('combobox', { name: 'Make project', exact: true }).selectOption('signer')
    const panel = page.getByRole('region', { name: 'App secret handles' })
    await panel.getByLabel('New secret', { exact: true }).fill(first)
    await panel.getByRole('button', { name: 'Create handle', exact: true }).click()
    await expect(panel.getByRole('status')).toHaveText('1 active · Values cannot be revealed.')
    await expect(panel.getByLabel('New secret', { exact: true })).toHaveValue('')
    const handle = await panel.locator('li code').innerText()
    expect(handle).toMatch(/^sec_[A-Za-z0-9_-]{32}$/)
    await page.getByRole('button', { name: 'Run preview', exact: true }).click()
    const app = page.frameLocator('iframe[title="Paper Make App Preview"]').frameLocator('iframe[title="Compiled app"]')
    await app.getByLabel('Signing handle').fill(handle)
    await app.getByRole('button', { name: 'Sign message' }).click()
    const output = app.getByLabel('Signature')
    await expect(output).toHaveText(/^[a-f0-9]{64}$/)
    const firstSignature = await output.innerText()
    const beforeSpoof = capabilityCalls
    await page.evaluate(handle => window.postMessage({ channel: 'paper-make-preview', version: 1, source: 'paper-preview', type: 'preview:capability', id: 'spoof', timestamp: Date.now(), payload: { handle, operation: 'hmac-sha256', message: 'spoof' } }, '*'), handle)
    await panel.getByRole('button', { name: 'Rotate', exact: true }).click()
    await panel.getByLabel('Replacement secret', { exact: true }).fill(second)
    await panel.getByRole('button', { name: 'Rotate secret', exact: true }).click()
    await expect(panel.getByText('v2 · active', { exact: true })).toBeVisible()
    expect(capabilityCalls).toBe(beforeSpoof)
    await app.getByRole('button', { name: 'Sign message' }).click()
    await expect(output).not.toHaveText(firstSignature)
    await expect(output).toHaveText(/^[a-f0-9]{64}$/)
    await panel.getByRole('button', { name: 'Revoke handle', exact: true }).click()
    await expect(panel.getByText('v3 · revoked', { exact: true })).toBeVisible()
    await app.getByRole('button', { name: 'Sign message' }).click()
    await expect(output).toHaveText('Unavailable')
    expect(await page.locator('body').innerText()).not.toContain(first)
    expect(await page.locator('body').innerText()).not.toContain(second)
    expect(logs.join('')).not.toContain(first)
    expect(logs.join('')).not.toContain(second)
    expect(responses.join('')).not.toContain(first)
    expect(responses.join('')).not.toContain(second)
    const vault = await readFile(join(root, 'apps', owner.user.id, 'signer', 'secrets.json'), 'utf8')
    expect(vault).not.toContain(first); expect(vault).not.toContain(second)
    expect((await service.storage.apps.read(owner.user.id, 'signer'))!.revision).toBe(1)
  } finally { service.close(); await rm(root, { recursive: true, force: true }) }
})
