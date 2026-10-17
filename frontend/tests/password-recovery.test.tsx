import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import App from '../src/App'
import { failure, mockApi, ok, user } from './fixtures'

it('opens forgot password and sends the email without sharing a login token', async () => {
  window.history.replaceState({}, '', '/login')
  const calls = mockApi(path => path === '/api/auth/forgot-password' ? ok({ challengeId: 'c'.repeat(43), message: 'If this email has a password account, a reset code will be sent.' }, 202) : undefined)
  render(<App />)
  await userEvent.click(screen.getByRole('link', { name: 'Forgot password?' }))
  await userEvent.type(await screen.findByLabelText('Email address'), 'reset@example.com')
  await userEvent.click(screen.getByRole('button', { name: 'Send OTP' }))
  expect(await screen.findByRole('status')).toHaveTextContent('If this email has a password account')
  const call = calls.find(value => value.path === '/api/auth/forgot-password')!
  expect(JSON.parse(String(call.options.body))).toEqual({ email: 'reset@example.com' })
  expect(new Headers(call.options.headers).has('Authorization')).toBe(false)
})
it.each(['/reset-password', '/forgot-password'])('requires OTP verification and keeps success visible after logout on %s', async path => {
  const token = 'a'.repeat(43)
  const successMessage = path === '/forgot-password'
    ? 'Your password has been created. You can sign in with your password or Google.'
    : 'Your password has been changed. Sign in with your new password.'
  sessionStorage.setItem('cinehook.access-token', 'current-test-session')
  window.history.replaceState({}, '', `${path}#token=${token}`)
  const calls = mockApi(path => path === '/api/auth/forgot-password' ? ok({ challengeId: 'c'.repeat(43), message: 'Check your inbox.' }, 202)
    : path === '/api/auth/verify-reset-otp' ? ok({ token, message: 'Verified.' })
    : path === '/api/auth/reset-password' ? ok({ message: successMessage })
    : path === '/api/auth/me' ? ok({ user }) : undefined)
  render(<App />)
  expect(screen.queryByLabelText('New password')).not.toBeInTheDocument()
  await userEvent.type(screen.getByLabelText('Email address'), 'reset@example.com')
  await userEvent.click(screen.getByRole('button', { name: 'Send OTP' }))
  await userEvent.type(await screen.findByLabelText('Verification code'), '123456')
  await userEvent.click(screen.getByRole('button', { name: 'Verify OTP' }))
  await screen.findByLabelText('New password')
  const verified = calls.find(call => call.path === '/api/auth/verify-reset-otp')!
  expect(JSON.parse(String(verified.options.body))).toEqual({ challengeId: 'c'.repeat(43), otp: '123456' })
  await userEvent.type(screen.getByLabelText('New password'), 'correct-password')
  await userEvent.type(screen.getByLabelText('Confirm new password'), 'wrong-password')
  await userEvent.click(screen.getByRole('button', { name: 'Reset password' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Passwords must match')
  expect(calls.some(call => call.path === '/api/auth/reset-password')).toBe(false)
  await userEvent.clear(screen.getByLabelText('Confirm new password'))
  await userEvent.type(screen.getByLabelText('Confirm new password'), 'correct-password')
  await userEvent.click(screen.getByRole('button', { name: 'Reset password' }))
  expect(await screen.findByRole('status')).toHaveTextContent(successMessage)
  expect(window.location.hash).toBe('')
  expect(screen.queryByRole('button', { name: 'Reset password' })).not.toBeInTheDocument()
  expect(sessionStorage.getItem('cinehook.access-token')).toBeNull()
})
it('shows a truthful delivery configuration failure and offers retry', async () => {
  window.history.replaceState({}, '', '/forgot-password')
  mockApi(path => path === '/api/auth/forgot-password' ? failure(503, 'PASSWORD_RESET_UNAVAILABLE', 'Not configured') : undefined)
  render(<App />)
  await userEvent.type(screen.getByLabelText('Email address'), 'reset@example.com')
  await userEvent.click(screen.getByRole('button', { name: 'Send OTP' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(/email.*unavailable/i)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send OTP' })).toBeEnabled())
})

it('keeps the existing OTP challenge after a throttled resend', async () => {
  window.history.replaceState({}, '', '/forgot-password')
  let requests = 0
  const calls = mockApi(path => path === '/api/auth/forgot-password'
    ? (++requests === 1 ? ok({ challengeId: 'c'.repeat(43), message: 'Check your inbox.' }, 202)
      : failure(429, 'PASSWORD_RESET_RATE_LIMITED', 'Too many requests'))
    : path === '/api/auth/verify-reset-otp' ? ok({ token: 't'.repeat(43), message: 'Verified.' }) : undefined)
  render(<App />)
  await userEvent.type(screen.getByLabelText('Email address'), 'reset@example.com')
  await userEvent.click(screen.getByRole('button', { name: 'Send OTP' }))
  await screen.findByLabelText('Verification code')
  const later = Date.now() + 61000
  vi.spyOn(Date, 'now').mockReturnValue(later)
  await userEvent.click(screen.getByRole('button', { name: 'Resend code' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Too many reset requests')
  await userEvent.type(screen.getByLabelText('Verification code'), '123456')
  await userEvent.click(screen.getByRole('button', { name: 'Verify OTP' }))
  expect(await screen.findByLabelText('New password')).toBeInTheDocument()
  const verified = calls.find(call => call.path === '/api/auth/verify-reset-otp')!
  expect(JSON.parse(String(verified.options.body)).challengeId).toBe('c'.repeat(43))
})
