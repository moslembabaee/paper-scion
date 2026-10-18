import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { getPreviewRuntime } from '../dist/src/make/compiler-runtime.js'

test('self-hosted preview runtime is frozen at build time with its compiler dependencies declared', async () => {
  const runtime = await readFile(new URL('../dist/src/make/preview-runtime.js', import.meta.url), 'utf8')
  assert.match(runtime, /__paperPreviewPackages/)
  assert.equal(await getPreviewRuntime(), runtime)
  const { dependencies } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.ok(dependencies.typescript, 'The API container must install the static TSX transformer')
  assert.ok(dependencies.postcss, 'The API container must install the CSS parser')
})
