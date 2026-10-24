import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { authApi } from '../api/auth'
import { useSession } from '../app/session-context'

export function PasswordRecoveryPage({ reset = false }: { reset?: boolean }) {
  const session = useSession()
  const [params] = useSearchParams()
  const [mode] = useState<'RESET_PASSWORD'|'CLEAN_START'>(() => params.get('mode') === 'CLEAN_START' ? 'CLEAN_START' : 'RESET_PASSWORD')
  const [name,setName]=useState(''),[cleanConsent,setCleanConsent]=useState(false)
  const [step, setStep] = useState<'email' | 'otp' | 'password' | 'done'>('email')
  const [email, setEmail] = useState(''), [otp, setOtp] = useState('')
  const [challengeId, setChallengeId] = useState(''), [token, setToken] = useState('')
  const [password, setPassword] = useState(''), [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('')
  const [resendAt, setResendAt] = useState(0)
  const request = useRef<AbortController | null>(null)
  useEffect(() => {
    if (window.location.hash) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
    return () => request.current?.abort()
  }, [])
  const restart = () => {
    request.current?.abort(); request.current = null
    setStep('email'); setChallengeId(''); setOtp(''); setToken(''); setPassword(''); setConfirm('')
    setName(''); setCleanConsent(false); setError(''); setMessage(''); setResendAt(0)
  }
  const send = async (signal: AbortSignal) => {
    const result = mode === 'RESET_PASSWORD' ? await authApi.forgotPassword(email.trim(), signal) : await authApi.requestOwnership(mode,email.trim(),signal)
    if (signal.aborted) return
    setChallengeId(result.challengeId); setOtp(''); setToken(''); setStep('otp'); setMessage(result.message); setResendAt(Date.now() + 60000)
  }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    setError('')
    if (step === 'password' && password !== confirm) { setError('Passwords must match.'); return }
    if (step === 'password' && (Array.from(password).length < 8 || new TextEncoder().encode(password).length > 72)) {
      setError('Choose a password with at least 8 characters and no more than 72 bytes.'); return
    }
    const controller = new AbortController(); request.current?.abort(); request.current = controller; setBusy(true)
    try {
      if (step === 'email') await send(controller.signal)
      else if (step === 'otp') {
        const result = mode === 'RESET_PASSWORD' ? await authApi.verifyResetOtp(challengeId, otp, controller.signal) : await authApi.verifyOwnership(challengeId,otp,controller.signal)
        if (!controller.signal.aborted) { setToken(result.token); setOtp(''); setStep('password'); setMessage('') }
      } else if (step === 'password') {
        const result = mode === 'RESET_PASSWORD' ? await authApi.resetPassword(token, password, controller.signal) : await authApi.completeOwnership({purpose:mode,token,password,name,cleanStartConfirmed:cleanConsent},controller.signal).then(()=>({message:'Your clean account is ready. Sign in with your new password.'}))
        if (!controller.signal.aborted) { setPassword(''); setConfirm(''); setToken(''); session.logout(); setMessage(result.message); setStep('done') }
      }
    } catch (value) { if (!controller.signal.aborted) setError(value instanceof Error ? value.message : 'Please try again.') }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  const resend = async () => {
    if (busy) return
    if (Date.now() < resendAt) { setError('Please wait one minute before requesting another code.'); return }
    const controller = new AbortController(); request.current?.abort(); request.current = controller; setBusy(true); setError('')
    try { await send(controller.signal) }
    catch (value) { if (!controller.signal.aborted) setError(value instanceof Error ? value.message : 'Please try again.') }
    finally { if (!controller.signal.aborted) setBusy(false) }
  }
  return <main className="auth-page auth-focused"><div className="auth-home"><Link className="secondary" to="/login">← Back to login</Link></div>
    <section className="panel recovery-panel"><h1 className="text-3xl font-semibold">{step === 'otp' ? 'Check your email' : step === 'password' ? 'Choose a new password' : 'Forgot your password?'}</h1>
      <p className="muted mt-3">{step === 'email' ? (reset ? 'Request a new code to set or reset your password.' : 'Enter your account email to receive a verification code.') : step === 'otp' ? 'Enter the six-digit code. It expires in 10 minutes.' : step === 'password' ? 'Choose a strong password. If you already have one, use a different password.' : ''}</p>
      {message && <p role="status" className="mt-4">{message}</p>}
      {mode === 'CLEAN_START' && <p className="mt-4">Your previous private history is not transferred. The old account is secured separately; restoring its history requires additional ownership review. This does not cancel any bookings or financial records.</p>}
      {step === 'done' ? <Link className="btn mt-5" to="/login">Back to login</Link> : <form className="mt-6 space-y-4" onSubmit={submit}>
        {step === 'email' && <label className="block">Email address<input className="input mt-2" type="email" maxLength={254} autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required disabled={busy} /></label>}
        {step === 'otp' && <label className="block">Verification code<input className="input mt-2" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={otp} onChange={event => setOtp(event.target.value.replace(/\D/g, ''))} required disabled={busy} /></label>}
        {step === 'password' && <>
          {mode === 'CLEAN_START' && <label className="block">Name for new account<input className="input mt-2" autoComplete="name" maxLength={100} value={name} onChange={event=>setName(event.target.value)} required disabled={busy}/></label>}
          <label className="block">New password<input className="input mt-2" type="password" autoComplete="new-password" minLength={8} value={password} onChange={event => setPassword(event.target.value)} required disabled={busy} /></label>
          <label className="block">Confirm new password<input className="input mt-2" type="password" autoComplete="new-password" value={confirm} onChange={event => setConfirm(event.target.value)} required disabled={busy} /></label>
          {mode === 'CLEAN_START' && <label className="block"><input type="checkbox" checked={cleanConsent} onChange={event=>setCleanConsent(event.target.checked)} required disabled={busy}/> I understand that this creates a separate account without previous private history.</label>}</>}
        {error && <p role="alert" className="text-red-300">{error}</p>}
        <button className="btn w-full" disabled={busy || step === 'password' && mode === 'CLEAN_START' && !cleanConsent}>{busy ? 'Please wait…' : step === 'email' ? 'Send OTP' : step === 'otp' ? 'Verify OTP' : mode === 'CLEAN_START' ? 'Create clean account' : 'Reset password'}</button>
        {step === 'otp' && <button className="secondary w-full" type="button" disabled={busy} onClick={() => void resend()}>Resend code</button>}
        {step !== 'email' && <button className="secondary w-full" type="button" disabled={busy} onClick={restart}>Start again</button>}
      </form>}
    </section>
  </main>
}
