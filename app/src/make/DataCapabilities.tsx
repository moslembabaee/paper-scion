import { useCallback, useEffect, useRef, useState } from 'react'
import { Database, RefreshCw } from 'lucide-react'
import { api } from '../cloud/api'
import { isAppDataDefinition, type AppDataCollection, type AppDataOperation } from './data'
import { parseJsonStrict } from './manifest'

const operations: readonly AppDataOperation[] = ['list', 'get', 'create', 'update', 'delete']
const initialSchema = JSON.stringify({ name: { type: 'string', required: true, maxLength: 80 }, subscribed: { type: 'boolean', required: true } }, null, 2)

export function DataCapabilities({ appId, accountId, saved, disabled }: {
  appId: string; accountId?: string; saved: boolean; disabled: boolean
}) {
  const available = saved && !!accountId
  const [collections, setCollections] = useState<AppDataCollection[]>([])
  const [busy, setBusy] = useState(available)
  const [error, setError] = useState('')
  const [schema, setSchema] = useState(initialSchema)
  const [allowed, setAllowed] = useState<readonly AppDataOperation[]>(operations)
  const request = useRef<AbortController | null>(null)
  const path = `/apps/${encodeURIComponent(appId)}/data`
  const refresh = useCallback(async (signal: AbortSignal) => {
    const result = await api<{ collections: AppDataCollection[] }>(path, { signal, headers: { 'X-Paper-Account': accountId ?? '' } })
    if (!signal.aborted) setCollections(result.collections)
  }, [path, accountId])
  useEffect(() => {
    const controller = new AbortController(); request.current = controller
    if (available) void refresh(controller.signal).catch(() => {
      if (!controller.signal.aborted) setError('Could not load app data. Refresh to retry.')
    }).finally(() => { if (!controller.signal.aborted) setBusy(false) })
    return () => { controller.abort(); request.current?.abort() }
  }, [available, refresh])
  async function change(input: unknown, collection?: AppDataCollection) {
    if (!available || busy || disabled) return
    const controller = new AbortController(); request.current?.abort(); request.current = controller
    setBusy(true); setError('')
    try {
      await api(path + (collection ? `/${collection.handle}` : ''), { method: collection ? 'DELETE' : 'POST',
        signal: controller.signal, headers: { 'X-Paper-Account': accountId ?? '' }, body: JSON.stringify(input) })
      await refresh(controller.signal)
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Data change could not complete. Refresh and retry.')
    } finally { if (!controller.signal.aborted) setBusy(false) }
  }
  return <section className="make-data" aria-label="App data capabilities" aria-busy={busy}>
    <h2><Database size={14} />App data<span>OWNER</span></h2>
    <p>Persist form responses in this app. Define a schema, choose permitted operations and set limits before granting access.</p>
    <details><summary>Define a collection</summary>
      <form onSubmit={event => {
        event.preventDefault()
        const fields = new FormData(event.currentTarget)
        try {
          const input = { name: fields.get('name'), schema: parseJsonStrict(schema, 12000), operations: allowed,
            quotas: { maxRecords: Number(fields.get('maxRecords')), maxBytes: Number(fields.get('maxBytes')), operationsPerMinute: Number(fields.get('operationsPerMinute')) } }
          if (!isAppDataDefinition(input)) { setError('Check the schema, operations and quota limits.'); return }
          void change(input)
        } catch { setError('Enter a valid JSON schema with string, number or boolean fields.') }
      }}>
        <fieldset disabled={!available || busy || disabled}>
          <label>Collection name<input name="name" required pattern="[a-zA-Z][a-zA-Z0-9_]{0,47}" maxLength={48} defaultValue="submissions" spellCheck={false} /></label>
          <label>Field schema<textarea aria-label="Field schema" value={schema} onChange={e => setSchema(e.target.value)} maxLength={12000} rows={10} spellCheck={false} /></label>
          <p>String fields require maxLength in UTF-8 bytes. Number fields accept minimum and maximum. Unknown fields are rejected.</p>
          <div className="make-data-operations" role="group" aria-label="Allowed data operations">{operations.map(op => <label key={op}>
            <input type="checkbox" checked={allowed.includes(op)} onChange={e => setAllowed(e.target.checked ? [...allowed, op] : allowed.filter(item => item !== op))} />{op}
          </label>)}</div>
          <div className="make-data-quotas">
            <label>Record limit<input name="maxRecords" type="number" required min={1} max={1000} defaultValue={100} /></label>
            <label>Storage bytes<input name="maxBytes" type="number" required min={1} max={262144} defaultValue={65536} /></label>
            <label>Calls / minute<input name="operationsPerMinute" type="number" required min={1} max={120} defaultValue={60} /></label>
          </div>
          <button type="submit" className="make-button">Create data capability</button>
        </fieldset>
      </form>
    </details>
    <ul>{collections.map(c => <li key={c.handle}>
      <div><strong>{c.name}</strong><span>v{c.version} · {c.status}</span></div>
      <code>{c.handle}</code>
      <small>{c.usage.records} / {c.quotas.maxRecords} records · {c.usage.bytes} / {c.quotas.maxBytes} bytes</small>
      <small>{c.operations.join(' · ')}</small>
      {c.status === 'active' ? <button className="make-button" disabled={busy || disabled} onClick={() => void change({ expectedVersion: c.version }, c)}>Revoke and erase data</button> : null}
    </li>)}</ul>
    <p role="status">{!available ? 'Save an app to configure its data.' : busy ? 'Loading app data…' : `${collections.filter(c => c.status === 'active').length} active collections · Owner preview only.`}</p>
    {available ? <button className="make-button" disabled={busy || disabled} onClick={() => {
      const controller = new AbortController(); request.current?.abort(); request.current = controller
      setBusy(true); setError('')
      void refresh(controller.signal).catch(() => { if (!controller.signal.aborted) setError('Could not load app data.') })
        .finally(() => { if (!controller.signal.aborted) setBusy(false) })
    }}><RefreshCw size={11} />Refresh app data</button> : null}
    {error ? <p role="alert" className="make-asset-error">{error}</p> : null}
  </section>
}
