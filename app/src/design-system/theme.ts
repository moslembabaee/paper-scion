import { themePalettes } from './tokens.ts'
import type { StudioTheme } from './tokens.ts'

export const THEME_STORAGE_KEY = 'paper.studio.theme'
let currentTheme: StudioTheme = 'dark'
const listeners = new Set<() => void>()

export const getTheme = (): StudioTheme => currentTheme
export const getThemePalette = () => themePalettes[currentTheme]
export const subscribeTheme = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function setTheme(theme: StudioTheme, persist = true): void {
  currentTheme = theme
  const root = document.documentElement
  root.dataset.theme = theme
  root.style.colorScheme = theme
  for (const [key, value] of Object.entries(themePalettes[theme])) {
    root.style.setProperty(`--paper-${key}`, value)
  }
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', themePalettes[theme].background)
  if (persist) {
    try { localStorage.setItem(THEME_STORAGE_KEY, theme) } catch { /* Theme still works when storage is unavailable. */ }
  }
  for (const listener of listeners) listener()
}

export function initializeTheme(): void {
  let theme: StudioTheme = 'dark'
  try {
    if (localStorage.getItem(THEME_STORAGE_KEY) === 'light') theme = 'light'
  } catch { /* Default to Dark Studio in restricted browser contexts. */ }
  setTheme(theme, false)
  window.addEventListener('storage', event => {
    if (event.key === THEME_STORAGE_KEY || event.key === null) setTheme(event.newValue === 'light' ? 'light' : 'dark', false)
  })
}
