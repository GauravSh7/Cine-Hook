import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import App from '../src/App'
import { ids, mockApi } from './fixtures'

it.each(['/login', '/register'])('%s keeps authentication focused and offers a home exit', async path => {
  window.history.replaceState({}, '', path)
  mockApi()
  render(<App />)
  expect(await screen.findByLabelText('Email')).toBeVisible()
  expect(screen.queryByRole('navigation', { name: 'Categories' })).not.toBeInTheDocument()
  expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Menu' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('link', { name: /Back to home/ }))
  await waitFor(() => expect(window.location.pathname).toBe('/'))
})

it('authentication tabs retain a safe protected destination without public navigation', async () => {
  window.history.replaceState({}, '', '/login?returnTo=%2Fwishlist')
  mockApi()
  render(<App />)
  await userEvent.click(screen.getByRole('tab', { name: 'Register' }))
  expect(window.location.pathname).toBe('/register')
  expect(new URLSearchParams(window.location.search).get('returnTo')).toBe('/wishlist')
  expect(screen.queryByRole('navigation', { name: 'Categories' })).not.toBeInTheDocument()
})

it.each(['//outside.example', '/\\outside.example', '/login?returnTo=/wishlist', '/register'])('password login rejects unsafe or looping return destination %s', async returnTo => {
  window.history.replaceState({}, '', `/login?returnTo=${encodeURIComponent(returnTo)}`)
  mockApi()
  render(<App />)
  await userEvent.type(screen.getByLabelText('Email'), 'fan@example.com')
  await userEvent.type(screen.getByLabelText('Password', { exact: true }), 'safe-unit-password')
  await userEvent.click(screen.getByRole('button', { name: 'Login' }))
  await waitFor(() => expect(window.location.pathname).toBe('/'))
})

it.each(['/', '/movies'])('%s offers exactly three graphical footer destinations with safe developer navigation', async path => {
  window.history.replaceState({}, '', path)
  mockApi()
  render(<App />)
  const footer = screen.getByRole('contentinfo')
  const links = within(footer).getAllByRole('link')
  expect(links).toHaveLength(3)
  for (const link of links) expect(link.querySelector('svg')).not.toBeNull()
  expect(within(footer).getByRole('link', { name: 'Customer Care / Support' })).toHaveAttribute('href', '/help')
  const developer = within(footer).getByRole('link', { name: 'About Developer' })
  expect(developer).toHaveAttribute('href', 'https://portfolio-gold-eight-71.vercel.app/#')
  expect(developer).toHaveAttribute('target', '_blank')
  expect(developer).toHaveAttribute('rel', 'noopener noreferrer')
  expect(within(footer).queryByText(/sample screenings.*not public/i)).not.toBeInTheDocument()
  await userEvent.click(within(footer).getByRole('link', { name: 'CineHook home' }))
  await waitFor(() => expect(window.location.pathname).toBe('/'))
})

it.each(['/help', '/help/chat', '/offers', '/events', `/movies/${ids.movie}`, '/account', '/wishlist'])('does not place the discovery footer on %s', async path => {
  sessionStorage.setItem('cinehook.access-token', 'unit-access-token')
  window.history.replaceState({}, '', path)
  mockApi()
  render(<App />)
  await waitFor(() => expect(screen.queryByText('Checking session…')).not.toBeInTheDocument())
  expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument()
})

it('provides five keyboard-operable FAQs with linked answers that can be closed', async () => {
  window.history.replaceState({}, '', '/help')
  mockApi()
  render(<App />)
  const faqs = screen.getByRole('region', { name: 'Frequently asked questions' })
  const questions = within(faqs).getAllByRole('button')
  expect(questions).toHaveLength(5)
  for (const question of questions) {
    expect(question).toHaveAttribute('aria-expanded', 'false')
    question.focus()
    await userEvent.keyboard('{Enter}')
    expect(question).toHaveAttribute('aria-expanded', 'true')
    const answer = document.getElementById(question.getAttribute('aria-controls')!)!
    expect(answer).toBeVisible()
    expect(answer).toHaveAttribute('aria-labelledby', question.id)
    await userEvent.keyboard(' ')
    expect(question).toHaveAttribute('aria-expanded', 'false')
    expect(answer).not.toBeVisible()
  }
})

it('support opens a dedicated upcoming-chat screen and returns to FAQs', async () => {
  window.history.replaceState({}, '', '/help')
  mockApi()
  render(<App />)
  const chat = screen.getByRole('link', { name: 'Chat With Us' })
  expect(chat).toHaveAttribute('href', '/help/chat')
  await userEvent.click(chat)
  expect(await screen.findByRole('heading', { name: 'Chatbot support is coming soon' })).toBeVisible()
  expect(screen.queryByText('CINEHOOK AI SUPPORT')).not.toBeInTheDocument()
  expect(screen.queryByText('Chatbot integration coming soon. No chatbot or live customer support is connected yet.')).not.toBeInTheDocument()
  expect(screen.queryByRole('navigation', { name: 'Categories' })).not.toBeInTheDocument()
  expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /send/i })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('link', { name: 'Back to Help & Support' }))
  expect(await screen.findByRole('region', { name: 'Frequently asked questions' })).toBeVisible()
})
