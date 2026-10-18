import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import type { CloudSession } from './api'
import type { CloudUser } from './model'

export function useCloudAccount() {
  const [session, setSession] = useState<CloudSession>({ user: null, providers: { google: false, github: false } })
  const [available, setAvailable] = useState(false)
  const [checked, setChecked] = useState(false)
  const request = useRef<AbortController | null>(null)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [authNotice, setAuthNotice] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    request.current?.abort()
    const abort = new AbortController()
    request.current = abort
    setChecked(false)
    setSessionError(null)
    try {
      const next = await api<CloudSession>('/auth/session', {
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(4000)]),
        cache: 'no-store',
      })
      if (!abort.signal.aborted) {
        // A successful HTTP response alone must never unlock the studio.
        if (!next || !Object.hasOwn(next, 'user') || !next.providers ||
          typeof next.providers.google !== 'boolean' || typeof next.providers.github !== 'boolean' ||
          (next.user !== null && (typeof next.user !== 'object' || typeof next.user.id !== 'string' || !next.user.id ||
            typeof next.user.name !== 'string' || typeof next.user.email !== 'string' || typeof next.user.avatar !== 'string'))) {
          throw new Error('Invalid session response')
        }
        setSession(next)
        setAvailable(true)
      }
    } catch {
      if (!abort.signal.aborted) {
        setSession({ user: null, providers: { google: false, github: false } })
        setAvailable(false)
        setSessionError('We couldn’t connect to your Paper server. Please try again.')
      }
    } finally {
      if (!abort.signal.aborted) setChecked(true)
    }
  }, [])

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const error = params.get('auth_error')
      const success = params.get('auth')
      if (error) {
        setAuthNotice(error)
        params.delete('auth_error')
      } else if (success === 'success') {
        params.delete('auth')
      }
      if (error || success === 'success') {
        const clean = window.location.pathname + (params.toString() ? `?${params.toString()}` : '') + window.location.hash
        window.history.replaceState(null, '', clean)
      }
    } catch { /* Ignore headless sandboxes */ }
  }, [])

  useEffect(() => {
    void refresh()
    return () => request.current?.abort()
  }, [refresh])

  const logout = useCallback(async () => {
    request.current?.abort()
    await api('/auth/logout', { method: 'POST', headers: { 'X-Paper-Account': session.user?.id ?? '' } })
    setSession(current => ({ ...current, user: null }))
  }, [session.user?.id])

  const regenerate = useCallback(async () => {
    const { token, user } = await api<{ token: string; user: CloudUser }>('/auth/token/regenerate', { method: 'POST', headers: { 'X-Paper-Account': session.user?.id ?? '' } })
    setSession(current => current.user?.id === session.user?.id ? { ...current, user } : current)
    return token
  }, [session.user?.id])

  const revoke = useCallback(async () => {
    const { user } = await api<{ user: CloudUser }>('/auth/token', { method: 'DELETE', headers: { 'X-Paper-Account': session.user?.id ?? '' } })
    setSession(current => current.user?.id === session.user?.id ? { ...current, user } : current)
  }, [session.user?.id])

  const revealToken = useCallback(async () => {
    const { token } = await api<{ token: string }>('/auth/token', { headers: { 'X-Paper-Account': session.user?.id ?? '' } })
    return token
  }, [session.user?.id])

  const updateProfile = useCallback(async (updates: { name?: string; avatar?: string }) => {
    const { user } = await api<{ user: CloudUser }>('/auth/profile', {
      method: 'PATCH',
      headers: { 'X-Paper-Account': session.user?.id ?? '' },
      body: JSON.stringify(updates),
    })
    setSession(current => current.user?.id === user.id ? { ...current, user } : current)
    return user
  }, [session.user?.id])

  const clearAuthNotice = useCallback(() => setAuthNotice(null), [])

  return {
    ...session,
    available,
    checked,
    authNotice,
    sessionError,
    clearAuthNotice,
    refresh,
    logout,
    regenerate,
    rotate: regenerate,
    revoke,
    revealToken,
    updateProfile,
  }
}
