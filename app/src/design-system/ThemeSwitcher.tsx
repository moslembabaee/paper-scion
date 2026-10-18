import { useSyncExternalStore } from 'react'
import { Moon, Sun } from 'lucide-react'
import { getTheme, setTheme, subscribeTheme } from './theme'
import './theme.css'

export function ThemeSwitcher() {
  const theme = useSyncExternalStore(subscribeTheme, getTheme)
  return <div className="theme-switcher" role="group" aria-label="Studio theme">
    <button type="button" data-testid="theme-dark" aria-label="Dark Studio theme" aria-pressed={theme === 'dark'} title="Dark Studio" onClick={() => setTheme('dark')}><Moon size={13} /><span>Dark</span></button>
    <button type="button" data-testid="theme-light" aria-label="Clean Slate light theme" aria-pressed={theme === 'light'} title="Clean Slate" onClick={() => setTheme('light')}><Sun size={13} /><span>Light</span></button>
  </div>
}
