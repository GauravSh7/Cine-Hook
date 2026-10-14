import { useState } from 'react'
import { ThematicArt } from './ThematicArt'
import type { EventRecord } from '../api/event-types'
import { experiencePhoto } from '../domain/experience-media'

export function EventArtwork({ event, className = '' }: { event: Pick<EventRecord, 'title' | 'imageUrl' | 'kind'>; className?: string }) {
  const [failed, setFailed] = useState(false)
  return <div className={`event-artwork ${className}`}>{!failed ? <img src={experiencePhoto(event.kind, event.imageUrl, event.title)} alt={`${event.title} banner`} loading="lazy" onError={() => setFailed(true)} /> : <ThematicArt theme={event.kind.toLowerCase()} />}</div>
}
