import { test, expect } from '@playwright/test'
import { compileAppProject } from '../src/make/compiler'
import { createAppProject } from '../src/make/manifest'
import { runAppValidation } from '../server/app-validation'

// Actual browser execution is required. An infrastructure blocker fails these
// tests; scripted API fixtures are deliberately not used in this suite.
async function check(content: string) {
  const project = createAppProject({ files: { 'src/App.tsx': content } })
  const result = await compileAppProject(project)
  expect(result.success).toBe(true)
  return runAppValidation(result.assets!, new AbortController().signal)
}

test('runtime crash never passes and captures only the isolated app at both sizes', async () => {
  const result = await check('export default function App() { throw new Error("runtime fixture crash") }')
  expect(result.status).toBe('failed')
  expect(result.diagnostics.some(d => d.message.includes('runtime fixture crash'))).toBe(true)
  expect(result.viewports.map(v => v.viewport)).toEqual(['desktop', 'mobile'])
  expect(result.screenshots).toHaveLength(2)
  expect(result.viewports.every(v => v.screenshotBytes > 0 && v.screenshotBytes <= 12000)).toBe(true)
})

test('a repaired visible app passes desktop/mobile checks', async () => {
  const result = await check('export default () => <main style={{padding:24}}>Repaired fixture</main>')
  expect(result.status).toBe('passed')
  expect(result.diagnostics).toEqual([])
  expect(result.viewports.map(v => [v.width, v.height])).toEqual([[1280, 800], [390, 844]])
})

test('a candidate that hangs its renderer stops at the fixed deadline without passing or returning captures', async () => {
  const result = await check('export default function App() { while (true) {} }')
  expect(result.status).toBe('blocked')
  expect(result.diagnostics.some(d => d.code === 'VALIDATION_BLOCKED')).toBe(true)
  expect(result.screenshots).toEqual([])
})

test('blank renders, delayed rejections, mobile overflow and denied network calls cannot be green', async () => {
  for (const source of [
    'export default () => null',
    'setTimeout(() => { Promise.reject(new Error("delayed failure")) }, 100); export default () => <main>Waiting</main>',
    'export default () => <main style={{width:1000}}>Too wide on mobile</main>',
    'fetch("https://example.invalid/steal"); export default () => <main>Network denied</main>',
  ]) {
    const result = await check(source)
    expect(result.status).toBe('failed')
    expect(result.diagnostics.length).toBeGreaterThan(0)
  }
})
