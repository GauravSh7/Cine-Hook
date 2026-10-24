import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import App from '../src/App'
import { failure, mockApi, ok, user } from './fixtures'

async function registrationDetails(email: string) {
  await userEvent.type(screen.getByLabelText('Name'),'Cinema Fan')
  await userEvent.type(screen.getByLabelText('Mobile number'),'+919876543210')
  await userEvent.type(screen.getByLabelText('Email'),email)
  await userEvent.type(screen.getByLabelText('Password',{exact:true}),'safe-unit-password')
  await userEvent.type(screen.getByLabelText('Confirm password'),'safe-unit-password')
}

it('locks the registration email during verification and Change email clears old proof and credentials', async () => {
  window.history.replaceState({}, '', '/register')
  let requests = 0
  const calls = mockApi(path => path === '/api/auth/ownership/request' ? ok({ challengeId: (++requests === 1 ? 'a' : 'b').repeat(43) })
    : path === '/api/auth/ownership/verify' ? ok({ token: 'g'.repeat(43) }) : undefined)
  render(<App />)
  await registrationDetails('first@example.com')
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
  await screen.findByLabelText('Verification code')
  expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
  await userEvent.type(screen.getByLabelText('Verification code'), '123456')
  await userEvent.click(screen.getByRole('button', { name: 'Change email' }))
  expect(screen.getByLabelText('Password',{exact:true})).toHaveValue('')
  expect(screen.getByLabelText('Confirm password')).toHaveValue('')
  await userEvent.clear(screen.getByLabelText('Email'));await userEvent.type(screen.getByLabelText('Email'),'second@example.com')
  await userEvent.type(screen.getByLabelText('Password',{exact:true}),'second-password')
  await userEvent.type(screen.getByLabelText('Confirm password'),'second-password')
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
  expect(await screen.findByLabelText('Verification code')).toHaveValue('')
  expect(calls.filter(c => c.path === '/api/auth/ownership/request').map(c => JSON.parse(String(c.options.body)).email)).toEqual(['first@example.com', 'second@example.com'])
  expect(calls.some(c => c.path === '/api/auth/register')).toBe(false)
  await userEvent.type(screen.getByLabelText('Verification code'), '654321')
  await userEvent.click(screen.getByRole('button', { name: 'Verify OTP' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Email verified')
  const verifications = calls.filter(c => c.path === '/api/auth/ownership/verify').map(c => JSON.parse(String(c.options.body)))
  expect(verifications).toEqual([{ challengeId: 'b'.repeat(43), otp: '654321' }])
  expect(JSON.parse(String(calls.find(c=>c.path==='/api/auth/register')!.options.body)).email).toBe('second@example.com')
})

it('verifies mailbox ownership before activating registration without storing credentials', async () => {
  window.history.replaceState({}, '', '/register')
  const calls = mockApi(path => path === '/api/auth/ownership/request' ? ok({ challengeId: 'c'.repeat(43) })
    : path === '/api/auth/ownership/verify' ? ok({ token: 'g'.repeat(43) }) : undefined)
  render(<App />)
  await registrationDetails('fan@example.com')
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
  expect(calls.some(c=>c.path==='/api/auth/register')).toBe(false)
  await userEvent.type(await screen.findByLabelText('Verification code'), '123456')
  await userEvent.click(screen.getByRole('button', { name: 'Verify OTP' }))
  await waitFor(() => expect(calls.some(c => c.path === '/api/auth/register')).toBe(true))
  expect(JSON.parse(String(calls.find(c => c.path === '/api/auth/register')!.options.body)).registrationToken).toBe('g'.repeat(43))
  expect(JSON.stringify(sessionStorage)).not.toContain('safe-unit-password')
  expect(sessionStorage.getItem('cinehook.access-token')).toBeNull()
})

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
  window.history.replaceState({}, '', '/register'); const calls = mockApi(path => path === '/api/auth/ownership/request' ? ok({challengeId:'c'.repeat(43)}) : path === '/api/auth/ownership/verify' ? ok({token:'t'.repeat(43)}) : undefined); render(<App />)
  await registrationDetails('fan@example.com')
  await userEvent.clear(screen.getByLabelText('Confirm password'))
  await userEvent.type(screen.getByLabelText('Confirm password'), 'different-password')
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
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
