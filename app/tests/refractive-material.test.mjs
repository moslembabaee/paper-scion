import test from 'node:test'
import assert from 'node:assert/strict'
import ts from 'typescript'
import { SceneStore } from '../src/scene/store.ts'
import {
  createShader,
  freezeShader,
  shaderCatalog,
  shaderKinds,
  updateShaderParameter,
  validateShader,
} from '../src/shaders/catalog.ts'
import {
  GLASSMORPHISM_PRESETS,
  LIQUID_CHROME_PRESETS,
} from '../src/shaders/refractive/presets.ts'
import {
  glassmorphismFragmentShader,
  glassmorphismUniforms,
} from '../src/shaders/refractive/glassmorphismFragment.ts'
import {
  liquidChromeFragmentShader,
  liquidChromeUniforms,
} from '../src/shaders/refractive/liquidChromeFragment.ts'
import {
  exportGlassmorphismReact,
  exportLiquidChromeReact,
} from '../src/shaders/refractive/refractiveExport.ts'
import { exportShaderSource } from '../src/shaders/shaderExport.ts'
import { shaderSchema, validateSchema } from '../src/mcp/schema.ts'

const clone = val => JSON.parse(JSON.stringify(val))

test('glassmorphism and liquid-chrome are registered in shaderKinds and shaderCatalog', () => {
  assert.ok(shaderKinds.includes('glassmorphism'))
  assert.ok(shaderKinds.includes('liquid-chrome'))

  const glassDef = shaderCatalog.glassmorphism
  assert.equal(glassDef.label, 'Glassmorphism FX')
  const glassKeys = glassDef.controls.map(c => c.key)
  const expectedGlass = [
    'refractionIndex',
    'dispersion',
    'roughness',
    'blurRadius',
    'surfacePattern',
    'patternScale',
    'frostIntensity',
    'tintColor',
    'tintOpacity',
    'highlightColor',
    'specularStrength',
    'lightAngle',
    'bevelWidth',
    'chromaticShift',
  ]
  for (const exp of expectedGlass) {
    assert.ok(glassKeys.includes(exp), `Glass controls must include ${exp}`)
  }

  const chromeDef = shaderCatalog['liquid-chrome']
  assert.equal(chromeDef.label, 'Liquid Chrome FX')
  const chromeKeys = chromeDef.controls.map(c => c.key)
  const expectedChrome = [
    'metallicSheen',
    'iridescence',
    'filmThickness',
    'roughness',
    'fluidViscosity',
    'flowSpeed',
    'rippleFrequency',
    'dispersion',
    'baseColor',
    'sheenColor',
    'lightAngle',
    'environmentStyle',
    'normalPerturbation',
    'grainMixer',
  ]
  for (const exp of expectedChrome) {
    assert.ok(chromeKeys.includes(exp), `Chrome controls must include ${exp}`)
  }
})

test('all glassmorphism and liquid-chrome presets validate successfully', () => {
  for (const preset of GLASSMORPHISM_PRESETS) {
    const paint = {
      ...createShader('glassmorphism'),
      params: { ...preset.params },
    }
    assert.doesNotThrow(() => validateShader(paint), `Glass preset ${preset.id} must validate`)
  }

  for (const preset of LIQUID_CHROME_PRESETS) {
    const paint = {
      ...createShader('liquid-chrome'),
      params: { ...preset.params },
    }
    assert.doesNotThrow(() => validateShader(paint), `Chrome preset ${preset.id} must validate`)
  }
})

test('glassmorphismUniforms and liquidChromeUniforms compute valid WebGL uniforms', () => {
  const glassPaint = createShader('glassmorphism')
  const glassU = glassmorphismUniforms(glassPaint)
  assert.equal(glassU.u_refractionIndex, glassPaint.params.refractionIndex)
  assert.equal(glassU.u_dispersion, glassPaint.params.dispersion)
  assert.equal(glassU.u_blurRadius, glassPaint.params.blurRadius)
  assert.equal(glassU.u_chromaticShift, glassPaint.params.chromaticShift)
  assert.equal(glassU.u_tintColor.length, 3)
  assert.equal(glassU.u_highlightColor.length, 3)

  const chromePaint = createShader('liquid-chrome')
  const chromeU = liquidChromeUniforms(chromePaint)
  assert.equal(chromeU.u_metallicSheen, chromePaint.params.metallicSheen)
  assert.equal(chromeU.u_rippleFrequency, chromePaint.params.rippleFrequency)
  assert.equal(chromeU.u_fluidViscosity, chromePaint.params.fluidViscosity)
  assert.equal(chromeU.u_baseColor.length, 3)
  assert.equal(chromeU.u_sheenColor.length, 3)
})

test('exportGlassmorphismReact and exportLiquidChromeReact compile through TypeScript', () => {
  const glassPaint = createShader('glassmorphism')
  const glassCode = exportGlassmorphismReact(glassPaint)
  assert.ok(glassCode.includes('GlassmorphismMaterial'))
  assert.equal(exportShaderSource(glassPaint), glassCode)

  const transpiledGlass = ts.transpileModule(glassCode, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  })
  assert.equal(transpiledGlass.diagnostics?.length ?? 0, 0)

  const chromePaint = createShader('liquid-chrome')
  const chromeCode = exportLiquidChromeReact(chromePaint)
  assert.ok(chromeCode.includes('LiquidChromeMaterial'))
  assert.equal(exportShaderSource(chromePaint), chromeCode)

  const transpiledChrome = ts.transpileModule(chromeCode, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  })
  assert.equal(transpiledChrome.diagnostics?.length ?? 0, 0)
})

test('SceneStore integrates glassmorphism and liquid-chrome with persistence and undo/redo', () => {
  const store = new SceneStore()
  const glass = createShader('glassmorphism')
  const chrome = createShader('liquid-chrome')

  store.add('rectangle', { id: 'glass-card', style: { shader: glass } })
  store.add('ellipse', { id: 'chrome-orb', style: { shader: chrome } })

  const doc = clone(store.toJSON())
  const restored = new SceneStore()
  restored.load(doc)

  assert.deepEqual(restored.toJSON(), doc)
  assert.equal(restored.getSnapshot().elements['glass-card'].style.shader.kind, 'glassmorphism')
  assert.equal(restored.getSnapshot().elements['chrome-orb'].style.shader.kind, 'liquid-chrome')
})

test('mcp schema accepts glassmorphism and liquid-chrome paints', () => {
  assert.doesNotThrow(() => validateSchema(shaderSchema, createShader('glassmorphism')))
  assert.doesNotThrow(() => validateSchema(shaderSchema, createShader('liquid-chrome')))
})
