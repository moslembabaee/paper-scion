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

test('owner provisions scoped form data; opaque preview persists, enforces quotas and revokes access', async ({ page }) => {
  test.setTimeout(120_000)
  const root = await mkdtemp(join(tmpdir(), 'paper-data-e2e-'))
  const config = { root, secret: 'data-browser-test-master-key-at-least-32-bytes', origin: 'http://127.0.0.1:4173' }
  let service = await createService(config)
  const owner = await service.auth.login('github', { sub: 'Owner', email: 'owner@paper.test', name: 'Owner', avatar: '' })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error' && !message.text().includes('Failed to load resource')) errors.push(message.text()) })
  let dataCalls = 0
  page.on('request', request => { if (/\/data\/dat_/.test(request.url()) && request.method() === 'POST') dataCalls++ })
  try {
    await service.storage.apps.put(owner.user.id, 'form-app', createAppProject({ id: 'form-app', name: 'Field notes', files: {
      'src/App.tsx': `import {useState} from 'react'; import './style.css'; export default function App(){
        const[handle,setHandle]=useState(''),[name,setName]=useState(''),[revision,setRevision]=useState(0),[rows,setRows]=useState([]),[status,setStatus]=useState('Ready');
        async function call(input){try{const result=await window.paperData.invoke(handle,input);setRevision(result.revision);setRows(result.records);setStatus('Saved r'+result.revision)}catch{setStatus('Unavailable')}}
        return <main><small>PAPER / FIELD NOTES</small><h1>A place for ideas.</h1><p>One thought, kept for later.</p>
          <label>Data handle<input aria-label="Data handle" value={handle} onChange={e=>setHandle(e.target.value)}/></label>
          <form onSubmit={e=>{e.preventDefault();call({operation:'create',expectedRevision:revision,value:{name,subscribed:true}})}}>
            <label>Your idea<input aria-label="Your idea" value={name} onChange={e=>setName(e.target.value)}/></label><button>Save idea</button>
          </form><button onClick={()=>call({operation:'list'})}>Load ideas</button>
          <output aria-label="Data status">{status}</output><ul>{rows.map(row=><li key={row.id}>{row.value.name}</li>)}</ul>
        </main>
      }`,
      'src/style.css': 'body{margin:0;background:#edebe1;color:#080808;font:16px system-ui;background-image:linear-gradient(#08080808 1px,transparent 1px),linear-gradient(90deg,#08080808 1px,transparent 1px);background-size:120px 120px}main{max-width:480px;margin:auto;padding:48px 24px}small{letter-spacing:.14em}h1{font-size:42px;font-weight:500;letter-spacing:-.04em}label{display:grid;gap:8px;margin:20px 0;font-size:13px}input{box-sizing:border-box;width:100%;padding:12px;border:1px solid #222222;background:transparent}button{background:#080808;color:#edebe1;padding:12px 16px;border:0;cursor:pointer;margin:0 12px 16px 0}button:focus-visible,input:focus-visible{outline:2px solid #81adec;outline-offset:3px}output{display:block;font-size:13px}li{padding:12px 0}',
    } }), null)
    await mount(page, service, owner)
    await expect(page).toHaveTitle(/Paper/i)
    await page.getByRole('combobox', { name: 'Make project', exact: true }).selectOption('form-app')
    const panel = page.getByRole('region', { name: 'App data capabilities' })
    await panel.getByText('Define a collection', { exact: true }).click()
    await panel.getByLabel('Record limit', { exact: true }).fill('1')
    await panel.getByRole('button', { name: 'Create data capability', exact: true }).click()
    await expect(panel.getByRole('status')).toHaveText('1 active collections · Owner preview only.')
    const handle = await panel.locator('li code').innerText()
    expect(handle).toMatch(/^dat_[A-Za-z0-9_-]{32}$/)
    await page.getByRole('button', { name: 'Run preview', exact: true }).click()
    const app = page.frameLocator('iframe[title="Paper Make App Preview"]').frameLocator('iframe[title="Compiled app"]')
    await app.getByLabel('Data handle').fill(handle)
    await app.getByLabel('Your idea').fill('An idea worth keeping')
    await app.getByRole('button', { name: 'Save idea', exact: true }).click()
    await expect(app.getByLabel('Data status')).toHaveText('Saved r1')
    await expect(app.getByRole('listitem')).toHaveText('An idea worth keeping')
    await app.getByLabel('Your idea').fill('Over quota')
    await app.getByRole('button', { name: 'Save idea', exact: true }).click()
    await expect(app.getByLabel('Data status')).toHaveText('Unavailable')
    await app.getByRole('button', { name: 'Load ideas', exact: true }).click()
    await expect(app.getByLabel('Data status')).toHaveText('Saved r1')
    await expect(app.getByRole('listitem')).toHaveText('An idea worth keeping')
    const beforeSpoof = dataCalls
    await page.evaluate(handle => window.postMessage({ channel: 'paper-make-preview', version: 1, source: 'paper-preview', type: 'preview:data', id: 'spoof', timestamp: Date.now(), payload: { handle, operation: 'list' } }, '*'), handle)
    await panel.getByRole('button', { name: 'Refresh app data', exact: true }).click()
    await expect(panel.getByText(/1 \/ 1 records/)).toBeVisible()
    expect(dataCalls).toBe(beforeSpoof)
    // Reload both service and browser: no record is kept in source or local state.
    service.close(); service = await createService(config)
    await page.unrouteAll({ behavior: 'wait' })
    await mount(page, service, owner)
    await page.getByRole('combobox', { name: 'Make project', exact: true }).selectOption('form-app')
    await page.getByRole('button', { name: 'Run preview', exact: true }).click()
    await app.getByLabel('Data handle').fill(handle)
    await app.getByRole('button', { name: 'Load ideas', exact: true }).click()
    await expect(app.getByLabel('Data status')).toHaveText('Saved r1')
    await expect(app.getByRole('listitem')).toHaveText('An idea worth keeping')
    await app.getByRole('heading', { name: 'A place for ideas.' }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: '/tmp/paper-data-desktop.png' })
    await page.setViewportSize({ width: 390, height: 844 })
    await app.getByRole('button', { name: 'Load ideas', exact: true }).click()
    await expect(app.getByRole('listitem')).toHaveText('An idea worth keeping')
    await page.screenshot({ path: '/tmp/paper-data-mobile.png' })
    await panel.getByRole('button', { name: 'Revoke and erase data', exact: true }).click()
    await expect(panel.getByText('v2 · revoked', { exact: true })).toBeVisible()
    await app.getByRole('button', { name: 'Load ideas', exact: true }).click()
    await expect(app.getByLabel('Data status')).toHaveText('Unavailable')
    expect(await page.locator('vite-error-overlay').count()).toBe(0)
    expect(errors).toEqual([])
    expect((await service.storage.apps.read(owner.user.id, 'form-app'))!.revision).toBe(1)
  } finally { service.close(); await rm(root, { recursive: true, force: true }) }
})
