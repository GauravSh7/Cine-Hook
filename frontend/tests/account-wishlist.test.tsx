import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import App from '../src/App'
import { api, setAccessToken } from '../src/api/client'
import { failure, ids, mockApi, movie, ok, page, user } from './fixtures'
import { MemoryRouter } from 'react-router'
import { SessionProvider } from '../src/app/SessionProvider'
import { WishlistButton } from '../src/components/WishlistButton'

function DuplicateWishlistControls() { return <MemoryRouter><SessionProvider><WishlistButton movieId={ids.movie} /><WishlistButton movieId={ids.movie} /></SessionProvider></MemoryRouter> }

it('saving a movie synchronizes its other visible card only after the owner API succeeds', async () => {
  signedIn('/'); let saved = false, finish!: (response: Response) => void
  mockApi((path, options) => path === `/api/wishlist/movies/${ids.movie}` ? options.method === 'PUT' ? new Promise<Response>(resolve => { finish = response => { saved = true; resolve(response) } }) : ok({ saved }) : undefined)
  render(<DuplicateWishlistControls />)
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Save to wishlist' })).toHaveLength(2))
  const buttons = screen.getAllByRole('button', { name: 'Save to wishlist' }); await waitFor(() => expect(buttons[0]).toBeEnabled())
  await userEvent.click(buttons[0]!)
  expect(buttons[1]).toHaveAttribute('aria-pressed', 'false')
  await act(async () => finish(ok({ saved: true })))
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Remove from wishlist' })).toHaveLength(2))
})

function signedIn(path: string) { sessionStorage.setItem('cinehook.access-token', 'unit-access-token'); window.history.replaceState({}, '', path) }
it('refills the loaded wishlist after removal without skipping the next movie', async () => {
  signedIn('/wishlist')
  let saved = Array.from({ length: 21 }, (_, index) => ({ movie: { ...movie, id: `saved-${index + 1}`, title: `Saved movie ${index + 1}` }, createdAt: movie.createdAt }))
  mockApi((path, options, url) => {
    if (path === '/api/wishlist/movies') { const offset = (Number(url.searchParams.get('page') ?? 1) - 1) * 20; return ok({ items: saved.slice(offset, offset + 20), page: offset / 20 + 1, limit: 20 }) }
    if (options.method === 'DELETE') { saved = saved.filter(item => !path.endsWith(item.movie.id)); return ok({ saved: false }) }
  })
  render(<App />); await screen.findByRole('heading', { name: 'Saved movie 20' })
  await userEvent.click(screen.getByRole('button', { name: 'Remove Saved movie 1' }))
  expect(await screen.findByRole('heading', { name: 'Saved movie 21' })).toBeVisible()
})
it('a movie saved again by the server reappears on wishlist refresh', async () => {
  signedIn('/wishlist'); let saved = true
  mockApi((path, options) => path === '/api/wishlist/movies' ? ok(page(saved ? [{ movie, createdAt: movie.createdAt }] : [])) : options.method === 'DELETE' ? (saved = false, ok({ saved })) : undefined)
  render(<App />); await screen.findByRole('heading', { name: movie.title })
  await userEvent.click(screen.getByRole('button', { name: `Remove ${movie.title}` }))
  await screen.findByRole('heading', { name: 'Your wishlist is empty' })
  saved = true
  await userEvent.click(screen.getByRole('link', { name: 'My Bookings' }))
  await userEvent.click(screen.getByRole('link', { name: 'My Wishlist' }))
  expect(await screen.findByRole('heading', { name: movie.title })).toBeVisible()
})
it('a pre-save status read cannot downgrade duplicate cards but a later authoritative read can', async () => {
  signedIn('/')
  let reads = 0, saved = false, stale!: (response: Response) => void
  mockApi((path, options) => {
    if (path !== `/api/wishlist/movies/${ids.movie}`) return
    if (options.method === 'PUT') { saved = true; return ok({ saved }) }
    if (++reads === 2) return new Promise<Response>(resolve => { stale = resolve })
    return ok({ saved })
  })
  render(<DuplicateWishlistControls />)
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Save to wishlist' })).toHaveLength(2))
  const buttons = screen.getAllByRole('button', { name: 'Save to wishlist' }); await waitFor(() => expect(buttons[0]).toBeEnabled())
  await userEvent.click(buttons[0]!)
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Remove from wishlist' })).toHaveLength(2))
  await act(async () => stale(ok({ saved: false })))
  expect(screen.getAllByRole('button', { name: 'Remove from wishlist' })).toHaveLength(2)
  saved = false; act(() => window.dispatchEvent(new Event('focus')))
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Save to wishlist' })).toHaveLength(2))
})
it('rejects international phone numbers with fewer than eight digits', async () => {
  signedIn('/account'); const calls = mockApi(); render(<App />)
  await userEvent.type(await screen.findByLabelText('Phone number'), '+1234567')
  await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(/international/i)
  expect(calls.some(call => call.path === '/api/account/profile')).toBe(false)
})
it('uploads multipart without JSON encoding or a manually supplied boundary', async () => {
  const calls = mockApi(() => ok({ user })); setAccessToken('unit-access-token')
  const form = new FormData(); form.append('image', new File(['image'], 'portrait.png', { type: 'image/png' }))
  await api('/account/avatar', { method: 'POST', body: form })
  expect(calls[0]!.options.body).toBe(form)
  expect(new Headers(calls[0]!.options.headers).has('Content-Type')).toBe(false)
  expect(new Headers(calls[0]!.options.headers).get('Authorization')).toBe('Bearer unit-access-token')
})
it('edits supported profile fields with a read-only email and derives age', async () => {
  signedIn('/account')
  const calls = mockApi(path => path === '/api/account/profile' ? ok({ user: { ...user, name: 'Updated Fan', dateOfBirth: '2000-02-29', phone: '+919876543210' } }) : undefined)
  render(<App />)
  const name = await screen.findByLabelText('Full name'); expect(screen.getByLabelText('Email address')).toHaveAttribute('readonly')
  await userEvent.clear(name); await userEvent.type(name, 'Updated Fan')
  await userEvent.type(screen.getByLabelText('Date of birth'), '2000-02-29')
  await userEvent.type(screen.getByLabelText('Phone number'), '+919876543210')
  await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Profile saved')
  expect(JSON.parse(String(calls.find(call => call.path === '/api/account/profile')!.options.body))).toEqual({ name: 'Updated Fan', dateOfBirth: '2000-02-29', phone: '+919876543210' })
  expect(screen.getByLabelText('Age')).toHaveValue('26')
  expect(sessionStorage.getItem('cinehook.access-token')).toBe('unit-access-token')
})
it('rejects invalid phone and oversized avatar before sending a write', async () => {
  signedIn('/account'); const calls = mockApi(); render(<App />)
  await screen.findByLabelText('Full name')
  await userEvent.type(screen.getByLabelText('Phone number'), '98765')
  await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(/international/i)
  await userEvent.upload(screen.getByLabelText('Profile photo'), new File([new Uint8Array(3 * 1024 * 1024 + 1)], 'photo.png', { type: 'image/png' }))
  expect(screen.getByRole('alert')).toHaveTextContent(/3 MiB/i)
  expect(calls.some(call => call.path.startsWith('/api/account/'))).toBe(false)
})
it('shows upload provider failure without claiming the photo was saved', async () => {
  signedIn('/account'); mockApi(path => path === '/api/account/avatar' ? failure(503, 'UPLOADS_UNAVAILABLE', 'secret provider detail') : undefined); render(<App />)
  await screen.findByLabelText('Full name')
  await userEvent.upload(screen.getByLabelText('Profile photo'), new File(['image'], 'photo.webp', { type: 'image/webp' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(/unavailable/i)
  expect(screen.queryByText(/photo saved/i)).not.toBeInTheDocument(); expect(screen.queryByText('secret provider detail')).not.toBeInTheDocument()
})
it('an abandoned profile response cannot restore a logged-out identity', async () => {
  signedIn('/account'); let resolve!: (response: Response) => void
  mockApi(path => path === '/api/account/profile' ? new Promise<Response>(done => { resolve = done }) : path === '/api/auth/logout' ? ok({message:'Signed out'}) : undefined); render(<App />)
  await screen.findByLabelText('Full name'); await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  await userEvent.click(screen.getByRole('button', { name: 'Logout' }))
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', {name:'Logout'}))
  await waitFor(()=>expect(sessionStorage.getItem('cinehook.access-token')).toBeNull())
  await act(async () => resolve(ok({ user: { ...user, name: 'Obsolete account' } })))
  expect(sessionStorage.getItem('cinehook.access-token')).toBeNull(); expect(screen.queryByText('Obsolete account')).not.toBeInTheDocument()
})
it('loads saved movies from the owner API and removes disabled entries without a booking link', async () => {
  signedIn('/wishlist'); let saved = true
  const calls = mockApi((path, options) => path === '/api/wishlist/movies' ? ok(page(saved ? [{ movie: { ...movie, isActive: false }, createdAt: movie.createdAt }] : [])) : path === `/api/wishlist/movies/${ids.movie}` ? (saved = options.method !== 'DELETE', ok({ saved })) : undefined)
  render(<App />); expect(await screen.findByRole('heading', { name: movie.title })).toBeVisible()
  expect(screen.queryByRole('link', { name: /Interstellar/ })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: `Remove ${movie.title}` }))
  expect(await screen.findByRole('heading', { name: 'Your wishlist is empty' })).toBeVisible()
  expect(calls.find(call => call.options.method === 'DELETE')!.path).toBe(`/api/wishlist/movies/${ids.movie}`)
})
it('movie saves use PUT without owner metadata and duplicate clicks cannot issue parallel writes', async () => {
  signedIn(`/movies/${ids.movie}`); let finish!: (response: Response) => void, saved = false
  const calls = mockApi((path, options) => path === `/api/wishlist/movies/${ids.movie}` ? options.method === 'PUT' ? new Promise<Response>(resolve => { finish = response => { saved = true; resolve(response) } }) : ok({ saved }) : undefined)
  render(<App />); const save = await screen.findByRole('button', { name: 'Save to wishlist' }); await waitFor(() => expect(save).toBeEnabled())
  await userEvent.dblClick(save); expect(save).toBeDisabled()
  expect(calls.filter(call => call.options.method === 'PUT')).toHaveLength(1)
  expect(JSON.parse(String(calls.find(call => call.options.method === 'PUT')!.options.body))).toEqual({})
  await act(async () => finish(ok({ saved: true })))
  expect(await screen.findByRole('button', { name: 'Remove from wishlist' })).toBeEnabled()
})
it('anonymous movie save requests sign-in with the original movie route', async () => {
  window.history.replaceState({}, '', `/movies/${ids.movie}`); mockApi(); render(<App />)
  await userEvent.click(await screen.findByRole('button', { name: 'Save to wishlist' }))
  await waitFor(() => expect(window.location.pathname).toBe('/login'))
  expect(new URLSearchParams(window.location.search).get('returnTo')).toBe(`/movies/${ids.movie}`)
})
