import { useState, type FormEvent } from 'react'
import { adminApi } from '../api/admin'
import type { Movie } from '../api/types'
import { utcDate } from '../domain/time'

export function MovieForm({ movie, onSaved, onClose }: { movie?: Movie; onSaved: () => void; onClose: () => void }) {
  const [error, setError] = useState(''), [saving, setSaving] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const fields = new FormData(event.currentTarget)
    const input = { title: String(fields.get('title')).trim(), description: String(fields.get('description')).trim(),
      durationMinutes: Number(fields.get('duration')), releaseDate: String(fields.get('release')), language: String(fields.get('language')).trim(),
      genres: String(fields.get('genres')).split(',').map(value => value.trim()).filter(Boolean), posterUrl: String(fields.get('poster')).trim() || null }
    setSaving(true); setError('')
    try { if (movie) await adminApi.updateMovie(movie.id, input); else await adminApi.createMovie(input); onSaved() }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to save movie.') }
    finally { setSaving(false) }
  }
  return <form onSubmit={submit} className="panel p-6 space-y-5 mb-6" aria-label={movie ? 'Edit movie' : 'Create movie'}>
    <h2 className="text-xl font-semibold">{movie ? 'Edit Movie' : 'Add Movie'}</h2>
    <div className="grid gap-5 sm:grid-cols-2">
      <label>Title<input name="title" className="input mt-2" required maxLength={200} defaultValue={movie?.title} /></label>
      <label>Language<input name="language" className="input mt-2" required maxLength={50} defaultValue={movie?.language} /></label>
      <label>Duration (minutes)<input name="duration" className="input mt-2" type="number" required min={1} max={600} defaultValue={movie?.durationMinutes} /></label>
      <label>Release date<input name="release" className="input mt-2" type="date" required defaultValue={movie && utcDate(movie.releaseDate)} /></label>
      <label className="sm:col-span-2">Description<textarea name="description" className="input mt-2" required maxLength={5000} defaultValue={movie?.description} /></label>
      <label>Genres (comma separated)<input name="genres" className="input mt-2" required defaultValue={movie?.genres.join(', ')} /></label>
      <label>Poster URL (optional)<input name="poster" className="input mt-2" type="url" pattern="https://.*" defaultValue={movie?.posterUrl ?? ''} /></label>
    </div>
    {error && <p role="alert" className="text-red-300">{error}</p>}
    <div className="flex flex-wrap gap-3"><button className="btn" disabled={saving}>{saving ? 'Saving…' : 'Save movie'}</button><button type="button" className="secondary" disabled={saving} onClick={onClose}>Close form</button></div>
  </form>
}
