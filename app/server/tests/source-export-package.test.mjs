import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile, unlink, symlink, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { openSync, closeSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createAppProject } from '../dist/src/make/manifest.js'
import { exportRunnableSource, createSourceZip } from '../dist/server/source-export.js'
import { PNG_SAMPLE, FONT_SAMPLE } from '../../tests/asset-fixtures.mjs'

const asset = (id, name, bytes, mimeType, type) => ({ id, name, mimeType, type, byteSize: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'), dataBase64: bytes.toString('base64'), createdAt: '2026-01-01T00:00:00.000Z' })
const records = [asset('ast_image123', 'logo.png', PNG_SAMPLE, 'image/png', 'image'), asset('ast_font1234', 'Paper.ttf', FONT_SAMPLE, 'font/ttf', 'font')]
function sourceFixture() {
  return createAppProject({ name: 'Runnable fixture', assetIds: records.map(a => a.id), files: {
    'src/App.tsx': `import { useState } from 'react'; import { Plus } from 'lucide-react'; import './style.css';
export default function App(){const [n,setN]=useState(0);return <main><h1>Runnable fixture</h1><img alt="Local logo" src="paper-asset:ast_image123"/><button onClick={()=>setN(n+1)}><Plus/>Count {n}</button></main>}`,
    'src/style.css': 'body{margin:0;background:#080808;color:#edebe1;font-family:Paper}main{padding:24px}button{color:#81adec}img{width:24px}',
    // These are data in the exported source namespace, never executed as build config.
    'package.json': '{"scripts":{"postinstall":"touch OWNED"},"dependencies":{"evil":"*"}}',
    'vite.config.js': 'throw new Error("Generated config executed")',
  } })
}
function command(command, args, cwd, succeeds = true) {
  const logPath = join(cwd, 'command.log'), fd = openSync(logPath, 'w')
  // External build tools are not test workers or installs in Paper's toolchain.
  // Drop its reporting context and npm's inherited allow-scripts option, which
  // npm rejects for this standalone project install. --ignore-scripts stays on.
  const { NODE_TEST_CONTEXT: _testContext, npm_config_allow_scripts: _allowScripts, ...commandEnv } = process.env
  let result
  try { result = spawnSync(command, args, { cwd, stdio: ['ignore', fd, fd], timeout: 60_000, env: { ...commandEnv, npm_config_userconfig: '/dev/null' } }) }
  finally { closeSync(fd) }
  const output = readFileSync(logPath, 'utf8')
  // Keep subprocess diagnostics visible when Node reports only the failing
  // test file in process-isolated runs.
  if (result.error || (succeeds ? result.status !== 0 : result.status === 0)) console.error(output)
  assert.ifError(result.error)
  if (succeeds) assert.equal(result.status, 0, `${command} ${args.join(' ')}\n${output}`)
  else assert.notEqual(result.status, 0, 'Invalid source must fail compilation')
  return output
}
// Preview HTML keeps code and styles inside base64 data URLs. Inspect decoded
// payloads without evaluating generated code or loosening the HTML boundary.
function payloads(html) {
  return [...html.matchAll(/data:text\/(?:javascript|css);base64,([^"\s]+)/g)]
    .map(match => Buffer.from(match[1], 'base64').toString('utf8')).join('\n')
}

test('persisted-form source exports build offline with the scoped data preview protocol', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'paper-data-export-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const project = createAppProject({ files: {
    'src/App.tsx': `import {useState} from 'react'; export default function App(){
      const [result,setResult]=useState('Ready');
      async function load(){try {const data=await window.paperData.invoke('dat_${'A'.repeat(32)}',{operation:'list'});setResult(String(data.records.length))}catch{setResult('Owner preview required')}}
      return <main><h1>Persisted form</h1><button onClick={load}>Load responses</button><output>{result}</output></main>
    }`,
  } })
  await writeFile(join(dir, 'app.zip'), await exportRunnableSource(project, []))
  command('unzip', ['-q', 'app.zip'], dir)
  command('npm', ['run', 'build', '--logs-dir', dir], dir)
  const html = await readFile(join(dir, 'dist/index.html'), 'utf8')
  assert.ok(payloads(html).includes('Persisted form'))
  // Exercise the exported sandbox module too: its serialized validators must
  // keep working without Paper's source tree or server dependencies.
  const sandbox = await import(pathToFileURL(join(dir, '.paper/compiler/preview-sandbox.js')))
  assert.equal(sandbox.parsePreviewMessage(sandbox.createPreviewMessage('paper-preview', 'preview:data', {
    handle: 'dat_' + 'A'.repeat(32), operation: 'list',
  }), 'paper-preview').valid, true)
})

test('unzip/install/build fixture is reproducible, editable and serves only its static app', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'paper-runnable-source-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const project = sourceFixture(), archive = await exportRunnableSource(project, records)
  assert.deepEqual(await exportRunnableSource(project, records), archive)
  const reversed = await exportRunnableSource(project, [...records].reverse())
  assert.equal(createHash('sha256').update(reversed).digest('hex'), createHash('sha256').update(archive).digest('hex'),
    'Asset enumeration order must not change a revision’s source archive')
  await writeFile(join(dir, 'app.zip'), archive)
  command('unzip', ['-q', 'app.zip'], dir)
  const manifest = JSON.parse(await readFile(join(dir, 'package.json')))
  const lock = JSON.parse(await readFile(join(dir, 'package-lock.json')))
  assert.deepEqual(manifest.dependencies, {})
  assert.deepEqual(Object.keys(lock.packages), [''])
  const tools = JSON.parse(await readFile(join(dir, '.paper/build-versions.json')))
  assert.deepEqual(Object.keys(tools), ['typescript', 'postcss', 'nanoid', 'picocolors', 'source-map-js'])
  assert.ok(Object.values(tools).every(tool => /^\d+\.\d+\.\d+$/.test(tool.version) && tool.integrity.startsWith('sha512-')))
  assert.deepEqual(await readFile(join(dir, 'assets/ast_image123.png')), PNG_SAMPLE)
  assert.deepEqual(await readFile(join(dir, 'assets/ast_font1234.ttf')), FONT_SAMPLE)
  command('npm', ['ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--logs-dir', dir], dir)
  command('npm', ['run', 'build', '--logs-dir', dir], dir)
  const first = await readFile(join(dir, 'dist/index.html'), 'utf8')
  command('npm', ['run', 'build', '--logs-dir', dir], dir)
  assert.equal(await readFile(join(dir, 'dist/index.html'), 'utf8'), first)
  assert.ok(payloads(first).includes(`data:image/png;base64,${PNG_SAMPLE.toString('base64')}`))
  assert.ok(payloads(first).includes(`data:font/ttf;base64,${FONT_SAMPLE.toString('base64')}`))
  await assert.rejects(readFile(join(dir, 'OWNED')))
  const { createAppServer } = await import(pathToFileURL(join(dir, '.paper/start.mjs')))
  const server = await createAppServer()
  // Real HTTP handler, exercised without requiring a listening socket in CI.
  const handle = (url, method = 'GET') => {
    let status, body
    server.emit('request', { url, method }, { writeHead(code) { status = code }, end(bytes) { body = bytes } })
    return { status, body }
  }
  assert.equal(handle('/').status, 200)
  assert.equal(handle('/').body.toString(), first)
  assert.equal(handle('/', 'HEAD').body, undefined)
  for (const path of ['/../paper-app.json', '/source/src/App.tsx', '/%2e%2e/package.json', '/.paper/compiler/compiler.js']) assert.equal(handle(path).status, 404)
  assert.equal(handle('/', 'POST').status, 404)
  const entry = join(dir, 'source/src/App.tsx')
  const content = await readFile(entry, 'utf8')
  await writeFile(entry, content.replace('Runnable fixture', 'Edited offline'))
  command('npm', ['run', 'build', '--logs-dir', dir], dir)
  assert.ok(payloads(await readFile(join(dir, 'dist/index.html'), 'utf8')).includes('Edited offline'))
  await writeFile(entry, "import bad from 'not-allowlisted'; export default () => <main>{bad}</main>")
  command('npm', ['run', 'build', '--logs-dir', dir], dir, false)
  // Failed rebuild preserves the last built app.
  assert.ok(payloads(await readFile(join(dir, 'dist/index.html'), 'utf8')).includes('Edited offline'))
  await writeFile(entry, content)
  await unlink(join(dir, 'assets/ast_image123.png'))
  command('npm', ['run', 'build', '--logs-dir', dir], dir, false)
  await symlink('/etc/passwd', join(dir, 'assets/ast_image123.png'))
  command('npm', ['run', 'build', '--logs-dir', dir], dir, false)
})

test('archive traversal, aliases, collisions and missing assets reject', async () => {
  for (const path of ['../escape', '/absolute', 'C:/escape', 'folder\\escape', '%2e%2e/escape', './alias']) {
    assert.throws(() => createSourceZip(new Map([[path, Buffer.from('bad')]])))
  }
  for (const paths of [['A.ts', 'a.ts'], ['src/a', 'src/a/b.ts']]) {
    assert.throws(() => createSourceZip(new Map(paths.map(path => [path, Buffer.from('bad')]))))
  }
  const project = sourceFixture()
  await assert.rejects(exportRunnableSource(project, []), /asset references/i)
  await assert.rejects(exportRunnableSource({ ...project, files: { '../escape': { path: '../escape', content: '' } } }, records), /traversal|path segment/i)
})

test('archive names reject lossy UTF-8 and Unicode normalization collisions', () => {
  for (const path of ['source/\ud800.ts', 'source/\udc00.ts']) {
    assert.throws(() => createSourceZip(new Map([[path, Buffer.from('bad')]])), /path|UTF-8/i)
  }
  for (const paths of [
    ['source/café.ts', 'source/cafe\u0301.ts'],
    ['source/café', 'source/cafe\u0301/child.ts'],
  ]) {
    assert.throws(() => createSourceZip(new Map(paths.map(path => [path, Buffer.from('bad')]))), /path/i)
  }
  // Non-ASCII names that retain their identity are supported.
  assert.ok(createSourceZip(new Map([['source/日本語.ts', Buffer.from('safe')]])).length > 0)
})

test('standalone build rejects output symlinks without overwriting files outside the app', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'paper-export-output-'))
  const outside = await mkdtemp(join(tmpdir(), 'paper-export-outside-'))
  t.after(async () => {
    await rm(dir, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })
  const sentinel = join(outside, 'index.html')
  await writeFile(sentinel, 'Keep this file')
  await writeFile(join(dir, 'app.zip'), await exportRunnableSource(createAppProject(), []))
  command('unzip', ['-q', 'app.zip'], dir)
  command('npm', ['run', 'build', '--logs-dir', dir], dir)
  await rm(join(dir, 'dist'), { recursive: true })
  await symlink(outside, join(dir, 'dist'))
  assert.match(command('npm', ['run', 'build', '--logs-dir', dir], dir, false), /symlink/i)
  assert.equal(await readFile(sentinel, 'utf8'), 'Keep this file')
  await unlink(join(dir, 'dist'))
  await mkdir(join(dir, 'dist'))
  await symlink(sentinel, join(dir, 'dist/index.html'))
  assert.match(command('npm', ['run', 'build', '--logs-dir', dir], dir, false), /symlink/i)
  assert.equal(await readFile(sentinel, 'utf8'), 'Keep this file')
})

test('standalone start rejects symlinked output and directories instead of serving local files', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'paper-export-host-'))
  const outside = await mkdtemp(join(tmpdir(), 'paper-export-host-outside-'))
  t.after(async () => {
    await rm(dir, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })
  const sentinel = join(outside, 'index.html')
  await writeFile(sentinel, 'Private local file')
  await writeFile(join(dir, 'app.zip'), await exportRunnableSource(createAppProject(), []))
  command('unzip', ['-q', 'app.zip'], dir)
  const { createAppServer } = await import(pathToFileURL(join(dir, '.paper/start.mjs')))
  await mkdir(join(dir, 'dist'))
  await symlink(sentinel, join(dir, 'dist/index.html'))
  await assert.rejects(createAppServer(), /symlink/i)
  await rm(join(dir, 'dist'), { recursive: true })
  await symlink(outside, join(dir, 'dist'))
  await assert.rejects(createAppServer(), /symlink/i)
  await unlink(join(dir, 'dist'))
  await mkdir(join(dir, 'dist/index.html'), { recursive: true })
  await assert.rejects(createAppServer(), /regular file/i)
  assert.equal(await readFile(sentinel, 'utf8'), 'Private local file')
})
