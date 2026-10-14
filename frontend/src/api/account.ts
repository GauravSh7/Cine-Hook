import { api } from './client'
import type { User } from './types'

export interface ProfileInput { name?: string; dateOfBirth?: string | null; phone?: string | null }
export const accountApi = {
  profile: (body: ProfileInput, signal?: AbortSignal) => api<{ user: User }>('/account/profile', { method: 'PATCH', body, signal }),
  avatar: (image: File, signal?: AbortSignal) => {
    const body = new FormData(); body.append('image', image)
    return api<{ user: User }>('/account/avatar', { method: 'POST', body, signal })
  },
}
