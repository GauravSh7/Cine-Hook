export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly requestId: string | null
  constructor(status: number, code: string, message: string, requestId: string | null = null) {
    super(message); this.name = 'ApiError'; this.status = status; this.code = code; this.requestId = requestId
  }
}

export interface ApiOptions { method?: string; body?: unknown; signal?: AbortSignal; token?: string | null }
let accessToken: string | null = null
let serverOffsetMs = 0
export function setAccessToken(token: string | null): void { accessToken = token }
export function getServerNow(): number { return Date.now() + serverOffsetMs }

const safeMessages: Record<string, string> = {
  PASSWORD_RESET_UNAVAILABLE: 'Password reset email is currently unavailable. Please try again later or use Google sign-in for your linked account.',
  PASSWORD_RESET_INVALID: 'This reset link is invalid or expired. Request a new link.',
  AUTH_TEMPORARILY_UNAVAILABLE: 'Sign-in is temporarily unavailable. Please try again.',
  GOOGLE_LINK_PROOF_REQUIRED:'Confirm your current password and choose the Google account with the same email. Then retry.',
  GOOGLE_LINK_CONFLICT:'This Google identity could not be linked. Sign in again and retry.',
  COUPON_INVALID:'This coupon is not valid. Try FIRST50 or SAVE10.', FIRST_OFFER_UNAVAILABLE:'Your first-booking offer has already been used or is reserved for another checkout.',
  QUOTE_FROZEN:'Your payment has started. The coupon and amount cannot be changed.', LEGACY_QUOTE:'This booking retains its original price and cannot use new coupons.',
  TAX_CONFIGURATION_REQUIRED:'Checkout is currently unavailable for this booking. Please try again after the pricing settings are confirmed.',
  INVALID_CREDENTIALS: 'Email or password is incorrect.', UNAUTHORIZED: 'Please sign in to continue.',
  EMAIL_EXISTS: 'Email is already registered.', HOLD_EXPIRED: 'Your seat hold has expired.', HOLD_LOST: 'Your seat hold is no longer available.',
  SEAT_BOOKED: 'One or more selected seats are already booked.', SEAT_LOCKED: 'One or more selected seats are held by another customer.',
  SHOW_CLOSED: 'Booking is closed for this show.', BOOKING_STATE: 'This action is unavailable for the current booking state.',
  CANCELLATION_CLOSED: 'Cancellation is closed for this show.', PAYMENTS_UNAVAILABLE: 'Payments are currently unavailable.',
  INVALID_PAYMENT_SIGNATURE: 'Payment verification was unsuccessful. Check your booking status.',
  GOOGLE_EMAIL_CONFLICT: 'An account already uses this email. Please sign in with email and password; accounts are not automatically linked.',
}
function messageFor(status: number, code: string): string {
  return safeMessages[code] ?? (status === 403 ? 'You do not have permission to perform this action.' : status === 404 ? 'This item could not be found.' : status >= 500 ? 'The service is temporarily unavailable. Please try again.' : 'The request could not be completed. Please refresh and try again.')
}
function apiPath(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//') || /[\\#]/.test(path)) throw new ApiError(0, 'INVALID_API_PATH', 'Invalid API request.')
  const destination = path.startsWith('/api/') ? path : `/api${path}`
  const parsed = new URL(destination, 'https://cinehook.invalid')
  if (!parsed.pathname.startsWith('/api/')) throw new ApiError(0, 'INVALID_API_PATH', 'Invalid API request.')
  return destination
}
const aborted = () => new DOMException('The request was cancelled.', 'AbortError')

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const destination = apiPath(path)
  if (options.signal?.aborted) throw aborted()
  const snapshotToken = options.token === undefined ? accessToken : options.token
  const controller = new AbortController()
  let timedOut = false
  let rejectInterrupted: (reason: unknown) => void = () => undefined
  const interrupted = new Promise<never>((_resolve, reject) => { rejectInterrupted = reject })
  const cancel = () => { controller.abort(); rejectInterrupted(aborted()) }
  options.signal?.addEventListener('abort', cancel, { once: true })
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); rejectInterrupted(new ApiError(0, 'REQUEST_TIMEOUT', 'The request took too long. Please check your booking before trying again.')) }, 10000)
  const headers = new Headers({ Accept: 'application/json' })
  if (snapshotToken) headers.set('Authorization', `Bearer ${snapshotToken}`)
  const multipart = options.body instanceof FormData
  if (options.body !== undefined && !multipart) headers.set('Content-Type', 'application/json')
  try {
    const operation = async (): Promise<T> => {
      const response = await fetch(destination, { method: options.method ?? 'GET', headers, body: options.body === undefined ? undefined : multipart ? options.body as FormData : JSON.stringify(options.body), signal: controller.signal, credentials: 'same-origin', cache: 'no-store' })
      if (controller.signal.aborted) throw aborted()
      const serverDate = Date.parse(response.headers.get('Date') ?? '')
      if (Number.isFinite(serverDate)) serverOffsetMs = serverDate - Date.now()
      if (response.status === 401 && snapshotToken && snapshotToken === accessToken) {
        accessToken = null
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('cinehook:unauthorized', { detail: { token: snapshotToken } }))
      }
      let envelope: unknown
      try { envelope = await response.json() } catch { throw new ApiError(response.status, 'INVALID_RESPONSE', 'We couldn’t load this information. Please try again.') }
      if (controller.signal.aborted) throw aborted()
      if (!envelope || typeof envelope !== 'object') throw new ApiError(response.status, 'INVALID_RESPONSE', 'We couldn’t load this information. Please try again.')
      const body = envelope as { success?: unknown; data?: T; error?: { code?: unknown; requestId?: unknown } }
      if (!response.ok || body.success !== true) {
        const code = typeof body.error?.code === 'string' && /^[A-Z0-9_]{1,100}$/.test(body.error.code) ? body.error.code : 'REQUEST_FAILED'
        const requestId = typeof body.error?.requestId === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/.test(body.error.requestId) ? body.error.requestId : null
        throw new ApiError(response.status, code, messageFor(response.status, code), requestId)
      }
      if (!('data' in body)) throw new ApiError(response.status, 'INVALID_RESPONSE', 'We couldn’t load this information. Please try again.')
      return body.data as T
    }
    return await Promise.race([operation(), interrupted])
  } catch (error) {
    if (options.signal?.aborted) throw aborted()
    if (error instanceof ApiError) throw error
    if (timedOut) throw new ApiError(0, 'REQUEST_TIMEOUT', 'The request took too long. Please check your booking before trying again.')
    throw new ApiError(0, 'NETWORK_ERROR', 'Unable to connect. Please try again.')
  } finally { clearTimeout(timeout); options.signal?.removeEventListener('abort', cancel) }
}

export function queryPath(path: string, query: object | undefined, fields: readonly string[]): string {
  const values = query as Record<string, unknown> | undefined
  const params = new URLSearchParams()
  for (const field of fields) if (values?.[field] !== undefined && values[field] !== '') params.set(field, String(values[field]))
  return `${path}${params.size ? `?${params}` : ''}`
}
