import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { LiveCanvasOptions } from './live'
import { LiveCanvas } from './live'
import { BRIDGE_PATH, DEFAULT_BRIDGE_URL } from './protocol'
import type { AgentActivity, AgentRequest, ToolReply } from './protocol'

export function useLiveBridge(options: Omit<LiveCanvasOptions, 'onActivity'>) {
  const values = useRef(options)
  useLayoutEffect(() => { values.current = options })
  const { projectId, store } = options
  const live = useRef<LiveCanvas | null>(null)
  const [activity, setActivity] = useState<AgentActivity | null>(null)
  const [connected, setConnected] = useState(false)
  useEffect(() => {
    if (!import.meta.env.DEV && !import.meta.env.VITE_PAPER_BRIDGE_URL) return
    const canvas = new LiveCanvas({ ...values.current, projectId, store, getProject: () => values.current.getProject(), onSettings: project => values.current.onSettings(project), onActivity: setActivity })
    live.current = canvas
    canvas.start()
    let stopped = false
    let endpoint = `${import.meta.env.BASE_URL.replace(/\/$/, '')}${BRIDGE_PATH}`
    const configured = import.meta.env.VITE_PAPER_BRIDGE_URL as string | undefined
    if (configured) endpoint = `${configured.replace(/\/$/, '')}${BRIDGE_PATH}`
    const preferredEndpoint = endpoint
    const fallbackEndpoint = `${DEFAULT_BRIDGE_URL}${BRIDGE_PATH}`
    const abort = new AbortController()
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let retryResolve: (() => void) | undefined
    const post = async (route: string, data: unknown) => {
      const response = await fetch(`${endpoint}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal: AbortSignal.any([abort.signal, AbortSignal.timeout(5000)]) })
      if (!response.ok) throw new Error(`Bridge: ${response.status}`)
      return response
    }
    const connect = () => post('/connect', { clientId: canvas.clientId, projectId, focused: document.hasFocus() && !document.hidden })
    const query = `?clientId=${encodeURIComponent(canvas.clientId)}`
    const focus = () => { void connect().catch(() => {}) }
    window.addEventListener('focus', focus)
    document.addEventListener('visibilitychange', focus)
    const run = async () => {
      while (!stopped) {
        try {
          await connect()
          setConnected(true)
          while (!stopped) {
            const response = await fetch(`${endpoint}/events${query}`, { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(35_000)]) })
            if (!response.ok) throw new Error('Editor disconnected')
            const data = await response.json() as { requests: AgentRequest[] }
            for (const request of data.requests) {
              if (stopped) break
              let reply: ToolReply
              try {
                if (Date.now() > request.expiresAt) throw new Error('Agent request expired before execution. Retry.')
                reply = { result: canvas.call(request.name, request.args) }
              } catch (error) { reply = { error: error instanceof Error ? error.message : 'Live tool failed' } }
              await post(`/reply${query}`, { id: request.id, ...reply })
            }
          }
        } catch {
          if (stopped) break
          setConnected(false)
          // Static hosting can use the separately running localhost bridge.
          if (!configured) endpoint = endpoint === preferredEndpoint ? fallbackEndpoint : preferredEndpoint
          await new Promise<void>(resolve => { retryResolve = resolve; retryTimer = setTimeout(resolve, 1500) })
        }
      }
    }
    void run()
    return () => {
      stopped = true
      abort.abort()
      clearTimeout(retryTimer); retryResolve?.()
      window.removeEventListener('focus', focus)
      document.removeEventListener('visibilitychange', focus)
      void fetch(`${endpoint}/disconnect${query}`, { method: 'POST', keepalive: true }).catch(() => {})
      canvas.close()
      live.current = null
    }
  }, [projectId, store])
  useEffect(() => { live.current?.metadataChanged() })
  return { connected, activity }
}
