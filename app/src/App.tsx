import { lazy, Suspense } from 'react'
import { useCloudAccount } from './cloud/useCloudAccount'
import { LoginGate, SessionLoader } from './auth/LoginGate'

// The canvas, shader engine and workspace storage only load after a valid session.
const Studio = lazy(() => import('./Studio'))

export default function App() {
  const account = useCloudAccount()
  if (!account.checked) return <SessionLoader />
  if (!account.user) return <LoginGate account={account} />
  return <Suspense fallback={<SessionLoader label="Opening your studio…" />}>
    <Studio key={account.user.id} account={account} />
  </Suspense>
}
