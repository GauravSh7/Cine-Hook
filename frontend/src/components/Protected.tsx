import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { useSession } from '../app/session-context'
import { EmptyState, ErrorState, Loading } from './feedback'

export function Protected({ children, admin = false }: { children: ReactNode; admin?: boolean }) {
  const session = useSession(), location = useLocation()
  if (session.status === 'checking') return <main className="page-shell"><Loading label="Checking your session…" /></main>
  if (session.status === 'error') return <main className="page-shell"><ErrorState error={session.error!} retry={session.retry} /><button className="secondary mt-4" onClick={session.logout}>Sign in again</button></main>
  if (!session.user) return <Navigate to={`/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`} replace />
  if (admin && session.user.role !== 'ADMIN') return <main className="page-shell"><EmptyState title="Administrator access required" detail="Your current account cannot access CineHook operations." /></main>
  return children
}
