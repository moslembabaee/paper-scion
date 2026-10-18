import type { LayerEffect } from './types.ts'
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!)

/** Sequential SVG primitives preserve stack order and follow the actual painted silhouette. */
export function effectFilterMarkup(effects: readonly LayerEffect[], id: string): string {
  let previous = 'SourceGraphic'
  const primitives: string[] = []
  effects.filter(effect => effect.enabled).forEach((effect, index) => {
    const result = `effect-${index}`
    if (effect.type === 'layer-blur') primitives.push(`<feGaussianBlur in="${previous}" stdDeviation="${effect.blur / 2}" result="${result}"/>`)
    else {
      const alpha = `alpha-${index}`, spread = `spread-${index}`, blur = `blur-${index}`, offset = `offset-${index}`, mask = `mask-${index}`, color = `color-${index}`, shadow = `shadow-${index}`
      primitives.push(`<feColorMatrix in="${previous}" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="${alpha}"/>`)
      const inner = effect.type === 'inner-shadow'
      const radius = Math.abs(effect.spread)
      if (radius) primitives.push(`<feMorphology in="${alpha}" operator="${(effect.spread > 0) !== inner ? 'dilate' : 'erode'}" radius="${radius}" result="${spread}"/>`)
      primitives.push(`<feGaussianBlur in="${radius ? spread : alpha}" stdDeviation="${effect.blur / 2}" result="${blur}"/><feOffset in="${blur}" dx="${effect.x}" dy="${effect.y}" result="${offset}"/>`)
      if (inner) primitives.push(`<feComposite in="${alpha}" in2="${offset}" operator="out" result="${mask}"/>`)
      primitives.push(`<feFlood flood-color="${escape(effect.color)}" result="${color}"/><feComposite in="${color}" in2="${inner ? mask : offset}" operator="in" result="${shadow}"/><feMerge result="${result}">${inner ? `<feMergeNode in="${previous}"/><feMergeNode in="${shadow}"/>` : `<feMergeNode in="${shadow}"/><feMergeNode in="${previous}"/>`}</feMerge>`)
    }
    previous = result
  })
  return `<filter id="${escape(id)}" x="-100%" y="-100%" width="300%" height="300%" color-interpolation-filters="sRGB">${primitives.join('')}</filter>`
}

export function effectsCSS(effects: readonly LayerEffect[]): { boxShadow?: string; filter?: string } {
  const active = effects.filter(effect => effect.enabled)
  const shadows = active.filter(effect => effect.type !== 'layer-blur').map(effect => `${effect.type === 'inner-shadow' ? 'inset ' : ''}${effect.x}px ${effect.y}px ${effect.blur}px ${effect.spread}px ${effect.color}`)
  const blurs = active.filter(effect => effect.type === 'layer-blur').map(effect => `blur(${effect.blur / 2}px)`)
  return { ...(shadows.length ? { boxShadow: shadows.join(', ') } : {}), ...(blurs.length ? { filter: blurs.join(' ') } : {}) }
}
