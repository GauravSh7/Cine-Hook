import { api, ApiError } from './client'
import type { AuthResult } from './types'
export interface GoogleConfig { clientId: string | null }
export interface GoogleChallenge { nonce: string; csrfToken: string; expiresAt: number }
export const googleApi = {
  link:(credential:string,csrfToken:string,password:string,signal?:AbortSignal,token?:string)=>api<AuthResult>('/auth/google/link',{method:'POST',body:{credential,csrfToken,password},signal,token}),
  config: async (signal?: AbortSignal) => {
    const value = await api<GoogleConfig>('/auth/google/config', { signal, token: null })
    if (!value || !(value.clientId === null || typeof value.clientId === 'string' && value.clientId.length <= 256 && /^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(value.clientId))) throw new Error('Google sign-in configuration could not be loaded.')
    return value
  },
  challenge: async (signal?: AbortSignal) => {
    const value = await api<GoogleChallenge>('/auth/google/challenge', { method: 'POST', body: {}, signal, token: null })
    if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value.nonce) || !/^[A-Za-z0-9_-]{43}$/.test(value.csrfToken)
      || !Number.isInteger(value.expiresAt) || value.expiresAt * 1000 <= Date.now() || value.expiresAt * 1000 > Date.now() + 360000) throw new Error('Google sign-in challenge could not be loaded.')
    return value
  },
  login: async (credential: string, csrfToken: string, signal?: AbortSignal) => {
    try { return await api<AuthResult>('/auth/google', { method: 'POST', body: { credential, csrfToken }, signal, token: null }) }
    catch (error) {
      if (error instanceof ApiError && error.code === 'GOOGLE_EMAIL_CONFLICT') throw new Error('Enter your existing email and password above, then choose Google again to connect this account.', { cause: error })
      if (error instanceof ApiError && error.code === 'GOOGLE_UNAVAILABLE') throw new Error('Google sign-in is not configured. Please use email and password.', { cause: error })
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) throw new Error('Google sign-in expired or could not be verified. Please try again.', { cause: error })
      throw error
    }
  },
}
