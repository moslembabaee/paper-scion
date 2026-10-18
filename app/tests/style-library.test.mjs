import test from 'node:test'
import assert from 'node:assert/strict'
import { SceneStore } from '../src/scene/store.ts'
import { resolveSharedStyle, resolveTokens } from '../src/tokens/library.ts'
import { pasteTokenCSS } from '../src/tokens/clipboard.ts'
import { designSystemToCSS } from '../src/tokens/libraryCodegen.ts'
import { sceneToSVG } from '../src/io/svg.ts'
import { buildCSSProps, buildReactComponent } from '../src/tokens/codegen.ts'
import { createProject } from '../src/io/project.ts'
import { projectSchema, validateSchema } from '../src/mcp/schema.ts'

const typography = { fontFamily: 'Georgia, serif', fontSize: 48, fontWeight: 500, lineHeight: 1.25, letterSpacing: -1, textAlign: 'left' }
const stack = [
  { id: 'drop', type: 'drop-shadow', enabled: true, color: '#08080833', x: 0, y: 8, blur: 20, spread: 2 },
  { id: 'inner', type: 'inner-shadow', enabled: true, color: '#ffffff88', x: 0, y: 2, blur: 4, spread: 1 },
  { id: 'blur', type: 'layer-blur', enabled: false, blur: 8 },
]
function scene() {
  const store = new SceneStore()
  store.add('rectangle', { id: 'a' }); store.add('rectangle', { id: 'untouched' }); store.add('text', { id: 'text' })
  return store
}
function roundtrip(store) {
  const loaded = new SceneStore(); loaded.load(JSON.parse(JSON.stringify(store.toJSON())))
  assert.deepEqual(loaded.toJSON(), store.toJSON())
  return loaded
}

test('alias chains react to source edits and theme switches in one publication', () => {
  const store = scene(), theme = store.addTheme('Dark')
  const base = store.addToken({ id: 'ink', type: 'color', name: 'ink', value: '#080808', themeValues: { [theme]: '#edebe1' }, palette: 'Neutrals' })
  store.addToken({ id: 'semantic', type: 'color', name: 'foreground', value: '#080808', aliasId: base.id })
  store.addToken({ id: 'alias', type: 'color', name: 'heading', value: '#080808', aliasId: 'semantic' })
  store.bindToken('a', 'fill', 'alias'); store.setLocked('a', true)
  const untouched = store.getSnapshot().elements.untouched
  let count = 0; store.subscribe(() => count++)
  store.setActiveTheme(theme)
  assert.equal(count, 1); assert.equal(store.getSnapshot().elements.a.style.fill, '#edebe1')
  assert.equal(store.getSnapshot().elements.untouched, untouched)
  assert.equal(store.getSnapshot().tokens[0].value, '#080808')
  assert.equal(roundtrip(store).getSnapshot().elements.a.style.fill, '#edebe1')
  store.setTokenThemeValue(base.id, theme, '#81adec')
  assert.equal(store.getSnapshot().elements.a.style.fill, '#81adec')
  store.setActiveTheme(null); assert.equal(store.getSnapshot().elements.a.style.fill, '#080808')
  assert.equal(resolveTokens(store.getSnapshot().tokens), resolveTokens(store.getSnapshot().tokens))
})

test('cycles, missing references, invalid modes and invalid stacks reject atomically', () => {
  const store = scene(), theme = store.addTheme('Dark')
  store.addToken({ id: 'base', type: 'color', name: 'base', value: '#080808' })
  store.addToken({ id: 'alias', type: 'color', name: 'alias', value: '#080808', aliasId: 'base' })
  const before = store.getSnapshot()
  for (const work of [
    () => store.updateToken('base', { aliasId: 'alias' }),
    () => store.updateToken('alias', { aliasId: 'missing' }),
    () => store.setTokenThemeValue('base', theme, 'invalid'),
    () => store.setTokenThemeValue('base', 'missing', '#ffffff'),
    () => store.setActiveTheme('missing'),
    () => store.addToken({ type: 'radius', name: 'wrong', value: 8, aliasId: 'base' }),
    () => store.addSharedStyle({ kind: 'effects', name: 'Bad', value: [{ ...stack[0], blur: -1 }] }),
    () => store.addSharedStyle({ kind: 'typography', name: 'Bad', value: { ...typography, tokenBindings: { fontSize: 'base' } } }),
  ]) { assert.throws(work); assert.equal(store.getSnapshot(), before) }
  const document = JSON.parse(JSON.stringify(store.toJSON())); document.styleLibrary.activeThemeId = 'missing'
  assert.throws(() => store.load(document)); assert.equal(store.getSnapshot(), before)
})

test('shared typography resolves tokens, propagates, and detaches on manual edits', () => {
  const store = scene(), size = store.addToken({ type: 'fontSize', name: 'display', value: 60 })
  const preset = store.addSharedStyle({ kind: 'typography', name: 'Display', value: { ...typography, tokenBindings: { fontSize: size.id } } })
  store.bindSharedStyle('text', 'typography', preset.id)
  assert.equal(store.getSnapshot().elements.text.fontSize, 60)
  store.updateToken(size.id, { value: 72 }); assert.equal(store.getSnapshot().elements.text.fontSize, 72)
  store.updateSharedStyle({ ...preset, value: { ...preset.value, fontFamily: 'Arial, sans-serif' } })
  assert.equal(store.getSnapshot().elements.text.fontFamily, 'Arial, sans-serif')
  store.update('text', 'text', { fontSize: 24 })
  assert.equal(store.getSnapshot().elements.text.sharedStyleBindings.typography, undefined)
  store.updateToken(size.id, { value: 90 }); assert.equal(store.getSnapshot().elements.text.fontSize, 24)
  roundtrip(store)
})

test('shared color and effect token references follow document themes and retain frozen values', () => {
  const store = scene(), theme = store.addTheme('Dark')
  const token = store.addToken({ id: 'accent', type: 'color', name: 'accent', value: '#81adec', themeValues: { [theme]: '#edebe1' } })
  const color = store.addSharedStyle({ kind: 'color', name: 'Brand', value: '#81adec', tokenId: token.id })
  const effects = store.addSharedStyle({ kind: 'effects', name: 'Elevation', value: [{ ...stack[0], colorTokenId: token.id }, ...stack.slice(1)] })
  store.bindSharedStyle('a', 'color', color.id); store.bindSharedStyle('a', 'effects', effects.id)
  store.setActiveTheme(theme)
  assert.equal(store.getSnapshot().elements.a.style.fill, '#edebe1')
  assert.equal(store.getSnapshot().elements.a.style.effects[0].color, '#edebe1')
  assert.ok(Object.isFrozen(store.getSnapshot().styleLibrary.styles[1].value[0]))
  assert.ok(Object.isFrozen(store.getSnapshot().elements.a.sharedStyleBindings))
  store.detachSharedStyle('a', 'color'); store.removeSharedStyle(effects.id)
  store.setActiveTheme(null)
  assert.equal(store.getSnapshot().elements.a.style.fill, '#edebe1')
  assert.equal(store.getSnapshot().elements.a.style.effects[0].color, '#81adec') // effect color binding remains live after detaching its preset
  roundtrip(store)
})

test('deleting alias targets materializes aliases in every theme and deletes style references safely', () => {
  const store = scene(), theme = store.addTheme('Dark')
  const base = store.addToken({ id: 'base', type: 'color', name: 'base', value: '#080808', themeValues: { [theme]: '#edebe1' } })
  store.addToken({ id: 'alias', type: 'color', name: 'alias', value: '#080808', aliasId: base.id })
  const style = store.addSharedStyle({ kind: 'color', name: 'Ink', value: '#080808', tokenId: base.id })
  store.bindToken('a', 'fill', 'alias'); store.bindSharedStyle('text', 'color', style.id)
  store.setActiveTheme(theme); store.removeTokens([base.id])
  assert.equal(store.getSnapshot().elements.a.style.fill, '#edebe1')
  assert.equal(store.getSnapshot().styleLibrary.styles[0].tokenId, undefined)
  store.setActiveTheme(null); assert.equal(store.getSnapshot().elements.a.style.fill, '#080808')
  roundtrip(store)
})

test('library-only changes and theme switching participate in undo and redo', () => {
  const store = scene(); store.clearHistory()
  const theme = store.addTheme('Dark'); store.undo(); assert.equal(store.getSnapshot().styleLibrary.themes.length, 0)
  store.redo(); store.setActiveTheme(theme); store.undo(); assert.equal(store.getSnapshot().styleLibrary.activeThemeId, null)
  store.redo(); assert.equal(store.getSnapshot().styleLibrary.activeThemeId, theme)
  const preset = store.addSharedStyle({ kind: 'color', name: 'Ink', value: '#080808' })
  store.undo(); assert.equal(store.getSnapshot().styleLibrary.styles.length, 0)
  store.redo(); assert.equal(store.getSnapshot().styleLibrary.styles[0].id, preset.id)
  store.removeTheme(theme); assert.equal(store.getSnapshot().styleLibrary.activeThemeId, null)
  store.undo(); assert.equal(store.getSnapshot().styleLibrary.activeThemeId, theme)
})

test('component inheritance respects shared presets, local bindings, edits and reset', () => {
  const store = scene()
  const preset = store.addSharedStyle({ kind: 'typography', name: 'Heading', value: typography })
  store.bindSharedStyle('text', 'typography', preset.id); store.createComponent('text')
  const instance = store.createComponentInstance('text')
  store.updateSharedStyle({ ...preset, value: { ...typography, fontSize: 64 } })
  assert.equal(store.getSnapshot().elements[instance.id].fontSize, 64)
  store.update(instance.id, 'text', { fontSize: 24 })
  store.updateSharedStyle({ ...preset, value: { ...typography, fontSize: 80 } })
  assert.equal(store.getSnapshot().elements[instance.id].fontSize, 24)
  store.bindSharedStyle(instance.id, 'typography', preset.id)
  assert.equal(store.getSnapshot().elements[instance.id].fontSize, 80)
  const size = store.addToken({ type: 'fontSize', name: 'local', value: 32 })
  store.bindToken(instance.id, 'fontSize', size.id)
  assert.equal(store.getSnapshot().elements[instance.id].fontSize, 32)
  assert.equal(store.getSnapshot().elements[instance.id].sharedStyleBindings.typography, undefined)
  store.resetComponentOverrides(instance.id)
  assert.equal(store.getSnapshot().elements[instance.id].fontSize, 80)
  roundtrip(store)
})

test('effect filters preserve stack order, escape colors, skip disabled effects, and export primitives', () => {
  const store = scene(); store.update('a', 'rectangle', { style: { effects: stack } })
  const svg = sceneToSVG(store.getSnapshot(), { scope: 'canvas', scale: 1, background: 'transparent' })
  assert.ok(svg.includes('feMorphology')); assert.ok(svg.includes('operator="out"'))
  assert.ok(svg.includes('result="effect-0"')); assert.ok(svg.includes('result="effect-1"'))
  assert.ok(!svg.includes('result="effect-2"'))
  const css = buildCSSProps(store.getSnapshot().elements.a).find(prop => prop.property === 'box-shadow').value
  assert.ok(css.includes('inset 0px 2px 4px 1px #ffffff88'))
  store.add('path', { id: 'path', style: { effects: stack } })
  assert.ok(buildReactComponent(store.getSnapshot().elements.path).includes('<feComposite'))
})

test('geometry-only edits reuse frozen effect stacks and handoff matches SVG shadow precedence', () => {
  const store = scene()
  store.update('a', 'rectangle', { style: { effects: stack, shadow: { color: '#81adec', x: 1, y: 2, blur: 3 } } })
  const effects = store.getSnapshot().elements.a.style.effects
  store.update('a', 'rectangle', { x: 240 })
  assert.equal(store.getSnapshot().elements.a.style.effects, effects)
  assert.ok(Object.isFrozen(effects))
  assert.ok(Object.isFrozen(effects[0]))
  const props = buildCSSProps(store.getSnapshot().elements.a)
  assert.equal(props.filter(prop => prop.property === 'box-shadow').length, 1)
  assert.ok(!props.find(prop => prop.property === 'box-shadow').value.includes('#81adec'))
})

test('theme CSS exports aliases, theme scopes, and token references in shared typography and effects', () => {
  const store = scene(), theme = store.addTheme('Dark')
  const color = store.addToken({ id: 'color', type: 'color', name: 'ink', value: '#080808', themeValues: { [theme]: '#edebe1' } })
  store.addToken({ id: 'alias', type: 'color', name: 'foreground', value: '#080808', aliasId: color.id })
  store.addSharedStyle({ kind: 'effects', name: 'Shadow', value: [{ ...stack[0], colorTokenId: color.id }] })
  const css = designSystemToCSS(store.getSnapshot().tokens, store.getSnapshot().styleLibrary)
  assert.ok(css.includes('--color-foreground: var(--color-ink)'))
  assert.ok(css.includes(`[data-paper-theme="${theme}"]`)); assert.ok(css.includes('--color-foreground: #edebe1'))
  assert.ok(css.includes('20px 2px var(--color-ink)'))
})

test('previews resolve themed typography and shadow colors and resolved tokens stay immutable', () => {
  const store = scene(), theme = store.addTheme('Dark')
  const color = store.addToken({ id: 'color', type: 'color', name: 'ink', value: '#080808', themeValues: { [theme]: '#edebe1' } })
  const size = store.addToken({ id: 'size', type: 'fontSize', name: 'display', value: 48, themeValues: { [theme]: 64 } })
  const colorStyle = store.addSharedStyle({ kind: 'color', name: 'Ink', value: '#81adec', tokenId: color.id })
  const typeStyle = store.addSharedStyle({ kind: 'typography', name: 'Display', value: { ...typography, tokenBindings: { fontSize: size.id } } })
  const effectStyle = store.addSharedStyle({ kind: 'effects', name: 'Elevation', value: [{ ...stack[0], colorTokenId: color.id }] })
  const tokens = store.getSnapshot().tokens
  store.setActiveTheme(theme)
  assert.equal(store.getSnapshot().tokens, tokens)
  const resolved = resolveTokens(tokens, theme)
  assert.equal(resolveSharedStyle(colorStyle, resolved).value, '#edebe1')
  assert.equal(resolveSharedStyle(typeStyle, resolved).value.fontSize, 64)
  assert.equal(resolveSharedStyle(effectStyle, resolved).value[0].color, '#edebe1')
  assert.equal(typeStyle.value.fontSize, 48)
  assert.ok(Object.isFrozen(resolved.find(token => token.id === color.id)))
  assert.throws(() => { resolved.find(token => token.id === color.id).value = '#222222' })
  assert.equal(resolveTokens(tokens, theme), resolved)
})

test('CSS clipboard preserves alias chains and ignores theme and shared-style scopes', () => {
  const source = scene(), theme = source.addTheme('Dark')
  source.addToken({ id: 'base', type: 'color', name: 'ink', value: '#080808', themeValues: { [theme]: '#edebe1' } })
  source.addToken({ id: 'alias', type: 'color', name: 'foreground', value: '#080808', aliasId: 'base' })
  source.addSharedStyle({ kind: 'color', name: 'Ink', value: '#080808', tokenId: 'alias' })
  const target = scene(), css = designSystemToCSS(source.getSnapshot().tokens, source.getSnapshot().styleLibrary)
  assert.equal(pasteTokenCSS(target, css), 2)
  const imported = target.getSnapshot().tokens
  assert.equal(imported.find(token => token.name === 'foreground').aliasId, imported.find(token => token.name === 'ink').id)
  target.bindToken('a', 'fill', imported.find(token => token.name === 'foreground').id)
  target.updateToken(imported.find(token => token.name === 'ink').id, { value: '#81adec' })
  assert.equal(target.getSnapshot().elements.a.style.fill, '#81adec')
  assert.equal(pasteTokenCSS(target, css), 2)
  const duplicated = target.getSnapshot().tokens
  assert.equal(duplicated.find(token => token.name === 'foreground-2').aliasId, duplicated.find(token => token.name === 'ink-2').id)
  const before = target.getSnapshot()
  for (const invalid of [
    ':root { --color-a: var(--color-missing); }',
    ':root { --color-a: var(--color-b); --color-b: var(--color-a); }',
    ':root { --radius-a: var(--color-ink); }',
  ]) { assert.throws(() => pasteTokenCSS(target, invalid)); assert.equal(target.getSnapshot(), before) }
  const forward = scene()
  pasteTokenCSS(forward, ':root { --color-foreground: var(--color-ink); --color-ink: #222222; }')
  assert.equal(resolveTokens(forward.getSnapshot().tokens)[0].value, '#222222')
})

test('shared styles survive transformed boolean release and continue to react', () => {
  const store = scene()
  store.update('a', 'rectangle', { cornerRadius: 12 })
  const preset = store.addSharedStyle({ kind: 'color', name: 'Ink', value: '#080808' })
  store.bindSharedStyle('a', 'color', preset.id)
  const compound = store.booleanSelection('union', false, ['a', 'untouched'])
  store.updateSharedStyle({ ...preset, value: '#81adec' })
  assert.equal(store.getSnapshot().elements[compound.id].boolean.operands.find(node => node.id === 'a').style.fill, '#81adec')
  store.update(compound.id, 'path', { width: compound.width * 2 })
  store.releaseBoolean(compound.id)
  assert.equal(store.getSnapshot().elements.a.type, 'path')
  assert.equal(store.getSnapshot().elements.a.sharedStyleBindings.color, preset.id)
  store.updateSharedStyle({ ...preset, value: '#222222' })
  assert.equal(store.getSnapshot().elements.a.style.fill, '#222222')
  roundtrip(store)
})

test('the published project schema accepts complete libraries and rejects malformed new fields', () => {
  const store = scene(), theme = store.addTheme('Dark')
  const token = store.addToken({ id: 'ink', type: 'color', name: 'ink', value: '#080808', palette: 'Neutrals', themeValues: { [theme]: '#edebe1' } })
  store.addToken({ id: 'alias', type: 'color', name: 'foreground', value: '#080808', aliasId: token.id })
  const color = store.addSharedStyle({ kind: 'color', name: 'Ink', value: '#080808', tokenId: 'alias' })
  const type = store.addSharedStyle({ kind: 'typography', name: 'Display', value: typography })
  const effect = store.addSharedStyle({ kind: 'effects', name: 'Elevation', value: stack })
  store.bindSharedStyle('a', 'color', color.id)
  store.bindSharedStyle('a', 'effects', effect.id)
  store.bindSharedStyle('text', 'typography', type.id)
  store.setActiveTheme(theme)
  const project = createProject(store, 'Library', { x: 0, y: 0, zoom: 1 }, true)
  assert.doesNotThrow(() => validateSchema(project, projectSchema))
  for (const mutate of [
    project => { project.scene.styleLibrary.styles[0].kind = 'unknown' },
    project => { project.scene.tokens[0].themeValues[theme] = 100 },
    project => { project.scene.elements.a.style.effects[0].blur = -1 },
    project => { project.scene.elements.a.sharedStyleBindings.unknown = color.id },
  ]) { const invalid = structuredClone(project); mutate(invalid); assert.throws(() => validateSchema(invalid, projectSchema)) }
})
