import { afterEach, expect, it, vi } from 'vitest'
import { accessTokenExpiresAt, scheduleTokenExpiryLogout } from '../src/app/token-expiry'

function tokenWithExpiry(exp: number) {
  const payload = btoa(JSON.stringify({ exp })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `header.${payload}.signature`
}

it('reads the signed token expiration for the automatic logout timer', () => {
  expect(accessTokenExpiresAt(tokenWithExpiry(1_800_000_000))).toBe(1_800_000_000_000)
})

it('does not trust malformed tokens as a source of a logout deadline', () => {
  expect(accessTokenExpiresAt('not-a-jwt')).toBeNull()
  expect(accessTokenExpiresAt(`header.${btoa(JSON.stringify({ exp: 'tomorrow' }))}.signature`)).toBeNull()
})

afterEach(() => vi.useRealTimers())
it('automatically logs out when the session token reaches its expiry', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
  const expiresAt = Date.now() / 1000 + 60
  const logout = vi.fn()
  scheduleTokenExpiryLogout(tokenWithExpiry(expiresAt), logout)
  vi.advanceTimersByTime(59_999)
  expect(logout).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1)
  expect(logout).toHaveBeenCalledOnce()
})
