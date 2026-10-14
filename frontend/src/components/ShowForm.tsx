import { useCallback, useState, type FormEvent } from 'react'
import { adminApi } from '../api/admin'
import { catalogApi } from '../api/catalog'
import { useAsync } from '../app/use-async'
import { ErrorState } from './feedback'

export function ShowForm({ onSaved, onClose }: { onSaved: () => void; onClose: () => void }) {
  const [theatreId, setTheatreId] = useState(''), [screenId, setScreenId] = useState('')
  const [saving, setSaving] = useState(false), [error, setError] = useState('')
  const choices = useAsync('show-choices', useCallback(async (signal: AbortSignal) => {
    const [movies, theatres] = await Promise.all([adminApi.movies({ limit: 100 }, signal), catalogApi.theatres({ limit: 100 }, signal)])
    return { movies: movies.items, theatres: theatres.items }
  }, []))
  const screens = useAsync(theatreId, useCallback(async (signal: AbortSignal) => theatreId ? (await catalogApi.theatre(theatreId, signal)).theatre.screens : [], [theatreId]))
  const seats = useAsync(screenId, useCallback(async (signal: AbortSignal) => screenId ? (await catalogApi.screenSeats(screenId, signal)).seats : [], [screenId]))
  const seatTypes = [...new Set(seats.data?.map(seat => seat.seatType) ?? [])].sort()
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!seatTypes.length) return
    const fields = new FormData(event.currentTarget); setSaving(true); setError('')
    try {
      await adminApi.createShow({ movieId: String(fields.get('movie')), screenId,
        startsAt: new Date(`${String(fields.get('start'))}:00Z`).toISOString(),
        prices: seatTypes.map(seatType => ({ seatType, pricePaise: Number(fields.get(seatType)) })) })
      onSaved()
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to schedule show.') }
    finally { setSaving(false) }
  }
  return <form onSubmit={submit} className="panel p-6 space-y-5 mb-6" aria-label="Create show">
    <h2 className="text-xl font-semibold">Add Show</h2>
    <p className="muted text-sm">Schedule in UTC. End time comes from the movie duration. Prices are integer paise for the actual physical seat types, not a flat show price.</p>
    {choices.error && <ErrorState error={choices.error} retry={choices.reload} />}
    <div className="grid gap-5 sm:grid-cols-2">
      <label>Movie<select name="movie" className="input mt-2" required defaultValue=""><option value="">Select movie</option>{choices.data?.movies.map(movie => <option key={movie.id} value={movie.id} disabled={!movie.isActive}>{movie.title}{!movie.isActive && ' (disabled)'}</option>)}</select></label>
      <label>Theatre<select className="input mt-2" required value={theatreId} onChange={event => { setTheatreId(event.target.value); setScreenId('') }}><option value="">Select theatre</option>{choices.data?.theatres.map(theatre => <option key={theatre.id} value={theatre.id}>{theatre.name}</option>)}</select></label>
      <label>Screen<select className="input mt-2" required value={screenId} onChange={event => setScreenId(event.target.value)} disabled={!theatreId || screens.loading}><option value="">Select screen</option>{screens.data?.map(screen => <option key={screen.id} value={screen.id}>{screen.name} · {screen.capacity} seats</option>)}</select></label>
      <label>Start time (UTC)<input name="start" type="datetime-local" className="input mt-2" required /></label>
      {seatTypes.map(type => <label key={`${screenId}:${type}`}>{type} price (paise)<input name={type} type="number" min={1} max={2147483647} required className="input mt-2" /></label>)}
    </div>
    {screens.error && <ErrorState error={screens.error} retry={screens.reload} />}{seats.error && <ErrorState error={seats.error} retry={seats.reload} />}
    {screenId && !seats.loading && !seatTypes.length && <p role="status" className="muted">This screen has no physical layout. Create its seats before scheduling.</p>}
    {error && <p role="alert" className="text-red-300">{error}</p>}
    <div className="flex flex-wrap gap-3"><button className="btn" disabled={saving || !seatTypes.length}>{saving ? 'Scheduling…' : 'Schedule show'}</button><button className="secondary" type="button" disabled={saving} onClick={onClose}>Close form</button></div>
  </form>
}
