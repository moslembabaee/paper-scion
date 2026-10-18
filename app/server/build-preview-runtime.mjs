import { writeFile } from 'node:fs/promises'
import { bundlePreviewRuntime } from './dist/src/make/compiler-runtime.js'

// Only Paper's fixed package allowlist enters this build; no project code is read.
await writeFile(new URL('./dist/src/make/preview-runtime.js', import.meta.url), await bundlePreviewRuntime())

// Freeze the source-export kit from Paper's trusted release, never app files.
const { readFile, readdir } = await import('node:fs/promises')
const { DEFAULT_ALLOWED_PACKAGES } = await import('./dist/src/make/compiler-runtime.js')
const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'))
const toolNames = ['typescript', 'postcss', 'nanoid', 'picocolors', 'source-map-js']
const packages = {}
for (const name of toolNames) {
  const item = lock.packages[`node_modules/${name}`]
  if (!item || !/^https:\/\/registry\.npmjs\.org\//.test(item.resolved) || !item.integrity?.startsWith('sha512-') || item.hasInstallScript) throw new Error(`Unapproved export tool: ${name}`)
  if (Object.keys(item.dependencies ?? {}).some(dep => !toolNames.includes(dep))) throw new Error('Unreviewed export tool dependency')
  const { dev: _dev, devOptional: _devOptional, ...entry } = item
  packages[`node_modules/${name}`] = entry
}
const manifest = {
  name: 'paper-make-app', version: '1.0.0', private: true, type: 'module', engines: { node: '>=22' },
  scripts: { build: 'node .paper/build.mjs', start: 'node .paper/start.mjs' },
  dependencies: {},
}
const files = {
  'package.json': JSON.stringify(manifest, null, 2) + '\n',
  'package-lock.json': JSON.stringify({ name: manifest.name, version: manifest.version, lockfileVersion: 3, requires: true,
    packages: { '': { name: manifest.name, version: manifest.version, dependencies: {}, engines: manifest.engines } } }, null, 2) + '\n',
  '.npmrc': 'ignore-scripts=true\nsave-exact=true\n',
  '.gitignore': 'node_modules/\ndist/\n',
  '.paper/build.mjs': await readFile(new URL('./source-export-build.mjs', import.meta.url), 'utf8'),
  '.paper/start.mjs': await readFile(new URL('./source-export-start.mjs', import.meta.url), 'utf8'),
  '.paper/build-versions.json': JSON.stringify(Object.fromEntries(toolNames.map(name => [name, { version: packages[`node_modules/${name}`].version, integrity: packages[`node_modules/${name}`].integrity }])), null, 2) + '\n',
}
// Bundle only the trusted static compiler and its reviewed tool dependencies.
// Every exported build is offline: npm ci has nothing to fetch or execute.
const { build } = await import('vite')
const { builtinModules } = await import('node:module')
const { fileURLToPath } = await import('node:url')
const runtimeStub = '\0paper-export-runtime'
const compiler = await build({
  configFile: false, envDir: false, publicDir: false, logLevel: 'silent',
  resolve: { conditions: ['node'], mainFields: ['module', 'main'] },
  plugins: [{
    name: 'paper-export-runtime', enforce: 'pre',
    resolveId(id) { if (/compiler-runtime\.(?:ts|js)$/.test(id)) return runtimeStub },
    load(id) { if (id === runtimeStub) return `import { readFile } from 'node:fs/promises';
      export const DEFAULT_ALLOWED_PACKAGES = Object.freeze(${JSON.stringify(DEFAULT_ALLOWED_PACKAGES)});
      export const getPreviewRuntime = () => readFile(new URL('./preview-runtime.js', import.meta.url), 'utf8');` },
  }],
  build: { write: false, minify: false, target: 'node22',
    lib: { entry: fileURLToPath(new URL('./dist/src/make/compiler.js', import.meta.url)), formats: ['es'] },
    rollupOptions: { external: id => id.startsWith('node:') || builtinModules.includes(id),
      output: { banner: "import { createRequire as __paperCreateRequire } from 'node:module'; import { fileURLToPath as __paperFileURLToPath } from 'node:url'; import { dirname as __paperDirname } from 'node:path'; const require = __paperCreateRequire(import.meta.url); const __filename = __paperFileURLToPath(import.meta.url); const __dirname = __paperDirname(__filename);" } },
  },
})
const chunks = (Array.isArray(compiler) ? compiler : [compiler]).flatMap(result => result.output).filter(chunk => chunk.type === 'chunk')
if (chunks.length !== 1) throw new Error('Export compiler must be one static module')
for (const id of Object.keys(chunks[0].modules)) {
  const name = id.split('/node_modules/').at(-1).match(/^(@[^/]+\/[^/]+|[^/]+)/)?.[0]
  if (id.includes('/node_modules/') && !toolNames.includes(name)) throw new Error(`Unapproved bundled export dependency: ${name}`)
}
files['.paper/compiler/compiler.js'] = chunks[0].code
for (const name of ['manifest.js', 'assets.js', 'data.js', 'preview-sandbox.js', 'preview-runtime.js']) {
  files[`.paper/compiler/${name}`] = await readFile(new URL(`./dist/src/make/${name}`, import.meta.url), 'utf8')
}
const runtimeNames = ['react', 'react-dom', 'scheduler', 'lucide-react', '@paper-design/shaders-react', '@paper-design/shaders']
files['.paper/runtime-versions.json'] = JSON.stringify(Object.fromEntries(runtimeNames.map(name => [name, lock.packages[`node_modules/${name}`].version])), null, 2) + '\n'
for (const name of [...runtimeNames, ...toolNames]) {
  const base = new URL(`../node_modules/${name}/`, import.meta.url)
  for (const filename of (await readdir(base)).filter(name => /^licen[sc]e(?:\.|$)/i.test(name))) {
    files[`.paper/licenses/${name.replaceAll('/', '-')}-${filename}`] = await readFile(new URL(filename, base), 'utf8')
  }
}
await writeFile(new URL('./dist/server/source-export-kit.json', import.meta.url), JSON.stringify({ files }))
