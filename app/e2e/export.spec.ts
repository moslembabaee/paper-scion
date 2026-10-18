import { readFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import type { Download, Page } from '@playwright/test'
import { waitForCanvasReady } from './helpers'

async function downloadBytes(download: Download): Promise<Buffer> {
  expect(await download.failure()).toBeNull()
  return readFile((await download.path())!)
}

function zipFiles(bytes: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>()
  let offset = 0
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const size = bytes.readUInt32LE(offset + 18), length = bytes.readUInt16LE(offset + 26)
    const name = bytes.subarray(offset + 30, offset + 30 + length).toString()
    const start = offset + 30 + length
    files.set(name, bytes.subarray(start, start + size))
    offset = start + size
  }
  expect(bytes.readUInt32LE(offset)).toBe(0x02014b50)
  return files
}

async function decodedSize(page: Page, bytes: Buffer, mime: string) {
  return page.evaluate(async ({ source, mime }) => {
    const data = Uint8Array.from(atob(source), char => char.charCodeAt(0))
    const bitmap = await createImageBitmap(new Blob([data], { type: mime }))
    const result = { width: bitmap.width, height: bitmap.height }
    bitmap.close()
    return result
  }, { source: bytes.toString('base64'), mime })
}

test.beforeEach(async ({ page }) => { await waitForCanvasReady(page) })

test('live artboard previews, preset validation, and modal focus work', async ({ page }) => {
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const panel = page.getByRole('dialog', { name: 'Ready for the outside.' })
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('checkbox')).toHaveCount(3)
  await expect(panel.getByRole('img', { name: 'Export preview of 01 — A little space' })).toBeVisible()
  const naturalWidth = await panel.getByRole('img').evaluate((img: HTMLImageElement) => img.naturalWidth)
  expect(naturalWidth).toBeGreaterThan(0)
  expect(naturalWidth).toBeLessThanOrEqual(480)
  await panel.getByRole('button', { name: 'Preview 03 — Material studies' }).click()
  await expect(panel.getByRole('img', { name: 'Export preview of 03 — Material studies' })).toBeVisible({ timeout: 15000 })
  await panel.getByRole('button', { name: '2×', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'Export PNG', exact: true })).toBeDisabled()
  await expect(panel).toContainText('Choose at least one asset and scale.')
  await panel.getByRole('button', { name: '3×', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'Export ZIP' })).toBeEnabled()
  await page.keyboard.press('Escape')
  await expect(panel).not.toBeVisible()
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeFocused()
})

test('selected layers download real SVG, PNG, WebP, and PDF without changing selection', async ({ page }) => {
  await page.getByTestId('tool-rectangle').click()
  const selected = page.locator('.scene-node.is-selected')
  const id = await selected.getAttribute('data-element-id')
  for (const format of ['SVG', 'PNG', 'WebP', 'PDF']) {
    await page.getByRole('button', { name: 'Export', exact: true }).click()
    const panel = page.getByRole('dialog')
    await panel.getByRole('button', { name: new RegExp(`^${format}`, 'i') }).click()
    await expect(panel.getByRole('img')).toBeVisible()
    const downloading = page.waitForEvent('download')
    await panel.getByRole('button', { name: `Export ${format.toUpperCase()}`, exact: true }).click()
    const download = await downloading, bytes = await downloadBytes(download)
    expect(download.suggestedFilename()).toMatch(new RegExp(`@2x\\.${format.toLowerCase()}$`))
    if (format === 'SVG') expect(bytes.toString()).toMatch(/width="240" height="240"/)
    if (format === 'PNG') {
      expect(bytes.subarray(1, 4).toString()).toBe('PNG')
      expect(await decodedSize(page, bytes, 'image/png')).toEqual({ width: 240, height: 240 })
    }
    if (format === 'WebP') {
      expect(bytes.subarray(0, 4).toString()).toBe('RIFF')
      expect(bytes.subarray(8, 12).toString()).toBe('WEBP')
      expect(await decodedSize(page, bytes, 'image/webp')).toEqual({ width: 240, height: 240 })
    }
    if (format === 'PDF') {
      expect(bytes.subarray(0, 8).toString()).toBe('%PDF-1.4')
      expect(bytes.toString('latin1')).toContain('/MediaBox [0 0 90 90]')
      expect(bytes.toString('latin1')).toContain('/Width 240 /Height 240')
    }
    await expect(panel).not.toBeVisible()
    await expect(selected).toHaveAttribute('data-element-id', id!)
  }
})

test('batch packages separate artboards at multiple scales with a manifest', async ({ page }) => {
  test.setTimeout(60000)
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const panel = page.getByRole('dialog')
  await panel.getByRole('checkbox', { name: 'Include 03 — Material studies' }).uncheck()
  await panel.getByRole('button', { name: '1×', exact: true }).click()
  await expect(panel).toContainText('4 assets · ZIP archive')
  const downloading = page.waitForEvent('download')
  await panel.getByRole('button', { name: 'Export ZIP' }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toMatch(/-assets\.zip$/)
  const files = zipFiles(await downloadBytes(download))
  expect(files.size).toBe(5)
  const manifest = JSON.parse(files.get('manifest.json')!.toString()) as { assets: { file: string; scale: number; width: number; height: number; colorSpace: string }[] }
  expect(manifest.assets.map(asset => asset.scale)).toEqual([1, 2, 1, 2])
  for (const asset of manifest.assets) {
    expect(asset.colorSpace).toBe('srgb')
    expect(await decodedSize(page, files.get(asset.file)!, 'image/png')).toEqual({ width: asset.width, height: asset.height })
  }
})

test('export panel remains usable on narrow screens and distinguishes color modes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const panel = page.getByRole('dialog')
  const rect = await panel.boundingBox()
  expect(rect!.width).toBeLessThanOrEqual(390)
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await panel.getByLabel('Export color space').selectOption('display-p3')
  await expect(panel.getByRole('img')).toBeVisible()
  await panel.getByRole('button', { name: /^SVG/ }).click()
  await expect(panel.getByLabel('Export color space')).toHaveValue('source')
  await expect(panel.getByLabel('Export color space')).toBeDisabled()
  await panel.getByRole('button', { name: /^PDF/ }).click()
  await expect(panel.getByLabel('Export color space')).toHaveValue('srgb')
  await expect(panel.getByRole('button', { name: 'Export ZIP' })).toBeEnabled()
})
