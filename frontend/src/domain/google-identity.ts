interface GoogleIdentity {
  initialize(options: { client_id: string; nonce: string; callback: (response: { credential?: string }) => void; ux_mode: 'popup'; auto_select: false; use_fedcm_for_button: true; button_auto_select: false }): void
  renderButton(element: HTMLElement, options: { type: 'standard'; theme: 'outline'; size: 'large'; width: number }): void
  cancel(): void
}
declare global { interface Window { google?: { accounts: { id: GoogleIdentity } } } }
let loading: Promise<GoogleIdentity> | null = null
export function loadGoogleIdentity(): Promise<GoogleIdentity> {
  if (window.google?.accounts.id) return Promise.resolve(window.google.accounts.id)
  if (loading) return loading
  loading = new Promise<GoogleIdentity>((resolve, reject) => {
    const script = document.createElement('script'); script.src = 'https://accounts.google.com/gsi/client'; script.async = true; script.dataset.cinehookGoogle = 'true'
    const timer = setTimeout(() => fail(), 15000)
    const cleanup = () => { clearTimeout(timer); script.onload = null; script.onerror = null }
    const fail = () => { cleanup(); script.remove(); loading = null; reject(new Error('Google sign-in could not load. Please check your connection and retry.')) }
    script.onload = () => { if (!window.google?.accounts.id) { fail(); return }; cleanup(); resolve(window.google.accounts.id) }
    script.onerror = fail; document.head.append(script)
  })
  return loading
}
// GIS initialization is global. Only the currently owned attempt can deliver a
// result; each callback closes over its own attempt, never a mutable dispatcher.
let owner: (() => void) | null = null
export function ownGoogleAttempt(abandon: () => void) {
  owner?.(); owner = abandon
  return { current: () => owner === abandon, release: () => { if (owner === abandon) { owner = null; window.google?.accounts.id.cancel() } } }
}
export function currentStoredSession() { try { return sessionStorage.getItem('cinehook.access-token') } catch { return null } }
