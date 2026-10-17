import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import App from '../src/App'
import { failure, mockApi, ok } from './fixtures'

it('opens forgot password and sends the email without sharing a login token', async () => {
  window.history.replaceState({}, '', '/login')
  const calls = mockApi(path => path === '/api/auth/forgot-password' ? ok({ message: 'If this email has a password account, a reset link will be sent.' }, 202) : undefined)
  render(<App />)
  await userEvent.click(screen.getByRole('link', { name: 'Forgot password?' }))
  await userEvent.type(await screen.findByLabelText('Email address'), 'reset@example.com')
  await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }))
  expect(await screen.findByRole('status')).toHaveTextContent('If this email has a password account')
  const call = calls.find(value => value.path === '/api/auth/forgot-password')!
  expect(JSON.parse(String(call.options.body))).toEqual({ email: 'reset@example.com' })
  expect(new Headers(call.options.headers).has('Authorization')).toBe(false)
})
it('clears the recovery token from the address bar and requires matching new passwords', async () => {
  const token = 'a'.repeat(43)
  window.history.replaceState({}, '', `/reset-password#token=${token}`)
  const calls = mockApi(path => path === '/api/auth/reset-password' ? ok({ message: 'Your password has been changed. Sign in with your new password.' }) : undefined)
  render(<App />)
  await userEvent.type(screen.getByLabelText('New password'), 'correct-password')
  await userEvent.type(screen.getByLabelText('Confirm new password'), 'wrong-password')
  await userEvent.click(screen.getByRole('button', { name: 'Reset password' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Passwords must match')
  expect(calls.some(call => call.path === '/api/auth/reset-password')).toBe(false)
  await userEvent.clear(screen.getByLabelText('Confirm new password'))
  await userEvent.type(screen.getByLabelText('Confirm new password'), 'correct-password')
  await userEvent.click(screen.getByRole('button', { name: 'Reset password' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Your password has been changed')
  expect(window.location.hash).toBe('')
  expect(screen.queryByRole('button', { name: 'Reset password' })).not.toBeInTheDocument()
  expect(sessionStorage.getItem('cinehook.access-token')).toBeNull()
})
it('shows a truthful delivery configuration failure and offers retry', async () => {
  window.history.replaceState({}, '', '/forgot-password')
  mockApi(path => path === '/api/auth/forgot-password' ? failure(503, 'PASSWORD_RESET_UNAVAILABLE', 'Not configured') : undefined)
  render(<App />)
  await userEvent.type(screen.getByLabelText('Email address'), 'reset@example.com')
  await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(/email.*unavailable/i)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send reset link' })).toBeEnabled())
})
