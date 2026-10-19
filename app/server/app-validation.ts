import { chromium, type Browser, type BrowserServer } from 'playwright'
import type { CompileDiagnostic, CompilePreviewAssets } from '../src/make/compiler.ts'
import { PREVIEW_PERMISSIONS_POLICY, PREVIEW_SANDBOX_POLICY, parsePreviewMessage } from '../src/make/preview-sandbox.ts'
import { PREVIEW_VIEWPORTS } from '../src/make/breakpoints.ts'
import type { AppValidationAttempt } from '../src/make/types.ts'
import { redactSensitiveText } from '../src/make/model-protocol.ts'
import {
  VALIDATION_LIMITS,
  boundedDiagnostics,
  type ValidationScreenshot,
  type BrowserValidation,
  type AppBrowserValidator,
} from '../src/make/validation.ts'

export {
  VALIDATION_LIMITS,
  boundedDiagnostics,
  type ValidationScreenshot,
  type BrowserValidation,
  type AppBrowserValidator,
}

// The caller owns the deadline, even if a runner ignores cancellation. Only a
// complete desktop/mobile result may authorize a source write or repair input.
export async function runAppValidation(
  assets: CompilePreviewAssets,
  signal: AbortSignal,
  validator: AppBrowserValidator = validateAppInBrowser,
  options: { timeoutMs?: number; sanitize?: (text: string) => string } = {},
): Promise<BrowserValidation> {
  const controller = new AbortController()
  const blocked = (message: string): BrowserValidation => ({
    status: 'blocked', screenshots: [], viewports: [], diagnostics: [{
      file: assets.entryPoint, line: 1, column: 1, code: 'VALIDATION_BLOCKED', severity: 'error', message,
    }],
  })
  let expired = false
  let onAbort: () => void = () => {}
  const stopped = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new Error('Validation stopped'))
    controller.signal.addEventListener('abort', onAbort, { once: true })
  })
  const cancel = () => controller.abort()
  const timer = setTimeout(() => { expired = true; cancel() }, options.timeoutMs ?? VALIDATION_LIMITS.timeoutMs)
  signal.addEventListener('abort', cancel, { once: true })
  try {
    if (signal.aborted) cancel()
    const validatorPromise = Promise.resolve().then(() => {
      controller.signal.throwIfAborted()
      return validator(assets, controller.signal)
    })
    validatorPromise.catch(() => {})
    let result: BrowserValidation
    try {
      result = await Promise.race([
        stopped,
        validatorPromise,
      ])
    } catch {
      try {
        const graceMs = Math.min(50, options.timeoutMs ?? 50)
        await Promise.race([
          validatorPromise,
          new Promise(resolve => setTimeout(resolve, graceMs)),
        ])
      } catch {}
      return blocked(expired ? 'Browser validation exceeded its fixed time limit.' : signal.aborted ? 'Browser validation cancelled.' : 'Browser validation could not complete.')
    }
    controller.signal.throwIfAborted()
    if (result.status === 'blocked') return blocked('Browser validation could not complete. The previous revision is unchanged.')
    if (!['passed', 'failed'].includes(result.status) ||
        !Array.isArray(result.diagnostics) || !Array.isArray(result.viewports) || !Array.isArray(result.screenshots) ||
        result.viewports.length !== 2 || result.screenshots.length !== 2 ||
        result.status === 'passed' && result.diagnostics.some(d => d.severity === 'error') ||
        result.status === 'failed' && !result.diagnostics.some(d => d.severity === 'error')) {
      return blocked('Browser validation returned incomplete or inconsistent evidence.')
    }
    const screenshots: ValidationScreenshot[] = []
    const viewports: AppValidationAttempt['viewports'][number][] = []
    for (const viewport of ['desktop', 'mobile'] as const) {
      const summary = result.viewports.filter(v => v.viewport === viewport)
      const images = result.screenshots.filter(s => s.viewport === viewport)
      const size = PREVIEW_VIEWPORTS[viewport]
      if (summary.length !== 1 || images.length !== 1 ||
          summary[0].width !== size.width || summary[0].height !== size.height) {
        return blocked('Browser validation requires desktop and mobile evidence at the approved sizes.')
      }
      const dataUrl = images[0].dataUrl
      if (typeof dataUrl !== 'string' || dataUrl.length > Math.ceil(VALIDATION_LIMITS.maxScreenshotBytes / 3) * 4 + 23 ||
          !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl)) {
        return blocked('Browser validation screenshot exceeded its budget or used an invalid format.')
      }
      const bytes = Buffer.from(dataUrl.slice(23), 'base64')
      if (!bytes.length || bytes.length > VALIDATION_LIMITS.maxScreenshotBytes || bytes.length !== summary[0].screenshotBytes ||
          bytes.toString('base64') !== dataUrl.slice(23) || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
        return blocked('Browser validation screenshot evidence is invalid.')
      }
      screenshots.push({ viewport, dataUrl })
      viewports.push({ viewport, width: summary[0].width, height: summary[0].height, screenshotBytes: bytes.length })
    }
    return { status: result.status, diagnostics: boundedDiagnostics(result.diagnostics, options.sanitize ?? redactSensitiveText), screenshots, viewports }
  } catch {
    return blocked(expired ? 'Browser validation exceeded its fixed time limit.' : signal.aborted ? 'Browser validation cancelled.' : 'Browser validation could not complete.')
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', cancel)
    controller.signal.removeEventListener('abort', onAbort)
  }
}

// No cookies, host UI, account data, filesystem screenshots, or network access.
// Browser failures fail closed; they are never treated as a passing compile.
let activeBrowsers = 0
export const validateAppInBrowser: AppBrowserValidator = async (assets, signal) => {
  const diagnostics: CompileDiagnostic[] = []
  const screenshots: ValidationScreenshot[] = []
  const viewports: AppValidationAttempt['viewports'][number][] = []
  const issue = (code: CompileDiagnostic['code'], message: string) => {
    if (diagnostics.length < VALIDATION_LIMITS.maxDiagnostics) diagnostics.push({ file: assets.entryPoint, line: 1, column: 1, code, severity: 'error', message: message.slice(0, VALIDATION_LIMITS.maxMessageChars) })
  }
  if (activeBrowsers >= 2) {
    issue('VALIDATION_BLOCKED', 'Validation capacity is busy. Try again after the active checks finish.')
    return { status: 'blocked', diagnostics, screenshots, viewports }
  }
  activeBrowsers++
  let browser: Browser | undefined
  let server: BrowserServer | undefined
  let expired = false
  const stop = () => { expired = true; try { server?.process().kill('SIGKILL') } catch {} }
  const timer = setTimeout(stop, VALIDATION_LIMITS.timeoutMs)
  signal.addEventListener('abort', stop, { once: true })
  try {
    signal.throwIfAborted()
    server = await chromium.launchServer({ headless: true, timeout: 5000, args: ['--force-webrtc-ip-handling-policy=disable_non_proxied_udp'], ...(process.env.PAPER_VALIDATION_CHROMIUM ? { executablePath: process.env.PAPER_VALIDATION_CHROMIUM } : {}) })
    browser = await chromium.connect(server.wsEndpoint(), { timeout: 3000 })
    if (expired || signal.aborted) { stop(); throw new Error('Stopped') }

    const runViewport = async (viewport: 'desktop' | 'mobile') => {
      const size = PREVIEW_VIEWPORTS[viewport]
      const width = Number(size.width), height = Number(size.height)
      const context = await browser!.newContext({ viewport: { width, height }, serviceWorkers: 'block', acceptDownloads: false, permissions: [] })
      await context.route('**/*', route => route.abort())
      const page = await context.newPage()
        page.setDefaultTimeout(3000)
        page.on('pageerror', error => issue('RUNTIME_ERROR', `${viewport}: ${error.message}`))
        page.on('console', message => {
          if (message.type() === 'error') {
            const text = message.text()
            if (text.includes('Unrecognized Content-Security-Policy directive')) return
            issue('RUNTIME_ERROR', `${viewport}: ${text}`)
          }
        })
        await page.exposeFunction('__paperValidationError', (raw: unknown) => {
          const parsed = parsePreviewMessage(raw, 'paper-preview')
          if (parsed.valid && parsed.message.type === 'preview:error') issue('RUNTIME_ERROR', `${viewport}: ${(parsed.message.payload as { message: string }).message}`)
        })
        await page.setContent('<html><body style="margin:0;background:#080808"><iframe style="border:0;width:100vw;height:100vh;display:block"></iframe></body></html>')
        await page.evaluate(({ html, sandbox, allow }) => {
          const frame = document.querySelector('iframe')!
          frame.setAttribute('sandbox', sandbox)
          frame.setAttribute('allow', allow)
          frame.setAttribute('referrerpolicy', 'no-referrer')
          let windowStart = Date.now(), count = 0
          window.addEventListener('message', event => {
            const now = Date.now()
            if (now - windowStart >= 1000) { windowStart = now; count = 0 }
            if (++count > 120) return
            if (event.source === frame.contentWindow && event.origin === 'null') {
              void (window as unknown as { __paperValidationError: (raw: unknown) => Promise<void> }).__paperValidationError(event.data)
            }
          })
          frame.srcdoc = html
        }, { html: assets.html, sandbox: PREVIEW_SANDBOX_POLICY, allow: PREVIEW_PERMISSIONS_POLICY })
        const frame = page.frameLocator('iframe')
        // The compiler's ready message precedes React's commit. Require a real,
        // visible render and observe delayed errors before deciding success.
        let visibleTimer: ReturnType<typeof setTimeout> | undefined
        try {
          await Promise.race([
            frame.locator('#root').locator(':scope > *').first().waitFor({ state: 'visible', timeout: 2500 }),
            new Promise<void>(resolve => {
              const check = () => {
                if (diagnostics.some(d => d.severity === 'error')) resolve()
                else visibleTimer = setTimeout(check, 50)
              }
              visibleTimer = setTimeout(check, 50)
            }),
          ])
        } catch {
          issue('RUNTIME_ERROR', `${viewport}: App did not render visible content within 2.5 seconds.`)
        } finally {
          clearTimeout(visibleTimer)
        }
        await page.waitForTimeout(350)
        const overflow = await frame.locator('html').evaluate(node => {
          const w = window.innerWidth
          if (node.scrollWidth > w + 1) return true
          if (document.body && document.body.scrollWidth > w + 1) return true
          const root = document.getElementById('root')
          if (root && root.scrollWidth > w + 1) return true
          for (const el of document.querySelectorAll('#root *')) {
            const rect = el.getBoundingClientRect()
            if (rect.right > w + 1) return true
          }
          return false
        }, undefined, { timeout: 1000 }).catch(() => false)
        if (overflow) issue('VISUAL_ERROR', `${viewport}: Content overflows the viewport horizontally.`)
        const capture = await page.screenshot({ type: 'jpeg', quality: 35, timeout: 2000 })
        // Resize only on the trusted, empty parent. Never expose image bytes to
        // the generated frame, and never take a screenshot of the Paper host.
        const dataUrl = await page.evaluate(async ({ encoded, limit }) => {
          const image = new Image()
          image.src = 'data:image/jpeg;base64,' + encoded
          await image.decode()
          const canvas = document.createElement('canvas')
          canvas.width = Math.round(image.width / 2); canvas.height = Math.round(image.height / 2)
          canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height)
          for (const quality of [0.5, 0.25, 0.1]) {
            const data = canvas.toDataURL('image/jpeg', quality)
            if (data.length <= Math.floor(limit * 4 / 3) + 23) return data
          }
          return ''
        }, { encoded: capture.toString('base64'), limit: VALIDATION_LIMITS.maxScreenshotBytes })
        if (!dataUrl) throw new Error('Screenshot budget exceeded')
        return {
          screenshot: { viewport, dataUrl },
          viewport: { viewport, width, height, screenshotBytes: Buffer.from(dataUrl.split(',')[1], 'base64').byteLength },
        }
    }

    const results = await Promise.all([runViewport('desktop'), runViewport('mobile')])
    for (const item of results) {
      screenshots.push(item.screenshot)
      viewports.push(item.viewport)
    }
    return { status: diagnostics.length ? 'failed' : 'passed', diagnostics, screenshots, viewports }
  } catch {
    issue('VALIDATION_BLOCKED', expired ? 'Browser validation exceeded its fixed time limit.' : signal.aborted ? 'Browser validation cancelled.' : 'Browser validation unavailable or screenshot capture failed. Install the matching Playwright Chromium browser and retry.')
    return { status: 'blocked', diagnostics, screenshots: [], viewports }
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', stop)
    if (expired || signal.aborted) {
      try { server?.process().kill('SIGKILL') } catch {}
    }
    await browser?.close().catch(() => {})
    await server?.close().catch(() => {})
    activeBrowsers--
  }
}
