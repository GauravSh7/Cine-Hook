import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import { useSession } from '../app/session-context'
import { useCity } from '../app/city-context'
import { Brand } from './Brand'
import { LocationDialog } from './LocationDialog'
import { LocationPin } from './LocationPin'
import { LogoutButton } from './LogoutButton'

const categories = ['Movies', 'Stream', 'Events', 'Sports', 'Activities', 'Offers']
export function PublicLayout({ children }: { children: ReactNode }) {
  const session = useSession(), city = useCity(), location = useLocation()
  const [menu, setMenu] = useState(false), [picker, setPicker] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null), menuWrap = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menu) return
    const dismiss = (event: PointerEvent) => { if (!menuWrap.current?.contains(event.target as Node)) setMenu(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('[role="dialog"][aria-modal="true"]')) { setMenu(false); menuButton.current?.focus() } }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape) }
  }, [menu])
  const authRoute = location.pathname === '/login' || location.pathname === '/register'
  const requested = authRoute ? new URLSearchParams(location.search).get('returnTo') ?? '/' : location.pathname + location.search
  const destination = requested.startsWith('/') && !requested.startsWith('//') && !requested.includes('\\') && !requested.startsWith('/login') && !requested.startsWith('/register') ? requested : '/'
  const login = `/login?returnTo=${encodeURIComponent(destination)}`
  const cityName = city.loading ? 'Loading cities…' : city.error ? 'Location unavailable' : city.selectedCity?.name ?? 'All cities'
  const home = location.pathname === '/' || location.pathname === '/movies'
  const scrollHome = () => window.scrollTo({ top: 0, left: 0, behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
  return <><a className="skip-link" href="#main-content">Skip to content</a>
    <header className="site-header print:hidden"><div className="header-main"><Link className="brand" aria-label="CineHook" to="/" onClick={scrollHome}><Brand /></Link>
      <button className="secondary location-button" onClick={() => setPicker(true)}><LocationPin/><span>{cityName}</span><span aria-hidden="true">⌄</span></button>
      {session.user ? <div className="menu-wrap profile-menu-wrap" ref={menuWrap}><button type="button" className="account-header-link" ref={menuButton} aria-label={`${session.user.name} account menu`} aria-expanded={menu} aria-controls="account-menu" onClick={() => setMenu(value => !value)}><span className="user-avatar-icon" aria-hidden="true">{session.user.avatarUrl ? <img src={session.user.avatarUrl} alt="" referrerPolicy="no-referrer" /> : <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/></svg>}</span><span>{session.user.name}</span></button><nav id="account-menu" className={`account-menu panel ${menu ? 'account-menu-open' : ''}`} aria-label="Account menu" aria-hidden={!menu} inert={!menu} onClick={() => setMenu(false)}><Link to="/bookings">My Bookings</Link><Link to="/wishlist">My Wishlist</Link><Link to="/account">Account Info</Link><Link to="/help">Help &amp; Support</Link><LogoutButton/></nav></div> : <Link className="btn signin-link" aria-label="Login" to={login}><span aria-hidden="true">♙</span> <span>Sign in</span></Link>}
    </div><nav className="category-nav" aria-label="Categories"><div>{categories.map((name, index) => {
      const to = index === 0 ? '/movies' : `/${name.toLowerCase()}`
      const active = index === 0 ? location.pathname === '/' || location.pathname.startsWith('/movies') : location.pathname === to || location.pathname.startsWith(`${to}/`)
      return <Link key={name} to={to} aria-current={active ? 'page' : undefined}>{name}</Link>
    })}</div></nav></header>
    <div id="main-content" tabIndex={-1}>{children}</div>
    {home && <footer className="site-footer graphical-footer print:hidden"><div className="footer-content"><section><Link className="footer-graphic" aria-label="Customer Care / Support" title="Help & Support" to="/help"><svg viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="3"><path d="M12 34v-6a20 20 0 0 1 40 0v6M12 48H8V32h10v16h-6Zm40 0h4V32H46v16h6ZM52 48c0 8-8 10-20 10"/><rect x="26" y="53" width="12" height="7" rx="3" fill="currentColor"/></svg><span>Customer Care / Support</span></Link></section><section><a className="footer-graphic" aria-label="About Developer" title="About Developer" href="https://portfolio-gold-eight-71.vercel.app/#" target="_blank" rel="noopener noreferrer"><svg viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="3"><rect x="5" y="8" width="54" height="39" rx="5"/><path d="m24 20-9 8 9 8m16-16 9 8-9 8m-5-20-6 25M23 55h18m-9-8v8"/></svg><span>About Developer</span></a></section><section className="footer-brand"><Link className="footer-graphic brand" aria-label="CineHook home" title="Movies — back to top" to="/" onClick={scrollHome}><Brand /></Link></section></div><div className="tmdb-attribution" aria-label="Data credits"><img src="/provider-assets/tmdb-logo.svg" alt="TMDB" /><p>This website uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.</p><a href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer">The Movie Database</a></div></footer>}
    {picker && <LocationDialog onClose={() => setPicker(false)} />}
    {session.user?.role === 'ADMIN' && <Link className="admin-shortcut print:hidden" to="/admin">Admin</Link>}
  </>
}
