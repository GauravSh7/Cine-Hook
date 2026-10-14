export interface RazorpaySignature { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }
export interface RazorpayFailure { error: { code?: string; description?: string; source?: string; step?: string; reason?: string; metadata?: { order_id?: string; payment_id?: string } } }
export interface RazorpayOptions {
  key: string; amount: number; currency: string; order_id: string; name?: string; description?: string
  prefill?: { name?: string; email?: string; contact?: string }; theme?: { color?: string }
  handler: (response: RazorpaySignature) => void | Promise<void>
  modal?: { ondismiss?: () => void; confirm_close?: boolean; escape?: boolean }
}
export interface RazorpayInstance { open(): void; close(): void; on(event: 'payment.failed', handler: (failure: RazorpayFailure) => void): void }
export interface RazorpayConstructor { new(options: RazorpayOptions): RazorpayInstance }
declare global { interface Window { Razorpay?: RazorpayConstructor } }

let loading: Promise<RazorpayConstructor> | null = null
export function loadRazorpay(): Promise<RazorpayConstructor> {
  if (window.Razorpay) return Promise.resolve(window.Razorpay)
  if (loading) return loading
  loading = new Promise<RazorpayConstructor>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'; script.async = true
    const cleanup = () => { clearTimeout(timeout); script.onload = null; script.onerror = null }
    const fail = (message: string) => { cleanup(); script.remove(); loading = null; reject(new Error(message)) }
    script.onload = () => {
      if (!window.Razorpay) { fail('Unable to load secure checkout. Please try again.'); return }
      cleanup(); resolve(window.Razorpay)
    }
    script.onerror = () => fail('Unable to load secure checkout. Please try again.')
    const timeout = setTimeout(() => fail('Secure checkout took too long to load. Please try again.'), 10000)
    document.head.appendChild(script)
  })
  return loading
}
