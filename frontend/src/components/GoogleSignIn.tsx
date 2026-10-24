import {useContext,useEffect,useLayoutEffect,useRef,useState} from 'react'
import type {AuthResult} from '../api/types'
import {googleApi} from '../api/google'
import {SessionContext} from '../app/session-context'
import {currentStoredSession,loadGoogleIdentity,ownGoogleAttempt} from '../domain/google-identity'
import {ApiError} from '../api/client'

export function GoogleSignIn({onSuccess,disabled=false,mode='login',password=''}:{onSuccess:(result:AuthResult)=>void;disabled?:boolean;mode?:'login'|'link';password?:string;existingAccount?:{email:string;password:string}}){
  const session=useContext(SessionContext),token=session?.token??null
  const [clientId,setClientId]=useState<string|null|undefined>(),[error,setError]=useState(''),[state,setState]=useState<'loading'|'choice'|'verifying'|'error'>('loading'),[revision,setRevision]=useState(0)
  const [collision,setCollision]=useState(false),[confirmationRequired,setConfirmationRequired]=useState(false),[confirmOwnership,setConfirmOwnership]=useState(false)
  const host=useRef<HTMLDivElement>(null),props=useRef({onSuccess,disabled,token,password})
  useLayoutEffect(()=>{props.current={onSuccess,disabled,token,password}},[onSuccess,disabled,token,password])
  useEffect(()=>{
    const controller=new AbortController()
    googleApi.config(controller.signal).then(value=>{if(!controller.signal.aborted)setClientId(value.clientId)},cause=>{if(!controller.signal.aborted){setError(cause instanceof Error?cause.message:'Google sign-in is unavailable.');setState('error')}})
    return()=>controller.abort()
  },[revision])
  useEffect(()=>{
    if(!clientId||disabled||(token&&mode!=='link')||(mode==='link'&&!password)||(confirmationRequired&&!confirmOwnership))return
    const controller=new AbortController(),snapshot=currentStoredSession(),element=host.current
    let timer:ReturnType<typeof setTimeout>|undefined,used=false
    const abandon=()=>{controller.abort();clearTimeout(timer);lease.release();element?.replaceChildren()}
    const lease=ownGoogleAttempt(abandon)
    const live=()=>!controller.signal.aborted&&lease.current()&&!props.current.disabled&&props.current.token===token&&props.current.password===password&&currentStoredSession()===snapshot
    async function prepare(){
      setState('loading');setError('')
      try{
        const sdk=await loadGoogleIdentity();if(!live())return
        const challenge=await googleApi.challenge(controller.signal);if(!live()||!element)return
        timer=setTimeout(()=>{if(live()){abandon();setState('error');setError('Google sign-in expired. Please retry.')}},Math.max(0,challenge.expiresAt*1000-Date.now()))
        sdk.initialize({client_id:clientId!,nonce:challenge.nonce,auto_select:false,use_fedcm_for_button:true,button_auto_select:false,ux_mode:'popup',callback:async response=>{
          if(!live()||used||typeof response.credential!=='string'||!response.credential||response.credential.length>16384)return
          used=true;setState('verifying')
          try{
            const result=mode==='link'?await googleApi.link(response.credential,challenge.csrfToken,password,controller.signal):await googleApi.login(response.credential,challenge.csrfToken,controller.signal,confirmOwnership)
            if(live()){props.current.onSuccess(result);abandon();setCollision(false)}
          }catch(cause){if(live()){
            const apiError=cause instanceof ApiError?cause:cause instanceof Error&&cause.cause instanceof ApiError?cause.cause:null
            if(apiError?.code==='GOOGLE_EMAIL_CONFLICT'||apiError?.code==='GOOGLE_EMAIL_PROOF_REQUIRED')setCollision(true)
            if(apiError?.code==='GOOGLE_OWNERSHIP_CONFIRMATION_REQUIRED')setConfirmationRequired(true)
            setError(cause instanceof Error?cause.message:'Google sign-in failed. Please retry.');abandon();setState('error')
          }}
        }})
        element.replaceChildren();sdk.renderButton(element,{type:'standard',theme:'outline',size:'large',width:Math.max(200,Math.min(360,element.clientWidth||240))});setState('choice')
      }catch(cause){if(live()){abandon();setState('error');setError(cause instanceof Error?cause.message:'Google sign-in could not load. Please retry.')}}
    }
    // Render the official button directly. Account selection still requires the
    // user's click; no synthetic click, One Tap prompt or automatic acceptance.
    void prepare()
    return abandon
  },[clientId,disabled,token,mode,password,confirmationRequired,confirmOwnership,revision])
  return <div className="google-sign-in" style={{maxWidth:'100%',minWidth:0}}>
    {clientId===null?<p className="muted text-sm">Google sign-in is not configured. Please use email and password.</p>:<>
      {confirmationRequired&&<label className="block text-sm"><input type="checkbox" checked={confirmOwnership} disabled={disabled||state==='verifying'} onChange={event=>setConfirmOwnership(event.target.checked)}/> Remove the old unverified password and sign out all existing sessions using my Google identity.</label>}
      {collision&&<a className="accent text-sm" href="/forgot-password">Verify account ownership</a>}
      {(state==='loading'||state==='verifying')&&<p role="status" className="muted text-sm">{state==='verifying'?'Verifying Google sign-in…':'Preparing Google sign-in…'}</p>}
      {mode==='link'&&!password&&<p className="muted text-sm">Confirm your current password to prepare Google linking.</p>}
      <div ref={host} style={{maxWidth:'100%',overflow:'hidden',display:state==='choice'&&!disabled?'block':'none'}}/>
      {error&&<><p role="alert" className="text-sm text-red-300">{error}</p><button type="button" className="accent text-sm" disabled={disabled||(confirmationRequired&&!confirmOwnership)} onClick={()=>{setError('');setRevision(value=>value+1)}}>Retry Google sign-in</button></>}
    </>}
  </div>
}
