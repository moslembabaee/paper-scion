import { useEffect, useState } from 'react'
import type { Font } from '../vendor/fontkit.mjs'
import { loadOutlineFont } from './fontEngine'

export function useOutlineFont(source?: string) {
  const [state, setState] = useState<{ source: string; font?: Font; error?: string } | null>(null)
  useEffect(() => {
    if (!source) return
    let active = true
    loadOutlineFont(source).then(font => { if (active) setState({ source, font }) }, error => { if (active) setState({ source, error: error instanceof Error ? error.message : 'Could not read this font.' }) })
    return () => { active = false }
  }, [source])
  return state?.source === source ? state : null
}
