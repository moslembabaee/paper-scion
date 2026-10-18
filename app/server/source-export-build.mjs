// Trusted standalone build: read bounded source data and compile static modules.
import { readFile, writeFile, mkdir, lstat, mkdtemp, rename, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { compileAppProject } from './compiler/compiler.js'
import { validateAppProject, normalizeAndValidatePath } from './compiler/manifest.js'

async function local(path, limit) {
  if (normalizeAndValidatePath(path) !== path) throw new Error('Non-canonical local path')
  let prefix = ''
  for (const segment of path.split('/')) {
    prefix += (prefix ? '/' : '') + segment
    if ((await lstat(prefix)).isSymbolicLink()) throw new Error('Symlinks are forbidden')
  }
  const info = await lstat(path)
  if (!info.isFile() || info.size > limit) throw new Error('Invalid or oversized local file')
  return readFile(path)
}
const project = validateAppProject(JSON.parse(await local('paper-app.json', 4 * 1024 * 1024)))
const files = {}
for (const file of Object.values(project.files)) {
  files[file.path] = { path: file.path, content: (await local('source/' + file.path, 512 * 1024)).toString('utf8') }
}
const metadata = JSON.parse(await local('assets.json', 256 * 1024))
if (!Array.isArray(metadata) || metadata.length > 100) throw new Error('Invalid asset list')
const assets = []
for (const { localPath, ...record } of metadata) {
  if (typeof localPath !== 'string' || !localPath.startsWith('assets/')) throw new Error('Invalid local asset path')
  const bytes = await local(localPath, 2 * 1024 * 1024)
  if (createHash('sha256').update(bytes).digest('hex') !== record.sha256) throw new Error('Local asset integrity check failed')
  assets.push({ ...record, dataBase64: bytes.toString('base64') })
}
const result = await compileAppProject(validateAppProject({ ...project, files }), {}, assets)
if (!result.success || !result.assets) throw new Error(JSON.stringify(result.diagnostics))
await mkdir('dist', { recursive: true })
const output = await lstat('dist')
const existing = await lstat('dist/index.html').catch(error => {
  if (error.code !== 'ENOENT') throw error
})
if (output.isSymbolicLink() || existing?.isSymbolicLink()) throw new Error('Output symlinks are forbidden')
if (!output.isDirectory() || (existing && !existing.isFile())) throw new Error('Invalid build output')
// Publish only a complete successful build, preserving the last runnable app.
const staging = await mkdtemp('dist/.paper-build-')
try {
  await writeFile(`${staging}/index.html`, result.assets.html, { flag: 'wx' })
  await rename(`${staging}/index.html`, 'dist/index.html')
} finally { await rm(staging, { recursive: true, force: true }) }
console.log('Built dist/index.html')
