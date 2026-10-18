import test from 'node:test'
import assert from 'node:assert/strict'
import { inflateSync } from 'node:zlib'
import { SceneStore } from '../src/scene/store.ts'
import { assetFileNames, exportTargets } from '../src/io/exportTypes.ts'
import { exportBatch, validateBatch } from '../src/io/exportBatch.ts'
import { exportAsset, exportSVG, rasterDimensions } from '../src/io/export.ts'
import { sceneToSVG } from '../src/io/svg.ts'
import { createPDF } from '../src/io/pdf.ts'
import { crc32, createZIP } from '../src/io/zip.ts'

function scene() {
  const store = new SceneStore()
  store.add('frame', { id: 'a', name: 'Study/a', x: 120, y: 240, width: 720, height: 480 })
  store.add('frame', { id: 'b', name: 'study/a', x: 960, width: 360, height: 480 })
  store.add('frame', { id: 'nested', parentId: 'a', width: 100, height: 100 })
  store.add('rectangle', { id: 'r', parentId: 'a', x: 40, y: 50, width: 60, height: 70 })
  store.add('frame', { id: 'hidden', visible: false })
  store.select(['r', 'a', 'b'])
  return store
}

test('artboard/layer batches isolate visible roots without mutating selection or history', () => {
  const store = scene(), before = store.getSnapshot()
  const targets = exportTargets(before, 'artboards', 'Document')
  assert.deepEqual(targets.map(t => t.id), ['a', 'b'])
  assert.deepEqual(targets[0].bounds, { x: 120, y: 240, width: 720, height: 480 })
  assert.deepEqual(targets[0].scene.selection, ['a'])
  assert.deepEqual(exportTargets(before, 'layers', 'Document').map(t => t.id), ['a', 'b'])
  assert.equal(exportTargets(before, 'selection', 'Document').length, 1)
  assert.equal(exportTargets(before, 'canvas', 'Document')[0].scope, 'canvas')
  assert.equal(store.getSnapshot(), before)
  store.select(['nested', 'r'])
  assert.deepEqual(exportTargets(store.getSnapshot(), 'layers', 'Document').map(t => t.id), ['nested', 'r'])
  store.setVisible('a', false)
  assert.equal(exportTargets(store.getSnapshot(), 'layers', 'Document').length, 0)
})

test('batch filenames preserve scale and avoid sanitized and case-insensitive collisions', () => {
  assert.deepEqual(assetFileNames(exportTargets(scene().getSnapshot(), 'artboards', 'Document'), [1, 2, 3], 'webp'), [
    'Study-a@1x.webp', 'Study-a@2x.webp', 'Study-a@3x.webp',
    'study-a-2@1x.webp', 'study-a-2@2x.webp', 'study-a-2@3x.webp',
  ])
})

test('SVG scales intrinsic size while retaining geometry; PDF enforces its memory limit', () => {
  const state = exportTargets(scene().getSnapshot(), 'artboards', 'Document')[0].scene
  const options = { scope: 'selection', scale: 3, background: 'transparent' }
  assert.match(sceneToSVG(state, options), /width="2160" height="1440" viewBox="120 240 720 480"/)
  assert.match(sceneToSVG(state, options, undefined, { width: 480, height: 320 }), /width="480" height="320" viewBox="120 240 720 480"/)
  assert.deepEqual(rasterDimensions(state, options, 'webp'), { width: 2160, height: 1440 })
  const large = new SceneStore()
  large.add('frame', { id: 'large', width: 5000, height: 5000 })
  large.select(['large'])
  assert.throws(() => rasterDimensions(large.getSnapshot(), { ...options, scale: 1 }, 'pdf'), /16 megapixels/)
  assert.throws(() => rasterDimensions(state, { ...options, scale: NaN }), /valid export scale/)
})

test('batch preflight rejects invalid presets, empty targets, and unsupported gamut before rendering', () => {
  const settings = { name: 'Document', targets: exportTargets(scene().getSnapshot(), 'artboards', 'Document'), scales: [1, 2], format: 'png', background: 'transparent', colorSpace: 'srgb', quality: .92 }
  assert.doesNotThrow(() => validateBatch(settings))
  assert.throws(() => validateBatch({ ...settings, scales: [] }), /at least one/)
  assert.throws(() => validateBatch({ ...settings, targets: [] }), /at least one/)
  assert.throws(() => validateBatch({ ...settings, scales: [2, 2] }), /unique/)
  assert.throws(() => validateBatch({ ...settings, format: 'webp', colorSpace: 'display-p3' }), /sRGB/)
  assert.throws(() => validateBatch({ ...settings, quality: NaN }), /valid WebP quality/)
})

function browserDocument(t, fonts = Promise.resolve()) {
  const previous = globalThis.document
  globalThis.document = { fonts: { ready: fonts }, createElement: () => ({ getContext: () => null }) }
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous })
}

test('SVG batch renders real files and a manifest from one scene revision', async t => {
  browserDocument(t)
  const store = scene(), before = store.getSnapshot()
  const targets = exportTargets(before, 'artboards', 'Document')
  const progress = []
  const archive = await exportBatch({ name: 'Document', targets, scales: [1, 3], format: 'svg', background: 'cream', colorSpace: 'srgb', quality: .92 }, new AbortController().signal, event => {
    progress.push(event)
    // Editing the live document during export cannot change this batch.
    if (!event.completed) store.update('a', 'frame', { width: 100 })
  })
  assert.equal(archive.name, 'Document-assets.zip')
  const bytes = Buffer.from(await archive.blob.arrayBuffer()), files = new Map()
  let offset = 0
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const size = bytes.readUInt32LE(offset + 18), length = bytes.readUInt16LE(offset + 26)
    files.set(bytes.subarray(offset + 30, offset + 30 + length).toString(), bytes.subarray(offset + 30 + length, offset + 30 + length + size).toString())
    offset += 30 + length + size
  }
  assert.match(files.get('Study-a@3x.svg'), /width="2160" height="1440"/)
  assert.match(files.get('Study-a@1x.svg'), /fill="#edebe1"/)
  const manifest = JSON.parse(files.get('manifest.json'))
  assert.deepEqual(manifest.assets.map(asset => [asset.scale, asset.width]), [[1, 720], [3, 2160], [1, 360], [3, 1080]])
  assert.equal(manifest.assets[0].colorSpace, 'native CSS colors')
  assert.equal(progress.at(-1).completed, 4)
  assert.deepEqual(store.getSnapshot().selection, before.selection)
})

test('cancelling while fonts load promptly releases export and permits retry', async t => {
  let releaseFonts
  browserDocument(t, new Promise(resolve => { releaseFonts = resolve }))
  const state = exportTargets(scene().getSnapshot(), 'artboards', 'Document')[0].scene
  const controller = new AbortController()
  const pending = exportSVG(state, { scope: 'selection', scale: 1, background: 'transparent' }, controller.signal)
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  releaseFonts()
  const blob = await exportSVG(state, { scope: 'selection', scale: 1, background: 'transparent' })
  assert.match(await blob.text(), /width="720" height="480"/)
})

test('cancelling during raster image decode revokes its temporary URL', async t => {
  browserDocument(t)
  const previous = globalThis.Image
  let decoding
  const started = new Promise(resolve => { decoding = resolve })
  globalThis.Image = class { decode() { decoding(); return new Promise(() => {}) } }
  t.after(() => { if (previous === undefined) delete globalThis.Image; else globalThis.Image = previous })
  const revoke = t.mock.method(URL, 'revokeObjectURL')
  const state = exportTargets(scene().getSnapshot(), 'artboards', 'Document')[0].scene
  const controller = new AbortController()
  const pending = exportAsset(state, { scope: 'selection', scale: 1, background: 'transparent' }, 'png', controller.signal)
  await started
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(revoke.mock.callCount(), 1)
})

test('ZIP headers, UTF-8 names, CRCs, central-directory offsets, and file payloads are valid', async () => {
  const files = [{ name: 'Étude@2x.svg', blob: new Blob(['<svg/>']) }, { name: 'manifest.json', blob: new Blob(['{}']) }]
  const zip = Buffer.from(await (await createZIP(files)).arrayBuffer())
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926)
  let offset = 0
  const localOffsets = []
  for (const file of files) {
    localOffsets.push(offset)
    assert.equal(zip.readUInt32LE(offset), 0x04034b50)
    assert.equal(zip.readUInt16LE(offset + 6), 0x0800)
    const length = zip.readUInt16LE(offset + 26), size = zip.readUInt32LE(offset + 18)
    const bytes = zip.subarray(offset + 30 + length, offset + 30 + length + size)
    assert.equal(zip.subarray(offset + 30, offset + 30 + length).toString(), file.name)
    assert.equal(zip.readUInt32LE(offset + 14), crc32(bytes))
    assert.equal(bytes.toString(), await file.blob.text())
    offset += 30 + length + size
  }
  const directoryOffset = offset
  for (let i = 0; i < files.length; i++) {
    assert.equal(zip.readUInt32LE(offset), 0x02014b50)
    assert.equal(zip.readUInt32LE(offset + 42), localOffsets[i])
    offset += 46 + zip.readUInt16LE(offset + 28)
  }
  assert.equal(zip.readUInt32LE(offset), 0x06054b50)
  assert.equal(zip.readUInt32LE(offset + 16), directoryOffset)
  assert.equal(zip.readUInt16LE(offset + 10), files.length)
  await assert.rejects(createZIP([]), /Choose between/)
  await assert.rejects(createZIP([{ name: '../bad', blob: new Blob() }]), /filename/)
  await assert.rejects(createZIP(files, AbortSignal.abort()), { name: 'AbortError' })
})

test('PDF losslessly embeds RGB and alpha, uses fixed page size, and has byte-correct xref offsets', async () => {
  const pdf = Buffer.from(await (await createPDF({ width: 2, height: 1, pageWidth: 720, pageHeight: 480, rgba: new Uint8ClampedArray([255, 0, 0, 255, 0, 128, 255, 100]) })).arrayBuffer())
  const source = pdf.toString('latin1')
  assert.match(source, /^%PDF-1.4/)
  assert.match(source, /MediaBox \[0 0 540 360\]/)
  assert.match(source, /SMask 6 0 R/)
  for (const [id, expected] of [[5, [255, 0, 0, 0, 128, 255]], [6, [255, 100]]]) {
    const start = source.indexOf(`${id} 0 obj\n`), stream = source.indexOf('stream\n', start) + 7
    const length = Number(source.slice(start, stream).match(/\/Length (\d+)/)[1])
    assert.deepEqual([...inflateSync(pdf.subarray(stream, stream + length))], expected)
  }
  const xref = Number(source.match(/startxref\n(\d+)/)[1])
  assert.equal(source.slice(xref, xref + 4), 'xref')
  const entries = source.slice(xref).match(/\d{10} 00000 n /g)
  entries.forEach((entry, i) => assert.equal(source.slice(Number(entry.slice(0, 10))).startsWith(`${i + 1} 0 obj`), true))
  const opaque = await createPDF({ width: 1, height: 1, pageWidth: 1, pageHeight: 1, rgba: new Uint8ClampedArray([1, 2, 3, 255]) })
  assert.doesNotMatch(await opaque.text(), /SMask/)
  await assert.rejects(createPDF({ width: 2, height: 1, pageWidth: 1, pageHeight: 1, rgba: new Uint8ClampedArray(4) }), /dimensions/)
})
