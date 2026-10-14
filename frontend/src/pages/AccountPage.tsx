import { useEffect, useRef, useState, type FormEvent } from 'react'
import { accountApi } from '../api/account'
import { useSession } from '../app/session-context'
import { AccountLayout } from '../components/AccountLayout'
import { profileAge } from '../domain/profile'
import { useCurrentDate } from '../app/use-current-date'

export function AccountPage() {
  const session = useSession(), user = session.user!
  const today = useCurrentDate()
  const [name, setName] = useState(user.name), [birth, setBirth] = useState(user.dateOfBirth?.slice(0, 10) ?? ''), [phone, setPhone] = useState(user.phone ?? '')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [photoFailed, setPhotoFailed] = useState(false)
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [session.token, user.id])
  const run = async (operation: (signal: AbortSignal) => ReturnType<typeof accountApi.profile>, success: string) => {
    if (request.current && !request.current.signal.aborted) return
    const controller = new AbortController(), token = session.token!
    request.current = controller; setBusy(true); setError(''); setMessage('')
    try { const result = await operation(controller.signal); if (!controller.signal.aborted) { session.updateUser(result.user, token); setMessage(success); setPhotoFailed(false) } }
    catch (value) { if (!controller.signal.aborted) setError(value instanceof Error ? value.message : 'Unable to save. Please retry.') }
    finally { if (!controller.signal.aborted) { request.current = null; setBusy(false) } }
  }
  const submit = (event: FormEvent) => {
    event.preventDefault(); setMessage('')
    if (!name.trim() || name.trim().length > 100) { setError('Enter a name between 1 and 100 characters.'); return }
    if (birth && profileAge(birth) === null) { setError('Enter a real date of birth that is not in the future.'); return }
    if (phone && !/^\+[1-9]\d{7,14}$/.test(phone)) { setError('Use an international phone number with 8 to 15 digits, for example +919876543210.'); return }
    void run(signal => accountApi.profile({ name: name.trim(), dateOfBirth: birth || null, phone: phone || null }, signal), 'Profile saved.')
  }
  return <AccountLayout title="Account Info" detail="Manage your personal profile"><section className="panel profile-panel"><div className="section-title"><h2>Profile Details</h2><p className="muted">Your personal information</p></div><div className="profile-grid"><div className="profile-photo"><div className="avatar">{user.avatarUrl && !photoFailed ? <img src={user.avatarUrl} alt="Your profile" onError={() => setPhotoFailed(true)} referrerPolicy="no-referrer"/> : <span>{user.name.slice(0, 1).toUpperCase()}</span>}</div><label className="secondary photo-label">Change photo<input className="sr-only" aria-label="Profile photo" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={event => {
      const file = event.target.files?.[0]; event.target.value = ''; if (!file) return
      setMessage('')
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setError('Choose a JPEG, PNG or WebP image.'); return }
      if (file.size > 3 * 1024 * 1024) { setError('Choose an image no larger than 3 MiB.'); return }
      void run(signal => accountApi.avatar(file, signal), 'Profile photo saved.')
    }}/></label></div><form className="profile-form" onSubmit={submit} noValidate><label>Full name<input className="input" maxLength={100} value={name} disabled={busy} onChange={event => setName(event.target.value)}/></label><div className="profile-row"><label>Date of birth<input className="input" type="date" value={birth} disabled={busy} onChange={event => setBirth(event.target.value)}/></label><label>Age<input className="input" readOnly value={birth ? profileAge(birth, today) ?? 'Not provided' : 'Not provided'}/></label></div><label>Email address<input className="input" readOnly type="email" value={user.email}/></label><label>Phone number<input className="input" type="tel" value={phone} disabled={busy} maxLength={16} placeholder="+919876543210" onChange={event => setPhone(event.target.value)}/></label><p className="muted text-xs">Phone is profile information only. It is not verified and cannot be used to sign in.</p>{error && <p role="alert" className="text-red-300">{error}</p>}{message && <p role="status" className="text-green-300">{message}</p>}<button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button></form></div></section></AccountLayout>
}
