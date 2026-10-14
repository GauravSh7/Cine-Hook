import { useEffect, useState } from 'react'
import { api } from '../api/client'

export function CatalogueNotice() {
  const [staging, setStaging] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    void api<{ mode: string; newPaymentsAllowed: boolean }>('/catalogue/status', { signal: controller.signal })
      .then(status => { if (!controller.signal.aborted) setStaging(status.mode === 'staging') })
      .catch(() => { /* Older deployments have no staging status route. */ })
    return () => controller.abort()
  }, [])
  if (!staging) return null
  return <p role="note" className="border-b border-white/10 bg-black/80 px-4 py-2 text-center text-xs text-gray-300 print:hidden">
    Portfolio staging · Venues and sessions are fictional. Payments are disabled.
  </p>
}
