import type { ReactNode } from 'react'
import { NavLink } from 'react-router'
import { useSession } from '../app/session-context'

export function AccountLayout({ title, detail, children }: { title: string; detail: string; children: ReactNode }) {
  const session = useSession()
  return <main className="page-shell account-page"><div className="section-title"><h1>{title}</h1><p className="muted">{detail}</p></div><div className="account-layout">
    <aside className="panel account-sidebar"><nav aria-label="Account navigation"><NavLink to="/bookings"><span aria-hidden="true">▣</span> <span>My Bookings</span></NavLink><NavLink to="/wishlist"><span aria-hidden="true">♡</span> <span>My Wishlist</span></NavLink><NavLink to="/account"><span aria-hidden="true">♙</span> <span>Account Info</span></NavLink><NavLink to="/help"><span aria-hidden="true">?</span> <span>Help &amp; Support</span></NavLink>{session.user && <button onClick={session.logout}><span aria-hidden="true">↪</span> <span>Logout</span></button>}</nav></aside>
    <div className="account-content">{children}</div></div></main>
}
