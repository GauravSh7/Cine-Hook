import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { authApi } from '../api/auth'
import { useSession } from '../app/session-context'
import { ThematicArt } from '../components/ThematicArt'
import { GoogleSignIn } from '../components/GoogleSignIn'

export function AuthPage({ register = false }: { register?: boolean }) {
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[params]=useSearchParams(),navigate=useNavigate(),session=useSession()
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[confirm,setConfirm]=useState(''),[name,setName]=useState(''),[phone,setPhone]=useState('')
  const [step,setStep]=useState<'details'|'otp'|'done'>('details'),[challengeId,setChallengeId]=useState(''),[otp,setOtp]=useState(''),[resendAt,setResendAt]=useState(0),[cooling,setCooling]=useState(false)
  const request=useRef<AbortController|null>(null)
  const requested=params.get('returnTo')??'/'
  const returnTo=requested.startsWith('/')&&!requested.startsWith('//')&&!requested.includes('\\')&&!requested.startsWith('/login')&&!requested.startsWith('/register')?requested:'/'
  useEffect(()=>()=>request.current?.abort(),[])
  useEffect(()=>{if(!resendAt)return;const timer=setTimeout(()=>setCooling(false),Math.max(0,resendAt-Date.now()));return()=>clearTimeout(timer)},[resendAt])
  const changeEmail=()=>{request.current?.abort();request.current=null;setBusy(false);setStep('details');setChallengeId('');setOtp('');setPassword('');setConfirm('');setError('');setResendAt(0);setCooling(false)}
  async function send(signal:AbortSignal){
    const result=await authApi.requestOwnership('REGISTER',email.trim(),signal)
    if(!signal.aborted){setChallengeId(result.challengeId);setOtp('');setStep('otp');setResendAt(Date.now()+60000);setCooling(true)}
  }
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(busy)return;setError('')
    if(register&&password!==confirm){setError('Passwords must match.');return}
    if(register&&(Array.from(password).length<8||new TextEncoder().encode(password).length>72)){setError('Choose a password with at least 8 characters and no more than 72 bytes.');return}
    const controller=new AbortController();request.current?.abort();request.current=controller;setBusy(true)
    try{
      if(!register){const result=await authApi.login({email,password},controller.signal);if(!controller.signal.aborted){setPassword('');session.accept(result);navigate(returnTo,{replace:true})}}
      else if(step==='details')await send(controller.signal)
      else if(step==='otp'){
        const proof=await authApi.verifyOwnership(challengeId,otp,controller.signal)
        if(controller.signal.aborted)return
        await authApi.register({name,email,phone,password,registrationToken:proof.token},controller.signal)
        if(!controller.signal.aborted){setPassword('');setConfirm('');setOtp('');setChallengeId('');setStep('done')}
      }
    }catch(value){if(!controller.signal.aborted)setError(value instanceof Error?value.message:'Unable to sign in. Please retry.')}
    finally{if(!controller.signal.aborted)setBusy(false)}
  }
  async function resend(){
    if(busy||Date.now()<resendAt)return
    const controller=new AbortController();request.current?.abort();request.current=controller;setBusy(true);setError('')
    try{await send(controller.signal)}catch(value){if(!controller.signal.aborted)setError(value instanceof Error?value.message:'Please try again.')}
    finally{if(!controller.signal.aborted)setBusy(false)}
  }
  return <main className="auth-page auth-focused"><div className="auth-home"><Link className="secondary" to="/">← Back to home</Link></div><section className="panel auth-panel"><div className="auth-form-side">
    <nav className="auth-tabs" aria-label="Authentication"><Link role="tab" aria-selected={!register} to={`/login?returnTo=${encodeURIComponent(returnTo)}`}>Login</Link><Link role="tab" aria-selected={register} to={`/register?returnTo=${encodeURIComponent(returnTo)}`}>Register</Link></nav>
    <h1 className="mt-7 text-3xl font-semibold">{register?step==='otp'?'Verify your email':step==='done'?'You’re all set':'Create account':'Welcome back'}</h1>
    {!register&&<p className="muted mt-2 text-sm">Sign in to your CineHook account.</p>}
    {register&&step==='done'?<><p role="status" className="mt-6 text-green-400">✓ Email verified. Your account is ready.</p><Link className="btn mt-6" to={`/login?returnTo=${encodeURIComponent(returnTo)}`}>Continue to login</Link></>:<form className="mt-6 space-y-4" onSubmit={submit}>
      {register&&step==='otp'?<><p className="muted">Enter the six-digit code sent to {email}. It expires in 10 minutes.</p><label className="block">Verification code<input className="input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={otp} onChange={e=>setOtp(e.target.value.replace(/\D/g,''))} required disabled={busy}/></label></>:<>
        {register&&<><label className="block"><span className="sr-only">Name</span><input name="name" className="input" placeholder="Name" autoComplete="name" maxLength={100} value={name} onChange={e=>setName(e.target.value)} required disabled={busy}/></label><label className="block"><span className="sr-only">Mobile number</span><input name="phone" type="tel" aria-label="Mobile number" aria-describedby="phone-hint" className="input" placeholder="Mobile number, e.g. +919876543210" autoComplete="tel" pattern="\+[1-9][0-9]{7,14}" maxLength={16} value={phone} onChange={e=>setPhone(e.target.value)} required disabled={busy}/></label><p id="phone-hint" className="muted text-sm">Include your country code, for example +91.</p></>}
        <label className="block"><span className="sr-only">Email</span><input name="email" type="email" className="input" placeholder="Email" autoComplete="email" maxLength={254} value={email} onChange={e=>setEmail(e.target.value)} required disabled={busy}/></label>
        <label className="block"><span className="sr-only">Password</span><input name="password" type="password" className="input" placeholder="Password" autoComplete={register?'new-password':'current-password'} minLength={register?8:undefined} value={password} onChange={e=>setPassword(e.target.value)} required disabled={busy}/></label>
        {register&&<label className="block"><span className="sr-only">Confirm password</span><input name="confirm" type="password" className="input" placeholder="Confirm password" autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)} required disabled={busy}/></label>}
      </>}
      {error&&<p role="alert" className="text-sm text-red-300">{error}</p>}
      {busy&&<p role="status" className="muted text-sm">Connecting securely… This may take a moment.</p>}
      <button type="submit" className="btn w-full" disabled={busy}>{busy?'Please wait…':register?step==='otp'?'Verify OTP':'Continue':'Login'}</button>
      {register&&step==='otp'&&<><button type="button" className="secondary" disabled={busy||cooling} onClick={()=>void resend()}>Resend OTP</button><button type="button" className="secondary" disabled={busy} onClick={changeEmail}>Change email</button></>}
    </form>}
    {!register&&<><Link className="accent mt-4 inline-block text-sm" to="/forgot-password">Forgot password?</Link><Link className="accent mt-4 block text-sm" to="/forgot-password?mode=VERIFY_LEGACY">Verify an existing account</Link><div className="google-auth-section"><div className="auth-divider"><span>or</span></div><GoogleSignIn disabled={busy} onSuccess={result=>{request.current?.abort();setPassword('');session.accept(result);navigate(returnTo,{replace:true})}}/></div></>}
    {step!=='done'&&<p className="muted mt-6 text-sm">{register?'Already have an account?':'Don’t have an account?'} <Link className="accent" to={`${register?'/login':'/register'}?returnTo=${encodeURIComponent(returnTo)}`}>{register?'Login':'Create account'}</Link></p>}
  </div><aside className="auth-art"><ThematicArt/><div><h2>Movies, events<br/>and more.</h2><p>Everything you enjoy, in one place.</p><div className="auth-promise"><p>▣ Discover Movies</p><span className="muted">Find your next story on the big screen.</span><p>♡ Save Your Favourites</p><span className="muted">Keep the movies you love in your wishlist.</span><p>♙ Your Account</p><span className="muted">Manage your profile and bookings.</span></div></div></aside></section></main>
}
