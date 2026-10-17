import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { authApi } from '../api/auth'
import { useSession } from '../app/session-context'

export function PasswordRecoveryPage({ reset = false }: { reset?: boolean }) {
  const session = useSession()
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '')
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  const request = useRef<AbortController | null>(null)
  useEffect(() => {
    if (reset && window.location.hash) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
    return () => request.current?.abort()
  }, [reset])
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    setError('')
    if (reset && password !== confirm) { setError('Passwords must match.'); return }
    if (reset && (Array.from(password).length < 8 || new TextEncoder().encode(password).length > 72)) {
      setError('Choose a password with at least 8 characters and no more than 72 bytes.'); return
    }
    const controller = new AbortController(); request.current?.abort(); request.current = controller; setBusy(true)
    try {
      const result = reset ? await authApi.resetPassword(token, password, controller.signal) : await authApi.forgotPassword(email.trim(), controller.signal)
      if (controller.signal.aborted) return
      if (reset) { setPassword(''); setConfirm(''); session.logout() }
      setMessage(result.message)
    } catch (value) { if (!controller.signal.aborted) setError(value instanceof Error ? value.message : 'Please try again.') }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  const validLink = !reset || /^[A-Za-z0-9_-]{43}$/.test(token)
  return <main className="auth-page auth-focused"><div className="auth-home"><Link className="secondary" to="/login">← Back to login</Link></div>
    <section className="panel recovery-panel"><h1 className="text-3xl font-semibold">{reset ? 'Choose a new password' : 'Forgot your password?'}</h1>
      <p className="muted mt-3">{reset ? 'Create a new password for your CineHook account.' : 'Enter your account email to request a reset link.'}</p>
      {!validLink ? <div className="mt-6"><p role="alert">This reset link is invalid. Please request a new link.</p><Link className="btn mt-5" to="/forgot-password">Request a new link</Link></div>
        : message ? <div className="mt-6"><p role="status">{message}</p><Link className="btn mt-5" to="/login">Back to login</Link></div>
        : <form className="mt-6 space-y-4" onSubmit={submit}>
          {reset ? <><label className="block">New password<input className="input mt-2" type="password" autoComplete="new-password" minLength={8} value={password} onChange={event => setPassword(event.target.value)} required disabled={busy} /></label>
            <label className="block">Confirm new password<input className="input mt-2" type="password" autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} required disabled={busy} /></label></>
            : <label className="block">Email address<input className="input mt-2" type="email" maxLength={254} autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required disabled={busy} /></label>}
          {error && <p role="alert" className="text-red-300">{error}</p>}
          <button className="btn w-full" disabled={busy}>{busy ? 'Please wait…' : reset ? 'Reset password' : 'Send reset link'}</button>
        </form>}
    </section>
  </main>
}
