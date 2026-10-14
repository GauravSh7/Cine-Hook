import { Fragment, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import { useSession } from '../app/session-context'

// A new route/session must own new forms, dialogs and provider SDK lifecycle.
// The key is internal React identity; it is never rendered or logged.
export function RouteScope({ children }: { children: ReactNode }) {
  const location = useLocation(), session = useSession()
  return <Fragment key={`${location.pathname}:${location.search}:${session.token ?? 'anonymous'}`}>{children}</Fragment>
}
