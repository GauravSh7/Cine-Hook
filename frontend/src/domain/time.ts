import { getServerNow } from '../api/client'

export function remainingHoldMs(expiresAt: string, now = getServerNow()): number {
  const expires = Date.parse(expiresAt)
  return Number.isFinite(expires) && Number.isFinite(now) ? Math.max(0, expires - now) : 0
}
export function formatCountdown(ms: number): string {
  // Visual cap only: HTTP Date is rounded to seconds. The actual expiresAt and
  // expiry checks are unchanged; this never extends or renews the Redis hold.
  const seconds = Number.isFinite(ms) ? Math.ceil(Math.min(300000, Math.max(0, ms)) / 1000) : 0
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}
// Display only: totals and charges remain the server's immutable paise values.
export function money(paise: number): string {
  return Number.isSafeInteger(paise) ? new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(paise / 100) : 'Unavailable'
}
export function formatDateTime(iso: string): string {
  const date = new Date(iso)
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata', timeZoneName: 'short' }).format(date) : 'Unavailable'
}
export function utcDate(iso?: string): string {
  const date = new Date(iso ?? getServerNow())
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : ''
}
