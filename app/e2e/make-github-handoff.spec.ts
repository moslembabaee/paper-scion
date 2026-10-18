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
import { githubFixture, githubToken } from '../server/tests/github-fixture.mjs'

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

test('owner connects, reviews dry-run diff, and commits only with explicit consent', async ({ page }) => {
  test.setTimeout(90_000)
  const root = await mkdtemp(join(tmpdir(), 'paper-github-handoff-e2e-'))
  const github = githubFixture()
  const service = await createService({
    root,
    secret: 'github-browser-test-secret-at-least-32-chars',
    origin: 'http://127.0.0.1:4173',
    fetch: github.fetch,
    appValidator: async () => ({ status: 'passed', diagnostics: [], viewports: [], screenshots: [] }),
  })
  const owner = await service.auth.login('github', { sub: 'Owner', email: 'owner@paper.test', name: 'Owner', avatar: '' })

  try {
    const project = await service.storage.apps.put(owner.user.id, 'github-app', createAppProject({
      id: 'github-app',
      name: 'GitHub Export Demo',
      files: {
        'src/App.tsx': `export default function App() { return <main><h1>Handoff source</h1></main> }`,
      },
    }), null)

    await mount(page, service, owner)
    await page.getByRole('combobox', { name: 'Make project', exact: true }).selectOption(project.id)

    const section = page.getByRole('region', { name: 'GitHub handoff' })
    await expect(section).toBeVisible()

    // Open configuration details
    await section.getByText('Choose repository & branch').click()

    // Fill repository, branch, token
    await section.getByLabel('GitHub repository').fill('owner/demo')
    await section.getByLabel('GitHub branch').fill('main')
    await section.getByLabel('GitHub access token').fill(githubToken)

    // Connect
    await section.getByRole('button', { name: 'Connect for review' }).click()
    await expect(section.getByText('Connected · Review first, confirm second.')).toBeVisible()

    // Button: Show dry-run diff
    const reviewBtn = section.getByRole('button', { name: 'Show dry-run diff' })
    await expect(reviewBtn).toBeEnabled()
    await reviewBtn.click()

    // Dry-run diff should appear
    const diffRegion = section.getByLabel('GitHub dry-run diff')
    await expect(diffRegion).toBeVisible()
    await expect(diffRegion).toContainText('REVIEWED REVISION 1')
    await expect(diffRegion).toContainText('owner/demo')

    // Commit button should be disabled until consent is checked
    const commitBtn = diffRegion.getByRole('button', { name: /Confirm & commit revision 1/ })
    await expect(commitBtn).toBeDisabled()

    // Consent checkbox
    const consentBox = diffRegion.getByRole('checkbox')
    await consentBox.check()
    await expect(commitBtn).toBeEnabled()

    // Confirm and commit
    await commitBtn.click()

    // Status updates and commit link appears
    await expect(section.getByText(/Revision 1 committed ·/)).toBeVisible()
    const commitLink = section.getByRole('link', { name: 'View commit on GitHub' })
    await expect(commitLink).toBeVisible()
    await expect(commitLink).toHaveAttribute('href', /https:\/\/github\.com\/owner\/demo\/commit\//)

    // Disconnect & revoke review
    const revokeBtn = section.getByRole('button', { name: 'Disconnect & revoke review' })
    await revokeBtn.click()
    await expect(section.getByText('Owner only · No writes before confirmation')).toBeVisible()
  } finally {
    service.close()
    await rm(root, { recursive: true, force: true })
  }
})
