import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import { Brand } from './Brand'

export function FocusedLayout({ children, eventBackTo }: { children: ReactNode; eventBackTo?: string }) {
  const location = useLocation()
  const statusDetails = /^\/bookings\/[^/]+$/.test(location.pathname)
  const eventSeats = location.pathname.startsWith('/event-sessions/')
  const back = location.pathname.includes('/checkout') ? location.pathname.replace('/checkout', '') : eventSeats ? eventBackTo ?? '/events' : '/movies'
  return <div className="focused-layout"><header className="focused-header print:hidden">{statusDetails ? <Link className="secondary" to="/bookings">← Back to My Bookings</Link> : <><Link className="secondary" to={back}>← Back</Link><Link className="brand" to="/" aria-label="CineHook home"><Brand /></Link></>}</header>{children}</div>
}
