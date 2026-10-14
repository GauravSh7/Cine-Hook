import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import App from '../src/App'
import { failure, mockApi, ok, user } from './fixtures'

it('mounts real Google configuration alongside the password form without simulating authentication', async () => {
  window.history.replaceState({}, '', '/login'); mockApi(path => path === '/api/auth/google/config' ? ok({ clientId: null }) : undefined)
  render(<App />)
  expect(await screen.findByText(/Google sign-in is not configured/)).toBeVisible()
  expect(screen.getByRole('button', { name: 'Login' })).toBeEnabled()
  expect(sessionStorage.getItem('cinehook.access-token')).toBeNull()
  expect(screen.queryByLabelText('CineHook')).not.toBeInTheDocument()
  expect(screen.queryByText('Welcome to CineHook')).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: /Back to home/ })).toBeVisible()
})

it('keeps register focused on the form without CineHook branding, navbar, or footer', async () => {
  window.history.replaceState({}, '', '/register'); mockApi(); render(<App />)
  expect(await screen.findByRole('heading', { name: 'Create account' })).toBeVisible()
  expect(screen.queryByLabelText('CineHook')).not.toBeInTheDocument()
  expect(screen.queryByText('Welcome to CineHook')).not.toBeInTheDocument()
  expect(screen.queryByRole('navigation', { name: 'Categories' })).not.toBeInTheDocument()
  expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument()
})

it('a delayed abandoned login cannot replace the newer accepted session', async () => {
  window.history.replaceState({}, '', '/login')
  let resolveOld!: (response: Response) => void, attempts = 0
  mockApi(path => path === '/api/auth/login' ? ++attempts === 1 ? new Promise<Response>(resolve => { resolveOld = resolve }) : ok({ user, accessToken: 'new-session-token', tokenType: 'Bearer' }) : undefined)
  render(<App />)
  await userEvent.type(screen.getByLabelText('Email'), 'old@example.com'); await userEvent.type(screen.getByLabelText('Password', { exact: true }), 'unit-password')
  await userEvent.click(screen.getByRole('button', { name: 'Login' }))
  await userEvent.click(screen.getByRole('link', { name: /Back to home/ }))
  await userEvent.click((await screen.findAllByRole('link', { name: 'Login' }))[0]!)
  await userEvent.type(screen.getByLabelText('Email'), 'fan@example.com'); await userEvent.type(screen.getByLabelText('Password', { exact: true }), 'unit-password')
  await userEvent.click(screen.getByRole('button', { name: 'Login' }))
  await waitFor(() => expect(sessionStorage.getItem('cinehook.access-token')).toBe('new-session-token'))
  await act(async () => resolveOld(ok({ user: { ...user, id: 'old-user', name: 'Obsolete user' }, accessToken: 'old-session-token', tokenType: 'Bearer' })))
  expect(sessionStorage.getItem('cinehook.access-token')).toBe('new-session-token')
  expect(screen.queryByText('Obsolete user')).not.toBeInTheDocument()
})

it('login uses the real API, stores only the token, and returns to the requested route', async () => {
  window.history.replaceState({}, '', '/login?returnTo=%2Fbookings'); const calls = mockApi(); render(<App />)
  await userEvent.type(await screen.findByLabelText('Email'), 'fan@example.com')
  await userEvent.type(screen.getByLabelText('Password', { exact: true }), 'safe-unit-password')
  await userEvent.click(screen.getByRole('button', { name: 'Login' }))
  await waitFor(() => expect(window.location.pathname).toBe('/bookings'))
  expect(JSON.parse(String(calls.find(call => call.path === '/api/auth/login')!.options.body))).toEqual({ email: 'fan@example.com', password: 'safe-unit-password' })
  expect(sessionStorage.getItem('cinehook.access-token')).toBe('unit-access-token')
  expect(JSON.stringify(sessionStorage)).not.toContain('safe-unit-password')
})
it('mismatched registration passwords are rejected without an API request', async () => {
  window.history.replaceState({}, '', '/register'); const calls = mockApi(); render(<App />)
  await userEvent.type(await screen.findByLabelText('Name'), 'Cinema Fan')
  await userEvent.type(screen.getByLabelText('Email'), 'fan@example.com')
  await userEvent.type(screen.getByLabelText('Password', { exact: true }), 'safe-unit-password')
  await userEvent.type(screen.getByLabelText('Confirm password'), 'different-password')
  await userEvent.click(screen.getByRole('button', { name: 'Register' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(/match/i)
  expect(calls.some(call => call.path === '/api/auth/register')).toBe(false)
})
it('expired token redirects protected history to login instead of trusting cached identity', async () => {
  sessionStorage.setItem('cinehook.access-token', 'expired-unit-token')
  window.history.replaceState({}, '', '/bookings')
  mockApi(path => path === '/api/auth/me' ? failure(401, 'INVALID_TOKEN', 'Authentication required.') : undefined)
  render(<App />); expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeVisible()
  expect(sessionStorage.getItem('cinehook.access-token')).toBeNull()
})
