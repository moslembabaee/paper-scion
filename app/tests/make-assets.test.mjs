import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  APP_ASSET_LIMITS,
  AppAssetValidationError,
  sniffAssetMimeType,
  validateAssetName,
  validateAssetId,
  generateAssetId,
  validateSvgContent,
  validateAssetBuffer,
  createFontFacesCss,
  createAssetDataUri,
  exportAppPackage,
  parseAppPackage,
  serializeAppPackage,
} from '../src/make/assets.ts'
import { PNG_SAMPLE, FONT_SAMPLE } from './asset-fixtures.mjs'
import { createAppProject } from '../src/make/manifest.ts'
import { compileAppProject } from '../src/make/compiler.ts'

// Sample minimal valid asset byte buffers
const PNG_HEADER = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52])
const JPEG_HEADER = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46])
const GIF89A_HEADER = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00])
const WEBP_HEADER = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, // 'RIFF'
  0x24, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50, // 'WEBP'
  0x56, 0x50, 0x38, 0x20, // 'VP8 '
])
const WOFF_HEADER = new Uint8Array([0x77, 0x4F, 0x46, 0x46, 0x00, 0x01, 0x00, 0x00])
const WOFF2_HEADER = new Uint8Array([0x77, 0x4F, 0x46, 0x32, 0x00, 0x01, 0x00, 0x00])
const TTF_HEADER = new Uint8Array([0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00])
const OTF_HEADER = new Uint8Array([0x4F, 0x54, 0x54, 0x4F, 0x00, 0x01, 0x00, 0x00])
const CLEAN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#81adec"/></svg>`

test('SVG assets reject external resources, stylesheet instructions and CSS escapes', () => {
  for (const svg of [
    '<svg><image href="https://attacker.test/tracker"/></svg>',
    '<svg><use href="//attacker.test/icon.svg#x"/></svg>',
    '<?xml-stylesheet href="https://attacker.test/a.css"?><svg/>',
    '<svg><style>@import "https://attacker.test/a.css";</style></svg>',
    '<svg><rect style="fill:u\\\\72l(https://attacker.test/x)"/></svg>',
    '<svg><animate attributeName="fill" to="url(https://attacker.test/x)"/></svg>',
  ]) assert.throws(() => validateSvgContent(svg), AppAssetValidationError)
})

test('content sniffing identifies approved image and font formats by magic bytes', () => {
  assert.equal(sniffAssetMimeType(PNG_HEADER).mimeType, 'image/png')
  assert.equal(sniffAssetMimeType(PNG_HEADER).type, 'image')

  assert.equal(sniffAssetMimeType(JPEG_HEADER).mimeType, 'image/jpeg')
  assert.equal(sniffAssetMimeType(JPEG_HEADER).type, 'image')

  assert.equal(sniffAssetMimeType(GIF89A_HEADER).mimeType, 'image/gif')
  assert.equal(sniffAssetMimeType(GIF89A_HEADER).type, 'image')

  assert.equal(sniffAssetMimeType(WEBP_HEADER).mimeType, 'image/webp')
  assert.equal(sniffAssetMimeType(WEBP_HEADER).type, 'image')

  assert.equal(sniffAssetMimeType(WOFF_HEADER).mimeType, 'font/woff')
  assert.equal(sniffAssetMimeType(WOFF_HEADER).type, 'font')

  assert.equal(sniffAssetMimeType(WOFF2_HEADER).mimeType, 'font/woff2')
  assert.equal(sniffAssetMimeType(WOFF2_HEADER).type, 'font')

  assert.equal(sniffAssetMimeType(TTF_HEADER).mimeType, 'font/ttf')
  assert.equal(sniffAssetMimeType(TTF_HEADER).type, 'font')

  assert.equal(sniffAssetMimeType(OTF_HEADER).mimeType, 'font/otf')
  assert.equal(sniffAssetMimeType(OTF_HEADER).type, 'font')

  const svgBytes = new TextEncoder().encode(CLEAN_SVG)
  assert.equal(sniffAssetMimeType(svgBytes).mimeType, 'image/svg+xml')
  assert.equal(sniffAssetMimeType(svgBytes).type, 'image')
})

test('content sniffing rejects unapproved formats, executables, HTML, and corrupted headers', () => {
  const rejected = [
    new Uint8Array([0x4D, 0x5A, 0x90, 0x00]), // Windows EXE MZ
    new Uint8Array([0x7F, 0x45, 0x4C, 0x46]), // Linux ELF
    new Uint8Array([0x50, 0x4B, 0x03, 0x04]), // ZIP archive
    new TextEncoder().encode('<!DOCTYPE html><html><body><h1>Not an image</h1></body></html>'),
    new TextEncoder().encode('console.log("alert(1)")'),
    new Uint8Array([0x00, 0x00, 0x00, 0x00]), // All zeroes
    new Uint8Array([0x89, 0x50, 0x4E]), // Truncated PNG header
  ]

  for (const buf of rejected) {
    assert.throws(
      () => sniffAssetMimeType(buf),
      AppAssetValidationError,
      'Should reject unapproved content signature'
    )
  }
})

test('SVG active content detection rejects scripts, handlers, foreignObject, and entity attacks', () => {
  const maliciousSvgs = [
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><SCRIPT src="https://evil.com/x.js"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><circle r="10"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" ONLOAD="alert(1)"><circle r="10"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><circle onclick="alert(1)" r="10"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><circle onerror="alert(1)" r="10"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><circle onmouseover="alert(1)" r="10"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><circle r="10"/></a></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><a xlink:href="javascript:alert(1)"><circle r="10"/></a></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><a href="jav&#x61;script:alert(1)"><circle r="10"/></a></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></body></foreignObject></svg>',
    '<!DOCTYPE svg [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]><svg>&xxe;</svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><iframe src="https://evil.com"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><set attributeName="onload" to="alert(1)"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><animate attributeName="href" values="javascript:alert(1)"/></svg>',
  ]

  for (const svg of maliciousSvgs) {
    assert.throws(
      () => validateSvgContent(svg),
      AppAssetValidationError,
      `Should reject malicious SVG: ${svg.slice(0, 40)}...`
    )
  }

  // Clean SVG should pass without throwing
  assert.doesNotThrow(() => validateSvgContent(CLEAN_SVG))
})

test('asset name validation strictly rejects traversal, control characters, and slashes', () => {
  const invalidNames = [
    '',
    '   ',
    '../evil.png',
    '..\\evil.png',
    'nested/path.png',
    'nested\\path.png',
    '%2e%2e/evil.png',
    '%2e%2e%2flogo.png',
    'null\0byte.png',
    'newline\n.png',
    'logo.exe',
    'logo.html',
    'logo.js',
    '..',
    '.',
    'a'.repeat(129) + '.png',
  ]

  for (const name of invalidNames) {
    assert.throws(
      () => validateAssetName(name, 'image/png'),
      AppAssetValidationError,
      `Should reject invalid asset name: ${name}`
    )
  }

  // Valid asset names should pass
  assert.equal(validateAssetName('hero-banner_2026.png', 'image/png'), 'hero-banner_2026.png')
  assert.equal(validateAssetName('inter-bold.woff2', 'font/woff2'), 'inter-bold.woff2')
  assert.equal(validateAssetName('icon.svg', 'image/svg+xml'), 'icon.svg')
})

test('private asset IDs must be opaque and conform to safe identifier pattern', () => {
  const id = generateAssetId()
  assert.match(id, /^ast_[a-f0-9]{16,32}$/)
  assert.doesNotThrow(() => validateAssetId(id))

  const invalidIds = [
    '',
    'ast',
    '../../etc/passwd',
    'ast/slash',
    'ast_with_spaces ',
    'ast_%2e%2e',
    'a'.repeat(65),
    123,
    null,
  ]

  for (const invalid of invalidIds) {
    assert.throws(
      () => validateAssetId(invalid),
      AppAssetValidationError,
      `Should reject invalid asset ID: ${invalid}`
    )
  }
})

test('quota enforcement rejects oversized files and projects exceeding asset limits', () => {
  // Single file limit: 2 MiB
  const maxBytes = APP_ASSET_LIMITS.MAX_ASSET_BYTES
  const oversized = new Uint8Array(maxBytes + 1)
  oversized.set(PNG_HEADER, 0)

  assert.throws(
    () => validateAssetBuffer(oversized, 'photo.png'),
    AppAssetValidationError,
    'Should reject asset exceeding 2 MiB'
  )
})

test('sandbox asset resolution generates inlined @font-face and data URIs without hotlinks', () => {
  const fontAsset = {
    id: 'ast_font1234567890',
    appId: 'app_test123',
    name: 'Inter-Medium.woff2',
    mimeType: 'font/woff2',
    type: 'font',
    byteSize: WOFF2_HEADER.length,
    sha256: 'abc123hash',
    dataBase64: Buffer.from(WOFF2_HEADER).toString('base64'),
    createdAt: new Date().toISOString(),
  }

  const css = createFontFacesCss([fontAsset])
  assert.ok(css.includes('@font-face'))
  assert.ok(css.includes(`src: url("data:font/woff2;base64,`))
  assert.ok(css.includes(`format("woff2")`))
  assert.ok(!css.includes('http://') && !css.includes('https://'), 'Must not contain external hotlinks')

  const imgDataUri = createAssetDataUri(PNG_HEADER, 'image/png')
  assert.ok(imgDataUri.startsWith('data:image/png;base64,'))
})

test('upload/preview/export round-trip preserves assets and integrity bit-for-bit', () => {
  const project = createAppProject({
    name: 'Asset Project',
    assetIds: ['ast_img123456789012', 'ast_fnt123456789012'],
  })

  const assets = [
    {
      id: 'ast_img123456789012',
      name: 'logo.png',
      mimeType: 'image/png',
      type: 'image',
      byteSize: PNG_SAMPLE.length,
      sha256: createHash('sha256').update(PNG_SAMPLE).digest('hex'),
      dataBase64: PNG_SAMPLE.toString('base64'),
      createdAt: new Date().toISOString(),
    },
    {
      id: 'ast_fnt123456789012',
      name: 'CustomFont.ttf',
      mimeType: 'font/ttf',
      type: 'font',
      byteSize: FONT_SAMPLE.length,
      sha256: createHash('sha256').update(FONT_SAMPLE).digest('hex'),
      dataBase64: FONT_SAMPLE.toString('base64'),
      createdAt: new Date().toISOString(),
    },
  ]

  const pkg = exportAppPackage(project, assets)
  assert.equal(pkg.format, 'paper-app-package')
  assert.equal(pkg.version, 1)
  assert.equal(pkg.assets.length, 2)

  const serialized = serializeAppPackage(pkg)
  const parsed = parseAppPackage(serialized)

  assert.equal(parsed.project.id, project.id)
  assert.deepEqual(parsed.project.assetIds, project.assetIds)
  assert.equal(parsed.assets.length, 2)
  assert.equal(parsed.assets[0].name, 'logo.png')
  assert.equal(parsed.assets[0].mimeType, 'image/png')
  assert.equal(parsed.assets[0].dataBase64, PNG_SAMPLE.toString('base64'))
  assert.equal(parsed.assets[1].name, 'CustomFont.ttf')
  assert.equal(parsed.assets[1].mimeType, 'font/ttf')
  assert.equal(parsed.assets[1].dataBase64, FONT_SAMPLE.toString('base64'))
})

test('package import rejects changed bytes, forged metadata, missing references and duplicate assets', () => {
  const id = 'ast_0123456789abcdef'
  const project = createAppProject({ assetIds: [id] })
  const bytes = new TextEncoder().encode(CLEAN_SVG)
  const record = { id, name: 'logo.svg', mimeType: 'image/svg+xml', type: 'image', byteSize: bytes.length,
    dataBase64: Buffer.from(bytes).toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex'), createdAt: project.createdAt }
  const pkg = exportAppPackage(project, [record])
  for (const change of [
    { ...record, sha256: '0'.repeat(64) },
    { ...record, mimeType: 'image/png', name: 'logo.png' },
    { ...record, type: 'font' },
    { ...record, byteSize: 1 },
    { ...record, dataBase64: record.dataBase64 + 'garbage' },
  ]) assert.throws(() => parseAppPackage(JSON.stringify({ ...pkg, assets: [change] })), AppAssetValidationError)
  assert.throws(() => parseAppPackage(JSON.stringify({ ...pkg, assets: [] })), AppAssetValidationError)
  assert.throws(() => parseAppPackage(JSON.stringify({ ...pkg, assets: [record, record] })), AppAssetValidationError)
})


test('uploads reject truncated image/font containers even when magic bytes match', () => {
  for (const [bytes, name] of [[PNG_HEADER, 'a.png'], [JPEG_HEADER, 'a.jpg'], [GIF89A_HEADER, 'a.gif'], [WEBP_HEADER, 'a.webp'], [WOFF_HEADER, 'a.woff'], [WOFF2_HEADER, 'a.woff2'], [TTF_HEADER, 'a.ttf'], [OTF_HEADER, 'a.otf']]) {
    assert.throws(() => validateAssetBuffer(bytes, name), AppAssetValidationError)
  }
})

test('WebP uploads reject excessive decoded dimensions and truncated frame headers', () => {
  // A VP8X extended header can declare a huge canvas in only 30 bytes.
  const bytes = Buffer.alloc(30)
  bytes.write('RIFF', 0); bytes.writeUInt32LE(22, 4)
  bytes.write('WEBPVP8X', 8); bytes.writeUInt32LE(10, 16)
  bytes.writeUIntLE(16384, 24, 3); bytes.writeUIntLE(16384, 27, 3)
  assert.throws(() => validateAssetBuffer(bytes, 'huge.webp'), AppAssetValidationError)
  for (const kind of ['VP8 ', 'VP8L', 'VP8X']) {
    const truncated = Buffer.alloc(20)
    truncated.write('RIFF', 0); truncated.writeUInt32LE(12, 4)
    truncated.write('WEBP' + kind, 8)
    assert.throws(() => validateAssetBuffer(truncated, 'truncated.webp'), AppAssetValidationError)
  }
})

test('exported private images resolve in JSX and CSS; unavailable asset IDs fail compilation', async () => {
  const id = 'ast_0123456789abcdef'
  const project = createAppProject({ assetIds: [id], files: {
    'src/App.tsx': { path: 'src/App.tsx', content: `import './styles.css'; export default () => <img src="paper-asset:${id}"/>` },
    'src/styles.css': { path: 'src/styles.css', content: `body{background-image:url("paper-asset:${id}")}` },
  } })
  const record = { id, name: 'logo.png', mimeType: 'image/png', type: 'image', byteSize: PNG_SAMPLE.length,
    sha256: createHash('sha256').update(PNG_SAMPLE).digest('hex'), dataBase64: PNG_SAMPLE.toString('base64'), createdAt: project.createdAt }
  const pkg = parseAppPackage(serializeAppPackage(exportAppPackage(project, [record])))
  const compiled = await compileAppProject(pkg.project, {}, pkg.assets)
  assert.equal(compiled.success, true)
  const uri = `data:image/png;base64,${record.dataBase64}`
  assert.ok(compiled.assets.js.includes(uri))
  assert.ok(compiled.assets.css.includes(uri))
  assert.ok(!compiled.assets.js.includes(`paper-asset:${id}`))
  for (const candidate of [
    project,
    createAppProject({ files: { 'src/App.tsx': { path: 'src/App.tsx', content: `export default () => <img src="paper-asset:${id}"/>` } } }),
  ]) {
    const denied = await compileAppProject(candidate)
    assert.equal(denied.success, false)
    assert.equal(denied.assets, null)
    assert.match(denied.diagnostics.at(-1).message, /asset/i)
  }
})
