import { useCallback, useState, type ReactNode } from 'react'
import { Link, NavLink, Route, Routes } from 'react-router'
import { adminApi } from '../api/admin'
import type { Movie } from '../api/types'
import { useAsync } from '../app/use-async'
import { usePagedAsync } from '../app/use-paged-async'
import { ScrollMore } from '../components/ScrollMore'
import { AdminTable } from '../components/AdminTable'
import { MovieForm } from '../components/MovieForm'
import { Brand } from '../components/Brand'
import { ShowForm } from '../components/ShowForm'
import { EmptyState, ErrorState, Loading, StatusBadge } from '../components/feedback'
import { formatDateTime, money } from '../domain/time'
import { adminBookingStartsAt, adminBookingTitle, seatLabel } from '../domain/booking-target'

function Header({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-4 mb-8"><h1 className="text-3xl font-semibold">{title}</h1>{children}</div>
}
function DashboardPage() {
  const stats = useAsync('dashboard', useCallback((signal: AbortSignal) => adminApi.dashboard(signal), []))
  const bookings = useAsync('recent-bookings', useCallback((signal: AbortSignal) => adminApi.bookings({ limit: 5 }, signal), []))
  return <><Header title="Dashboard" />{stats.error ? <ErrorState error={stats.error} retry={stats.reload} /> : !stats.data ? <Loading /> : <>
    <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4 mb-8">{[['Total Movies', stats.data.totalMovies], ['Active Shows', stats.data.activeShows], ['Bookings Today', stats.data.bookingsToday], ['Captured Today', money(stats.data.capturedTodayPaise)]].map(([label, value]) => <div className="panel p-6" key={label}><p className="muted text-sm">{label}</p><p className="text-3xl font-semibold mt-3">{value}</p></div>)}</div>
    <p className="muted text-sm mb-8">Daily totals follow UTC. Captured amounts are shown before refunds.</p></>}
    <h2 className="text-xl font-semibold mb-5">Recent Bookings</h2>{bookings.error ? <ErrorState error={bookings.error} retry={bookings.reload} /> : !bookings.data ? <Loading /> : !bookings.data.items.length ? <EmptyState title="No bookings yet" /> : <AdminTable headings={['Booking ID', 'User', 'Movie / Event', 'Amount', 'Status']}>{bookings.data.items.map(booking => <tr key={booking.id}><td className="font-mono text-xs">{booking.id}</td><td>{booking.user.name}</td><td>{adminBookingTitle(booking)}</td><td>{money(booking.totalPaise)}</td><td><StatusBadge value={booking.status} /></td></tr>)}</AdminTable>}
  </>
}
function MoviesPage() {
  const [page, setPage] = useState(1), [search, setSearch] = useState(''), [editor, setEditor] = useState<Movie | 'new' | null>(null)
  const [busy, setBusy] = useState(''), [error, setError] = useState('')
  const movies = usePagedAsync(`admin-movies:${search}`, useCallback((signal: AbortSignal) => adminApi.movies({ page, limit: 20, search: search || undefined }, signal), [page, search]), page)
  async function disable(movie: Movie) {
    if (!window.confirm(`Disable ${movie.title}? Historical bookings remain unchanged.`)) return
    setBusy(movie.id); setError('')
    try { await adminApi.disableMovie(movie.id); setPage(1); movies.reload() } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to disable movie.') } finally { setBusy('') }
  }
  return <><Header title="Movies"><button className="btn" onClick={() => setEditor('new')}>Add Movie</button></Header>
    {editor && <MovieForm key={editor === 'new' ? 'new' : editor.id} movie={editor === 'new' ? undefined : editor} onSaved={() => { setEditor(null); setPage(1); movies.reload() }} onClose={() => setEditor(null)} />}
    <label className="block mb-6 max-w-md">Search movies<input className="input mt-2" value={search} onChange={event => { setSearch(event.target.value); setPage(1) }} /></label>
    {error && <p role="alert" className="text-red-300 mb-5">{error}</p>}
    {movies.error ? <ErrorState error={movies.error} retry={movies.reload} /> : !movies.data ? <Loading /> : !movies.data.items.length ? <EmptyState title="No movies found" /> : <>
      <AdminTable headings={['Movie', 'Language', 'Duration', 'Status', 'Actions']}>{movies.data.items.map(movie => <tr key={movie.id}><td>{movie.title}</td><td>{movie.language}</td><td>{movie.durationMinutes} min</td><td>{movie.isActive ? 'Active' : 'Disabled'}</td><td><div className="flex gap-3"><button className="secondary" onClick={() => setEditor(movie)}>Edit</button><button className="danger-outline" disabled={!movie.isActive || busy === movie.id} onClick={() => void disable(movie)}>{busy === movie.id ? 'Disabling…' : 'Disable'}</button></div></td></tr>)}</AdminTable>
      <ScrollMore {...movies} next={() => setPage(p => p + 1)} retry={movies.reload}/></>}
  </>
}
function ShowsPage() {
  const [page, setPage] = useState(1), [editor, setEditor] = useState(false)
  const shows = usePagedAsync('admin-shows', useCallback((signal: AbortSignal) => adminApi.shows({ page, limit: 20 }, signal), [page]), page)
  return <><Header title="Shows"><button className="btn" onClick={() => setEditor(true)}>Add Show</button></Header>
    {editor && <ShowForm onSaved={() => { setEditor(false); setPage(1); shows.reload() }} onClose={() => setEditor(false)} />}
    <p className="muted text-sm mb-6">Show times are displayed in IST. Existing schedules are read-only; editing and cancellation are not available.</p>
    {shows.error ? <ErrorState error={shows.error} retry={shows.reload} /> : !shows.data ? <Loading /> : !shows.data.items.length ? <EmptyState title="No shows scheduled" /> : <>
      <AdminTable headings={['Movie', 'Theatre / Screen', 'Start time', 'Seat prices', 'Status']}>{shows.data.items.map(show => <tr key={show.id}><td>{show.movie.title}</td><td>{show.screen.theatre.name}<p className="muted text-sm">{show.screen.name}</p></td><td>{formatDateTime(show.startsAt)}</td><td>{show.prices.map(price => <p key={price.seatType}>{price.seatType}: {money(price.pricePaise)}</p>)}</td><td><StatusBadge value={show.status} /></td></tr>)}</AdminTable>
      <ScrollMore {...shows} next={() => setPage(p => p + 1)} retry={shows.reload}/></>}
  </>
}
function BookingsPage() {
  const [page, setPage] = useState(1), [search, setSearch] = useState('')
  const bookings = usePagedAsync(`admin-bookings:${search}`, useCallback((signal: AbortSignal) => adminApi.bookings({ page, limit: 20, search: search || undefined }, signal), [page, search]), page)
  return <><Header title="Bookings" /><label className="block max-w-md mb-6">Search user name or exact booking ID<input className="input mt-2" value={search} onChange={event => { setSearch(event.target.value); setPage(1) }} /></label>
    {bookings.error ? <ErrorState error={bookings.error} retry={bookings.reload} /> : !bookings.data ? <Loading /> : !bookings.data.items.length ? <EmptyState title="No bookings found" /> : <>
      <AdminTable headings={['Booking ID', 'User', 'Movie / Event session', 'Seats', 'Amount', 'Status / Payment']}>{bookings.data.items.map(booking => <tr key={booking.id}><td className="font-mono text-xs">{booking.id}</td><td>{booking.user.name}</td><td>{adminBookingTitle(booking)}<p className="muted text-sm">{formatDateTime(adminBookingStartsAt(booking))}</p></td><td>{booking.seats.map(seatLabel).join(', ')}</td><td>{money(booking.totalPaise)}</td><td><StatusBadge value={booking.status} /><p className="mt-2">{booking.payment ? <StatusBadge value={booking.payment.status} /> : 'No payment'}</p></td></tr>)}</AdminTable>
      <ScrollMore {...bookings} next={() => setPage(p => p + 1)} retry={bookings.reload}/></>}
  </>
}
function PaymentsPage() {
  const [page, setPage] = useState(1), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('')
  const payments = usePagedAsync('admin-payments', useCallback((signal: AbortSignal) => adminApi.payments({ page, limit: 20 }, signal), [page]), page)
  async function reconcile() {
    setBusy(true); setError(''); setMessage('')
    try { const result = await adminApi.reconcileRefunds(); setMessage(`Checked ${result.examined} outstanding refunds. Refresh to see the latest confirmed results.`); setPage(1); payments.reload() }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to reconcile refunds.') } finally { setBusy(false) }
  }
  return <><Header title="Payments"><button className="secondary" disabled={busy} onClick={() => void reconcile()}>{busy ? 'Reconciling…' : 'Reconcile pending refunds'}</button></Header>
    <p className="muted text-sm mb-6">Retry outstanding refunds. Completion depends on confirmation from the payment provider.</p>
    {message && <p role="status" className="mb-5">{message}</p>}{error && <p role="alert" className="text-red-300 mb-5">{error}</p>}
    {payments.error ? <ErrorState error={payments.error} retry={payments.reload} /> : !payments.data ? <Loading /> : !payments.data.items.length ? <EmptyState title="No payments yet" /> : <>
      <AdminTable headings={['Payment / Provider ID', 'User / Booking', 'Payment amount', 'Payment status', 'Booking status', 'Refund obligations']}>{payments.data.items.map(payment => <tr key={payment.id}><td className="font-mono text-xs">{payment.id}<p className="muted mt-2">{payment.providerPaymentId ?? 'Awaiting capture'}</p></td><td>{payment.booking.user.name}<p className="muted font-mono text-xs mt-2">{payment.bookingId}</p></td><td>{money(payment.amountPaise)}</td><td><StatusBadge value={payment.status} />{payment.reconciliation?.compensationRequired && !payment.reconciliation.resolvedAt && <p className="muted text-sm mt-2">Compensation required</p>}</td><td><StatusBadge value={payment.booking.status} /></td><td>{payment.refunds.length ? payment.refunds.map(refund => <p key={refund.id} className="mb-2">{money(refund.amountPaise)} · <StatusBadge value={refund.status} /></p>) : 'None'}</td></tr>)}</AdminTable>
      <ScrollMore {...payments} next={() => setPage(p => p + 1)} retry={payments.reload}/></>}
  </>
}
export function AdminPage() {
  return <div className="admin-layout"><a href="#admin-content" className="skip-link">Skip to content</a><aside className="admin-sidebar"><Link to="/" className="brand"><Brand /></Link><p className="muted text-sm mt-2 mb-8">Admin Panel</p><nav aria-label="Admin navigation">{[['', 'Dashboard'], ['/movies', 'Movies'], ['/shows', 'Shows'], ['/bookings', 'Bookings'], ['/payments', 'Payments']].map(([path, label]) => <NavLink key={label} to={`/admin${path}`} end={!path}>{label}</NavLink>)}</nav><Link to="/" className="secondary mt-8">Back to cinema</Link></aside><main id="admin-content" className="admin-content"><Routes><Route index element={<DashboardPage />} /><Route path="movies" element={<MoviesPage />} /><Route path="shows" element={<ShowsPage />} /><Route path="bookings" element={<BookingsPage />} /><Route path="payments" element={<PaymentsPage />} /><Route path="*" element={<EmptyState title="Admin page not found" />} /></Routes></main></div>
}
