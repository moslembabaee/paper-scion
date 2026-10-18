import { test, expect, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { mockStudioSession } from './studio-session'
import { createAppProject } from '../src/make/manifest'
import { compileAppProject } from '../src/make/compiler'

const initial = createAppProject({ id: 'annotation-app', name: 'Annotation study', files: {
  'src/App.tsx': `import { useState } from 'react'
    import Left from './left/Item'; import Right from './right/Item'
    export default function App() {
      const [count, setCount] = useState(0)
      const [reverse, setReverse] = useState(false)
      return <main style={{padding:24}}><h1>Target study</h1>
        <button onClick={() => setCount(c => c + 1)}>Count: {count}</button>
        <button onClick={() => setReverse(r => !r)}>Reverse</button>
        <Left /><Right />
        {(reverse ? ['Beta', 'Alpha'] : ['Alpha', 'Beta']).map(label => <button key={label}><span>{label}</span></button>)}
      </main>
    }`,
  'src/left/Item.tsx': 'export default () => <button>Left item</button>',
  'src/right/Item.tsx': 'export default () => <button>Right item</button>',
} })

async function setup(page: Page) {
  let disk = structuredClone(initial)
  const prompts: string[] = []
  await page.route('http://127.0.0.1:4173/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path.startsWith('/api/')) return route.fallback()
    const file = new URL(`../dist${path === '/' ? '/index.html' : path}`, import.meta.url)
    await route.fulfill({ body: await readFile(file), contentType: path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html' })
  })
  await mockStudioSession(page)
  await page.route('**/api/model/budget', route => route.fulfill({ status: 503, json: { error: 'Offline' } }))
  await page.route('**/api/apps', route => route.fulfill({ json: { apps: [disk] } }))
  await page.route('**/api/apps/annotation-app', async route => {
    if (route.request().method() === 'PUT') {
      const input = route.request().postDataJSON()
      expect(input.expectedRevision).toBe(disk.revision)
      disk = { ...input.project, revision: disk.revision + 1 }
    }
    await route.fulfill({ json: disk })
  })
  await page.route('**/api/apps/compile', async route => route.fulfill({ json: await compileAppProject(route.request().postDataJSON().project) }))
  await page.route('**/api/**/plan', async route => {
    prompts.push(route.request().postDataJSON().prompt)
    await route.fulfill({ status: 503, json: { error: 'Offline planner' } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Make workspace', exact: true }).click()
  await page.getByRole('combobox', { name: 'Make project' }).selectOption(disk.id)
  return { disk: () => disk, prompts }
}

async function run(page: Page) {
  await page.getByRole('button', { name: 'Run preview', exact: true }).click()
  await expect(page.getByTestId('make-preview-status')).toHaveText('Running')
  return page.frameLocator('iframe').frameLocator('iframe')
}

test('selects a unique stable target after React rerender and keyed reorder, saves notes and includes them in the next prompt after reload', async ({ page }) => {
  const f = await setup(page)
  const preview = await run(page)
  const select = page.getByRole('button', { name: 'Select element', exact: true })
  await preview.getByRole('button', { name: 'Count: 0', exact: true }).click()
  await expect(preview.getByRole('button', { name: 'Count: 1' })).toBeVisible()
  await select.click()
  await preview.getByRole('button', { name: 'Count: 1' }).click()
  const target = page.getByTestId('make-selected-target')
  const firstId = await target.getAttribute('data-element-id')
  expect(firstId).toBeTruthy()
  await select.click()
  await preview.getByRole('button', { name: 'Count: 1' }).click()
  await select.click()
  await preview.getByRole('button', { name: 'Count: 2' }).click()
  await expect(target).toHaveAttribute('data-element-id', firstId!)
  await expect(preview.getByRole('button', { name: 'Count: 2' })).toBeVisible()
  await expect(preview.locator('#__paper_inspect_highlight')).toBeVisible()
  // Same JSX site renders twice. Both instances must have different identities.
  await preview.getByRole('button', { name: 'Alpha', exact: true }).click()
  const alphaId = await target.getAttribute('data-element-id')
  await preview.getByRole('button', { name: 'Beta', exact: true }).click()
  const betaId = await target.getAttribute('data-element-id')
  expect(betaId).not.toBe(alphaId)
  await select.click()
  await preview.getByRole('button', { name: 'Reverse', exact: true }).click()
  await select.click()
  await preview.getByRole('button', { name: 'Alpha', exact: true }).click()
  await expect(target).toHaveAttribute('data-element-id', alphaId!)
  await preview.getByRole('button', { name: 'Left item' }).click()
  const leftId = await target.getAttribute('data-element-id')
  await preview.getByRole('button', { name: 'Right item' }).click()
  expect(await target.getAttribute('data-element-id')).not.toBe(leftId)
  await page.getByRole('textbox', { name: 'Annotation text' }).fill('Use #81adec for this action')
  await page.getByRole('button', { name: 'Save annotation', exact: true }).click()
  await expect(page.getByText('All annotations saved', { exact: true })).toBeVisible()
  expect(f.disk().annotations).toHaveLength(1)
  const savedId = f.disk().annotations![0].elementId
  await page.reload()
  await page.getByRole('button', { name: 'Make workspace', exact: true }).click()
  await page.getByRole('combobox', { name: 'Make project' }).selectOption(initial.id)
  await expect(page.getByText('Use #81adec for this action', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Include in prompt', exact: true }).click()
  await expect(page.getByTestId('make-prompt-input')).toHaveValue(new RegExp(savedId))
  await page.getByRole('button', { name: 'Generate plan', exact: true }).click()
  await expect.poll(() => f.prompts.length).toBe(1)
  expect(f.prompts[0]).toContain('Use #81adec for this action')
  expect(f.prompts[0]).toContain(savedId)
})

test('ignores cross-origin, sibling, direct guest and malformed selections and selections outside inspect mode', async ({ page }) => {
  await setup(page)
  const preview = await run(page)
  const envelope = { channel: 'paper-make-preview', version: 1, source: 'paper-preview', type: 'preview:element-selected', id: 'spoof', timestamp: 1, payload: { elementId: 'spoof', tagName: 'button' } }
  await page.getByRole('button', { name: 'Select element', exact: true }).click()
  await page.evaluate(msg => {
    window.postMessage(msg, '*')
    const frame = document.querySelector('iframe')!
    dispatchEvent(new MessageEvent('message', { data: msg, source: frame.contentWindow, origin: 'https://attacker.invalid' }))
    const sibling = document.createElement('iframe'); document.body.append(sibling)
    sibling.contentWindow!.eval('parent.postMessage(' + JSON.stringify(msg) + ', "*")')
    sibling.remove()
  }, envelope)
  await preview.locator('main').evaluate((_, msg) => {
    top!.postMessage(msg, '*')
    parent.postMessage({ ...msg, source: 'paper-host' }, '*')
    parent.postMessage({ ...msg, payload: { ...msg.payload, innerHTML: '<img src=x>' } }, '*')
    parent.postMessage({ ...msg, payload: { ...msg.payload, bounds: { x: 0, y: 0, width: 2, height: 2, html: '<script>' } } }, '*')
  }, envelope)
  await page.waitForTimeout(150)
  await expect(page.getByTestId('make-selected-target')).toHaveCount(0)
  await preview.getByRole('button', { name: 'Count: 0' }).click()
  await expect(page.getByTestId('make-selected-target')).toContainText('button')
  const id = await page.getByTestId('make-selected-target').getAttribute('data-element-id')
  await page.getByRole('button', { name: 'Select element', exact: true }).click()
  await preview.locator('main').evaluate((_, msg) => parent.postMessage(msg, '*'), envelope)
  await page.waitForTimeout(150)
  await expect(page.getByTestId('make-selected-target')).toHaveAttribute('data-element-id', id!)
  expect(await page.evaluate(() => localStorage.getItem('paper-private'))).toBeNull()
})
