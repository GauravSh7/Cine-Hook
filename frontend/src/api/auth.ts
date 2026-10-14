import { api } from './client'
import type { AuthResult, LoginInput, RegisterInput, User } from './types'

export const authApi = {
  login: (input: LoginInput, signal?: AbortSignal) => api<AuthResult>('/auth/login', { method: 'POST', body: { email: input.email, password: input.password }, signal, token: null }),
  register: (input: RegisterInput, signal?: AbortSignal) => api<AuthResult>('/auth/register', { method: 'POST', body: { name: input.name, email: input.email, password: input.password }, signal, token: null }),
  me: (signal?: AbortSignal) => api<{ user: User }>('/auth/me', { signal }),
}
