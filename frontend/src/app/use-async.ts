import { useCallback, useEffect, useReducer, useState } from 'react'

export function useAsync<T>(key: string, load: (signal: AbortSignal) => Promise<T>, pollMs = 0) {
  const [revision, reload] = useReducer((value: number) => value + 1, 0)
  const [result, setResult] = useState<{ key: string; data?: T; error?: Error }>({ key: '' })
  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal).then(data => {
      if (!controller.signal.aborted) setResult({ key, data })
    }, error => {
      if (!controller.signal.aborted) setResult({ key, error: error instanceof Error ? error : new Error('Unable to load. Please retry.') })
    })
    return () => controller.abort()
  }, [key, load, revision])
  const refresh = useCallback(() => reload(), [])
  const replace = useCallback((data:T)=>{setResult({key,data});reload()},[key])
  useEffect(() => {
    window.addEventListener('focus', refresh)
    const timer = pollMs > 0 ? window.setInterval(refresh, pollMs) : undefined
    return () => { window.removeEventListener('focus', refresh); if (timer) clearInterval(timer) }
  }, [pollMs, refresh])
  return { data: result.key === key ? result.data : undefined, error: result.key === key ? result.error : undefined,
    loading: result.key !== key || (!result.data && !result.error), reload: refresh, replace }
}
