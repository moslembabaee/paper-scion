import { ArrowUpRight, Moon, Sun } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { getTheme, setTheme, subscribeTheme } from '../design-system/theme'
import type { CloudAccountState } from '../cloud/CloudAccount'
import './login.css'

function Mark() {
  return <svg width="25" height="28" viewBox="0 0 25 28" fill="none" aria-hidden="true">
    <path d="M3 2h12l7 7v17H3V2Z" stroke="currentColor" strokeWidth="1.5" />
    <path d="M15 2v7h7M7 15h11M7 19h7" stroke="currentColor" strokeWidth="1.5" />
  </svg>
}

function GoogleMark() {
  return <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
  </svg>
}

function GitHubMark() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 .75a11.25 11.25 0 0 0-3.56 21.92c.56.1.77-.24.77-.54v-2.1c-3.13.68-3.79-1.33-3.79-1.33-.51-1.3-1.25-1.64-1.25-1.64-1.02-.7.08-.69.08-.69 1.13.08 1.73 1.16 1.73 1.16 1 .1.49 2.26 3.28 1.21.1-.72.39-1.21.71-1.49-2.5-.28-5.13-1.25-5.13-5.56 0-1.23.44-2.23 1.16-3.02-.12-.29-.5-1.43.11-2.98 0 0 .95-.3 3.1 1.15a10.8 10.8 0 0 1 5.62 0c2.15-1.46 3.09-1.15 3.09-1.15.61 1.55.23 2.69.11 2.98.72.79 1.16 1.79 1.16 3.02 0 4.32-2.63 5.27-5.14 5.55.4.35.76 1.04.76 2.1v2.79c0 .3.2.65.77.54A11.25 11.25 0 0 0 12 .75Z" />
  </svg>
}

export function SessionLoader({ label = 'Opening Paper…' }: { label?: string }) {
  return <main className="login-surface session-loader" role="status" aria-live="polite">
    <Mark /><span>{label}</span><span className="session-progress" aria-hidden="true" />
  </main>
}

export function LoginGate({ account }: { account: CloudAccountState }) {
  const theme = useSyncExternalStore(subscribeTheme, getTheme)
  const message = account.sessionError || account.authNotice
  return <div className="login-surface login-gate">
    <header className="login-header">
      <div className="login-brand"><Mark /><span>paper</span></div>
      <div className="login-appearance">
        <span>Studio appearance</span>
        <div role="group" aria-label="Studio appearance preview">
          <button type="button" aria-label="Dark studio appearance" aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}><Moon size={15} /><span>Dark</span></button>
          <button type="button" aria-label="Light studio appearance" aria-pressed={theme === 'light'} onClick={() => setTheme('light')}><Sun size={15} /><span>Light</span></button>
        </div>
      </div>
    </header>
    <main className="login-main">
      <section className="login-intro" aria-labelledby="login-title">
        <div className="login-study" aria-hidden="true">
          <span className="study-caption">01 / A little room for possibility</span>
          <div className="study-square"><i /><i /><i /><i /></div>
          <div className="study-circle" />
          <span className="study-measure">120 × 120</span>
        </div>
        <p className="login-eyebrow">A canvas of your own</p>
        <h1 id="login-title">Paper —<br />Space to think.</h1>
        <p className="login-description">A personal, high-craft space for your design ideas. Sign in to access your cloud workspaces and AI agent integration.</p>
      </section>
      <section className="login-actions" aria-labelledby="signin-title">
        <span className="login-section-number" aria-hidden="true">↗</span>
        <h2 id="signin-title">Make yourself at home.</h2>
        <p>Your ideas. Your space. Your next beginning.</p>
        <div className="login-providers">
          {(['google', 'github'] as const).map(provider => {
            const enabled = account.available && account.providers[provider]
            return <a key={provider} className="login-oauth" href={`/api/auth/${provider}`} aria-disabled={!enabled} aria-describedby={!enabled ? 'login-provider-status' : undefined} tabIndex={enabled ? undefined : -1} onClick={event => { if (!enabled) event.preventDefault() }}>
              {provider === 'google' ? <GoogleMark /> : <GitHubMark />}
              <span>Sign in with {provider === 'google' ? 'Google' : 'GitHub'}</span>
              <ArrowUpRight size={15} />
            </a>
          })}
        </div>
        {message && <div className="login-notice" role="alert"><p>{message}</p>{account.sessionError ? <button type="button" onClick={() => void account.refresh()}>Try again</button> : <button type="button" onClick={account.clearAuthNotice}>Dismiss</button>}</div>}
        <div id="login-provider-status">
          {!account.available && account.sessionError && <p className="login-provider-note">Sign-in will be available when your server reconnects.</p>}
          {account.available && (!account.providers.google || !account.providers.github) && <p className="login-provider-note">{!account.providers.google && !account.providers.github ? 'Sign-in is not configured yet. Ask your host to enable Google or GitHub.' : `${account.providers.google ? 'GitHub' : 'Google'} sign-in is not configured on this host.`}</p>}
        </div>
        <p className="login-storage-note"><span />Your work lives in your private workspace.</p>
      </section>
    </main>
    <footer className="login-footer"><span>Independent by design. Open source by nature.</span><span>Infinite canvas <i /> Endless possibility</span></footer>
  </div>
}
