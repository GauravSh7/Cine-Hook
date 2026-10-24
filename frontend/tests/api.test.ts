import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// These tests catch altered wire payloads, leaked provider errors, missed expiry
// clock correction, and stale authentication responses clearing a newer session.
describe('API boundary', () => {
  beforeEach(() => { vi.resetModules() })
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

  it('unwraps complete success envelopes and serializes IDs only', async () => {
    const sent: { url: string; body: unknown; authorization: string | null }[] = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      sent.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined, authorization: new Headers(init.headers).get('Authorization') })
      return new Response(JSON.stringify({ success: true, data: { booking: { id: 'booking-1', showId: 'show-1', status: 'PENDING', totalPaise: 25000, expiresAt: '2026-10-07T10:05:00Z', confirmedAt: null, failureCode: null, createdAt: '2026-10-07T10:00:00Z', updatedAt: '2026-10-07T10:00:00Z', seats: [{ id: 'bs-1', showId: 'show-1', seatId: 'seat-1', rowName: 'A', seatNumber: 1, seatType: 'REGULAR', pricePaise: 25000 }] } } }), { status: 201 })
    })
    const { setAccessToken } = await import('../src/api/client')
    const { bookingApi } = await import('../src/api/booking')
    setAccessToken('session-token')
    const result = await bookingApi.create('show-1', ['seat-1'])
    expect(result.booking.totalPaise).toBe(25000)
    expect(sent).toEqual([{ url: '/api/bookings', body: { showId: 'show-1', seatIds: ['seat-1'] }, authorization: 'Bearer session-token' }])
  })

  it('uses only booking IDs and exact provider signature fields for payment and refund writes', async () => {
    const sent: { url: string; body: unknown }[] = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      sent.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined })
      return new Response(JSON.stringify({ success: true, data: { examined: 0 } }))
    })
    const { paymentApi } = await import('../src/api/payment')
    const { bookingApi } = await import('../src/api/booking')
    await paymentApi.order('b/1')
    await paymentApi.verify({ bookingId: 'b/1', razorpay_order_id: 'order-1', razorpay_payment_id: 'pay-1', razorpay_signature: 'sig', amountPaise: 1, paid: true } as Parameters<typeof paymentApi.verify>[0])
    await bookingApi.cancel('b/1'); await bookingApi.retryRefund('b/1')
    expect(sent).toEqual([
      { url: '/api/payments/order', body: { bookingId: 'b/1' } },
      { url: '/api/payments/verify', body: { bookingId: 'b/1', razorpay_order_id: 'order-1', razorpay_payment_id: 'pay-1', razorpay_signature: 'sig' } },
      { url: '/api/bookings/b%2F1/cancel', body: {} },
      { url: '/api/bookings/b%2F1/refund/retry', body: {} },
    ])
  })

  it('encodes query values without forwarding unknown query parameters', async () => {
    let actual = ''
    vi.stubGlobal('fetch', async (url: string) => { actual = url; return new Response(JSON.stringify({ success: true, data: { items: [], page: 1, limit: 20 } })) })
    const { catalogApi } = await import('../src/api/catalog')
    expect((await catalogApi.movies({ search: 'A & B', language: 'Hindi', page: 2, paid: true } as Parameters<typeof catalogApi.movies>[0])).items).toEqual([])
    expect(actual).toBe('/api/movies?page=2&search=A+%26+B&language=Hindi')
  })

  it('preserves safe error metadata without exposing raw server details', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ success: false, error: { code: 'PROVIDER_FAILURE', message: 'key_secret=private', requestId: 'req-42' } }), { status: 503 }))
    const { api, ApiError } = await import('../src/api/client')
    const error = await api('/payments/order').catch(value => value)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 503, code: 'PROVIDER_FAILURE', requestId: 'req-42' })
    expect((error as Error).message).not.toContain('private')
  })

  it('rejects foreign destinations and malformed server envelopes safely', async () => {
    vi.stubGlobal('fetch', async () => new Response('<html>private upstream detail</html>'))
    const { api } = await import('../src/api/client')
    await expect(api('https://foreign.test')).rejects.toMatchObject({ code: 'INVALID_API_PATH' })
    await expect(api('/movies')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it.each(['<html>private upstream detail</html>', 'null', '{"success":true}'])('uses clear retry guidance for unreadable responses: %s', async content => {
    vi.stubGlobal('fetch', async () => new Response(content, { status: 200 }))
    const { api } = await import('../src/api/client')
    await expect(api('/movies')).rejects.toMatchObject({ status: 200, code: 'INVALID_RESPONSE', message: 'We couldn’t load this information. Please try again.' })
  })

  it('guides an existing password account without leaking Google collision details', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ success: false, error: { code: 'GOOGLE_EMAIL_CONFLICT', message: 'private provider identity' } }), { status: 409 }))
    const { api } = await import('../src/api/client')
    await expect(api('/auth/google', { method: 'POST', body: {} })).rejects.toMatchObject({ code: 'GOOGLE_EMAIL_CONFLICT', message: expect.stringMatching(/email and password/i) })
  })

  it('corrects the browser clock from a response Date header', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-07T09:00:00Z'))
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ success: true, data: { items: [], page: 1, limit: 20 } }), { headers: { Date: 'Wed, 07 Oct 2026 10:00:00 GMT' } }))
    const { api, getServerNow } = await import('../src/api/client')
    await api('/movies')
    expect(getServerNow()).toBe(Date.parse('2026-10-07T10:00:00Z'))
    vi.advanceTimersByTime(2500)
    expect(getServerNow()).toBe(Date.parse('2026-10-07T10:00:02.500Z'))
  })

  it('aborts after ten seconds without retrying or exposing network details', async () => {
    vi.useFakeTimers()
    let attempts = 0
    vi.stubGlobal('fetch', () => { attempts += 1; return new Promise(() => {}) })
    const { api } = await import('../src/api/client')
    const result = api('/bookings', { method: 'POST', body: { showId: 's', seatIds: ['a'] } }).catch(value => value)
    await vi.advanceTimersByTimeAsync(10000)
    expect(await result).toMatchObject({ code: 'REQUEST_TIMEOUT', status: 0 })
    expect(attempts).toBe(1)
  })

  it('honors caller cancellation and sanitizes network rejection', async () => {
    vi.stubGlobal('fetch', () => new Promise(() => {}))
    const { api } = await import('../src/api/client')
    const controller = new AbortController()
    const request = api('/movies', { signal: controller.signal }).catch(value => value)
    controller.abort()
    expect(await request).toMatchObject({ name: 'AbortError' })
    vi.stubGlobal('fetch', async () => { throw new Error('password=secret') })
    await expect(api('/movies')).rejects.toMatchObject({ code: 'NETWORK_ERROR', message: 'Unable to connect. Please try again.' })
  })

  it('allows a cold-start read beyond ten seconds and never reports a booking error', async () => {
    vi.useFakeTimers()
    let finish!: (response: Response) => void
    vi.stubGlobal('fetch', () => new Promise<Response>(resolve => { finish = resolve }))
    const { api } = await import('../src/api/client')
    const pending = api('/movies').catch(error => error)
    await vi.advanceTimersByTimeAsync(15000)
    finish(new Response(JSON.stringify({ success: true, data: { items: [] } })))
    expect(await pending).toEqual({ items: [] })
  })

  it('retries a transient proxy GET once, but never repeats an OTP mutation', async () => {
    vi.useFakeTimers(); let attempts = 0
    vi.stubGlobal('fetch', async () => ++attempts === 1 ? new Response('Bad gateway', {status: 502}) : new Response(JSON.stringify({success:true,data:{items:[]}})))
    const { api } = await import('../src/api/client')
    const pending = api('/movies').catch(error => error)
    await vi.advanceTimersByTimeAsync(1000)
    expect(await pending).toEqual({items:[]}); expect(attempts).toBe(2)
    attempts = 0
    await expect(api('/auth/ownership/request',{method:'POST',body:{email:'owner@example.com'}})).rejects.toMatchObject({status:502})
    expect(attempts).toBe(1)
  })

  it('bounds a slow login without replaying credentials and uses neutral timeout guidance', async () => {
    vi.useFakeTimers(); let attempts=0
    vi.stubGlobal('fetch',()=>{attempts++; return new Promise(()=>{})})
    const {api}=await import('../src/api/client')
    const pending=api('/auth/login',{method:'POST',body:{}}).catch(error=>error)
    await vi.advanceTimersByTimeAsync(60000)
    const error=await pending
    expect(error).toMatchObject({code:'REQUEST_TIMEOUT'}); expect((error as Error).message).not.toMatch(/booking/)
    expect(attempts).toBe(1)
  })

  it('stops transient read retries after one attempt and retains the final request ID',async()=>{
    vi.useFakeTimers();let attempts=0
    vi.stubGlobal('fetch',async()=>{attempts++;return new Response(JSON.stringify({success:false,error:{code:'UNAVAILABLE',requestId:`request-${attempts}`}}),{status:503})})
    const {api}=await import('../src/api/client');const pending=api('/cities').catch(error=>error)
    await vi.advanceTimersByTimeAsync(1000)
    expect(await pending).toMatchObject({status:503,requestId:'request-2'});expect(attempts).toBe(2)
  })

  it('does not send a retry when navigation aborts the read during backoff',async()=>{
    vi.useFakeTimers();let attempts=0
    vi.stubGlobal('fetch',async()=>{attempts++;return new Response('unavailable',{status:502})})
    const {api}=await import('../src/api/client'),controller=new AbortController()
    const pending=api('/movies',{signal:controller.signal}).catch(error=>error)
    await vi.advanceTimersByTimeAsync(100);controller.abort();await vi.advanceTimersByTimeAsync(1000)
    expect(await pending).toMatchObject({name:'AbortError'});expect(attempts).toBe(1)
  })

  it('clears current identity on 401 but ignores an old-session 401', async () => {
    const { api, setAccessToken } = await import('../src/api/client')
    const events: unknown[] = []
    const listener = (event: Event) => events.push((event as CustomEvent).detail)
    window.addEventListener('cinehook:unauthorized', listener)
    let finish!: (value: Response) => void
    vi.stubGlobal('fetch', () => new Promise<Response>(resolve => { finish = resolve }))
    setAccessToken('old')
    const pending = api('/auth/me').catch(value => value)
    setAccessToken('new')
    finish(new Response(JSON.stringify({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication is required.', requestId: 'r1' } }), { status: 401 }))
    await pending
    expect(events).toEqual([])
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication is required.', requestId: 'r2' } }), { status: 401 }))
    await api('/auth/me').catch(() => undefined)
    expect(events).toEqual([{ token: 'new' }])
    window.removeEventListener('cinehook:unauthorized', listener)
  })

  it('does not change the clock or identity when a cancelled transport completes late', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-07T09:00:00Z'))
    let finish!: (response: Response) => void
    vi.stubGlobal('fetch', () => new Promise<Response>(resolve => { finish = resolve }))
    const { api, setAccessToken, getServerNow } = await import('../src/api/client')
    setAccessToken('current')
    const events: Event[] = []
    const listener = (event: Event) => events.push(event)
    window.addEventListener('cinehook:unauthorized', listener)
    const controller = new AbortController()
    const pending = api('/auth/me', { signal: controller.signal }).catch(value => value)
    controller.abort(); await pending
    finish(new Response(JSON.stringify({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication is required.', requestId: 'late' } }), { status: 401, headers: { Date: 'Wed, 07 Oct 2026 10:00:00 GMT' } }))
    await vi.advanceTimersByTimeAsync(0)
    expect(getServerNow()).toBe(Date.parse('2026-10-07T09:00:00Z'))
    expect(events).toEqual([])
    window.removeEventListener('cinehook:unauthorized', listener)
  })

  it('expires current identity for a 401 even if an intermediary returns unreadable content', async () => {
    vi.stubGlobal('fetch', async () => new Response('<html>Unauthorized</html>', { status: 401 }))
    const { api, setAccessToken } = await import('../src/api/client')
    setAccessToken('current')
    const events: unknown[] = []
    const listener = (event: Event) => events.push((event as CustomEvent).detail)
    window.addEventListener('cinehook:unauthorized', listener)
    await api('/auth/me').catch(() => undefined)
    expect(events).toEqual([{ token: 'current' }])
    window.removeEventListener('cinehook:unauthorized', listener)
  })
})
