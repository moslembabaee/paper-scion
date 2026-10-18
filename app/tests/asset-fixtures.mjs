import { readFileSync, readdirSync } from 'node:fs'

export const PNG_SAMPLE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=', 'base64')
// Use the installed browser tooling's real font; no font download or system font
// dependency is needed. Its filename is content-hashed across Playwright versions.
const directory = new URL('../node_modules/playwright-core/lib/vite/recorder/assets/', import.meta.url)
export const FONT_SAMPLE = readFileSync(new URL(readdirSync(directory).find(name => name.endsWith('.ttf')), directory))
