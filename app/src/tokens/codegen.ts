import { applyTextTransform, compileTypographyStyles, embeddedFontCSS, resolveTextPathD, textAnchorForPath, textPathOffset, typographyCSS } from '../scene/typography.ts'
import { effectsCSS, effectFilterMarkup } from './effects.ts'
import { frameMask, maskPathData, maskFillRule } from '../scene/maskGeometry.ts'
import type { SceneElement, TextElement } from '../scene/types.ts'
import { boundToken, tokenClass, tokenVariable } from './model.ts'
import type { DesignToken, TokenProperty } from './types.ts'

// ─── CSS generation ──────────────────────────────────────────────────────────

function hexToRgba(color: string): string {
  const hex = color.replace('#', '')
  if (hex.length === 8) {
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 4), 16)
    const b = parseInt(hex.slice(4, 6), 16)
    const a = (parseInt(hex.slice(6, 8), 16) / 255).toFixed(2)
    return `rgba(${r}, ${g}, ${b}, ${a})`
  }
  if (hex.length === 6) {
    const r = parseInt(hex.slice(0, 2), 16)
    const g = parseInt(hex.slice(2, 4), 16)
    const b = parseInt(hex.slice(4, 6), 16)
    return `rgb(${r}, ${g}, ${b})`
  }
  return color
}

export interface CSSProp { property: string; value: string; token?: string; resolvedValue?: string }

export function buildCSSProps(node: SceneElement, tokens: readonly DesignToken[] = [], parent?: SceneElement): CSSProp[] {
  const props: CSSProp[] = []
  const parentLayout = parent?.type === 'frame' ? parent.layout : null
  props.push({ property: 'position', value: parentLayout ? 'relative' : 'absolute' })
  if (!parentLayout) props.push({ property: 'left', value: `${node.x}px` }, { property: 'top', value: `${node.y}px` })
  if (parentLayout) props.push({ property: 'flex-shrink', value: '0' })
  for (const axis of ['width', 'height'] as const) {
    const rule = node.sizing?.[axis] ?? 'fixed'
    const main = parentLayout && (parentLayout.direction === 'horizontal' ? axis === 'width' : axis === 'height')
    const fills = rule === 'fill' && parentLayout && parent?.sizing?.[axis] !== 'hug'
    const wrappedCrossFill = fills && !main && parentLayout?.wrap && parentLayout.wrap !== 'nowrap'
    props.push({ property: axis, value: rule === 'hug' ? axis === 'width' ? 'max-content' : 'auto' : fills ? main ? '0px' : wrappedCrossFill ? 'auto' : '100%' : `${node[axis]}px` })
    if (wrappedCrossFill) props.push({ property: 'align-self', value: 'stretch' })
    if (fills && main) props.push({ property: 'flex', value: `${node.sizing?.flexGrow ?? 1} 1 0px` })
    const min = axis === 'width' ? node.sizing?.minWidth : node.sizing?.minHeight
    const max = axis === 'width' ? node.sizing?.maxWidth : node.sizing?.maxHeight
    if (min !== undefined || (fills && (main || wrappedCrossFill))) props.push({ property: `min-${axis}`, value: `${Math.max(.01, min ?? .01)}px` })
    if (max !== undefined) props.push({ property: `max-${axis}`, value: `${max}px` })
  }
  if (node.type === 'frame' && node.layout) {
    const { direction, gap, padding, justify, align } = node.layout
    props.push({ property: 'display', value: 'flex' }, { property: 'box-sizing', value: 'border-box' }, { property: 'flex-direction', value: direction === 'horizontal' ? 'row' : 'column' }, { property: 'gap', value: `${gap}px` }, { property: 'padding', value: `${padding.top}px ${padding.right}px ${padding.bottom}px ${padding.left}px` }, { property: 'justify-content', value: justify === 'start' || justify === 'end' ? `flex-${justify}` : justify }, { property: 'align-items', value: align === 'start' || align === 'end' ? `flex-${align}` : align })
    props.push({ property: 'flex-wrap', value: node.layout.wrap ?? 'nowrap' }, { property: 'align-content', value: node.layout.alignContent === 'start' || node.layout.alignContent === 'end' || !node.layout.alignContent ? `flex-${node.layout.alignContent ?? 'start'}` : node.layout.alignContent })
  }

  if (node.rotation !== 0) {
    props.push({ property: 'transform', value: `rotate(${node.rotation}deg)` })
  }

  if (node.style.opacity !== 1) {
    props.push({ property: 'opacity', value: String(node.style.opacity) })
  }
  if (node.type !== 'path' && !(node.type === 'frame' && node.layout)) props.push({ property: 'box-sizing', value: 'border-box' })
  if (node.type === 'ellipse') props.push({ property: 'border-radius', value: '50%' })
  if (node.type === 'image') props.push({ property: 'overflow', value: 'hidden' })

  if (node.style.fill !== null) {
    const raw = node.style.fill
    const token = boundToken(node, 'fill', tokens) ? tokenVariable(boundToken(node, 'fill', tokens)!) : undefined
    if (node.type === 'text') {
      props.push({ property: 'color', value: raw, token })
    } else {
      props.push({ property: node.type === 'path' ? 'fill' : 'background-color', value: raw, token })
    }
  } else props.push({ property: node.type === 'path' ? 'fill' : node.type === 'text' ? 'color' : 'background-color', value: node.type === 'path' ? 'none' : 'transparent' })

  if ('cornerRadius' in node && (node.cornerRadius > 0 || node.tokenBindings?.cornerRadius)) {
    props.push({ property: 'border-radius', value: `${node.cornerRadius}px` })
  }

  if (node.style.stroke) {
    const { color, width } = node.style.stroke
    if (node.type === 'path') {
      props.push({ property: 'stroke', value: color }, { property: 'stroke-width', value: String(width) })
      if (node.style.stroke.dash.length) props.push({ property: 'stroke-dasharray', value: node.style.stroke.dash.join(' ') })
    } else if (node.type === 'text') props.push({ property: '-webkit-text-stroke', value: `${width}px ${color}` })
    else props.push({ property: 'border', value: `${width}px ${node.style.stroke.dash.length ? 'dashed' : 'solid'} ${color}` })
  }

  if (node.style.effects?.length) {
    const effects = effectsCSS(node.style.effects)
    if (effects.boxShadow) props.push({ property: 'box-shadow', value: effects.boxShadow })
    if (effects.filter) props.push({ property: 'filter', value: effects.filter })
  }
  if (node.style.shadow && !node.style.effects?.some(effect => effect.enabled)) {
    const { x, y, blur, color } = node.style.shadow
    props.push(node.type === 'path'
      ? { property: 'filter', value: `drop-shadow(${x}px ${y}px ${blur / 2}px ${hexToRgba(color)})` }
      : { property: 'box-shadow', value: `${x}px ${y}px ${blur}px ${hexToRgba(color)}` })
  }

  if (node.type === 'text') {
    const t = node as TextElement
    props.push({ property: 'margin', value: '0' }, { property: 'white-space', value: 'pre-wrap' }, { property: 'overflow-wrap', value: 'break-word' })
    props.push({ property: 'font-family', value: t.fontFamily })
    props.push({ property: 'font-size', value: `${t.fontSize}px` })
    props.push({ property: 'font-weight', value: String(t.fontWeight) })
    props.push({ property: 'line-height', value: String(t.lineHeight) })
    if (t.letterSpacing !== 0 || node.tokenBindings?.letterSpacing) props.push({ property: 'letter-spacing', value: `${t.letterSpacing}px` })
    if (t.textAlign !== 'left') props.push({ property: 'text-align', value: t.textAlign })
    for (const [property, value] of Object.entries(typographyCSS(t))) {
      if (!['font-family', 'font-size', 'line-height', 'text-align', 'letter-spacing', 'font-weight'].includes(property)) props.push({ property, value })
    }
    const tracking = compileTypographyStyles(t).letterSpacing
    if (tracking) { const current = props.find(prop => prop.property === 'letter-spacing'); if (current) current.value = String(tracking); else props.push({ property: 'letter-spacing', value: String(tracking) }) }
    const weight = props.find(prop => prop.property === 'font-weight')
    if (weight) weight.value = String(t.variableAxes?.wght ?? t.fontWeight)
  }

  if (node.type === 'frame' && node.clipContent) {
    props.push({ property: 'overflow', value: 'hidden' })
  }

  const elevation = boundToken(node, 'shadow', tokens)
  if (elevation) {
    const variable = tokenVariable(elevation)
    const property = node.type === 'path' ? 'filter' : 'box-shadow'
    const value = node.type === 'path' ? `drop-shadow(0px var(${variable}) var(${variable}) #08080826)` : `0px var(${variable}) calc(var(${variable}) * 2) #08080826`
    const index = props.findIndex(prop => prop.property === property)
    const prop = { property, value, token: variable, resolvedValue: index >= 0 ? props[index].value : 'none' }
    if (index >= 0) props[index] = prop
    else props.push(prop)
  }
  const properties: Partial<Record<string, TokenProperty>> = { left: 'x', top: 'y', width: 'width', height: 'height', fill: 'fill', stroke: 'stroke', color: 'fill', 'background-color': 'fill', border: 'stroke', '-webkit-text-stroke': 'stroke', 'border-radius': 'cornerRadius', 'font-family': 'fontFamily', 'font-size': 'fontSize', 'font-weight': 'fontWeight', 'line-height': 'lineHeight', 'letter-spacing': 'letterSpacing' }
  return props.map(prop => {
    const property = properties[prop.property]
    if ((property === 'width' || property === 'height') && node.sizing?.[property] && node.sizing[property] !== 'fixed') return prop
    const token = property ? boundToken(node, property, tokens) : undefined
    if (!token) return prop
    const variable = tokenVariable(token)
    const value = prop.property === 'border' ? `${node.style.stroke!.width}px ${node.style.stroke!.dash.length ? 'dashed' : 'solid'} var(${variable})` : prop.property === '-webkit-text-stroke' ? `${node.style.stroke!.width}px var(${variable})` : `var(${variable})`
    return { ...prop, value, token: variable, resolvedValue: prop.value }
  })
}

// ─── Tailwind generation ──────────────────────────────────────────────────────

function colorToTailwind(color: string, prefix: 'bg' | 'text' | 'border' | 'fill' | 'stroke'): string {
  return `${prefix}-[${color.replace(/ /g, '_')}]`
}

export function buildTailwindClasses(node: SceneElement, tokens: readonly DesignToken[] = [], parent?: SceneElement): string {
  const parentLayout = parent?.type === 'frame' ? parent.layout : null
  const classes: string[] = [parentLayout ? 'relative' : 'absolute']
  if (parentLayout) classes.push('shrink-0')
  const bindingClass = (property: TokenProperty) => { const token = boundToken(node, property, tokens); return token ? tokenClass(token, property, node.type === 'text', tokens) : undefined }
  for (const property of ['x', 'y', 'width', 'height'] as const) {
    if ((property === 'x' || property === 'y') && parentLayout) continue
    if ((property === 'width' || property === 'height') && (node.sizing?.[property] === 'hug' || (node.sizing?.[property] === 'fill' && parentLayout && parent?.sizing?.[property] !== 'hug'))) continue
    const prefix = { x: 'left', y: 'top', width: 'w', height: 'h' }[property]
    classes.push(bindingClass(property) ?? `${prefix}-[${node[property]}px]`)
  }
  for (const axis of ['width', 'height'] as const) {
    const prefix = axis === 'width' ? 'w' : 'h', rule = node.sizing?.[axis]
    const main = parentLayout && (parentLayout.direction === 'horizontal' ? axis === 'width' : axis === 'height')
    if (rule === 'hug') classes.push(`${prefix}-${axis === 'width' ? 'max' : 'auto'}`)
    const fills = rule === 'fill' && parentLayout && parent?.sizing?.[axis] !== 'hug'
    const wrappedCrossFill = fills && !main && parentLayout.wrap && parentLayout.wrap !== 'nowrap'
    if (fills) classes.push(...(main ? [(node.sizing?.flexGrow ?? 1) === 1 ? 'flex-1' : `flex-[${node.sizing!.flexGrow}_1_0px]`, `${prefix}-0`] : wrappedCrossFill ? [`${prefix}-auto`, 'self-stretch'] : [`${prefix}-full`]))
    const min = axis === 'width' ? node.sizing?.minWidth : node.sizing?.minHeight
    const max = axis === 'width' ? node.sizing?.maxWidth : node.sizing?.maxHeight
    if (min !== undefined || (fills && (main || wrappedCrossFill))) classes.push(`min-${prefix}-[${Math.max(.01, min ?? .01)}px]`)
    if (max !== undefined) classes.push(`max-${prefix}-[${max}px]`)
  }
  if (node.type === 'frame' && node.layout) {
    const { direction, gap, padding, justify, align } = node.layout
    classes.push('flex', 'box-border', direction === 'horizontal' ? 'flex-row' : 'flex-col', `gap-[${gap}px]`, `pt-[${padding.top}px]`, `pr-[${padding.right}px]`, `pb-[${padding.bottom}px]`, `pl-[${padding.left}px]`, `justify-${justify === 'space-between' ? 'between' : justify}`, `items-${align}`)
    classes.push(node.layout.wrap === 'wrap' ? 'flex-wrap' : node.layout.wrap === 'wrap-reverse' ? 'flex-wrap-reverse' : 'flex-nowrap', `content-${node.layout.alignContent === 'space-between' ? 'between' : node.layout.alignContent ?? 'start'}`)
  }

  if (node.style.opacity !== 1) {
    classes.push(`opacity-[${node.style.opacity}]`)
  }
  if (node.rotation) classes.push(`rotate-[${node.rotation}deg]`)
  if (node.type !== 'path') classes.push('box-border')
  if (node.type === 'ellipse') classes.push('rounded-full')
  if (node.type === 'image') classes.push('overflow-hidden')
  if (node.style.fill === null) classes.push(node.type === 'path' ? 'fill-none' : node.type === 'text' ? 'text-transparent' : 'bg-transparent')

  if (node.style.fill !== null && node.type !== 'text') {
    const token = boundToken(node, 'fill', tokens)
    classes.push(node.type === 'path' ? token ? `fill-[var(${tokenVariable(token)})]` : colorToTailwind(node.style.fill, 'fill') : bindingClass('fill') ?? colorToTailwind(node.style.fill, 'bg'))
  }

  if (node.style.fill !== null && node.type === 'text') {
    classes.push(bindingClass('fill') ?? colorToTailwind(node.style.fill, 'text'))
  }

  if ('cornerRadius' in node && (node.cornerRadius > 0 || node.tokenBindings?.cornerRadius)) {
    const r = node.cornerRadius
    if (bindingClass('cornerRadius')) classes.push(bindingClass('cornerRadius')!)
    else classes.push(`rounded-[${r}px]`)
  }

  if (node.style.stroke) {
    const { width } = node.style.stroke
    if (node.type === 'path') {
      const token = boundToken(node, 'stroke', tokens)
      classes.push(token ? `stroke-[var(${tokenVariable(token)})]` : colorToTailwind(node.style.stroke.color, 'stroke'), `[stroke-width:${width}]`)
      if (node.style.stroke.dash.length) classes.push(`[stroke-dasharray:${node.style.stroke.dash.join('_')}]`)
    } else if (node.type === 'text') {
      const token = boundToken(node, 'stroke', tokens)
      classes.push(`[-webkit-text-stroke:${width}px_${token ? `var(${tokenVariable(token)})` : node.style.stroke.color.replace(/ /g, '_')}]`)
    } else {
      classes.push('border')
      if (width !== 1) classes.push(`border-[${width}px]`)
      classes.push(bindingClass('stroke') ?? colorToTailwind(node.style.stroke.color, 'border'))
      classes.push(node.style.stroke.dash.length ? 'border-dashed' : 'border-solid')
    }
  }

  for (const prop of buildCSSProps(node, tokens, parent).filter(prop => ['box-shadow', 'filter'].includes(prop.property) && node.style.effects?.length)) classes.push(`[${prop.property}:${prop.value.replace(/ /g, '_')}]`)

  if (node.style.shadow && !node.style.effects?.some(effect => effect.enabled)) {
    const { x, y, blur } = node.style.shadow
    if (boundToken(node, 'shadow', tokens)) {
      const variable = tokenVariable(boundToken(node, 'shadow', tokens)!)
      classes.push(node.type === 'path' ? `[filter:drop-shadow(0px_var(${variable})_var(${variable})_#08080826)]` : bindingClass('shadow')!)
    } else if (node.type === 'path') classes.push(`drop-shadow-[${x}px_${y}px_${blur / 2}px_${node.style.shadow.color}]`)
    else classes.push(`shadow-[${x}px_${y}px_${blur}px_${node.style.shadow.color.replace(/ /g, '_')}]`)
  }

  if (!node.style.shadow && boundToken(node, 'shadow', tokens)) classes.push(bindingClass('shadow')!)

  if (node.type === 'text') {
    const t = node as TextElement
    classes.push('m-0', 'whitespace-pre-wrap', '[overflow-wrap:break-word]')
    classes.push(bindingClass('fontSize') ?? `text-[${t.fontSize}px]`)
    classes.push(bindingClass('fontWeight') ?? `font-[${t.fontWeight}]`)
    classes.push(bindingClass('fontFamily') ?? `[font-family:${t.fontFamily.replace(/ /g, '_')}]`)
    classes.push(bindingClass('lineHeight') ?? `leading-[${t.lineHeight}]`)
    if (t.letterSpacing !== 0 || bindingClass('letterSpacing')) classes.push(bindingClass('letterSpacing') ?? `tracking-[${t.letterSpacing}px]`)
    if (t.textAlign === 'center') classes.push('text-center')
    if (t.textAlign === 'right') classes.push('text-right')
  }

  if (node.type === 'frame' && node.clipContent) {
    classes.push('overflow-hidden')
  }

  return [...new Set(classes)].join(' ')
}

// ─── React component code gen ─────────────────────────────────────────────────

export function elementToComponentName(node: SceneElement): string {
  const name = node.name.replace(/[^a-zA-Z0-9]/g, '') || node.type
  return `${/^[a-zA-Z]/.test(name) ? '' : 'Paper'}${name[0].toUpperCase()}${name.slice(1)}`
}

export function buildReactComponent(node: SceneElement, tokens: readonly DesignToken[] = [], parent?: SceneElement, elements?: Readonly<Record<string, SceneElement>>): string {
  const name = elementToComponentName(node)
  const tw = buildTailwindClasses(node, tokens, parent)
  const parentLayout = parent?.type === 'frame' ? parent.layout : null
  const geometryStyle = (['x', 'y', 'width', 'height'] as const).filter(property => {
    if ((property === 'x' || property === 'y') && parentLayout) return false
    if ((property === 'width' || property === 'height') && (node.sizing?.[property] === 'hug' || (node.sizing?.[property] === 'fill' && parentLayout && parent?.sizing?.[property] !== 'hug'))) return false
    return !node.tokenBindings?.[property]
  }).map(property => `${property === 'x' ? 'left' : property === 'y' ? 'top' : property}: ${node[property]}`)
  if (node.rotation !== 0) geometryStyle.push(`transform: 'rotate(${node.rotation}deg)'`)
  if (node.type === 'text') {
    for (const [key, value] of Object.entries(compileTypographyStyles(node))) {
      if (value !== undefined && !node.tokenBindings?.[key as TokenProperty]) geometryStyle.push(`${key}: ${JSON.stringify(value)}`)
    }
  }
  if (node.style.effects?.some(effect => effect.enabled) && node.type !== 'path') {
    const effects = effectsCSS(node.style.effects)
    if (effects.boxShadow) geometryStyle.push(`boxShadow: ${JSON.stringify(effects.boxShadow)}`)
    if (effects.filter) geometryStyle.push(`filter: ${JSON.stringify(effects.filter)}`)
  }
  const inlineStyle = geometryStyle.length ? `{{ ${geometryStyle.join(', ')} }}` : null
  const styleAttribute = inlineStyle ? `\n      style=${inlineStyle}` : ''

  if (node.type === 'text') {
    const t = node as TextElement
    if (t.textOnPath?.enabled) {
      const pathD = resolveTextPathD(t, elements)
      const styles = { ...compileTypographyStyles(t), letterSpacing: `${Number.parseFloat(String(compileTypographyStyles(t).letterSpacing ?? 0)) + (t.textOnPath.spacing ?? 0)}px` }
      return `import { useId } from 'react'\n\nexport function ${name}() {\n  const pathId = useId()\n  return (\n    <svg className={${JSON.stringify(tw)}}${styleAttribute} viewBox="0 0 ${t.width} ${t.height}" overflow="visible">\n      ${t.fontSource ? `<style>{${JSON.stringify(embeddedFontCSS(t))}}</style>` : ''}\n      <defs><path id={pathId} d={${JSON.stringify(pathD)}} /></defs>\n      <text fill={${JSON.stringify(t.style.fill ?? 'none')}} stroke={${JSON.stringify(t.style.stroke?.color ?? 'none')}} strokeWidth={${t.style.stroke?.width ?? 0}} style={${JSON.stringify(styles)}} textAnchor="${textAnchorForPath(t.textOnPath.align, t.textAlign)}" xmlSpace="preserve">\n        <textPath href={\`#\${pathId}\`} startOffset="${textPathOffset(t)}%">{${JSON.stringify(applyTextTransform(t.text, t.textTransform).replace(/\n/g, ' '))}}</textPath>\n      </text>\n    </svg>\n  )\n}`
    }
    const tag = t.fontSize >= 36 ? 'h2' : t.fontSize >= 24 ? 'h3' : 'p'
    if (inlineStyle) {
      return `export function ${name}() {\n  return (\n    <${tag}\n      className={${JSON.stringify(tw)}}\n      style=${inlineStyle}\n    >\n      ${t.fontSource ? `<style>{${JSON.stringify(embeddedFontCSS(t))}}</style>` : ''}{${JSON.stringify(t.text)}}\n    </${tag}>\n  )\n}`
    }
    return `export function ${name}() {\n  return (\n    <${tag} className={${JSON.stringify(tw)}}>\n      ${t.fontSource ? `<style>{${JSON.stringify(embeddedFontCSS(t))}}</style>` : ''}{${JSON.stringify(t.text)}}\n    </${tag}>\n  )\n}`
  }

  if (node.type === 'image') {
    return `export function ${name}() {\n  return (\n    <div\n      className={${JSON.stringify(tw)}}${styleAttribute}\n    >\n      <img\n        src={${JSON.stringify(node.src)}}\n        alt={${JSON.stringify(node.alt)}}\n        className="w-full h-full object-${node.fit}"\n      />\n    </div>\n  )\n}`
  }

  if (node.type === 'frame') {
    const mask = elements ? frameMask(elements, node) : undefined
    if (mask) {
      const layout = node.layout
      const clipLayoutStyle = layout ? `, display: 'flex', flexDirection: '${layout.direction === 'horizontal' ? 'row' : 'column'}', flexWrap: '${layout.wrap ?? 'nowrap'}', alignContent: '${layout.alignContent === 'start' || layout.alignContent === 'end' || !layout.alignContent ? `flex-${layout.alignContent ?? 'start'}` : layout.alignContent}', gap: ${layout.gap}, padding: '${layout.padding.top}px ${layout.padding.right}px ${layout.padding.bottom}px ${layout.padding.left}px', boxSizing: 'border-box', justifyContent: '${{ start: 'flex-start', center: 'center', end: 'flex-end', 'space-between': 'space-between' }[layout.justify]}', alignItems: '${{ start: 'flex-start', center: 'center', end: 'flex-end' }[layout.align]}'` : ''
      return `import { useId } from 'react'\n\nimport type { ReactNode } from 'react'\n\nexport function ${name}({ children }: { children?: ReactNode }) {\n  const clipId = useId()\n  return (\n    <div\n      className={${JSON.stringify(tw)}}${styleAttribute}\n    >\n      <svg width="0" height="0" aria-hidden="true" style={{ position: 'absolute' }}>\n        <defs><clipPath id={clipId} clipPathUnits="userSpaceOnUse">\n          <path d={${JSON.stringify(maskPathData(mask))}} clipRule="${maskFillRule(mask)}" />\n        </clipPath></defs>\n      </svg>\n      <div style={{ position: 'absolute', inset: 0, clipPath: \`url(#\${clipId})\`${clipLayoutStyle} }}>\n        {children}\n      </div>\n    </div>\n  )\n}`
    }
    return `import type { ReactNode } from 'react'\n\nexport function ${name}({ children }: { children?: ReactNode }) {\n  return (\n    <div\n      className={${JSON.stringify(tw)}}${styleAttribute}\n    >\n      {children}\n    </div>\n  )\n}`
  }

  if (node.type === 'ellipse') {
    return `export function ${name}() {\n  return (\n    <div\n      className={${JSON.stringify(tw)}}${styleAttribute}\n    />\n  )\n}`
  }

  if (node.type === 'path') {
    const effectId = `paper-${node.id.replace(/[^a-zA-Z0-9-]/g, '')}-effects`
    const effectDefs = node.style.effects?.some(effect => effect.enabled) ? `<defs>${effectFilterMarkup(node.style.effects, effectId)}</defs>` : ''
    const fillToken = boundToken(node, 'fill', tokens), strokeToken = boundToken(node, 'stroke', tokens)
    const fill = fillToken ? `var(${tokenVariable(fillToken)})` : node.style.fill ?? 'none'
    const stroke = strokeToken ? `var(${tokenVariable(strokeToken)})` : node.style.stroke?.color ?? 'none'
    // A real SVG outline keeps compound holes and curves intact in handoff.
    return `export function ${name}() {\n  return (\n    <svg\n      className={${JSON.stringify(tw)}}${styleAttribute}\n      viewBox="${node.viewBox.join(' ')}"\n      preserveAspectRatio="none"\n      overflow="visible"\n    >\n      ${effectDefs}\n      <path${effectDefs ? ` filter="url(#${effectId})"` : ''}\n        d={${JSON.stringify(node.d)}}\n        fillRule="${node.fillRule}"\n        fill={${JSON.stringify(fill)}}\n        stroke={${JSON.stringify(stroke)}}\n        strokeWidth={${node.style.stroke?.width ?? 0}}\n        strokeDasharray="${node.style.stroke?.dash.join(' ') ?? ''}"\n        strokeLinejoin="round"\n      />\n    </svg>\n  )\n}`
  }

  return `export function ${name}() {\n  return (\n    <div\n      className={${JSON.stringify(tw)}}${styleAttribute}\n    />\n  )\n}`
}

