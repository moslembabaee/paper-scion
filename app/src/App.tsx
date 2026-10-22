import { Component, lazy, Suspense, type ReactNode } from 'react'
import { useCloudAccount } from './cloud/useCloudAccount'
import { LoginGate, SessionLoader } from './auth/LoginGate'

// The canvas, shader engine and workspace storage only load after a valid session.
const Studio = lazy(() => import('./Studio'))

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

class StudioErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  override componentDidCatch(error: Error, errorInfo: unknown) {
    console.error('Studio crashed:', error, errorInfo)
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          background: '#0c0c0e',
          color: '#fafafa',
          fontFamily: 'system-ui, sans-serif',
          padding: 24,
          textAlign: 'center'
        }}>
          <h2 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Something went wrong loading the Studio</h2>
          <p style={{ color: '#85858f', maxWidth: 480, margin: 0, fontSize: 13, wordBreak: 'break-word' }}>
            {this.state.error.message || 'An unexpected rendering error occurred.'}
          </p>
          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: '#3b82f6',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                padding: '8px 16px',
                fontSize: 13,
                cursor: 'pointer'
              }}
            >
              Reload Studio
            </button>
            <button
              onClick={() => { localStorage.clear(); window.location.reload() }}
              style={{
                background: '#27272a',
                color: '#fafafa',
                border: '1px solid #3f3f46',
                borderRadius: 6,
                padding: '8px 16px',
                fontSize: 13,
                cursor: 'pointer'
              }}
            >
              Reset Cache & Reload
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

export default function App() {
  const account = useCloudAccount()
  if (!account.checked) return <SessionLoader />
  if (!account.user) return <LoginGate account={account} />
  return (
    <StudioErrorBoundary>
      <Suspense fallback={<SessionLoader label="Opening your studio…" />}>
        <Studio key={account.user.id} account={account} />
      </Suspense>
    </StudioErrorBoundary>
  )
}
