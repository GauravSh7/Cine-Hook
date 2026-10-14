import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { AuthResult } from '../api/types'
import { googleApi } from '../api/google'
import { SessionContext } from '../app/session-context'
import { currentStoredSession, loadGoogleIdentity, ownGoogleAttempt } from '../domain/google-identity'
import { authApi } from '../api/auth'
import { ApiError } from '../api/client'

export function GoogleSignIn({ onSuccess, disabled = false, mode='login',password='',existingAccount }: { onSuccess: (result: AuthResult) => void; disabled?: boolean;mode?:'login'|'link';password?:string;existingAccount?:{email:string;password:string} }) {
  const [linkRequired,setLinkRequired]=useState(false)
  const existingEmail=existingAccount?.email??'',existingPassword=existingAccount?.password??''
  const session = useContext(SessionContext), [clientId, setClientId] = useState<string | null | undefined>(), [error, setError] = useState(''), [state, setState] = useState<'idle' | 'loading' | 'choice' | 'verifying'>('idle'), [revision, setRevision] = useState(0)
  const host = useRef<HTMLDivElement>(null), active = useRef<(() => void) | null>(null), props = useRef({ onSuccess, disabled, token: session?.token ?? null,mode,password,existingEmail,existingPassword })
  useLayoutEffect(() => { props.current = { onSuccess, disabled, token: session?.token ?? null,mode,password,existingEmail,existingPassword } }, [onSuccess, disabled, session?.token,mode,password,existingEmail,existingPassword])
  useEffect(() => {
    const controller = new AbortController()
    googleApi.config(controller.signal).then(v => { if (!controller.signal.aborted) setClientId(v.clientId) }, e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Google sign-in configuration could not be loaded.') })
    return () => { controller.abort(); active.current?.() }
  }, [revision])
  useEffect(() => { if (disabled || (session?.token && mode!=='link')) { active.current?.(); queueMicrotask(() => setState('idle')) } }, [disabled, session?.token,mode])
  useEffect(() => { active.current?.(); queueMicrotask(() => { setState('idle');setLinkRequired(false) }) }, [password,mode,existingEmail,existingPassword])
  async function begin() {
    if (!clientId || props.current.disabled || state !== 'idle' || (mode==='link'&&!password)) return
    if(linkRequired&&(!existingEmail.trim()||!existingPassword)){setError('Enter your existing email and password above, then choose Google again.');return}
    active.current?.(); setError(''); setState('loading')
    const controller = new AbortController(), snapshot = currentStoredSession(), token = props.current.token,linkPassword=props.current.password
    let timer: ReturnType<typeof setTimeout> | undefined, used = false
    const abandon = () => { controller.abort(); clearTimeout(timer); lease.release(); if (host.current) host.current.replaceChildren() }
    const lease = ownGoogleAttempt(abandon); active.current = abandon
    const live = () => !controller.signal.aborted && lease.current() && !props.current.disabled && props.current.token === token && currentStoredSession() === snapshot && props.current.password===linkPassword && (!linkRequired||(props.current.existingEmail===existingEmail&&props.current.existingPassword===existingPassword))
    try {
      const proof=linkRequired?await authApi.login({email:existingEmail.trim(),password:existingPassword},controller.signal):undefined
      if(!live())return
      const sdk = await loadGoogleIdentity(); if (!live()) return
      const challenge = await googleApi.challenge(controller.signal); if (!live() || !host.current) return
      timer = setTimeout(() => { if (live()) { abandon(); setState('idle'); setError('Google sign-in expired. Please try again.') } }, Math.max(0, challenge.expiresAt * 1000 - Date.now()))
      sdk.initialize({ client_id: clientId, nonce: challenge.nonce, auto_select: false, ux_mode: 'popup', callback: async response => {
        if (!live() || used || typeof response.credential !== 'string' || !response.credential || response.credential.length > 16384) return
        used = true; setState('verifying')
        try { const result = proof?await googleApi.link(response.credential,challenge.csrfToken,existingPassword,controller.signal,proof.accessToken):mode==='link'?await googleApi.link(response.credential,challenge.csrfToken,linkPassword,controller.signal):await googleApi.login(response.credential, challenge.csrfToken, controller.signal); if (live()) { props.current.onSuccess(result); abandon(); setState('idle');setLinkRequired(false) } }
        catch (e) { if (live()) { if(e instanceof Error&&e.cause instanceof ApiError&&e.cause.code==='GOOGLE_EMAIL_CONFLICT'){setLinkRequired(true);setError('Enter your existing email and password above, then choose Google again to connect this account.')}else setError(e instanceof Error ? e.message : 'Google sign-in failed. Please retry.'); abandon(); setState('idle') } }
      } })
      host.current.replaceChildren(); sdk.renderButton(host.current, { type: 'standard', theme: 'outline', size: 'large', width: Math.max(200, Math.min(360, host.current.clientWidth || 240)) }); setState('choice')
    } catch (e) { if (live()) { abandon(); setState('idle'); setError(e instanceof Error ? e.message : 'Google sign-in failed. Please retry.') } }
  }
  return <div className="google-sign-in" style={{ maxWidth: '100%', minWidth: 0 }}>
    {clientId === null ? <p className="muted text-sm">Google sign-in is not configured. Please use email and password.</p> : <>
      {state === 'idle' && clientId && <button type="button" className="btn w-full" disabled={disabled||(mode==='link'&&!password)} onClick={() => void begin()}>{mode==='link'?'Link Google account':'Continue with Google'}</button>}
      {!clientId && !error && <p role="status" className="muted text-sm">Checking Google sign-in…</p>}
      {(state === 'loading' || state === 'verifying') && <p role="status">{state === 'loading' ? 'Loading Google sign-in…' : 'Verifying Google sign-in…'}</p>}
      <div ref={host} style={{ maxWidth: '100%', overflow: 'hidden', display: state === 'choice' && !disabled ? 'block' : 'none' }} />
      {state === 'choice' && <button type="button" className="accent text-sm" disabled={disabled} onClick={() => { active.current?.(); setState('idle') }}>Cancel Google sign-in</button>}
      {error && <><p role="alert" className="text-sm text-red-300">{error}</p>{!clientId&&<button type="button" className="accent text-sm" disabled={disabled} onClick={() => { active.current?.(); setState('idle'); setError(''); setClientId(undefined); setRevision(v => v + 1) }}>Retry Google sign-in</button>}</>}
    </>}
  </div>
}
