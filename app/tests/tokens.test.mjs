import test from 'node:test'
import assert from 'node:assert/strict'
import { SceneStore } from '../src/scene/store.ts'
import { tokensToCSS, tokenVariable } from '../src/tokens/model.ts'
import { buildCSSProps, buildTailwindClasses, buildReactComponent } from '../src/tokens/codegen.ts'
import { pasteTokenCSS } from '../src/tokens/clipboard.ts'
import { compile } from 'tailwindcss'

function scene() {
  const store = new SceneStore()
  store.add('rectangle', { id: 'a', style: { stroke: { color: '#000000', width: 1, dash: [] } } })
  store.add('rectangle', { id: 'b' })
  store.add('text', { id: 'text' })
  return store
}

test('a token update publishes once, resolves hidden and locked layers, and retains unrelated node identities', () => {
  const store = scene()
  const token = store.addToken({ type: 'color', name: 'brand', value: '#81adec' })
  store.bindToken('a', 'fill', token.id)
  store.bindToken('text', 'fill', token.id)
  store.setLocked('a', true)
  store.setVisible('text', false)
  const untouched = store.getSnapshot().elements.b
  let notifications = 0
  store.subscribe(() => notifications++)
  store.updateToken(token.id, { value: '#222222' })
  assert.equal(notifications, 1)
  assert.equal(store.getSnapshot().elements.a.style.fill, '#222222')
  assert.equal(store.getSnapshot().elements.text.style.fill, '#222222')
  assert.equal(store.getSnapshot().elements.b, untouched)
  assert.ok(Object.isFrozen(store.getSnapshot().tokens[0]))
  assert.ok(Object.isFrozen(store.getSnapshot().elements.a.tokenBindings))
})

test('all bindable typography, radius, spacing, and stroke values resolve from compatible tokens', () => {
  const store = scene()
  const cases = [['a', 'cornerRadius', 'radius', 12], ['a', 'stroke', 'color', '#edebe1'], ['a', 'x', 'spacing', 24], ['a', 'width', 'container', 720], ['text', 'fontFamily', 'fontFamily', 'Georgia, serif'], ['text', 'fontSize', 'fontSize', 48], ['text', 'fontWeight', 'fontWeight', 600], ['text', 'lineHeight', 'lineHeight', 1.5], ['text', 'letterSpacing', 'letterSpacing', -.5]]
  for (const [id, property, type, value] of cases) {
    const token = store.addToken({ type, name: `token-${property.toLowerCase()}`, value })
    store.bindToken(id, property, token.id)
    const node = store.getSnapshot().elements[id]
    assert.equal(property === 'stroke' ? node.style.stroke.color : node[property], value)
  }
  const roundtrip = new SceneStore()
  roundtrip.load(JSON.parse(JSON.stringify(store.toJSON())))
  assert.deepEqual(roundtrip.toJSON(), store.toJSON())
})

test('detach and token deletion preserve the current value; manual edits detach only the edited property', () => {
  const store = scene()
  const color = store.addToken({ type: 'color', name: 'ink', value: '#222222' })
  store.bindToken('a', 'fill', color.id)
  store.bindToken('a', 'stroke', color.id)
  store.update('a', 'rectangle', { style: { stroke: { ...store.getSnapshot().elements.a.style.stroke, width: 3 } } })
  assert.equal(store.getSnapshot().elements.a.tokenBindings.stroke, color.id)
  store.detachToken('a', 'fill')
  store.updateToken(color.id, { value: '#81adec' })
  assert.equal(store.getSnapshot().elements.a.style.fill, '#222222')
  assert.equal(store.getSnapshot().elements.a.style.stroke.color, '#81adec')
  store.removeTokens([color.id])
  assert.equal(store.getSnapshot().elements.a.style.stroke.color, '#81adec')
  assert.deepEqual(store.getSnapshot().elements.a.tokenBindings, {})
  store.undo()
  assert.equal(store.getSnapshot().elements.a.tokenBindings.stroke, color.id)
  store.update('a', 'rectangle', { style: { fill: '#edebe1' } })
  assert.equal(store.getSnapshot().elements.a.tokenBindings.stroke, color.id)
  const radius = store.addToken({ type: 'radius', name: 'card', value: 8 })
  store.bindToken('b', 'cornerRadius', radius.id)
  store.update('b', 'rectangle', { cornerRadius: 16 })
  store.updateToken(radius.id, { value: 24 })
  assert.equal(store.getSnapshot().elements.b.cornerRadius, 16)
})

test('token-only changes, binding, rename, duplicate and update support undo/redo', () => {
  const store = scene()
  store.clearHistory()
  const token = store.addToken({ type: 'color', name: 'brand', value: '#81adec' })
  store.undo()
  assert.equal(store.getSnapshot().tokens.length, 0)
  store.redo()
  assert.equal(store.getSnapshot().tokens.length, 1)
  store.bindToken('a', 'fill', token.id)
  store.updateToken(token.id, { name: 'accent', value: '#222222' })
  assert.equal(store.getSnapshot().elements.a.tokenBindings.fill, token.id)
  store.undo()
  assert.equal(store.getSnapshot().elements.a.style.fill, '#81adec')
  store.redo()
  assert.equal(store.getSnapshot().elements.a.style.fill, '#222222')
  const duplicate = store.duplicateToken(token.id)
  assert.equal(duplicate.name, 'accent-copy')
  assert.notEqual(duplicate.id, token.id)
  assert.equal(store.duplicateToken(token.id).name, 'accent-copy-2')
  const before = store.getSnapshot()
  store.updateToken(token.id, { name: 'accent' })
  assert.equal(store.getSnapshot(), before)
})

test('incompatible bindings and invalid token edits/imports reject atomically', () => {
  const store = scene()
  const color = store.addToken({ type: 'color', name: 'brand', value: '#81adec' })
  const gap = store.addToken({ type: 'spacing', name: 'gap', value: 24 })
  store.bindToken('a', 'width', gap.id)
  const before = store.getSnapshot()
  for (const work of [
    () => store.bindToken('a', 'cornerRadius', color.id),
    () => store.bindToken('a', 'fontSize', color.id),
    () => store.bindToken('a', 'fill', 'missing'),
    () => store.updateToken(color.id, { value: 5 }),
    () => store.updateToken(color.id, { value: 'notacolor' }),
    () => store.updateToken(color.id, { name: 'bad;name' }),
    () => store.updateToken(gap.id, { value: 0 }), // invalid for the bound width
    () => store.addToken({ type: 'color', name: 'brand', value: '#000000' }),
    () => store.addToken({ type: 'radius', name: 'negative', value: -1 }),
    () => store.addToken({ type: 'fontFamily', name: 'inject', value: 'Arial; color: red' }),
  ]) { assert.throws(work); assert.equal(store.getSnapshot(), before) }
  for (const mutate of [
    doc => { doc.elements.a.tokenBindings = { fill: 'missing' } },
    doc => { doc.elements.a.tokenBindings = { fill: gap.id } },
    doc => { doc.elements.a.tokenBindings = null },
    doc => { doc.elements.a.tokenBindings = 42 },
    doc => { doc.tokens.push(doc.tokens[0]) },
    doc => { doc.tokens = {} },
  ]) {
    const document = JSON.parse(JSON.stringify(store.toJSON()))
    mutate(document)
    assert.throws(() => store.load(document))
    assert.equal(store.getSnapshot(), before)
  }
  const legacy = JSON.parse(JSON.stringify(store.toJSON()))
  delete legacy.tokens
  delete legacy.elements.a.tokenBindings
  store.load(legacy)
  assert.deepEqual(store.getSnapshot().tokens, [])
})

test('handoff uses actual bindings for CSS and Tailwind, including zero radius and no inline spacing overrides', () => {
  const store = scene()
  const inputs = [
    ['fill', 'color', 'brand', '#81adec'], ['cornerRadius', 'radius', 'flat', 0],
    ['fontSize', 'fontSize', 'title', 48], ['fontFamily', 'fontFamily', 'display', 'Georgia, serif'],
    ['fontWeight', 'fontWeight', 'strong', 600], ['lineHeight', 'lineHeight', 'relaxed', 1.5],
    ['letterSpacing', 'letterSpacing', 'tight', -.5], ['x', 'spacing', 'gutter', 24],
    ['y', 'spacing', 'gutter-y', 24], ['width', 'spacing', 'wide', 240], ['height', 'spacing', 'tall', 120],
  ]
  for (const [property, type, name, value] of inputs) {
    const token = store.addToken({ type, name, value })
    store.bindToken(property === 'cornerRadius' ? 'a' : 'text', property, token.id)
  }
  const { tokens, elements } = store.getSnapshot()
  const css = buildCSSProps(elements.text, tokens)
  assert.equal(css.find(prop => prop.property === 'color').value, 'var(--color-brand)')
  assert.equal(css.find(prop => prop.property === 'font-family').value, 'var(--font-display)')
  assert.equal(css.find(prop => prop.property === 'font-size').value, 'var(--text-title)')
  assert.equal(buildCSSProps(elements.a, tokens).find(prop => prop.property === 'border-radius').value, 'var(--radius-flat)')
  const classes = buildTailwindClasses(elements.text, tokens)
  for (const name of ['text-brand', 'text-title', 'font-display', 'font-strong', 'leading-relaxed', 'tracking-tight', 'left-gutter', 'top-gutter-y', 'w-wide', 'h-tall']) assert.ok(classes.includes(name))
  const code = buildReactComponent(elements.text, tokens)
  assert.ok(!code.includes('left:') && !code.includes('width:') && !code.includes('fontFamily:'))
  assert.ok(tokensToCSS(tokens).includes('--text-title: 48px;'))
  assert.ok(tokensToCSS(tokens, true).startsWith('@theme static {'))
  assert.equal(tokenVariable(tokens[0]), '--color-brand')
  // A visually matching hardcoded color is never mislabeled as a binding.
  assert.equal(buildCSSProps(elements.b, tokens).find(prop => prop.property === 'background-color').token, undefined)
})

test('CSS clipboard imports whole themes in one undo step and rejects invalid themes atomically', () => {
  const store = scene()
  let notifications = 0
  store.subscribe(() => notifications++)
  assert.equal(pasteTokenCSS(store, ':root { --color-brand: #81adec; --radius-card: 8px; --font-weight-body: 600; --font-body: Georgia, serif; }'), 4)
  assert.equal(notifications, 1)
  const tokens = store.getSnapshot().tokens
  assert.equal(tokens.find(token => token.type === 'fontWeight').value, 600)
  assert.equal(tokens.find(token => token.type === 'fontFamily').value, 'Georgia, serif')
  store.undo()
  assert.equal(store.getSnapshot().tokens.length, 0)
  store.redo()
  assert.deepEqual(store.getSnapshot().tokens, tokens)
  const before = store.getSnapshot()
  assert.throws(() => pasteTokenCSS(store, ':root { --radius-valid: 8px; --text-invalid: -1px; }'))
  assert.throws(() => pasteTokenCSS(store, ':root { --spacing-empty: ; }'))
  assert.throws(() => pasteTokenCSS(store, ':root { --radius-valid: 8px; --spacing-empty:; }'))
  assert.equal(store.getSnapshot(), before)
  assert.equal(pasteTokenCSS(store, tokensToCSS(tokens, true)), 4)
  assert.ok(store.getSnapshot().tokens.some(token => token.name === 'brand-2'))
  assert.equal(pasteTokenCSS(store, 'A note for the canvas'), 0)
})

test('generated handoff compiles the correct properties when typography and colors share names', async () => {
  const store = scene()
  for (const [property, type, value] of [['fill', 'color', '#81adec'], ['fontSize', 'fontSize', 48], ['fontFamily', 'fontFamily', 'Georgia, serif'], ['fontWeight', 'fontWeight', 600]]) {
    const token = store.addToken({ type, name: 'body', value })
    store.bindToken('text', property, token.id)
  }
  const { tokens, elements } = store.getSnapshot()
  const classes = buildTailwindClasses(elements.text, tokens).split(' ')
  const compiler = await compile(`${tokensToCSS(tokens, true)}\n@tailwind utilities;`)
  const css = compiler.build(classes)
  for (const declaration of ['color: var(--color-body)', 'font-size: var(--text-body)', 'font-family: var(--font-body)', 'font-weight: var(--font-weight-body)']) assert.ok(css.includes(declaration), declaration)
})

test('duplicate names also avoid overlapping CSS namespaces', () => {
  const store = scene()
  const weight = store.addToken({ type: 'fontWeight', name: 'body', value: 600 })
  store.addToken({ type: 'fontFamily', name: 'weight-body-copy', value: 'Georgia, serif' })
  assert.equal(store.duplicateToken(weight.id).name, 'body-copy-2')
})

test('reserved Tailwind color names retain their bound values in generated handoff', async () => {
  const store = scene()
  for (const name of ['inherit', 'current', 'transparent']) {
    const token = store.addToken({ type: 'color', name, value: '#81adec' })
    for (const [id, property] of [['a', 'fill'], ['a', 'stroke'], ['text', 'fill']]) store.bindToken(id, property, token.id)
    const { tokens, elements } = store.getSnapshot()
    const classes = [buildTailwindClasses(elements.a, tokens), buildTailwindClasses(elements.text, tokens)].join(' ').split(' ')
    const compiler = await compile(`${tokensToCSS(tokens, true)}\n@tailwind utilities;`)
    const css = compiler.build(classes)
    for (const property of ['background-color', 'border-color', 'color']) assert.ok(css.includes(`${property}: var(--color-${name})`), `${name}: ${property}`)
  }
})
