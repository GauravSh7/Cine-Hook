import { useSyncExternalStore } from 'react'

let timestamp = Date.now()
const listeners = new Set<() => void>()
let interval: number | undefined

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (interval === undefined && typeof window !== 'undefined') {
    interval = window.setInterval(() => {
      timestamp = Date.now()
      listeners.forEach(update => update())
    }, 60_000)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && interval !== undefined) {
      window.clearInterval(interval)
      interval = undefined
    }
  }
}

function getSnapshot() { return timestamp }

export function useNow() {
  return useSyncExternalStore(subscribe, getSnapshot)
}
