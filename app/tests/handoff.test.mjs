import test from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import { compile } from 'tailwindcss'
import { SceneStore } from '../src/scene/store.ts'
import { buildCSSProps, buildTailwindClasses, buildReactComponent } from '../src/tokens/codegen.ts'

test('unbound handoff compiles exact paint, geometry, opacity, and typography', async () => {
  const store = new SceneStore()
  const { id } = store.add('text', { x: 24, y: -12, width: 123, height: 57, fontSize: 10, fontWeight: 450, fontFamily: '"IBM Plex Sans", sans-serif', lineHeight: 1.37, style: { fill: '#81adec', opacity: .333 } })
  const node = store.getSnapshot().elements[id]
  const classes = buildTailwindClasses(node).split(' ')
  const compiler = await compile('@tailwind utilities;')
  const css = compiler.build(classes)
  for (const declaration of ['left: 24px', 'top: -12px', 'width: 123px', 'height: 57px', 'color: #81adec', 'font-size: 10px', 'font-weight: 450', 'opacity: 0.333', 'font-family: "IBM Plex Sans", sans-serif', 'line-height: 1.37']) assert.ok(css.includes(declaration), declaration)
  const code = buildReactComponent(node)
  assert.deepEqual(ts.createSourceFile('Handoff.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX).parseDiagnostics, [])
})

test('token CSS retains current resolved values, including dashed stroke', () => {
  const store = new SceneStore()
  const { id } = store.add('rectangle', { style: { stroke: { color: '#222222', width: 2, dash: [4, 2] } } })
  const token = store.addToken({ type: 'color', name: 'ink', value: '#080808' })
  store.bindToken(id, 'fill', token.id)
  store.bindToken(id, 'stroke', token.id)
  store.updateToken(token.id, { value: '#222222' })
  const state = store.getSnapshot(), props = buildCSSProps(state.elements[id], state.tokens)
  assert.deepEqual(props.find(prop => prop.property === 'background-color'), { property: 'background-color', value: 'var(--color-ink)', token: '--color-ink', resolvedValue: '#222222' })
  assert.equal(props.find(prop => prop.property === 'border').resolvedValue, '2px dashed #222222')
  assert.equal(props.find(prop => prop.property === 'border').value, '2px dashed var(--color-ink)')
})

test('image JSX safely round-trips quotes, braces, backslashes and newlines', () => {
  const store = new SceneStore()
  const src = 'https://example.test/asset?label="paper"&value={x}', alt = 'Paper "study"\n{one} \\ two'
  const { id } = store.add('image', { src, alt })
  const code = buildReactComponent(store.getSnapshot().elements[id])
  const file = ts.createSourceFile('Image.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  assert.deepEqual(file.parseDiagnostics, [])
  const attributes = new Map()
  function visit(node) { if (ts.isJsxAttribute(node) && node.initializer && ts.isJsxExpression(node.initializer) && ts.isStringLiteral(node.initializer.expression)) attributes.set(node.name.getText(file), node.initializer.expression.text); ts.forEachChild(node, visit) }
  visit(file)
  assert.equal(attributes.get('src'), src)
  assert.equal(attributes.get('alt'), alt)
})

test('fill sizing without auto layout keeps resolved fixed dimensions in Tailwind', () => {
  const store = new SceneStore()
  const { id } = store.add('rectangle', { width: 180, height: 90, sizing: { width: 'fill', height: 'fill' } })
  const classes = buildTailwindClasses(store.getSnapshot().elements[id])
  assert.ok(classes.includes('w-[180px]'))
  assert.ok(classes.includes('h-[90px]'))
})
