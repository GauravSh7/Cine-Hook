import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import App from '../src/App'
import { city, failure, ids, mockApi, ok, page, payment, user } from './fixtures'
import { event, eventAvailability, eventBooking, eventIds, eventPath, eventResponse, eventSession, eventSummary, physicalSeats, seatPath } from './event-fixtures'

function visit(path: string, authenticated = false) { if (authenticated) sessionStorage.setItem('cinehook.access-token', 'unit-token'); window.history.replaceState({}, '', path) }
function api(override?: (path: string, options: RequestInit, url: URL) => Response | Promise<Response> | undefined) {
  return mockApi((path, options, url) => override?.(path, options, url) ?? (path === '/api/payments/order' ? ok({ payment: { ...payment, amountPaise: 95000 }, order: { id: 'order_controlled', amountPaise: 95000, currency: 'INR', receipt: payment.id, keyId: 'rzp_test_fixture' }, expiresAt: eventBooking.expiresAt }) : eventResponse(path) ? ok(eventResponse(path)) : undefined))
}
it('discovers inventory sessions separately from sample category filters and links to persisted details', async () => {
  visit('/events'); const urls: URL[] = []
  api((path, _options, url) => { if (path === '/api/events') urls.push(url) }); render(<App />)
  const card = (await screen.findByRole('heading', { name: event.title })).closest('article')!
  expect(within(card).getByRole('link', { name: `Book ${event.title}` })).toHaveAttribute('href', eventPath)
  expect(card).toHaveTextContent('₹400.00'); expect(card).not.toHaveTextContent(/sample/i)
  await userEvent.click(screen.getByRole('button', { name: 'Comedy Shows' }))
  expect(urls[0]?.searchParams.get('kind')).toBe('EVENTS')
  expect(urls.every(url => !url.searchParams.has('category'))).toBe(true)
  await userEvent.type(screen.getByRole('searchbox', { name: 'Search experiences' }), 'Paperkite')
  await userEvent.click(screen.getByRole('button', { name: 'Find listings' }))
  await waitFor(() => expect(urls.at(-1)?.searchParams.get('search')).toBe('Paperkite'))
})
it('shows persisted performer details and independently queries sessions for the selected city', async () => {
  visit(eventPath); sessionStorage.setItem('cinehook.city', city.id)
  const urls: URL[] = []; api((path, _options, url) => { if (path === '/api/event-sessions') { urls.push(url); return ok(page([eventSession])) } }); render(<App />)
  expect(await screen.findByRole('heading', { name: event.title })).toBeVisible()
  expect(screen.queryByText(event.performers[0]!.biography)).not.toBeInTheDocument()
  expect(await screen.findByRole('link', { name: /Choose seats/i })).toHaveAttribute('href', seatPath)
  expect(screen.getAllByText(/₹950.00/).length).toBeGreaterThan(0)
  expect(urls[0]?.searchParams.get('eventId')).toBe(event.id)
  expect(urls[0]?.searchParams.get('cityId')).toBe(city.id)
})
it('rejects a persisted event on the wrong category details route', async () => {
  visit(`/sports/bookable/${event.id}`); api(); render(<App />)
  expect(await screen.findByRole('heading', { name: /Experience not found/i })).toBeVisible()
  expect(screen.queryByRole('link', { name: /Choose seats/i })).not.toBeInTheDocument()
})
it('shows an honest empty session state without inventing purchase dates', async () => {
  visit(eventPath); api(path => path === '/api/event-sessions' ? ok(page([])) : undefined); render(<App />)
  expect(await screen.findByRole('heading', { name: /No upcoming sessions/i })).toBeVisible()
  expect(screen.queryByRole('link', { name: /Choose seats/i })).not.toBeInTheDocument()
})
it('renders actual section identities and disambiguates repeated row and seat numbers', async () => {
  visit(seatPath); api(); render(<App />)
  const front = await screen.findByRole('button', { name: /Front rows.*A1 available.*VIP.*₹950.00/i })
  const rear = screen.getByRole('button', { name: /Rear rows.*A1 available.*STANDARD.*₹400.00/i })
  expect(screen.getByRole('button', { name: /Rear rows.*A4 booked/i })).toBeDisabled()
  expect(screen.queryByRole('button', { name: /Rear rows.*A2/i })).not.toBeInTheDocument()
  expect(screen.getByRole('img', { name: /Stage with standing performer and microphone/i })).toBeVisible()
  await userEvent.click(front); await userEvent.click(rear)
  expect(screen.getByRole('status', { name: /Selected seats/i })).toHaveTextContent(/Front rows A1.*Rear rows A1/)
  expect(screen.getByText('₹1,350.00')).toBeVisible()
})
it.each(['cricket', 'football', 'basketball'])('uses the persisted %s sport to render its playing area', async sport => {
  visit(seatPath)
  const sportsSession = { ...eventSession, event: { ...event, kind: 'SPORTS', sport, performers: [], participants: [{ eventId: event.id, name: 'Invented team' }] }, venue: { ...eventSession.venue, kind: sport === 'basketball' ? 'ARENA' : 'STADIUM', sections: eventSession.venue.sections.map((section, index) => ({ ...section, position: index ? 'SOUTH' : 'NORTH' })) } }
  api(path => path === `/api/event-sessions/${eventIds.session}` ? ok({ session: sportsSession }) : undefined); render(<App />)
  expect(await screen.findByRole('img', { name: new RegExp(`${sport} (field|court)`, 'i') })).toBeVisible()
  expect(screen.getByRole('region', { name: /Venue seat map/i })).toHaveAttribute('tabindex', '0')
  await userEvent.click(screen.getByRole('button', { name: /Zoom in/i }))
  expect(screen.getByRole('button', { name: /Reset zoom/i })).toHaveTextContent('125%')
})
it('requires owner sign in before creating an event hold and retains the selection for return', async () => {
  visit(seatPath); const calls = api(); render(<App />)
  await userEvent.click(await screen.findByRole('button', { name: /Front rows.*A1 available/i })); await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await waitFor(() => expect(window.location.pathname).toBe('/login'))
  expect(new URLSearchParams(window.location.search).get('returnTo')).toBe(seatPath)
  expect(calls.some(call => call.path === '/api/event-bookings')).toBe(false)
  expect(sessionStorage.getItem(`cinehook.event-seats.${eventIds.session}`)).toContain(physicalSeats[0]!.id)
})
it('creates the authenticated event hold with only physical seat IDs and uses the persisted checkout quote', async () => {
  visit(seatPath, true); const calls = api(); render(<App />)
  await userEvent.click(await screen.findByRole('button', { name: /Front rows.*A1 available/i })); await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
  expect(await screen.findByRole('heading', { name: 'Checkout' })).toBeVisible()
  const call = calls.find(call => call.path === '/api/event-bookings')!
  expect(JSON.parse(String(call.options.body))).toEqual({ eventSessionId: eventIds.session, seatIds: [physicalSeats[0]!.id] })
  expect(new Headers(call.options.headers).get('Authorization')).toBe('Bearer unit-token')
  expect(screen.getByRole('button', { name: /Proceed to payment.*₹950.00/i })).toBeEnabled()
  expect(screen.queryByRole('navigation', { name: /Main/i })).not.toBeInTheDocument()
})
it('refreshes changed inventory after a hold conflict without navigating to checkout', async () => {
  visit(seatPath, true); let conflicted = false
  api(path => { if (path === '/api/event-bookings') { conflicted = true; return failure(409, 'SEAT_BOOKED', 'Conflict') } if (conflicted && path.endsWith('/availability')) return ok({ ...eventAvailability, seats: eventAvailability.seats.map(seat => ({ ...seat, availability: 'BOOKED' })) }) }); render(<App />)
  await userEvent.click(await screen.findByRole('button', { name: /Front rows.*A1 available/i })); await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(/already booked/i)
  expect(await screen.findByRole('button', { name: /Front rows.*A1 booked/i })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
})
it('keeps an event capture awaiting booking confirmation from becoming a ticket', async () => {
  visit(`/bookings/${ids.booking}`, true); api(path => path.endsWith('/summary') ? ok({ ...eventSummary, payment: { ...payment, status: 'SUCCESS', amountPaise: 95000 } }) : undefined); render(<App />)
  expect(await screen.findByRole('heading', { name: /Payment received, confirmation pending/i })).toBeVisible()
  expect(screen.queryByRole('button', { name: /Download ticket/i })).not.toBeInTheDocument()
  expect(screen.getByText('Front rows A1')).toBeVisible()
})
it('recovers a server-confirmed event ticket without creating another provider order', async () => {
  visit(`/bookings/${ids.booking}`, true); const calls = api(path => path.endsWith('/summary') ? ok({ ...eventSummary, booking: { ...eventBooking, status: 'CONFIRMED' }, payment: { ...payment, status: 'SUCCESS', amountPaise: 95000 } }) : undefined); render(<App />)
  expect(await screen.findByRole('button', { name: /Download ticket/i })).toBeEnabled()
  expect(screen.getByRole('heading', { name: event.title })).toBeVisible()
  expect(calls.some(call => call.path === '/api/payments/order')).toBe(false)
})
it('lists event history with sections and uses event start for upcoming classification', async () => {
  visit('/bookings', true); api(path => path === '/api/bookings' ? ok(page([{ ...eventBooking, status: 'CONFIRMED' }])) : path.endsWith('/summary') ? ok({ ...eventSummary, booking: { ...eventBooking, status: 'CONFIRMED' } }) : undefined); render(<App />)
  expect(await screen.findByRole('heading', { name: event.title })).toBeVisible()
  await userEvent.click(screen.getByRole('tab', { name: 'Upcoming (1)' }))
  expect(screen.getByRole('link', { name: 'View ticket' })).toBeVisible(); expect(screen.getByText(/Seats: Front rows A1/)).toBeVisible()
})
it('cancels a confirmed event through the shared API and waits for provider refund completion', async () => {
  visit(`/bookings/${ids.booking}`, true); let cancelled = false
  const refund = { id: 'refund_event', providerPaymentId: 'pay_event', amountPaise: 95000, currency: 'INR', reason: 'BOOKING_CANCELLED', status: 'PENDING', attempts: [] }
  const calls = api(path => { if (path.endsWith('/cancel')) { cancelled = true; return ok({ booking: { ...eventBooking, status: 'CANCELLED' }, payment: { ...payment, status: 'REFUND_PENDING' }, refunds: [refund] }) } if (path.endsWith('/summary')) return ok({ ...eventSummary, booking: { ...eventBooking, status: cancelled ? 'CANCELLED' : 'CONFIRMED' }, payment: { ...payment, amountPaise: 95000, status: cancelled ? 'REFUND_PENDING' : 'SUCCESS' }, refunds: cancelled ? [refund] : [] }) }); render(<App />)
  await userEvent.click(await screen.findByRole('button', { name: 'Cancel booking' })); await userEvent.click(screen.getByRole('button', { name: 'Confirm cancellation' }))
  expect(await screen.findByRole('heading', { name: 'Refund In Process' })).toBeVisible()
  expect(screen.queryByRole('button', { name: /Download ticket/i })).not.toBeInTheDocument()
  expect(JSON.parse(String(calls.find(call => call.path.endsWith('/cancel'))!.options.body))).toEqual({})
})
it('closes event cancellation at the persisted session start', async () => {
  visit(`/bookings/${ids.booking}`, true); api(path => path.endsWith('/summary') ? ok({ ...eventSummary, eventSession: { ...eventSession, startsAt: '2020-01-01T00:00:00Z' }, booking: { ...eventBooking, status: 'CONFIRMED' } }) : undefined); render(<App />)
  await screen.findByRole('heading', { name: 'Booking confirmed' })
  expect(screen.queryByRole('button', { name: 'Cancel booking' })).not.toBeInTheDocument()
})
it('safely reads event bookings in both admin views without movie fields', async () => {
  visit('/admin/bookings', true)
  api(path => path === '/api/auth/me' ? ok({ user: { ...user, role: 'ADMIN' } }) : path === '/api/admin/bookings' ? ok(page([{ ...eventBooking, eventSession: eventSummary.eventSession, user: { id: user.id, name: user.name }, show: null, payment: null }])) : undefined); render(<App />)
  expect(await screen.findByRole('cell', { name: new RegExp(event.title) })).toBeVisible()
  expect(screen.getByRole('cell', { name: 'Front rows A1' })).toBeVisible()
})
it('event checkout verifies the provider callback and reports uncertainty without claiming payment success', async () => {
  visit(`/bookings/${ids.booking}/checkout`, true)
  const calls = api(path => path === '/api/payments/verify' ? failure(503, 'PAYMENT_PROVIDER_UNAVAILABLE', 'uncertain') : undefined)
  vi.stubGlobal('Razorpay', class { options: { description: string; handler: (value: unknown) => void }; constructor(options: { description: string; handler: (value: unknown) => void }) { this.options = options } on() {} close() {} open() { expect(this.options.description).toBe(event.title); this.options.handler({ razorpay_order_id: 'order_controlled', razorpay_payment_id: 'pay_event', razorpay_signature: 'a'.repeat(64) }) } })
  render(<App />); await userEvent.click(await screen.findByRole('button', { name: /Proceed to payment/i }))
  expect(await screen.findByRole('alert')).toHaveTextContent(/uncertain.*do not.*pay twice/i)
  expect(JSON.parse(String(calls.find(call => call.path === '/api/payments/verify')!.options.body))).toEqual({ bookingId: ids.booking, razorpay_order_id: 'order_controlled', razorpay_payment_id: 'pay_event', razorpay_signature: 'a'.repeat(64) })
  expect(screen.queryByRole('heading', { name: 'Payment Successful' })).not.toBeInTheDocument()
})
it('focus polling drops a selected seat that another customer holds', async () => {
  visit(seatPath); let locked = false
  api(path => path.endsWith('/availability') ? ok({ ...eventAvailability, seats: eventAvailability.seats.map(seat => locked ? { ...seat, availability: 'LOCKED', remainingHoldMs: 250000 } : seat) }) : undefined); render(<App />)
  await userEvent.click(await screen.findByRole('button', { name: /Front rows.*A1 available/i })); locked = true; act(() => window.dispatchEvent(new Event('focus')))
  expect(await screen.findByRole('button', { name: /Front rows.*A1 unavailable/i })).toBeDisabled()
  expect(screen.getByRole('status', { name: /Selected seats/i })).toHaveTextContent('None')
})
it('abandons an in-flight hold response when the customer leaves the seat route', async () => {
  visit(seatPath, true); let release!: (response: Response) => void
  const calls = api(path => path === '/api/event-bookings' ? new Promise(resolve => { release = resolve }) : undefined)
  render(<App />); await userEvent.click(await screen.findByRole('button', { name: /Front rows.*A1 available/i })); await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await userEvent.click(screen.getByRole('link', { name: '← Back' }))
  await screen.findByRole('heading', { name: event.title })
  const hold = calls.find(call => call.path === '/api/event-bookings')!
  expect(hold.options.signal?.aborted).toBe(true)
  await act(async () => release(ok({ booking: eventBooking })))
  expect(window.location.pathname).toBe(eventPath)
})
it.each(['EVENTS', 'SPORTS', 'ACTIVITIES'] as const)('returns the focused header to the persisted %s experience on a direct seat route', async kind => {
  visit(seatPath)
  const persistedEvent = { ...event, kind }, detailPath = `/${kind.toLowerCase()}/bookable/${event.id}`
  api(path => path === `/api/event-sessions/${eventIds.session}` ? ok({ session: { ...eventSession, event: persistedEvent } }) : path === `/api/events/${event.id}` ? ok({ event: { ...persistedEvent, sessions: [eventSession] } }) : undefined)
  render(<App />); await screen.findByRole('heading', { name: 'Choose your seats' })
  const back = screen.getByRole('link', { name: '← Back' })
  expect(screen.getAllByRole('link', { name: /Back/i })).toHaveLength(1)
  expect(screen.getByRole('link', { name: 'CineHook home' })).toHaveAttribute('href', '/')
  expect(screen.queryByText('YOUR VIEW. YOUR SEAT.')).not.toBeInTheDocument()
  expect(screen.queryByText(event.title)).not.toBeInTheDocument()
  expect(screen.queryByText(/Your next experience/i)).not.toBeInTheDocument()
  expect(screen.queryByText(/Fictional|development|sample inventory/i)).not.toBeInTheDocument()
  expect(back).toHaveAttribute('href', detailPath)
  await userEvent.click(back)
  expect(window.location.pathname).toBe(detailPath)
  expect(await screen.findByRole('heading', { name: event.title })).toBeVisible()
})
it('retains the known sports experience back destination when inventory cannot be loaded', async () => {
  visit(seatPath)
  api(path => path === `/api/event-sessions/${eventIds.session}` ? ok({ session: { ...eventSession, event: { ...event, kind: 'SPORTS' } } }) : path.endsWith('/availability') ? failure(503, 'SERVICE_UNAVAILABLE', 'unavailable') : undefined)
  render(<App />); await screen.findByRole('alert')
  expect(screen.getByRole('link', { name: '← Back' })).toHaveAttribute('href', `/sports/bookable/${event.id}`)
})
it('uses neutral hold state copy without inferring customer ownership', async () => {
  visit(seatPath)
  api(path => path.endsWith('/availability') ? ok({ ...eventAvailability, seats: eventAvailability.seats.map(seat => ({ ...seat, availability: 'LOCKED', remainingHoldMs: 250000 })) }) : undefined)
  render(<App />)
  const seat = await screen.findByRole('button', { name: /Front rows.*A1 unavailable/i })
  expect(seat).toBeDisabled()
  const legend = screen.getByRole('list', { name: 'Seat states' })
  expect(legend).toHaveTextContent('Unavailable')
  expect(legend).not.toHaveTextContent(/locked|temporarily held/i)
  expect(legend).not.toHaveTextContent(/another customer/i)
})
it.each([
  { path: `/shows/${ids.show}/seats`, heading: 'Choose your seats', name: '← Back', href: '/movies' },
  { path: `/bookings/${ids.booking}/checkout`, heading: 'Checkout', name: '← Back', href: `/bookings/${ids.booking}` },
  { path: `/bookings/${ids.booking}`, heading: 'Awaiting payment confirmation', name: '← Back to My Bookings', href: '/bookings' },
])('preserves the focused Back destination on $path', async ({ path, heading, name, href }) => {
  visit(path, true); mockApi(); render(<App />)
  await screen.findByRole('heading', { name: heading })
  expect(screen.getByRole('link', { name })).toHaveAttribute('href', href)
})
