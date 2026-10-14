import {useCallback} from 'react'
import {catalogApi} from '../api/catalog'
import type {MovieBookingSummary} from '../api/types'
import {useAsync} from '../app/use-async'
import {ErrorState,Loading} from './feedback'
import {publicVenueLabel} from '../domain/customer-copy'

export function CheckoutSeatPreview({summary}:{summary:MovieBookingSummary}) {
  const screenId=summary.show.screenId
  const load=useCallback((signal:AbortSignal)=>catalogApi.screenSeats(screenId,signal),[screenId])
  const layout=useAsync(`checkout-layout:${screenId}`,load)
  const selected=new Set(summary.booking.seats.map(seat=>seat.seatId))
  const seats=layout.data?.seats??[]
  const rows=[...new Set(seats.map(seat=>seat.rowName))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}))
  const maximum=Math.max(1,...seats.map(seat=>seat.seatNumber)),aisle=Math.ceil(maximum/2)
  return <div className="mt-8 min-w-0 border-t border-white/10 pt-6">
    <h3 className="text-lg font-semibold">Your seats</h3><p className="muted mt-1 text-xs">{publicVenueLabel(summary.show.screen.name)} · Selected for this booking</p>
    {layout.loading?<Loading label="Loading theatre layout…"/>:layout.error?<ErrorState error={layout.error} retry={layout.reload}/>:<>
      <div className="mt-6 overflow-x-auto pb-4" role="region" aria-label="Your seats in the theatre" tabIndex={0}>
        <div className="mx-auto w-max min-w-full px-2"><div className="mx-auto mb-6 max-w-sm text-center"><span className="muted text-[10px] tracking-[.3em]">SCREEN</span><div className="mt-2 h-1 rounded-full bg-gradient-to-r from-transparent via-red-400 to-transparent"/></div>
          {rows.map(row=><div className="mx-auto mb-2 grid w-max items-center gap-1" key={row} style={{gridTemplateColumns:`20px repeat(${aisle}, 28px) 14px repeat(${maximum-aisle}, 28px)`}}><span className="muted text-xs">{row}</span>
            {seats.filter(seat=>seat.rowName===row).sort((a,b)=>a.seatNumber-b.seatNumber).map(seat=><span key={seat.id} aria-label={`${row}${seat.seatNumber}, ${selected.has(seat.id)?'your selected seat':'other seat'}`} style={{gridColumn:seat.seatNumber+1+(seat.seatNumber>aisle?1:0),gridRow:1}} className={`grid h-7 place-items-center rounded-t-lg border text-[10px] ${selected.has(seat.id)?'border-red-400 bg-red-600 text-white shadow-[0_0_12px_#e5091440]':'border-white/15 bg-white/5 text-slate-500'}`}>{seat.seatNumber}</span>)}</div>)}
        </div>
      </div><div className="muted mt-2 flex justify-center gap-4 text-xs"><span className="text-red-300">■ Your seats</span><span>□ Other seats</span></div>
    </>}
  </div>
}
