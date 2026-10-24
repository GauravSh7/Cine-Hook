import { api } from './client'
import type { AuthResult, LoginInput, RegisterInput, User } from './types'

export const authApi = {
  login: (input: LoginInput, signal?: AbortSignal) => api<AuthResult>('/auth/login', { method: 'POST', body: { email: input.email, password: input.password }, signal, token: null }),
  register: (input: RegisterInput, signal?: AbortSignal) => api<AuthResult>('/auth/register', { method: 'POST', body: { name: input.name, email: input.email, password: input.password, registrationToken: input.registrationToken, phone: input.phone }, signal, token: null }),
  logout: (signal?: AbortSignal) => api<{message:string}>('/auth/logout', {method:'POST',body:{},signal}),
  requestOwnership: (purpose: 'REGISTER' | 'CLEAN_START' | 'RESET_PASSWORD', email: string, signal?: AbortSignal) => api<{challengeId: string; message: string}>('/auth/ownership/request', { method: 'POST', body: { purpose, email }, signal, token: null }),
  verifyOwnership: (challengeId: string, otp: string, signal?: AbortSignal) => api<{token: string}>('/auth/ownership/verify', { method: 'POST', body: {challengeId, otp}, signal, token: null }),
  completeOwnership: (input: {purpose: 'CLEAN_START'; token: string; password: string; name?: string; cleanStartConfirmed?: boolean}, signal?: AbortSignal) => api<AuthResult>('/auth/ownership/complete', {method: 'POST', body: input, signal, token: null}),
  me: (signal?: AbortSignal) => api<{ user: User }>('/auth/me', { signal }),
  forgotPassword: (email: string, signal?: AbortSignal) => api<{ message: string; challengeId: string }>('/auth/forgot-password', { method: 'POST', body: { email }, signal, token: null }),
  verifyResetOtp: (challengeId: string, otp: string, signal?: AbortSignal) => api<{ message: string; token: string }>('/auth/verify-reset-otp', { method: 'POST', body: { challengeId, otp }, signal, token: null }),
  resetPassword: (token: string, password: string, signal?: AbortSignal) => api<{ message: string }>('/auth/reset-password', { method: 'POST', body: { token, password }, signal, token: null }),
}
