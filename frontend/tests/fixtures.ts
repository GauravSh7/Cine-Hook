import { vi } from 'vitest'

export const ids = { movie: '10000000-0000-4000-8000-000000000001', city: '10000000-0000-4000-8000-000000000002',
  theatre: '10000000-0000-4000-8000-000000000003', screen: '10000000-0000-4000-8000-000000000004', show: '10000000-0000-4000-8000-000000000005',
  booking: '10000000-0000-4000-8000-000000000006', user: '10000000-0000-4000-8000-000000000007' }
export const timestamps = { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
export const user = { id: ids.user, name: 'Cinema Fan', email: 'fan@example.com', role: 'USER', ...timestamps }
export const city = { id: ids.city, name: 'Greater Noida', state: 'Uttar Pradesh', countryCode: 'IN', ...timestamps }
export const theatre = { id: ids.theatre, cityId: ids.city, name: 'PVR Logix', address: 'Test road', ...timestamps }
export const screen = { id: ids.screen, theatreId: ids.theatre, name: 'Screen 1', capacity: 3, ...timestamps }
export const movie = { id: ids.movie, title: 'Interstellar', description: 'A journey beyond time and space.', durationMinutes: 169,
  releaseDate: '2026-10-10T00:00:00.000Z', language: 'english', genres: ['sci-fi'], posterUrl: 'https://upload.wikimedia.org/wikipedia/en/b/bc/Interstellar_film_poster.jpg', backdropUrl: 'https://upload.wikimedia.org/wikipedia/en/b/bc/Interstellar_film_poster.jpg', collections: ['featured', 'recommended', 'picks'], artwork: null, rating: null, bookingAvailability: { cityId: null, hasShows: true, nextShowStartsAt: '2099-10-10T14:00:00.000Z' }, isActive: true, ...timestamps }
export const show = { id: ids.show, movieId: ids.movie, screenId: ids.screen, startsAt: '2099-10-10T14:00:00.000Z',
  endsAt: '2099-10-10T16:49:00.000Z', status: 'SCHEDULED' as const, ...timestamps,
  movie, screen: { ...screen, theatre: { ...theatre, city } }, prices: [{ showId: ids.show, seatType: 'REGULAR' as const, pricePaise: 12345 }] }
export const seats = [1, 2, 3].map((number, index) => ({ id: `20000000-0000-4000-8000-00000000000${number}`, screenId: ids.screen,
  rowName: 'A', seatNumber: number, seatType: 'REGULAR', pricePaise: 12345,
  availability: ['AVAILABLE', 'LOCKED', 'BOOKED'][index], remainingHoldMs: index === 1 ? 299000 : 0 }))
export const booking = { id: ids.booking, showId: ids.show, status: 'PENDING' as const, totalPaise: 12345,
  expiresAt: new Date(Date.now() + 300000).toISOString(), confirmedAt: null, failureCode: null, ...timestamps,
  seats: [{ id: '30000000-0000-4000-8000-000000000001', showId: ids.show, seatId: seats[0]!.id,
    rowName: 'A', seatNumber: 1, seatType: 'REGULAR' as const, pricePaise: 12345 }] }
export const payment = { id: '40000000-0000-4000-8000-000000000001', bookingId: ids.booking, amountPaise: 12345,
  currency: 'INR', status: 'PENDING', providerOrderId: 'order_controlled', providerPaymentId: null,
  capturedAt: null, bookingFinalizedAt: null, failureCode: null, reconciliation: null }
export const summary = { booking, show, payment: null, refunds: [] }
export const page = <T>(items: T[]) => ({ items, page: 1, limit: 20 })
export const ok = (data: unknown, status = 200) => new Response(JSON.stringify({ success: true, data }),
  { status, headers: { 'Content-Type': 'application/json', Date: new Date().toUTCString() } })
export const failure = (status: number, code: string, message: string) => new Response(JSON.stringify({ success: false,
  error: { code, message, requestId: 'test-request' } }), { status })
export function mockApi(override?: (path: string, options: RequestInit, url: URL) => Response | Promise<Response> | undefined) {
  const calls: { path: string; options: RequestInit }[] = []
  vi.stubGlobal('fetch', async (input: string | URL | Request, options: RequestInit = {}) => {
    const url = new URL(String(input), 'http://localhost'), path = url.pathname
    calls.push({ path, options })
    const custom = override?.(path, options, url)
    if (custom) return custom
    if (path === '/api/auth/me') return ok({ user })
    if (path === '/api/auth/google/config') return ok({ clientId: null })
    if (path === '/api/auth/login' || path === '/api/auth/register') return ok({ user, accessToken: 'unit-access-token', tokenType: 'Bearer' })
    if (path === '/api/movies') return ok(page([movie]))
    if (path === `/api/movies/${ids.movie}`) return ok({ movie })
    if (path === `/api/movies/${ids.movie}/show-dates`) return ok({ dates: ['2099-10-10'], timeZone: 'Asia/Kolkata' })
    if (path === '/api/cities') return ok(page([city]))
    if (path.startsWith('/api/demo-catalog/')) return ok(page([]))
    if (path === '/api/events') return ok(page([]))
    if (path === '/api/theatres') return ok(page([theatre]))
    if (path === `/api/theatres/${ids.theatre}`) return ok({ theatre: { ...theatre, city, screens: [screen] } })
    if (path === '/api/shows') return ok(page([show]))
    if (path === `/api/shows/${ids.show}`) return ok({ show })
    if (path === `/api/shows/${ids.show}/availability`) return ok({ showId: ids.show, seats })
    if (path === `/api/screens/${ids.screen}/seats`) return ok({ screenId: ids.screen, seats })
    if (path === '/api/bookings' && options.method === 'POST') return ok({ booking }, 201)
    if (path === '/api/bookings') return ok(page([booking]))
    if (path === `/api/bookings/${ids.booking}/summary`) return ok(summary)
    if (path.endsWith('/quote')) return ok({version:0,label:'Order summary',couponCode:null,subtotalPaise:12345,totalPaise:12345,frozen:true})
    if (path === '/api/payments/order') return ok({ payment, order: { id: payment.providerOrderId, amountPaise: 12345, currency: 'INR', receipt: payment.id, keyId: 'rzp_test_fixture' }, expiresAt: booking.expiresAt }, 201)
    return failure(404, 'NOT_FOUND', 'No matching test API fixture.')
  })
  return calls
}
