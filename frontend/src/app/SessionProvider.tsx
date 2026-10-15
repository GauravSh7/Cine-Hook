import { useEffect, useReducer, useState, type ReactNode } from 'react'
import { authApi } from '../api/auth'
import { ApiError, setAccessToken } from '../api/client'
import type { AuthResult, User } from '../api/types'
import { SessionContext, type Session } from './session-context'
import { scheduleTokenExpiryLogout } from './token-expiry'

const storageKey = 'cinehook.access-token'
function storedToken() { try { return sessionStorage.getItem(storageKey) } catch { return null } }
function saveToken(token: string | null) {
  try { if (token) sessionStorage.setItem(storageKey, token); else sessionStorage.removeItem(storageKey) } catch { /* Storage restrictions do not grant auth. */ }
  setAccessToken(token)
}
type State = Pick<Session, 'user' | 'token' | 'status' | 'error'>
export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(() => {
    const token = storedToken(); setAccessToken(token)
    return { token, user: null, status: token ? 'checking' : 'anonymous' }
  })
  const [revision, retry] = useReducer((value: number) => value + 1, 0)
  const token = state.token
  useEffect(() => {
    if (!token) return
    return scheduleTokenExpiryLogout(token, () => {
      saveToken(null)
      setState({ token: null, user: null, status: 'anonymous' })
    })
  }, [token])
  useEffect(() => {
    if (!token) return
    const controller = new AbortController()
    authApi.me(controller.signal).then(({ user }) => {
      if (!controller.signal.aborted) setState({ token, user, status: 'authenticated' })
    }, (error: unknown) => {
      if (controller.signal.aborted) return
      if (error instanceof ApiError && error.status === 401) { saveToken(null); setState({ token: null, user: null, status: 'anonymous' }) }
      else setState({ token, user: null, status: 'error', error: error instanceof Error ? error : new Error('Unable to restore your session.') })
    })
    return () => controller.abort()
  }, [token, revision])
  useEffect(() => {
    const expired = (event: Event) => {
      if ((event as CustomEvent<{ token: string | null }>).detail?.token === token && token) {
        saveToken(null); setState({ token: null, user: null, status: 'anonymous' })
      }
    }
    window.addEventListener('cinehook:unauthorized', expired)
    return () => window.removeEventListener('cinehook:unauthorized', expired)
  }, [token])
  const accept = (result: AuthResult) => { saveToken(result.accessToken); setState({ token: result.accessToken, user: result.user, status: 'authenticated' }) }
  const logout = () => { saveToken(null); setState({ token: null, user: null, status: 'anonymous' }) }
  const updateUser = (user: User, expectedToken: string) => setState(current => current.token === expectedToken && current.user?.id === user.id && current.status === 'authenticated' ? { ...current, user } : current)
  return <SessionContext.Provider value={{ ...state, accept, logout, retry, updateUser }}>{children}</SessionContext.Provider>
}
