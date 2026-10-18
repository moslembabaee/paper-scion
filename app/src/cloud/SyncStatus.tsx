import { CloudCheck, CloudOff, LoaderCircle, RefreshCw } from 'lucide-react'
import type { SyncState } from './useCloudSync'

interface Props {
  state: SyncState
  status: string
  localStatus: string
  persistent: boolean
  error: string
  onRetry: () => void
}

export function SyncStatus({ state, status, localStatus, persistent, error, onRetry }: Props) {
  const localError = !persistent || localStatus.startsWith('Save unavailable')
  const saving = localStatus === 'Saving locally…'
  const retryable = ['offline', 'auth-required', 'error'].includes(state)
  const syncing = !retryable && (saving || state === 'pending' || state === 'syncing')
  const label = localError ? 'Save JSON to keep edits' : syncing ? 'Saving…' : status
  const Icon = localError || retryable ? CloudOff : syncing ? LoaderCircle : CloudCheck
  const displayState = localError ? 'error' : syncing ? 'syncing' : state
  return <div className="sync-indicator" data-state={displayState}>
    <span className="cloud-status" data-testid="sync-status" data-state={displayState} role="status" aria-live="polite" title={localError ? 'Local storage is unavailable. Export a JSON copy to keep your work.' : error || (state === 'synced' && !saving ? 'All changes saved to your account.' : 'Changes save automatically to your account.')}>
      <Icon size={13} aria-hidden="true" className={syncing ? 'sync-spinner' : undefined} />{label}
    </span>
    {retryable && !localError && <button type="button" className="sync-retry" aria-label="Retry cloud sync" title="Retry cloud sync" onClick={onRetry}><RefreshCw size={12} /></button>}
  </div>
}
