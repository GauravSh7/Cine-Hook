import {useRef,useEffect,useState} from 'react'
import {useNavigate} from 'react-router'
import {authApi} from '../api/auth'
import {useSession} from '../app/session-context'
import {ConfirmDialog} from './ConfirmDialog'
import {ApiError} from '../api/client'
import {createPortal} from 'react-dom'

export function LogoutButton(){
  const session=useSession(),navigate=useNavigate(),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const request=useRef<AbortController|null>(null)
  useEffect(()=>()=>request.current?.abort(),[])
  async function confirm(){
    if(busy)return
    const controller=new AbortController();request.current=controller;setBusy(true);setError('')
    try{await authApi.logout(controller.signal);if(controller.signal.aborted)return;session.logout();navigate('/login',{replace:true})}
    catch(value){if(controller.signal.aborted)return;if(value instanceof ApiError&&value.status===401){session.logout();navigate('/login',{replace:true})}else setError(value instanceof Error?value.message:'Could not sign out. Please retry.')}
    finally{if(!controller.signal.aborted)setBusy(false)}
  }
  return <>
    <button type="button" onClick={event=>{event.stopPropagation();setError('');setOpen(true)}}>Logout</button>
    {open&&createPortal(
      <div onClick={event=>event.stopPropagation()} onPointerDown={event=>event.stopPropagation()} onKeyDown={event=>event.stopPropagation()}>
        <ConfirmDialog busy={busy} onClose={()=>setOpen(false)}>
          <h2 id="cancel-title" className="text-xl font-semibold">Are you sure you want to log out?</h2>
          <p className="muted mt-3">This signs out your account’s active sessions.</p>
          {error&&<p role="alert" className="mt-3 text-red-300">{error}</p>}
          <div className="flex flex-wrap gap-3 mt-6">
            <button type="button" className="secondary" disabled={busy} onClick={()=>setOpen(false)}>Cancel</button>
            <button type="button" className="btn" disabled={busy} onClick={()=>void confirm()}>{busy?'Signing out…':'Logout'}</button>
          </div>
        </ConfirmDialog>
      </div>,document.body)}
  </>
}
