import test from 'node:test'
import assert from 'node:assert/strict'
import { SceneStore } from '../src/scene/store.ts'
import { subtree } from '../src/scene/components.ts'
import { foundationTokens } from '../src/tokens/foundation.ts'
import { buildCSSProps, buildTailwindClasses } from '../src/tokens/codegen.ts'

function setup() {
  const store = new SceneStore()
  store.add('frame', { id: 'button', width: 240, height: 120 })
  store.add('text', { id: 'label', parentId: 'button', text: 'Continue' })
  store.add('ellipse', { id: 'icon', parentId: 'button', width: 16, height: 16 })
  store.createComponent('button')
  const definitions = [
    { id: 'tone', name: 'Tone', kind: 'variant', defaultValue: 'Default', options: [{ value: 'Default', layers: {} }, { value: 'Accent', layers: { button: { style: { fill: '#81adec' } }, label: { properties: { fontWeight: 600 } } } }] },
    { id: 'copy', name: 'Label', kind: 'text', sourceId: 'label', defaultValue: 'Continue' },
    { id: 'show-icon', name: 'Show icon', kind: 'boolean', sourceId: 'icon', defaultValue: true },
  ]
  store.setComponentProperties('button', definitions)
  const instance = store.createComponentInstance('button')
  const layer = sourceId => subtree(store.getSnapshot().elements, instance.id).find(node => node.component.sourceId === sourceId)
  return { store, instance, layer, definitions }
}
function roundtrip(store) {
  const restored = new SceneStore()
  restored.load(JSON.parse(JSON.stringify(store.toJSON())))
  assert.deepEqual(restored.toJSON(), store.toJSON())
}

test('variant, text and visibility switches compose without changing the master; local edits win', () => {
  const { store, instance, layer } = setup()
  const untouched = store.add('rectangle', { id: 'unrelated' })
  store.setComponentProperty(instance.id, 'tone', 'Accent')
  store.setComponentProperty(layer('label').id, 'copy', '')
  store.setComponentProperty(instance.id, 'show-icon', false)
  assert.equal(layer('button').style.fill, '#81adec')
  assert.equal(layer('label').text, '')
  assert.equal(layer('label').fontWeight, 600)
  assert.equal(layer('icon').visible, false)
  assert.equal(store.getSnapshot().elements.icon.visible, true)
  assert.equal(store.getSnapshot().elements.unrelated, untouched)
  store.update(layer('label').id, 'text', { text: 'Local' })
  store.setComponentProperty(instance.id, 'copy', 'Configured')
  assert.equal(layer('label').text, 'Local')
  store.resetComponentOverrides(layer('label').id)
  assert.equal(layer('label').text, 'Configured')
  roundtrip(store)
})

test('property defaults propagate while local values persist; root reset, undo and detach are complete', () => {
  const { store, instance, layer, definitions } = setup()
  store.setComponentProperty(instance.id, 'copy', 'Local label')
  store.setComponentProperties('button', definitions.map(property => property.id === 'copy' ? { ...property, defaultValue: 'New default' } : property))
  assert.equal(layer('label').text, 'Local label')
  store.setComponentProperty(instance.id, 'copy', null)
  assert.equal(layer('label').text, 'New default')
  store.setComponentProperty(instance.id, 'tone', 'Accent')
  store.setComponentProperty(instance.id, 'show-icon', false)
  store.clearHistory()
  store.resetComponentOverrides(instance.id)
  assert.equal(layer('icon').visible, true)
  assert.deepEqual(layer('button').component.propertyValues, {})
  store.undo()
  assert.equal(layer('icon').visible, false)
  assert.equal(layer('button').style.fill, '#81adec')
  roundtrip(store)
  const root = layer('button')
  store.detachComponentInstance(instance.id)
  assert.equal(store.getSnapshot().elements[root.id].component, undefined)
  assert.equal(store.getSnapshot().elements[root.id].style.fill, '#81adec')
})

test('invalid definitions and inactive variants are rejected atomically; removed layers release definitions', () => {
  const { store, instance, definitions } = setup()
  const before = store.getSnapshot()
  assert.throws(() => store.setComponentProperty(instance.id, 'tone', 'Unknown'))
  assert.throws(() => store.setComponentProperty(instance.id, 'show-icon', 'false'))
  assert.throws(() => store.setComponentProperties('button', [...definitions, { id: 'bad', name: 'Bad', kind: 'text', sourceId: 'icon', defaultValue: 'x' }]))
  assert.throws(() => store.setComponentProperties('button', [{ ...definitions[0], options: [{ value: 'Default', layers: {} }, { value: 'Bad', layers: { button: { properties: { width: -1 } } } }] }]))
  assert.equal(store.getSnapshot(), before)
  const corrupt = structuredClone(store.toJSON())
  corrupt.elements[instance.id].component.propertyValues = { tone: 'Unknown' }
  assert.throws(() => new SceneStore().load(corrupt))
  store.setComponentProperty(instance.id, 'show-icon', false)
  store.remove('icon')
  assert.equal(store.getSnapshot().elements.button.component.properties.some(property => property.id === 'show-icon'), false)
  assert.equal(Object.hasOwn(store.getSnapshot().elements[instance.id].component.propertyValues, 'show-icon'), false)
  roundtrip(store)
})

test('semantic colors, type scales and elevation aliases synchronize variants through themes and deletion', () => {
  const { store, instance, layer, definitions } = setup()
  store.addTokens(foundationTokens(store.getSnapshot().tokens))
  assert.equal(foundationTokens(store.getSnapshot().tokens).length, 0)
  const token = name => store.getSnapshot().tokens.find(token => token.name === name)
  store.bindToken('label', 'fontSize', token('body').id)
  store.bindToken('button', 'shadow', token('raised').id)
  const accent = { ...definitions[0], options: [{ value: 'Default', layers: {} }, { value: 'Accent', layers: { button: { tokenBindings: { fill: token('action').id } } } }] }
  store.setComponentProperties('button', [accent, ...definitions.slice(1)])
  store.setComponentProperty(instance.id, 'tone', 'Accent')
  store.updateToken(token('blue').id, { value: '#222222' })
  store.updateToken(token('body').id, { value: 20 })
  store.updateToken(token('raised').id, { value: 8 })
  assert.equal(layer('button').style.fill, '#222222')
  assert.equal(layer('label').fontSize, 20)
  assert.deepEqual(layer('button').style.shadow, { x: 0, y: 8, blur: 16, color: '#08080826' })
  const night = store.addTheme('Night')
  store.setTokenThemeValue(token('raised').id, night, 12)
  store.setActiveTheme(night)
  assert.equal(layer('button').style.shadow.y, 12)
  assert.match(buildCSSProps(layer('button'), store.getSnapshot().tokens).find(prop => prop.property === 'box-shadow').value, /var\(--elevation-raised\)/)
  assert.match(buildTailwindClasses(layer('button'), store.getSnapshot().tokens), /--elevation-raised/)
  roundtrip(store)
  store.removeTokens([token('action').id, token('raised').id])
  assert.equal(layer('button').style.fill, '#222222')
  assert.equal(layer('button').style.shadow.y, 12)
  store.setComponentProperty(instance.id, 'tone', 'Default')
  store.setComponentProperty(instance.id, 'tone', 'Accent')
  assert.equal(layer('button').style.fill, '#222222')
  roundtrip(store)
})

test('elevation edits release only the shadow binding, and zero remains linked in handoff', () => {
  const { store, instance, layer } = setup()
  const elevation = store.addToken({ type: 'elevation', name: 'raised', value: 4 })
  store.bindToken('button', 'shadow', elevation.id)
  store.update(layer('button').id, 'frame', { style: { shadow: { x: 1, y: 2, blur: 3, color: '#08080833' } } })
  store.updateToken(elevation.id, { value: 10 })
  assert.equal(layer('button').style.shadow.y, 2)
  assert.equal(layer('button').tokenBindings.shadow, undefined)
  store.resetComponentOverrides(instance.id)
  assert.equal(layer('button').style.shadow.y, 10)
  store.updateToken(elevation.id, { value: 0 })
  assert.equal(layer('button').style.shadow, null)
  assert.match(buildCSSProps(layer('button'), store.getSnapshot().tokens).find(prop => prop.property === 'box-shadow').value, /--elevation-raised/)
  roundtrip(store)
})

test('component documents and zero elevation satisfy the published project schema', async () => {
  const { projectSchema, validateSchema } = await import('../src/mcp/schema.ts')
  const { createProject } = await import('../src/io/project.ts')
  const { store, instance } = setup()
  store.addToken({ type: 'elevation', name: 'flat', value: 0 })
  store.setComponentProperty(instance.id, 'copy', '')
  validateSchema(createProject(store, 'Components', { x: 0, y: 0, zoom: 1 }, true), projectSchema)
})

test('deleting a shared style materializes inactive variants before releasing their links', () => {
  const { store, instance, layer, definitions } = setup()
  const style = store.addSharedStyle({ kind: 'color', name: 'Dark surface', value: '#222222' })
  store.setComponentProperties('button', [{ ...definitions[0], options: [{ value: 'Default', layers: {} }, { value: 'Accent', layers: { button: { sharedStyleBindings: { color: style.id } } } }] }, ...definitions.slice(1)])
  store.removeSharedStyle(style.id)
  store.setComponentProperty(instance.id, 'tone', 'Accent')
  assert.equal(layer('button').style.fill, '#222222')
  roundtrip(store)
})

test('generated elevation handoff compiles through Tailwind', async () => {
  const { compile } = await import('tailwindcss')
  const { tokensToCSS } = await import('../src/tokens/model.ts')
  const { store, layer } = setup()
  const token = store.addToken({ type: 'elevation', name: 'raised', value: 4 })
  store.bindToken('button', 'shadow', token.id)
  const compiler = await compile(`${tokensToCSS(store.getSnapshot().tokens, true)}\n@tailwind utilities;`)
  const css = compiler.build(buildTailwindClasses(layer('button'), store.getSnapshot().tokens).split(' '))
  assert.match(css, /var\(--elevation-raised\)/)
  assert.match(css, /--tw-shadow:/)
})

test('kinetic typography master symbols support dynamic wave, stagger and weight modulation overrides', () => {
  const store = new SceneStore()
  store.add('text', {
    id: 'headline',
    text: 'Kinetic Craft',
    fontSize: 32,
    kinetic: {
      enabled: true,
      playing: true,
      amplitude: 24,
      rotation: 5,
      duration: 1.2,
      stagger: 45,
      phase: 0.1,
      waveShape: 'sine',
      staggerMode: 'cascade',
      weightModulation: 200,
      horizontalAmplitude: 12,
    },
  })
  store.createComponent('headline')
  store.autoExposeComponentProperties('headline')

  const master = store.getSnapshot().elements.headline
  assert.equal(master.component.kind, 'master')
  const propNames = master.component.properties.map(p => p.name)
  assert.ok(propNames.includes('Text'))
  assert.ok(propNames.includes('Kinetic Active'))
  assert.ok(propNames.includes('Wave Amplitude'))
  assert.ok(propNames.includes('Wave Shape'))
  assert.ok(propNames.includes('Stagger Delay'))
  assert.ok(propNames.includes('Weight Modulation'))
  assert.ok(propNames.includes('Stagger Mode'))
  assert.ok(propNames.includes('Horizontal Amplitude'))

  const instance = store.createComponentInstance('headline')
  const ampProp = master.component.properties.find(p => p.targetProperty === 'amplitude')
  const shapeProp = master.component.properties.find(p => p.targetProperty === 'waveShape')
  const weightProp = master.component.properties.find(p => p.targetProperty === 'weightModulation')

  store.setComponentProperty(instance.id, ampProp.id, 48)
  store.setComponentProperty(instance.id, shapeProp.id, 'triangle')
  store.setComponentProperty(instance.id, weightProp.id, 350)

  const instLayer = store.getSnapshot().elements[instance.id]
  assert.equal(instLayer.kinetic.amplitude, 48)
  assert.equal(instLayer.kinetic.waveShape, 'triangle')
  assert.equal(instLayer.kinetic.weightModulation, 350)

  // Master is untouched
  const masterNow = store.getSnapshot().elements.headline
  assert.equal(masterNow.kinetic.amplitude, 24)
  assert.equal(masterNow.kinetic.waveShape, 'sine')
  assert.equal(masterNow.kinetic.weightModulation, 200)

  // Resetting restores master defaults
  store.resetComponentOverrides(instance.id)
  const instReset = store.getSnapshot().elements[instance.id]
  assert.equal(instReset.kinetic.amplitude, 24)
  assert.equal(instReset.kinetic.waveShape, 'sine')
  assert.equal(instReset.kinetic.weightModulation, 200)

  roundtrip(store)
})

test('shader setup master symbols support dynamic shader parameters and pushing overrides back to master', () => {
  const store = new SceneStore()
  store.add('frame', {
    id: 'shader-card',
    width: 320,
    height: 240,
    style: {
      fill: '#080808',
      shader: {
        kind: 'mesh-gradient',
        animated: true,
        speed: 1.0,
        frame: 0,
        scale: 1.2,
        rotation: 15,
        offsetX: 0,
        offsetY: 0,
        params: {
          colors: ['#edebe1', '#81adec', '#222222', '#080808'],
          distortion: 0.65,
          swirl: 0.25,
          grainMixer: 0.08,
          grainOverlay: 0.04,
        },
        mesh: {
          anchors: [
            { x: 0.2, y: 0.2, radius: 0.5 },
            { x: 0.8, y: 0.2, radius: 0.5 },
            { x: 0.5, y: 0.8, radius: 0.5 },
            { x: 0.5, y: 0.5, radius: 0.5 },
          ],
          turbulence: 0.3,
          frequency: 2.5,
          chromaticAberration: 0.05,
          grainBlend: 'overlay',
          normalPerturbation: 0.4,
          viewMode: 'shaded',
        },
      },
    },
  })

  store.createComponent('shader-card')
  store.autoExposeComponentProperties('shader-card')

  const master = store.getSnapshot().elements['shader-card']
  assert.equal(master.component.kind, 'master')
  const propNames = master.component.properties.map(p => p.name)
  assert.ok(propNames.includes('Shader Speed'))
  assert.ok(propNames.includes('Shader Scale'))
  assert.ok(propNames.includes('Mesh Frequency'))
  assert.ok(propNames.includes('Mesh Turbulence'))
  assert.ok(propNames.includes('Surface View Mode'))

  const instance = store.createComponentInstance('shader-card')
  const turbProp = master.component.properties.find(p => p.name === 'Mesh Turbulence')
  const viewModeProp = master.component.properties.find(p => p.name === 'Surface View Mode')

  store.setComponentProperty(instance.id, turbProp.id, 0.85)
  store.setComponentProperty(instance.id, viewModeProp.id, 'normal-map')

  let instLayer = store.getSnapshot().elements[instance.id]
  assert.equal(instLayer.style.shader.mesh.turbulence, 0.85)
  assert.equal(instLayer.style.shader.mesh.viewMode, 'normal-map')

  // Master symbol remains shaded and 0.3 turbulence
  let masterNow = store.getSnapshot().elements['shader-card']
  assert.equal(masterNow.style.shader.mesh.turbulence, 0.3)
  assert.equal(masterNow.style.shader.mesh.viewMode, 'shaded')

  // Push overrides back to master
  store.pushOverridesToMaster(instance.id)

  masterNow = store.getSnapshot().elements['shader-card']
  assert.equal(masterNow.style.shader.mesh.turbulence, 0.85)
  assert.equal(masterNow.style.shader.mesh.viewMode, 'normal-map')

  // New instance inherits updated master values
  const secondInstance = store.createComponentInstance('shader-card')
  const secondLayer = store.getSnapshot().elements[secondInstance.id]
  assert.equal(secondLayer.style.shader.mesh.turbulence, 0.85)
  assert.equal(secondLayer.style.shader.mesh.viewMode, 'normal-map')

  roundtrip(store)
})

test('recursive property override resolution for canvas element trees, kinetic typography, and shader setups', () => {
  const store = new SceneStore()
  store.add('frame', {
    id: 'card',
    width: 400,
    height: 300,
    cornerRadius: 12,
    style: {
      fill: '#edebe1',
      stroke: { color: '#222222', width: 2, dash: [] },
      opacity: 1,
      shadow: null,
    },
    layout: { direction: 'vertical', justify: 'start', align: 'start', gap: 16, padding: { top: 0, right: 0, bottom: 0, left: 0 } },
  })
  store.add('frame', {
    id: 'header',
    parentId: 'card',
    width: 360,
    height: 60,
    style: { fill: null, stroke: null, opacity: 1, shadow: null },
  })
  store.add('text', {
    id: 'title',
    parentId: 'header',
    text: 'Reactive Master',
    fontSize: 24,
    kinetic: {
      enabled: true,
      playing: true,
      amplitude: 16,
      rotation: 4,
      duration: 0.8,
      stagger: 30,
      phase: 0.2,
      waveShape: 'sine',
      staggerMode: 'cascade',
    },
    variableAxes: { wght: 600, wdth: 100 },
    style: { fill: '#080808', stroke: null, opacity: 1, shadow: null },
  })
  store.add('rectangle', {
    id: 'preview',
    parentId: 'card',
    width: 360,
    height: 180,
    style: {
      fill: '#080808',
      stroke: null,
      opacity: 1,
      shadow: null,
      shader: {
        kind: 'procedural-noise',
        animated: true,
        speed: 1.0,
        frame: 0,
        scale: 1.0,
        rotation: 0,
        offsetX: 0,
        offsetY: 0,
        params: {
          frequency: 2.0,
          turbulence: 0.5,
          octaves: 3,
          normalPerturbation: 0.2,
          colorFront: '#edebe1',
          colorMid: '#81adec',
          colorBack: '#080808',
          noiseType: 'simplex',
          viewMode: 'shaded',
          displacement: 0.3,
          lacunarity: 2.0,
          persistence: 0.5,
          grainMixer: 0.1,
          grainOverlay: 0.05,
          lightAngle: 45,
          specularStrength: 0.5,
        },
      },
    },
  })

  store.createComponent('card')
  const inst1 = store.createComponentInstance('card')
  const inst2 = store.createComponentInstance('card')

  const findLayer = (rootId, sourceId) =>
    subtree(store.getSnapshot().elements, rootId).find(node => node.component?.sourceId === sourceId)

  // Local overrides on inst1:
  const inst1Title = findLayer(inst1.id, 'title')
  const inst1Preview = findLayer(inst1.id, 'preview')
  const inst1Root = store.getSnapshot().elements[inst1.id]

  // Override text
  store.update(inst1Title.id, 'text', { text: 'Instance Override' })
  // Override kinetic amplitude only
  store.update(inst1Title.id, 'text', {
    kinetic: { ...inst1Title.kinetic, amplitude: 32 },
  })
  // Override preview shader frequency only
  store.update(inst1Preview.id, 'rectangle', {
    style: {
      ...inst1Preview.style,
      shader: {
        ...inst1Preview.style.shader,
        params: {
          ...inst1Preview.style.shader.params,
          frequency: 5.0,
        },
      },
    },
  })
  // Override corner radius on card root
  store.update(inst1Root.id, 'frame', { cornerRadius: 24 })

  // Verify local overrides took effect on inst1
  let currentInst1Title = findLayer(inst1.id, 'title')
  let currentInst1Preview = findLayer(inst1.id, 'preview')
  let currentInst1Root = store.getSnapshot().elements[inst1.id]
  assert.equal(currentInst1Title.text, 'Instance Override')
  assert.equal(currentInst1Title.kinetic.amplitude, 32)
  assert.equal(currentInst1Preview.style.shader.params.frequency, 5.0)
  assert.equal(currentInst1Root.cornerRadius, 24)

  // Now update MASTER properties:
  // 1. Kinetic duration, stagger, waveShape on master title
  store.update('title', 'text', {
    kinetic: {
      ...store.getSnapshot().elements.title.kinetic,
      duration: 1.2,
      stagger: 60,
      staggerMode: 'wave',
    },
    variableAxes: { wght: 800, wdth: 100 },
  })

  // 2. Shader speed, colorFront, turbulence on master preview
  store.update('preview', 'rectangle', {
    style: {
      ...store.getSnapshot().elements.preview.style,
      shader: {
        ...store.getSnapshot().elements.preview.style.shader,
        speed: 2.5,
        params: {
          ...store.getSnapshot().elements.preview.style.shader.params,
          turbulence: 0.8,
          colorFront: '#81adec',
        },
      },
    },
  })

  // 3. Stroke width and fill on master card
  store.update('card', 'frame', {
    style: {
      ...store.getSnapshot().elements.card.style,
      fill: '#ffffff',
      stroke: { color: '#222222', width: 4, dash: [] },
    },
  })

  // Check inst1: local overrides preserved, master updates propagated!
  currentInst1Title = findLayer(inst1.id, 'title')
  currentInst1Preview = findLayer(inst1.id, 'preview')
  currentInst1Root = store.getSnapshot().elements[inst1.id]

  // Title:
  assert.equal(currentInst1Title.text, 'Instance Override') // local override wins!
  assert.equal(currentInst1Title.kinetic.amplitude, 32) // local override wins!
  assert.equal(currentInst1Title.kinetic.duration, 1.2) // propagated from master!
  assert.equal(currentInst1Title.kinetic.stagger, 60) // propagated from master!
  assert.equal(currentInst1Title.kinetic.staggerMode, 'wave') // propagated from master!
  assert.equal(currentInst1Title.variableAxes.wght, 800) // propagated from master!

  // Preview shader:
  assert.equal(currentInst1Preview.style.shader.params.frequency, 5.0) // local override wins!
  assert.equal(currentInst1Preview.style.shader.speed, 2.5) // propagated from master!
  assert.equal(currentInst1Preview.style.shader.params.turbulence, 0.8) // propagated from master!
  assert.equal(currentInst1Preview.style.shader.params.colorFront, '#81adec') // propagated from master!

  // Card root:
  assert.equal(currentInst1Root.cornerRadius, 24) // local override wins!
  assert.equal(currentInst1Root.style.stroke.width, 4) // propagated from master!
  assert.equal(currentInst1Root.style.fill, '#ffffff') // propagated from master!

  // Check inst2: all master updates inherited!
  const inst2Title = findLayer(inst2.id, 'title')
  const inst2Preview = findLayer(inst2.id, 'preview')
  const inst2Root = store.getSnapshot().elements[inst2.id]

  assert.equal(inst2Title.text, 'Reactive Master')
  assert.equal(inst2Title.kinetic.amplitude, 16)
  assert.equal(inst2Title.kinetic.duration, 1.2)
  assert.equal(inst2Title.kinetic.stagger, 60)
  assert.equal(inst2Title.kinetic.staggerMode, 'wave')
  assert.equal(inst2Title.variableAxes.wght, 800)

  assert.equal(inst2Preview.style.shader.params.frequency, 2.0)
  assert.equal(inst2Preview.style.shader.speed, 2.5)
  assert.equal(inst2Preview.style.shader.params.turbulence, 0.8)
  assert.equal(inst2Preview.style.shader.params.colorFront, '#81adec')

  assert.equal(inst2Root.cornerRadius, 12)
  assert.equal(inst2Root.style.stroke.width, 4)
  assert.equal(inst2Root.style.fill, '#ffffff')

  // Test granular reset on inst1:
  store.resetPropertyOverride(inst1Title.id, 'kinetic.amplitude')
  currentInst1Title = findLayer(inst1.id, 'title')
  assert.equal(currentInst1Title.kinetic.amplitude, 16) // now inherited from master!
  assert.equal(currentInst1Title.text, 'Instance Override') // text override remains!

  store.resetPropertyOverride(inst1Preview.id, 'shader.frequency')
  currentInst1Preview = findLayer(inst1.id, 'preview')
  assert.equal(currentInst1Preview.style.shader.params.frequency, 2.0) // now inherited from master!

  // Test granular push on inst1:
  // Override kinetic rotation on inst1Title
  store.update(currentInst1Title.id, 'text', {
    kinetic: { ...currentInst1Title.kinetic, rotation: 12 },
  })
  store.pushPropertyOverrideToMaster(currentInst1Title.id, 'kinetic.rotation')

  // Master has rotation: 12
  assert.equal(store.getSnapshot().elements.title.kinetic.rotation, 12)
  // inst2 inherits rotation: 12
  assert.equal(findLayer(inst2.id, 'title').kinetic.rotation, 12)
  // inst1 has rotation: 12 without override
  assert.equal(findLayer(inst1.id, 'title').kinetic.rotation, 12)

  // Test dynamic layer addition to master component subtree:
  store.add('ellipse', { id: 'badge', parentId: 'header', width: 14, height: 14, style: { fill: '#81adec', stroke: null, opacity: 1, shadow: null } })
  assert.ok(findLayer(inst1.id, 'badge'), 'inst1 receives new badge child')
  assert.ok(findLayer(inst2.id, 'badge'), 'inst2 receives new badge child')

  // Test dynamic layer removal from master component subtree:
  store.remove('badge')
  assert.equal(findLayer(inst1.id, 'badge'), undefined, 'inst1 drops removed badge child')
  assert.equal(findLayer(inst2.id, 'badge'), undefined, 'inst2 drops removed badge child')

  roundtrip(store)
})

test('MasterComponent and ComponentInstance schema registry, instance tracking, and metadata management', async () => {
  const { projectSchema, validateSchema } = await import('../src/mcp/schema.ts')
  const { createProject } = await import('../src/io/project.ts')

  const store = new SceneStore()
  store.add('frame', {
    id: 'hero-banner',
    name: 'Hero Banner',
    width: 600,
    height: 300,
    style: { fill: '#080808', stroke: { color: '#222222', width: 1, dash: [] }, opacity: 1, shadow: null },
  })
  store.add('text', {
    id: 'hero-title',
    parentId: 'hero-banner',
    text: 'Paper Design',
    fontSize: 32,
    style: { fill: '#edebe1', stroke: null, opacity: 1, shadow: null },
  })

  // Create master component
  const master = store.createComponent('hero-banner')
  assert.equal(master.component.kind, 'master')
  assert.ok(master.component.createdAt)

  // Verify getMasterComponent and getMasterComponents
  const retrievedMaster = store.getMasterComponent('hero-banner')
  assert.ok(retrievedMaster)
  assert.equal(retrievedMaster.id, 'hero-banner')
  assert.equal(store.getMasterComponents().length, 1)
  assert.equal(store.getMasterComponents()[0].id, 'hero-banner')

  // Set description
  store.setComponentDescription('hero-banner', 'Hero banner with typography and background shader')
  assert.equal(store.getMasterComponent('hero-banner')?.component.description, 'Hero banner with typography and background shader')

  // Add exposed property
  store.addExposedProperty('hero-banner', {
    id: 'title-prop',
    name: 'Headline',
    kind: 'text',
    sourceId: 'hero-title',
    defaultValue: 'Paper Design',
  })
  assert.equal(store.getMasterComponent('hero-banner')?.component.properties?.length, 1)

  // Duplicate property addition throws
  assert.throws(() => {
    store.addExposedProperty('hero-banner', {
      id: 'title-prop',
      name: 'Headline',
      kind: 'text',
      sourceId: 'hero-title',
      defaultValue: 'Another',
    })
  })

  // Update exposed property
  store.updateExposedProperty('hero-banner', 'title-prop', {
    name: 'Banner Headline',
    defaultValue: 'Paper Craft',
  })
  const updatedProp = store.getMasterComponent('hero-banner')?.component.properties?.[0]
  assert.equal(updatedProp?.name, 'Banner Headline')
  assert.equal(updatedProp?.defaultValue, 'Paper Craft')

  // Create instances and test instance tracking
  const inst1 = store.createComponentInstance('hero-banner')
  const inst2 = store.createComponentInstance('hero-banner')

  assert.equal(store.getInstanceCount('hero-banner'), 2)
  const registeredIds = store.getRegisteredInstanceIds('hero-banner')
  assert.equal(registeredIds.length, 2)
  assert.ok(registeredIds.includes(inst1.id))
  assert.ok(registeredIds.includes(inst2.id))

  // getComponentInstance and getComponentInstances
  const instNode1 = store.getComponentInstance(inst1.id)
  assert.ok(instNode1)
  assert.equal(instNode1.component.kind, 'instance')
  assert.equal(instNode1.component.masterId, 'hero-banner')
  assert.equal(store.getComponentInstances('hero-banner').length, 2)

  // Component registry and schema retrieval
  const registry = store.getComponentRegistry()
  assert.ok(registry['hero-banner'])
  assert.equal(registry['hero-banner'].name, 'Hero Banner')
  assert.equal(registry['hero-banner'].instanceIds.length, 2)

  const schema = store.getComponentSchema('hero-banner')
  assert.ok(schema)
  assert.equal(schema.id, 'hero-banner')
  assert.equal(schema.name, 'Hero Banner')
  assert.equal(schema.instanceCount, 2)
  assert.equal(schema.properties.length, 1)

  const allSchemas = store.getComponentSchemas()
  assert.equal(allSchemas.length, 1)
  assert.equal(allSchemas[0].id, 'hero-banner')
  assert.equal(allSchemas[0].name, 'Hero Banner')

  // Schema serialization and import
  const serialized = store.serializeComponentSchema('hero-banner')
  assert.ok(typeof serialized === 'string')
  const imported = store.importComponentSchema(serialized)
  assert.equal(imported.id, 'hero-banner')
  assert.equal(imported.name, 'Hero Banner')
  assert.equal(imported.properties.length, 1)

  // Remove exposed property
  store.removeExposedProperty('hero-banner', 'title-prop')
  assert.equal(store.getMasterComponent('hero-banner')?.component.properties?.length, 0)

  // Detach instance and check registry updates
  store.detachComponentInstance(inst1.id)
  assert.equal(store.getInstanceCount('hero-banner'), 1)
  assert.deepEqual(store.getRegisteredInstanceIds('hero-banner'), [inst2.id])

  // Project schema validation
  const proj = createProject(store, 'Master-Instance Test', { x: 0, y: 0, zoom: 1 }, true)
  assert.doesNotThrow(() => validateSchema(proj, projectSchema))

  roundtrip(store)
})

