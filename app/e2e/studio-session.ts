import type { Page } from '@playwright/test'
import type { CloudProject, CloudUser } from '../src/cloud/model'

/** Editor tests enter through the same session guard as real users. */
export async function mockStudioSession(page: Page) {
  let user: CloudUser = { id: 'studio-test', name: 'Paper Designer', email: 'designer@paper.test', avatar: '', provider: 'github', createdAt: 1, hasMcpToken: false }
  const projects = new Map<string, CloudProject>()
  let revision = 0
  await page.route('**/api/auth/session', route => route.fulfill({ json: { user, providers: { google: true, github: true } } }))
  await page.route('**/api/auth/profile', async route => {
    user = { ...user, ...route.request().postDataJSON() }
    await route.fulfill({ json: { user } })
  })
  await page.route('**/api/events?*', route => route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': connected\n\n' }))
  await page.route('**/api/projects', route => route.fulfill({ json: { projects: [...projects.values()].map(({ id, revision }) => ({ id, revision })) } }))
  await page.route('**/api/projects/*', async route => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop()!)
    if (route.request().method() === 'PUT') {
      const input = route.request().postDataJSON()
      const project: CloudProject = { id, document: input.document, revision: `studio-${++revision}`, updatedAt: input.updatedAt, createdAt: projects.get(id)?.createdAt ?? Date.now() }
      projects.set(id, project)
      await route.fulfill({ json: project })
    } else await route.fulfill({ status: projects.has(id) ? 200 : 404, json: projects.get(id) ?? { error: 'Not found' } })
  })
}
