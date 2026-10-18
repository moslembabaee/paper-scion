import { test, expect, type Page } from '@playwright/test'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Duplex } from 'node:stream'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { createService } from '../server/service'
import { mockStudioSession } from './studio-session'

async function setup(page: Page) {
  const root = await mkdtemp(join(tmpdir(), 'paper-source-export-e2e-'))
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

// No scripted validation pass in this test: approval must use real isolated
// Chromium checks, then a real local install, build, start, render and click.
test('downloads the exact saved app, unzips/builds/starts locally and keeps assets offline', async ({ page }) => {
  test.setTimeout(90_000)
  const f = await setup(page)
  const dir = await mkdtemp(join(tmpdir(), 'paper-export-browser-'))
  let child: ReturnType<typeof spawn> | undefined
  try {
    const panel = page.getByRole('region', { name: 'Runnable source', exact: true })
    await expect(panel.getByRole('button', { name: 'Download source ZIP' })).toBeDisabled()
    await page.getByRole('button', { name: 'New app', exact: true }).click()
    await page.getByRole('button', { name: 'Save a copy', exact: true }).click()
    await expect(page.getByText('Saved to your account', { exact: true })).toBeVisible()
    const id = await page.getByRole('combobox', { name: 'Make project' }).inputValue()
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=', 'base64')
    const { asset, project } = await f.service.storage.apps.uploadAsset(f.user.id, id, 'logo.png', png, 1)
    await f.service.storage.apps.put(f.user.id, id, { ...project, files: {
      'src/App.tsx': { path: 'src/App.tsx', content: `import {useState} from 'react'; import {Plus} from 'lucide-react'; export default function App(){const[n,setN]=useState(0);return <main><h1>Exported app</h1><img alt="Local logo" src="paper-asset:${asset.id}"/><button onClick={()=>setN(n+1)}><Plus/>Count {n}</button></main>}` },
    } }, project.revision)
    await page.reload()
    await page.getByRole('button', { name: 'Make workspace', exact: true }).click()
    await page.getByRole('combobox', { name: 'Make project' }).selectOption(id)
    await expect(panel).toContainText('saved revision 3')
    const downloading = page.waitForEvent('download')
    await panel.getByRole('button', { name: 'Download source ZIP' }).click()
    const download = await downloading
    expect(download.suggestedFilename()).toBe(`${id}-r3.zip`)
    await download.saveAs(join(dir, 'app.zip'))
    for (const [cmd, args] of [
      ['unzip', ['-q', 'app.zip']],
      ['npm', ['ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--logs-dir', dir]],
      ['npm', ['run', 'build', '--logs-dir', dir]],
    ] as [string, string[]][]) {
      const result = spawnSync(cmd, args, { cwd: dir, encoding: 'utf8', timeout: 30_000 })
      expect(result.status, result.stdout + result.stderr).toBe(0)
    }
    child = spawn('npm', ['start', '--logs-dir', dir], { cwd: dir, env: { ...process.env, PORT: '0' },
      detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
    const url = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Local npm start did not become ready')), 10_000)
      let output = ''
      child!.stdout!.on('data', chunk => {
        output += chunk
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+/)
        if (match) { clearTimeout(timer); resolve(match[0]) }
      })
      child!.once('exit', code => { clearTimeout(timer); reject(new Error(`Local npm start exited: ${code}`)) })
    })
    // Remove Paper's route interception before navigating to the standalone app.
    await page.unrouteAll({ behavior: 'wait' })
    await page.goto(url)
    await expect(page.getByRole('heading', { name: 'Exported app' })).toBeVisible()
    await expect(page.getByAltText('Local logo')).toHaveJSProperty('naturalWidth', 1)
    await page.getByRole('button', { name: 'Count 0' }).click()
    await expect(page.getByRole('button', { name: 'Count 1' })).toBeVisible()
    expect((await f.service.storage.apps.read(f.user.id, id))!.revision).toBe(3)
  } finally {
    if (child?.pid) {
      // npm spawns the host through a shell. Close the whole local process group
      // so the acceptance test cannot leave its server or stdio pipes running.
      try {
        if (process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM')
        else child.kill('SIGTERM')
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
    }
    await f.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('validation failure produces an actionable error and no source download', async ({ page }) => {
  const f = await setup(page)
  try {
    await page.getByRole('button', { name: 'New app', exact: true }).click()
    await page.getByRole('button', { name: 'Save a copy', exact: true }).click()
    await expect(page.getByText('Saved to your account', { exact: true })).toBeVisible()
    await page.route('**/api/apps/*/export/approve', route => route.fulfill({ status: 422, json: { error: 'Source export browser validation failed. Fix the app and retry.' } }))
    let downloads = 0
    page.on('download', () => { downloads++ })
    const panel = page.getByRole('region', { name: 'Runnable source', exact: true })
    await panel.getByRole('button', { name: 'Download source ZIP' }).click()
    await expect(panel.getByRole('alert')).toContainText('Fix the app and retry')
    await expect(panel.getByRole('button', { name: 'Download source ZIP' })).toBeEnabled()
    expect(downloads).toBe(0)
  } finally { await f.close() }
})
