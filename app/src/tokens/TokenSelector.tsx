import { useState } from 'react'
import { Unlink } from 'lucide-react'
import type { SceneStore } from '../scene/store'
import type { SceneElement } from '../scene/types'
import { boundToken, propertyTokenTypes, tokenCSSValue } from './model'
import type { DesignToken, TokenProperty } from './types'

export function TokenSelector({ store, node, property, label, tokens, color = false }: {
  store: SceneStore; node: SceneElement; property: TokenProperty; label: string; tokens: readonly DesignToken[]; color?: boolean
}) {
  const [error, setError] = useState('')
  const compatible = tokens.filter(token => propertyTokenTypes(property).includes(token.type))
  const bound = boundToken(node, property, tokens)
  if (!tokens.length && !bound) return null
  return <div className={`token-selector ${color ? 'token-color-selector' : ''} ${bound ? 'is-bound' : ''}`}>
    <div className="token-selector-control">
      {color && <svg className="token-four-circles" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">{[[4, 4], [10, 4], [4, 10], [10, 10]].map(([cx, cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2" fill="currentColor" />)}</svg>}
      <select aria-label={`${label} token`} title={bound ? `Bound to ${bound.name}` : `Choose a ${label.toLowerCase()} token`} value={bound?.id ?? ''} onChange={event => {
        try { if (event.currentTarget.value) store.bindToken(node.id, property, event.currentTarget.value); else store.detachToken(node.id, property); setError('') }
        catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to bind token') }
      }} onKeyDown={event => {
        if (event.key === 'Backspace' && bound) { event.preventDefault(); event.stopPropagation(); store.detachToken(node.id, property) }
      }}>
        <option value="">{bound ? 'Detach token · keep value' : compatible.length ? 'Choose token' : 'No matching tokens'}</option>
        {compatible.map(token => <option key={token.id} value={token.id}>{token.name} · {tokenCSSValue(token)}</option>)}
      </select>
    </div>
    {color && bound && <button className="quiet-button" title="Detach token · keep current value" aria-label={`Detach ${label.toLowerCase()} token`} onClick={() => store.detachToken(node.id, property)}><Unlink size={12} /></button>}
    {error && <span className="token-error" role="alert">{error}</span>}
  </div>
}
