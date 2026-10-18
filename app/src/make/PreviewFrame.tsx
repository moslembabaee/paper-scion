import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  PREVIEW_SANDBOX_POLICY, PREVIEW_PERMISSIONS_POLICY, MAX_PREVIEW_MESSAGES_PER_SECOND,
  createIsolatedPreviewDocument, createPreviewMessage, parsePreviewMessage,
  type PreviewThemeConfig, type PreviewReadyPayload, type PreviewErrorPayload,
  type PreviewPongPayload, type PreviewEventPayload, type PreviewHostMessageType,
  type PreviewElementSelectedPayload,
} from './preview-sandbox.ts'
import type { CompilePreviewAssets } from './compiler.ts'
import { api } from '../cloud/api.ts'
import type { AppCapabilityRequest, AppCapabilityResult } from './secrets.ts'
import { isAppDataResult, type AppDataRequest, type AppDataResult } from './data.ts'

export type PreviewFrameStatus = 'idle' | 'loading' | 'ready' | 'error'
export interface PreviewFrameProps {
  readonly html?: string | null
  readonly assets?: CompilePreviewAssets | null
  readonly title?: string
  readonly theme?: PreviewThemeConfig
  readonly sessionKey?: number
  readonly inspectMode?: boolean
  readonly selectedElementId?: string | null
  readonly onReady?: (payload: PreviewReadyPayload) => void
  readonly onError?: (payload: PreviewErrorPayload) => void
  readonly onEvent?: (payload: PreviewEventPayload) => void
  readonly onElementSelect?: (payload: PreviewElementSelectedPayload) => void
  readonly onStatusChange?: (status: PreviewFrameStatus) => void
  readonly className?: string
  readonly style?: CSSProperties
  /** Set only for an owner's saved app; shared/public previews have no capability authority. */
  readonly capabilityScope?: { readonly appId: string; readonly accountId: string }
}
export interface PreviewFrameHandle {
  readonly iframe: HTMLIFrameElement | null
  readonly status: PreviewFrameStatus
  ping(timeoutMs?: number): Promise<number>
  setTheme(theme: PreviewThemeConfig): void
  setInspectMode(enabled: boolean): void
  highlightElement(elementId: string): void
  postMessage(type: PreviewHostMessageType, payload?: unknown): void
  reload(): void
}
interface PendingPing {
  readonly sentAt: number
  readonly resolve: (latency: number) => void
  readonly reject: (error: Error) => void
  readonly timer: ReturnType<typeof setTimeout>
}

let sessionSequence = 0
/** A new document gets a new browsing context, so queued old messages cannot impersonate it. */
export const PreviewFrame = forwardRef<PreviewFrameHandle, PreviewFrameProps>(function PreviewFrame(props, ref) {
  const [reloadCount, setReloadCount] = useState(0)
  const reload = useCallback(() => setReloadCount(n => n + 1), [])
  const html = props.html ?? props.assets?.html ?? ''
  const externalSessionKey = props.sessionKey ?? 0
  const scopeKey = props.capabilityScope ? `${props.capabilityScope.accountId}:${props.capabilityScope.appId}` : ''
  const session = useMemo(() => ({
    id: `preview-${++sessionSequence}-${reloadCount}-${externalSessionKey}-${scopeKey}`,
    document: html ? createIsolatedPreviewDocument(html) : '',
  }), [html, reloadCount, externalSessionKey, scopeKey])
  return <PreviewSession key={session.id} {...props} ref={ref} document={session.document} reload={reload} />
})

const PreviewSession = forwardRef<PreviewFrameHandle, PreviewFrameProps & { document: string; reload: () => void }>(function PreviewSession(
  { document: previewDocument, reload, title = 'Paper Make App Preview', theme, className = '', style, ...callbacks }, ref,
) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const callbacksRef = useRef(callbacks)
  const inspectEnabled = useRef(callbacks.inspectMode ?? false)
  useLayoutEffect(() => { callbacksRef.current = callbacks })
  const initialStatus: PreviewFrameStatus = previewDocument ? 'loading' : 'idle'
  const statusRef = useRef<PreviewFrameStatus>(initialStatus)
  const [status, setStatus] = useState<PreviewFrameStatus>(initialStatus)
  const [lastError, setLastError] = useState<PreviewErrorPayload | null>(null)
  const pings = useRef(new Map<string, PendingPing>())
  const updateStatus = useCallback((next: PreviewFrameStatus) => {
    if (statusRef.current === next) return
    statusRef.current = next
    setStatus(next)
    callbacksRef.current.onStatusChange?.(next)
  }, [])
  const postToGuest = useCallback((type: PreviewHostMessageType, payload: unknown) => {
    const guest = iframeRef.current?.contentWindow
    if (!guest) return
    const message = createPreviewMessage('paper-host', type, payload)
    // Opaque origins require '*'; the destination is this frame's exact WindowProxy.
    // This API accepts public UI configuration and fixed capability results.
    guest.postMessage(message, '*')
    return message
  }, [])

  useLayoutEffect(() => {
    let windowStart = 0, received = 0
    let capabilityWindow = 0, capabilityCount = 0
    const capabilities = new Set<AbortController>()
    const requestIds = new Set<string>()
    let mounted = true
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow || event.origin !== 'null') return
      const now = Date.now()
      if (now - windowStart >= 1000) { windowStart = now; received = 0 }
      if (++received > MAX_PREVIEW_MESSAGES_PER_SECOND) return
      const result = parsePreviewMessage(event.data, 'paper-preview')
      if (!result.valid) return
      const { message } = result
      switch (message.type) {
        case 'preview:data': {
          if (requestIds.has(message.id)) return
          if (now - capabilityWindow >= 60_000) { capabilityWindow = now; capabilityCount = 0; requestIds.clear() }
          const scope = callbacksRef.current.capabilityScope
          if (!scope || statusRef.current !== 'ready' || capabilities.size >= 4 || ++capabilityCount > 20) {
            postToGuest('preview:data-result', { requestId: message.id, error: 'Data operation unavailable' }); return
          }
          requestIds.add(message.id)
          const controller = new AbortController(); capabilities.add(controller)
          const { handle, ...input } = message.payload as AppDataRequest & { handle: string }
          void api<AppDataResult>(`/apps/${encodeURIComponent(scope.appId)}/data/${encodeURIComponent(handle)}`, {
            method: 'POST', signal: controller.signal, headers: { 'X-Paper-Account': scope.accountId }, body: JSON.stringify(input),
          }).then(result => {
            if (mounted && !controller.signal.aborted) postToGuest('preview:data-result', isAppDataResult(result)
              ? { requestId: message.id, result } : { requestId: message.id, error: 'Data operation unavailable' })
          }).catch(() => {
            if (mounted && !controller.signal.aborted) postToGuest('preview:data-result', { requestId: message.id, error: 'Data operation unavailable' })
          }).finally(() => capabilities.delete(controller))
          break
        }
        case 'preview:capability': {
          if (requestIds.has(message.id)) return
          if (now - capabilityWindow >= 60_000) { capabilityWindow = now; capabilityCount = 0; requestIds.clear() }
          const scope = callbacksRef.current.capabilityScope
          if (!scope || statusRef.current !== 'ready' || capabilities.size >= 4 || ++capabilityCount > 20) {
            postToGuest('preview:capability-result', { requestId: message.id, error: 'Capability unavailable' }); return
          }
          requestIds.add(message.id)
          const controller = new AbortController(); capabilities.add(controller)
          const { handle, ...input } = message.payload as AppCapabilityRequest & { handle: string }
          void api<AppCapabilityResult>(`/apps/${encodeURIComponent(scope.appId)}/capabilities/${encodeURIComponent(handle)}`, {
            method: 'POST', signal: controller.signal, headers: { 'X-Paper-Account': scope.accountId }, body: JSON.stringify(input),
          }).then(result => {
            if (mounted && !controller.signal.aborted && /^[a-f0-9]{64}$/.test(result.signature)) postToGuest('preview:capability-result', { requestId: message.id, signature: result.signature })
          }).catch(() => {
            if (mounted && !controller.signal.aborted) postToGuest('preview:capability-result', { requestId: message.id, error: 'Capability unavailable' })
          }).finally(() => capabilities.delete(controller))
          break
        }
        case 'preview:ready':
          if (statusRef.current !== 'loading') return
          updateStatus('ready')
          callbacksRef.current.onReady?.(message.payload as PreviewReadyPayload)
          break
        case 'preview:error': {
          const error = message.payload as PreviewErrorPayload
          updateStatus('error'); setLastError(error)
          callbacksRef.current.onError?.(error)
          break
        }
        case 'preview:pong': {
          const pong = message.payload as PreviewPongPayload
          const pending = pong.pingId ? pings.current.get(pong.pingId) : undefined
          if (pending) {
            clearTimeout(pending.timer); pings.current.delete(pong.pingId!)
            pending.resolve(Math.max(0, Date.now() - pending.sentAt))
          }
          break
        }
        case 'preview:element-selected':
          if (statusRef.current === 'ready' && inspectEnabled.current) callbacksRef.current.onElementSelect?.(message.payload as PreviewElementSelectedPayload)
          break
        case 'preview:event': callbacksRef.current.onEvent?.(message.payload as PreviewEventPayload); break
      }
    }
    window.addEventListener('message', handleMessage)
    callbacksRef.current.onStatusChange?.(statusRef.current)
    const pendingPings = pings.current
    return () => {
      mounted = false
      for (const controller of capabilities) controller.abort()
      window.removeEventListener('message', handleMessage)
      for (const pending of pendingPings.values()) {
        clearTimeout(pending.timer); pending.reject(new Error('Preview document replaced or unmounted'))
      }
      pendingPings.clear()
    }
  }, [updateStatus, postToGuest])

  useEffect(() => {
    if (theme && status === 'ready') postToGuest('preview:set-theme', theme)
  }, [theme, status, postToGuest])

  useEffect(() => {
    inspectEnabled.current = callbacks.inspectMode ?? false
    if (status === 'ready') postToGuest('preview:set-inspect', { enabled: callbacks.inspectMode ?? false, ...(callbacks.selectedElementId ? { activeElementId: callbacks.selectedElementId } : {}) })
  }, [callbacks.inspectMode, callbacks.selectedElementId, status, postToGuest])

  useEffect(() => {
    if (status !== 'loading') return
    const timer = setTimeout(() => {
      const error = { message: 'Preview did not become ready within 10 seconds.' }
      updateStatus('error'); setLastError(error); callbacksRef.current.onError?.(error)
    }, 10000)
    return () => clearTimeout(timer)
  }, [status, updateStatus])

  useImperativeHandle(ref, () => ({
    get iframe() { return iframeRef.current },
    get status() { return statusRef.current },
    ping(timeoutMs = 5000) {
      return new Promise<number>((resolve, reject) => {
        if (statusRef.current !== 'ready' || pings.current.size >= 16 || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) {
          reject(new Error('Preview is not ready, ping limit reached, or timeout is outside 1–10000ms')); return
        }
        const message = postToGuest('preview:ping', { timestamp: Date.now() })
        if (!message) { reject(new Error('Preview window unavailable')); return }
        const timer = setTimeout(() => { pings.current.delete(message.id); reject(new Error('Preview ping timed out')) }, timeoutMs)
        pings.current.set(message.id, { sentAt: Date.now(), resolve, reject, timer })
      })
    },
    setInspectMode: enabled => { inspectEnabled.current = enabled; postToGuest('preview:set-inspect', { enabled }) },
    highlightElement: elementId => { postToGuest('preview:highlight-element', { elementId }) },
    setTheme: newTheme => { postToGuest('preview:set-theme', newTheme) },
    postMessage(type, payload) {
      if (type === 'preview:reset') reload()
      else postToGuest(type, payload)
    },
    reload,
  }), [postToGuest, reload])

  return <div className={`paper-preview-container ${className}`} data-preview-status={status} style={{
    position: 'relative', width: '100%', height: '100%', overflow: 'hidden', backgroundColor: '#080808', color: '#edebe1',
    backgroundImage: 'linear-gradient(#222222 1px,transparent 1px),linear-gradient(90deg,#222222 1px,transparent 1px)',
    backgroundSize: '120px 120px', ...style,
  }}>
    {previewDocument ? <iframe ref={iframeRef} title={title} sandbox={PREVIEW_SANDBOX_POLICY}
      allow={PREVIEW_PERMISSIONS_POLICY} {...{ credentialless: '' }} referrerPolicy="no-referrer" srcDoc={previewDocument}
      style={{ display: 'block', width: '100%', height: '100%', border: 0 }} /> :
      <div style={{ display: 'grid', placeContent: 'center', height: '100%', textAlign: 'center', padding: 24 }}>
        <p style={{ fontSize: 14, margin: '0 0 8px' }}>Your app preview</p>
        <p style={{ fontSize: 12, opacity: 0.6, margin: 0 }}>Compile your app to bring it to life.</p>
      </div>}
    {status === 'error' && lastError ? <div role="alert" style={{
      position: 'absolute', bottom: 12, left: 12, right: 12, padding: 12, background: '#222222',
      border: '1px solid #81adec', borderRadius: 6, fontSize: 12, overflowWrap: 'anywhere', maxHeight: '40%', overflow: 'auto',
    }}>{lastError.message}</div> : null}
  </div>
})
