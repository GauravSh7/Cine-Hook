import { useEffect, useState } from 'react'
import { getServerNow } from '../api/client'
import { remainingHoldMs } from '../domain/time'

export function useCountdown(expiresAt: string) {
  const [now, setNow] = useState(getServerNow)
  useEffect(() => { const timer = setInterval(() => setNow(getServerNow()), 1000); return () => clearInterval(timer) }, [])
  return remainingHoldMs(expiresAt, now)
}
