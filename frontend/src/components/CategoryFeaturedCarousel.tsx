import type { DemoKind } from '../api/demo-catalog'
import type { CategorySlide } from './category-carousel-data'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { experiencePhoto } from '../domain/experience-media'
import './category-carousel.css'
export function CategoryFeaturedCarousel({category,title,slides}:{category:DemoKind;title:string;slides:CategorySlide[]}) {
  const [index,setIndex]=useState(0),[hover,setHover]=useState(false),[focus,setFocus]=useState(false)
  const [hidden,setHidden]=useState(document.hidden),[reduced,setReduced]=useState(()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
  const paused=hover || focus || hidden || reduced, active=slides.length ? index%slides.length : 0
  useEffect(()=> {
    const media=window.matchMedia?.('(prefers-reduced-motion: reduce)'),motion=()=>setReduced(media?.matches ?? false),visibility=()=>setHidden(document.hidden)
    media?.addEventListener('change',motion); document.addEventListener('visibilitychange',visibility)
    return ()=>{media?.removeEventListener('change',motion);document.removeEventListener('visibilitychange',visibility)}
  },[])
  useEffect(()=>{if(paused || slides.length<2)return;const timer=window.setInterval(()=>setIndex(value=>(value+1)%slides.length),5000);return ()=>window.clearInterval(timer)},[paused,slides.length])
  const move=(value:number)=>setIndex((value+slides.length)%slides.length)
  return <section className="category-featured" aria-label={`Featured ${category}`} aria-roledescription="carousel" onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)} onFocusCapture={()=>setFocus(true)} onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget))setFocus(false)}}>
    <div className="category-featured-track" style={{transform:`translateX(-${active*100}%)`}}>{slides.length ? slides.map((slide,i)=><div className="category-featured-slide" key={slide.id} aria-hidden={i!==active} inert={i!==active}><img src={slide.image} alt="" onError={event=>{event.currentTarget.onerror=null;event.currentTarget.src=experiencePhoto(category,null,slide.id)}}/><div className="category-featured-shade"/><div className="category-featured-copy"><h1>{slide.title}</h1>{slide.date && <p>{new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit',timeZone:'Asia/Kolkata'}).format(new Date(slide.date))} IST</p>}<Link className="btn" to={slide.href}>{slide.action}</Link></div></div>) : <div className="category-featured-slide"><img src={experiencePhoto(category)} alt=""/><div className="category-featured-shade"/><div className="category-featured-copy"><h1>{title}</h1><a className="btn" href="#category-explore">Explore</a></div></div>}</div>
    {slides.length>1 && <div className="category-featured-controls"><button aria-label="Previous featured experience" onClick={()=>move(active-1)}>←</button><div className="category-featured-dots">{slides.map((slide,i)=><button key={slide.id} aria-label={`Show ${slide.title}`} aria-pressed={active===i} onClick={()=>move(i)}/>)}</div><button aria-label="Next featured experience" onClick={()=>move(active+1)}>→</button></div>}
  </section>
}
