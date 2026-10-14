import { createContext, useContext } from 'react'
import type { AuthResult, User } from '../api/types'

export interface Session { user: User | null; token: string | null; status: 'checking' | 'authenticated' | 'anonymous' | 'error';
  error?: Error; accept(result: AuthResult): void; logout(): void; retry(): void; updateUser(user: User, expectedToken: string): void }
export const SessionContext = createContext<Session | null>(null)
export function useSession() {
  const session = useContext(SessionContext)
  if (!session) throw new Error('Session provider missing.')
  return session
}
