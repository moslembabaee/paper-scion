import { test, expect, type Route } from '@playwright/test'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Duplex } from 'node:stream'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createService } from '../server/service'
import { SceneStore } from '../src/scene/store'
import { createProject } from '../src/io/project'
import type { BoundedDesignContext } from '../src/make/design-context'
import { mockStudioSession } from './studio-session'

test('selected nested frame guides a running app, preserves layer IDs and excludes unrelated design data', async ({ page }) => {
  const root = await mkdtemp(join(tmpdir(), 'paper-frame-browser-'))
  const prompts: string[] = []
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const service = await createService({ root, secret: 'frame-browser-secret-with-at-least-32-characters', origin: 'http://127.0.0.1:4173',
    modelGateway: { provider: 'mock', tokenBudget: 500000, customAdapter: async request => {
      prompts.push(request.prompt)
      if (request.context?.mode === 'plan') return { content: JSON.stringify({ summary: 'Build the selected profile card',
        files: [{ path: 'src/App.tsx', description: 'Interactive selected frame', action: 'modify' }, { path: 'src/styles.css', description: 'Frame styling', action: 'modify' }],
        interactions: ['Save changes the button label'], risks: [] }) }
      // Deterministic model transport derives output from the actual bounded prompt.
      const snapshot = JSON.parse(request.prompt.match(/Snapshot geometry[^\n]*\n([^\n]+)/)![1]) as BoundedDesignContext
      const title = snapshot.elements.find(element => element.type === 'text')!
      return { content: JSON.stringify({ summary: 'Frame card', files: [
        { path: 'src/App.tsx', content: `import { useState } from 'react'; import './styles.css';
          export default function App() { const [saved, setSaved] = useState(false); return <main data-layer-id="${snapshot.frameId}">
          <h1 data-layer-id="${title.id}">${title.text}</h1><button data-layer-id="save" onClick={() => setSaved(true)}>{saved ? 'Saved' : 'Save'}</button></main> }` },
        { path: 'src/styles.css', content: `body { margin:0; } main { display:flex; flex-direction:${snapshot.layout?.direction === 'vertical' ? 'column' : 'row'};
          gap:${snapshot.layout?.gap}px; padding:${snapshot.layout?.padding.top}px; background:${snapshot.fill}; border-radius:${snapshot.cornerRadius}px; }
          h1 { color:${title.style.fill}; font-size:${title.fontSize}px; } button { background:#81adec; }` },
      ] }) }
    } },
  })
  const { user, session } = await service.auth.login('github', { sub: 'frame-browser', email: 'frame@paper.test', name: 'Designer', avatar: '' })
  const responses: ServerResponse[] = []
  try {
    await mockStudioSession(page)
    await page.route('**/api/auth/session', route => route.fulfill({ json: { user: service.auth.profile(user), providers: { github: true } } }))
    const relay = async (route: Route) => {
      const socket = new Duplex({ read() {}, write(_chunk, _encoding, callback) { callback() } })
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
    await page.route(/\/api\/(?:projects|apps|model)(?:\/|$)/, relay)
    await page.goto('/')
    const store = new SceneStore()
    store.addToken({ id: 'card-fill', name: 'card-fill', type: 'color', value: '#edebe1' })
    store.add('frame', { id: 'outer', width: 600, height: 500 })
    store.add('frame', { id: 'card', parentId: 'outer', x: 40, y: 40, name: 'Selected profile', width: 400, height: 280, cornerRadius: 12,
      layout: { direction: 'vertical', gap: 16, padding: { top: 24, right: 24, bottom: 24, left: 24 }, justify: 'start', align: 'start' } })
    store.bindToken('card', 'fill', 'card-fill')
    store.add('text', { id: 'title', parentId: 'card', text: 'Profile from frame', fontSize: 24, width: 300, height: 32, style: { fill: '#080808' } })
    store.add('frame', { id: 'save', parentId: 'card', width: 120, height: 40 })
    store.add('text', { id: 'private', parentId: 'outer', text: 'SECRET_UNRELATED_DATA', y: 400 })
    const designDocument = createProject(store, 'Frame browser fixture', { x: 0, y: 0, zoom: 1 }, true)
    await page.getByLabel('Open or import file').setInputFiles({ name: 'frame.paper.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(designDocument)) })
    const frame = page.locator('.scene-node[data-element-id="card"]')
    await expect(frame).toBeVisible()
    await frame.click({ position: { x: 370, y: 240 } })
    await expect(frame).toHaveClass(/is-selected/)
    await expect(page.getByText('Saved to Cloud', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Make workspace', exact: true }).click()
    const attachment = page.getByRole('checkbox', { name: 'Use selected frame' })
    await expect(attachment).toBeChecked()
    await expect(page.getByText('Use selected frame ·')).toContainText('Selected profile')
    await page.getByRole('textbox', { name: 'Prompt for app planning' }).fill('Build this card')
    await page.getByRole('button', { name: 'Generate plan', exact: true }).click()
    await expect(page.getByText(/Snapshot · 3 layers · 1 tokens · 0 assets/)).toBeVisible()
    await page.getByRole('button', { name: 'Approve plan', exact: true }).click()
    await page.getByRole('button', { name: 'Generate app', exact: true }).click()
    const preview = page.frameLocator('iframe').frameLocator('iframe')
    const main = preview.locator('[data-layer-id="card"]')
    await expect(preview.getByRole('heading', { name: 'Profile from frame' })).toHaveAttribute('data-layer-id', 'title')
    await expect(main).toHaveCSS('background-color', 'rgb(237, 235, 225)')
    await expect(main).toHaveCSS('gap', '16px')
    await expect(main).toHaveCSS('padding-top', '24px')
    await expect(main).toHaveCSS('border-radius', '12px')
    await preview.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(preview.getByRole('button', { name: 'Saved', exact: true })).toBeVisible()
    for (const prompt of prompts) {
      expect(prompt).toContain('card-fill')
      expect(prompt).not.toContain('SECRET_UNRELATED_DATA')
      expect(prompt).not.toContain('"outer"')
      expect(prompt).not.toContain('"private"')
    }
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await attachment.uncheck()
    await expect(page.getByRole('region', { name: 'App plan', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'Design workspace', exact: true }).click()
    await expect(frame).toHaveClass(/is-selected/)
    expect(errors).toEqual([])
  } finally {
    service.close()
    for (const res of responses) res.emit('close')
    await rm(root, { recursive: true, force: true })
  }
})
