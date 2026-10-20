import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { AuthResult } from '../api/types'
import { googleApi } from '../api/google'
import { SessionContext } from '../app/session-context'
import { currentStoredSession, loadGoogleIdentity, ownGoogleAttempt } from '../domain/google-identity'
import { ApiError } from '../api/client'

export function GoogleSignIn({ onSuccess, disabled = false, mode='login',password='' }: { onSuccess: (result: AuthResult) => void; disabled?: boolean;mode?:'login'|'link';password?:string;existingAccount?:{email:string;password:string} }) {
  const [collision,setCollision]=useState(false),[confirmationRequired,setConfirmationRequired]=useState(false),[confirmOwnership,setConfirmOwnership]=useState(false)
  const session = useContext(SessionContext), [clientId, setClientId] = useState<string | null | undefined>(), [error, setError] = useState(''), [state, setState] = useState<'idle' | 'loading' | 'choice' | 'verifying'>('idle'), [revision, setRevision] = useState(0)
  const host = useRef<HTMLDivElement>(null), active = useRef<(() => void) | null>(null), props = useRef({ onSuccess, disabled, token: session?.token ?? null,mode,password })
  useLayoutEffect(() => { props.current = { onSuccess, disabled, token: session?.token ?? null,mode,password } }, [onSuccess, disabled, session?.token,mode,password])
  useEffect(() => {
    const controller = new AbortController()
    googleApi.config(controller.signal).then(v => { if (!controller.signal.aborted) setClientId(v.clientId) }, e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Google sign-in configuration could not be loaded.') })
    return () => { controller.abort(); active.current?.() }
  }, [revision])
  useEffect(() => { if (disabled || (session?.token && mode!=='link')) { active.current?.(); queueMicrotask(() => setState('idle')) } }, [disabled, session?.token,mode])
  useEffect(() => { active.current?.(); queueMicrotask(() => { setState('idle');setCollision(false);setConfirmationRequired(false);setConfirmOwnership(false) }) }, [password,mode])
  async function begin() {
    if (!clientId || props.current.disabled || state !== 'idle' || (mode==='link'&&!password)) return
    if(confirmationRequired&&!confirmOwnership){setError('Confirm the security change before choosing Google again.');return}
    active.current?.(); setError(''); setState('loading')
    const controller = new AbortController(), snapshot = currentStoredSession(), token = props.current.token,linkPassword=props.current.password
    let timer: ReturnType<typeof setTimeout> | undefined, used = false
    const abandon = () => { controller.abort(); clearTimeout(timer); lease.release(); if (host.current) host.current.replaceChildren() }
    const lease = ownGoogleAttempt(abandon); active.current = abandon
    const live = () => !controller.signal.aborted && lease.current() && !props.current.disabled && props.current.token === token && currentStoredSession() === snapshot && props.current.password===linkPassword
    try {
      const sdk = await loadGoogleIdentity(); if (!live()) return
      const challenge = await googleApi.challenge(controller.signal); if (!live() || !host.current) return
      timer = setTimeout(() => { if (live()) { abandon(); setState('idle'); setError('Google sign-in expired. Please try again.') } }, Math.max(0, challenge.expiresAt * 1000 - Date.now()))
      // Modern Chrome mediates account selection without the legacy window.open
      // popup, which can remain blocked by browser/extension settings.
      sdk.initialize({ client_id: clientId, nonce: challenge.nonce, auto_select: false, use_fedcm_for_button: true, button_auto_select: false, ux_mode: 'popup', callback: async response => {
        if (!live() || used || typeof response.credential !== 'string' || !response.credential || response.credential.length > 16384) return
        used = true; setState('verifying')
        try { const result = mode==='link'?await googleApi.link(response.credential,challenge.csrfToken,linkPassword,controller.signal):await googleApi.login(response.credential, challenge.csrfToken, controller.signal, confirmOwnership); if (live()) { props.current.onSuccess(result); abandon(); setState('idle');setCollision(false) } }
        catch (e) { if (live()) { const cause = e instanceof ApiError ? e : e instanceof Error && e.cause instanceof ApiError ? e.cause : null;
          if(cause?.code==='GOOGLE_EMAIL_CONFLICT'||cause?.code==='GOOGLE_EMAIL_PROOF_REQUIRED')setCollision(true);
          if(cause?.code==='GOOGLE_OWNERSHIP_CONFIRMATION_REQUIRED')setConfirmationRequired(true);
          setError(e instanceof Error ? e.message : 'Google sign-in failed. Please retry.'); abandon(); setState('idle') } }
      } })
      host.current.replaceChildren(); sdk.renderButton(host.current, { type: 'standard', theme: 'outline', size: 'large', width: Math.max(200, Math.min(360, host.current.clientWidth || 240)) }); setState('choice')
    } catch (e) { if (live()) { abandon(); setState('idle'); setError(e instanceof Error ? e.message : 'Google sign-in failed. Please retry.') } }
  }
  return <div className="google-sign-in" style={{ maxWidth: '100%', minWidth: 0 }}>
    {clientId === null ? <p className="muted text-sm">Google sign-in is not configured. Please use email and password.</p> : <>
      {confirmationRequired && <label className="block text-sm"><input type="checkbox" checked={confirmOwnership} disabled={state!=='idle'||disabled} onChange={e=>setConfirmOwnership(e.target.checked)}/> Remove the old unverified password and sign out all existing sessions using my Google identity.</label>}
      {collision && <a className="accent text-sm" href="/forgot-password">Verify account ownership</a>}
      {state === 'idle' && clientId && <button type="button" className="btn w-full" disabled={disabled||(mode==='link'&&!password)} onClick={() => void begin()}>{mode==='link'?'Link Google account':'Continue with Google'}</button>}
      {!clientId && !error && <p role="status" className="muted text-sm">Checking Google sign-in…</p>}
      {(state === 'loading' || state === 'verifying') && <p role="status">{state === 'loading' ? 'Loading Google sign-in…' : 'Verifying Google sign-in…'}</p>}
      <div ref={host} style={{ maxWidth: '100%', overflow: 'hidden', display: state === 'choice' && !disabled ? 'block' : 'none' }} />
      {state === 'choice' && <button type="button" className="accent text-sm" disabled={disabled} onClick={() => { active.current?.(); setState('idle') }}>Cancel Google sign-in</button>}
      {error && <><p role="alert" className="text-sm text-red-300">{error}</p>{!clientId&&<button type="button" className="accent text-sm" disabled={disabled} onClick={() => { active.current?.(); setState('idle'); setError(''); setClientId(undefined); setRevision(v => v + 1) }}>Retry Google sign-in</button>}</>}
    </>}
  </div>
}
