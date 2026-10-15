import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import App from '../src/App'
import { MovieCard } from '../src/components/MovieCard'
import { MemoryRouter } from 'react-router'
import { ids, mockApi, movie, ok } from './fixtures'

it('keeps movie detail pages free of repeated media-credit panels', async () => {
  window.history.replaceState({}, '', `/movies/${ids.movie}`)
  mockApi(path => path === `/api/movies/${ids.movie}` ? ok({ movie: { ...movie, artwork: { kind: 'TMDB', sourceUrl: 'https://www.themoviedb.org/movie/157336', attribution: 'TMDB artwork' } } }) : undefined)
  render(<App />)
  expect(await screen.findByRole('heading', { name: movie.title })).toBeVisible()
  expect(screen.queryByText(/About & media credits|Movie artwork belongs/)).not.toBeInTheDocument()
});

it('cards display a source-labelled score and language without exposing release dates or confusing providers', () => {
  render(<MemoryRouter><MovieCard movie={{ ...movie, rating: { provider: 'TMDB', value: 8.3, scale: 10, voteCount: 1234, sourceUrl: 'https://www.themoviedb.org/movie/27205', verifiedAt: '2026-10-10T00:00:00Z' } }} /></MemoryRouter>)
  expect(screen.getByText(/8.3\/10.*TMDB/)).toBeVisible()
  expect(screen.getByText(/english/)).toBeVisible()
  expect(screen.queryByText(/2020/)).not.toBeInTheDocument()
  expect(screen.queryByText(/IMDb.*8.3|Rotten Tomatoes.*8.3/)).not.toBeInTheDocument()
});
it('shows truthful missing rating and trailer states without invented values', async () => {
  window.history.replaceState({}, '', `/movies/${ids.movie}`); mockApi(); render(<App />)
  expect(await screen.findByText('Trailer unavailable')).toBeVisible()
  expect(screen.queryByText(/rating unavailable/i)).not.toBeInTheDocument()
  expect(document.querySelector('iframe')).toBeNull()
});
it('loads both persisted descriptions, starts a trailer only on click, and restores focus after Escape', async () => {
  window.history.replaceState({}, '', `/movies/${ids.movie}`)
  mockApi(path => path === `/api/movies/${ids.movie}` ? ok({ movie: { ...movie, descriptionHindi: 'मानवता के भविष्य की खोज में एक यात्रा।', trailer: { provider: 'YouTube', videoId: 'TestOnlyID1', sourceUrl: 'https://www.themoviedb.org/movie/27205', verifiedAt: '2026-10-10T00:00:00Z' } } }) : undefined)
  render(<App />)
  expect(await screen.findByText('मानवता के भविष्य की खोज में एक यात्रा।')).toHaveAttribute('lang', 'hi')
  expect(screen.getByText(movie.description)).toHaveAttribute('lang', 'en')
  expect(document.querySelector('iframe')).toBeNull()
  const play = screen.getByRole('button', { name: 'Play Trailer' }); await userEvent.click(play)
  const dialog = screen.getByRole('dialog', { name: `${movie.title} — official trailer` })
  expect(within(dialog).getByTitle(`${movie.title} official trailer`)).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/TestOnlyID1?autoplay=1&rel=0')
  expect(screen.getByRole('button', { name: 'Close trailer' })).toHaveFocus()
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(document.querySelector('iframe')).toBeNull()
  expect(play).toHaveFocus()
  await userEvent.click(play); await userEvent.click(screen.getByRole('button', { name: 'Close trailer' }))
  expect(document.querySelector('iframe')).toBeNull()
});
it('rejects a malformed provider video ID at the rendering boundary', async () => {
  window.history.replaceState({}, '', `/movies/${ids.movie}`)
  mockApi(path => path === `/api/movies/${ids.movie}` ? ok({ movie: { ...movie, trailer: { provider: 'YouTube', videoId: '//evil.test', sourceUrl: 'https://www.themoviedb.org/movie/27205' } } }) : undefined)
  render(<App />)
  expect(await screen.findByText('Trailer unavailable')).toBeVisible()
  expect(document.querySelector('iframe')).toBeNull()
});
