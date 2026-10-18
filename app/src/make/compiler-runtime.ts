// Host-only: build Paper's installed, trusted runtime, never generated sources.
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'

export const DEFAULT_ALLOWED_PACKAGES = Object.freeze([
  'react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom',
  'react-dom/client', 'lucide-react', '@paper-design/shaders-react',
])

let runtimeBuild: Promise<string> | undefined

export function getPreviewRuntime(): Promise<string> {
  if (!runtimeBuild) {
    runtimeBuild = readFile(new URL('./preview-runtime.js', import.meta.url), 'utf8').catch(error => {
      if (error.code !== 'ENOENT') throw error
      // Source-level development/tests can build the trusted installed packages.
      // Production receives this immutable artifact from build:server.
      return bundlePreviewRuntime()
    }).catch(error => {
      runtimeBuild = undefined
      throw error
    })
  }
  return runtimeBuild
}

export async function bundlePreviewRuntime(): Promise<string> {
  const { build } = await import('vite')
  const require = createRequire(import.meta.url)
  const packages = DEFAULT_ALLOWED_PACKAGES
  const source = packages.map((name, i) => `import * as p${i} from ${JSON.stringify(require.resolve(name))};`).join('\n') +
    `\nglobalThis.__paperPreviewPackages = {${packages.map((name, i) => `${JSON.stringify(name)}: p${i}`).join(',')}};`
  const output = await build({
    configFile: false,
    envDir: false,
    publicDir: false,
    logLevel: 'silent',
    mode: 'production',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    css: { postcss: { plugins: [] } },
    plugins: [{
      name: 'paper-fixed-preview-runtime',
      enforce: 'pre',
      resolveId(id) { if (id === '/__paper-preview-runtime.js') return '\0paper-preview-runtime' },
      load(id) { if (id === '\0paper-preview-runtime') return source },
    }],
    build: {
      write: false,
      minify: true,
      sourcemap: false,
      lib: { entry: '/__paper-preview-runtime.js', name: 'PaperPreviewRuntime', formats: ['iife'] },
    },
  })
  const outputs = Array.isArray(output) ? output : [output]
  const chunks = outputs.flatMap(result => {
    if (!('output' in result)) throw new Error('Unexpected runtime build output')
    return result.output.filter(chunk => chunk.type === 'chunk')
  })
  if (chunks.length !== 1) throw new Error('Preview runtime must be a single static script')
  return chunks[0].code
}
