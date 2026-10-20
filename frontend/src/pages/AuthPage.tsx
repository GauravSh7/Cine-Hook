import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { authApi } from '../api/auth'
import { useSession } from '../app/session-context'
import { ThematicArt } from '../components/ThematicArt'
import { GoogleSignIn } from '../components/GoogleSignIn'

export function AuthPage({ register = false }: { register?: boolean }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [params] = useSearchParams(), navigate = useNavigate(), session = useSession()
  const [email,setEmail]=useState(''),[password,setPassword]=useState('')
  const [registrationStep, setRegistrationStep] = useState<'email'|'otp'|'credentials'>('email')
  const [challengeId,setChallengeId]=useState(''),[otp,setOtp]=useState(''),[registrationToken,setRegistrationToken]=useState('')
  const requested = params.get('returnTo') ?? '/'
  const returnTo = requested.startsWith('/') && !requested.startsWith('//') && !requested.includes('\\') && !requested.startsWith('/login') && !requested.startsWith('/register') ? requested : '/'
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])
  const changeEmail = () => {
    request.current?.abort(); request.current = null
    setBusy(false); setRegistrationStep('email'); setChallengeId(''); setRegistrationToken(''); setOtp(''); setPassword(''); setError('')
  }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy) return
    const form = event.currentTarget, data = new FormData(form), email = String(data.get('email')), password = String(data.get('password'))
    if (register && registrationStep === 'credentials' && password !== data.get('confirm')) { setError('Passwords must match.'); return }
    const controller = new AbortController(); request.current?.abort(); request.current = controller
    setBusy(true); setError('')
    try {
      if (register && registrationStep === 'email') { const result = await authApi.requestOwnership('REGISTER', email, controller.signal); if (!controller.signal.aborted) { setChallengeId(result.challengeId); setRegistrationStep('otp') } return }
      if (register && registrationStep === 'otp') { const result = await authApi.verifyOwnership(challengeId, otp, controller.signal); if (!controller.signal.aborted) { setRegistrationToken(result.token); setOtp(''); setRegistrationStep('credentials') } return }
      const result = register ? await authApi.register({ name: String(data.get('name')), email, password, registrationToken }, controller.signal) : await authApi.login({ email, password }, controller.signal)
      if (controller.signal.aborted) return
      form.reset(); session.accept(result); navigate(returnTo, { replace: true }) }
    catch (value) { if (!controller.signal.aborted) setError(value instanceof Error ? value.message : 'Unable to sign in. Please retry.') }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  return <main className="auth-page auth-focused"><div className="auth-home"><Link className="secondary" to="/">← Back to home</Link></div><section className="panel auth-panel"><div className="auth-form-side"><nav className="auth-tabs" aria-label="Authentication"><Link role="tab" aria-selected={!register} to={`/login?returnTo=${encodeURIComponent(returnTo)}`}>Login</Link><Link role="tab" aria-selected={register} to={`/register?returnTo=${encodeURIComponent(returnTo)}`}>Register</Link></nav>
    <h1 className="mt-7 text-3xl font-semibold">{register ? 'Create account' : 'Welcome back'}</h1>
    {!register && <p className="muted mt-2 text-sm">Login to continue your booking.</p>}
    <form className="mt-6 space-y-4" onSubmit={submit}>{register && registrationStep === 'credentials' && <label className="block"><span className="sr-only">Name</span><input name="name" className="input" placeholder="Name" autoComplete="name" maxLength={100} required /></label>}
      <label className="block"><span className="sr-only">Email</span><input name="email" type="email" className="input" placeholder="Email" autoComplete="email" maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} readOnly={register && (busy || registrationStep !== 'email')} required /></label>
      {(!register || registrationStep === 'credentials') && <label className="block"><span className="sr-only">Password</span><input name="password" type="password" className="input" placeholder="Password" autoComplete={register ? 'new-password' : 'current-password'} minLength={register ? 8 : undefined} value={password} onChange={e=>setPassword(e.target.value)} required /></label>}
      {register && registrationStep === 'credentials' && <label className="block"><span className="sr-only">Confirm password</span><input name="confirm" type="password" className="input" placeholder="Confirm password" autoComplete="new-password" required /></label>}
      {register && registrationStep === 'otp' && <label className="block">Verification code<input className="input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={otp} onChange={e=>setOtp(e.target.value.replace(/\D/g,''))} required /></label>}
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      <button type="submit" className="btn w-full" disabled={busy}>{busy ? 'Please wait…' : register ? registrationStep === 'email' ? 'Send verification code' : registrationStep === 'otp' ? 'Verify email' : 'Register' : 'Login'}</button>
      {register && registrationStep !== 'email' && <button type="button" className="secondary" disabled={busy} onClick={changeEmail}>Change email</button>}
    </form>{!register && <><Link className="accent mt-4 inline-block text-sm" to="/forgot-password">Forgot password?</Link><Link className="accent mt-4 block text-sm" to="/forgot-password?mode=VERIFY_LEGACY">Verify an existing account</Link></>}
    {!register&&<div className="google-auth-section"><div className="auth-divider"><span>or</span></div><GoogleSignIn existingAccount={{email,password}} disabled={busy} onSuccess={result => { request.current?.abort();setPassword('');session.accept(result); navigate(returnTo, { replace: true }) }} /></div>}
    <p className="muted mt-6 text-sm">{register ? 'Already have an account?' : 'Don’t have an account?'} <Link className="accent" to={`${register ? '/login' : '/register'}?returnTo=${encodeURIComponent(returnTo)}`}>{register ? 'Login' : 'Create account'}</Link></p>
  </div><aside className="auth-art"><ThematicArt/><div><h2>Movies, events<br/>and more.</h2><p>Everything you enjoy, in one place.</p><div className="auth-promise"><p>▣ Discover Movies</p><span className="muted">Find your next story on the big screen.</span><p>♡ Save Your Favourites</p><span className="muted">Keep the movies you love in your wishlist.</span><p>♙ Your Account</p><span className="muted">Manage your profile and bookings.</span></div></div></aside></section></main>
}
