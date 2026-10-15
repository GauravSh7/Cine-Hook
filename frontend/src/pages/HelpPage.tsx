import { useState } from 'react'
import { Link } from 'react-router'

const faqs = [
  ['How do I book a movie ticket?', 'Choose a movie, your city, a date and a showtime. Select available seats, sign in and complete payment before the on-screen countdown ends. Your ticket is ready once your booking is confirmed.'],
  ['How do I select or change my city?', 'Select the location button near the top of a browsing page, search for your city, choose it and select Save location. The available movie showtimes will update for your choice.'],
  ['How can I cancel my booking and request a refund?', 'A confirmed booking can be cancelled within 24 hours of booking only when the show or event is on a later calendar day and at least 24 hours away. Same-day bookings cannot be cancelled. A paid eligible cancellation receives a full refund of the amount paid. If payment was received but the booking could not be completed, a full refund is due even after showtime.'],
  ['How long does it take to receive my refund?', 'Crediting time depends on your payment provider, payment method and bank. Check View status / refund in My Bookings for progress and your refund reference when available. A completed refund may take additional time to appear in your account; we cannot promise a fixed arrival date.'],
  ['Where can I see my booked tickets and payment status?', 'Sign in and open My Bookings. Select View ticket for a confirmed booking, or View status / refund to check payment and refund progress. Only a confirmed booking is a valid ticket.'],
] as const

export function HelpPage() {
  const [open, setOpen] = useState<number | null>(null)
  return <main className="page-shell support-page"><h1>How can we help?</h1><p className="muted">A little clarity, before your next movie night.</p><section className="faq-list" role="region" aria-label="Frequently asked questions">{faqs.map(([question, answer], index) => <article className="panel faq-item" key={question}><h2><button id={`faq-question-${index}`} aria-expanded={open === index} aria-controls={`faq-answer-${index}`} onClick={() => setOpen(open === index ? null : index)}>{question}<span aria-hidden="true">{open === index ? '−' : '+'}</span></button></h2><div id={`faq-answer-${index}`} aria-labelledby={`faq-question-${index}`} hidden={open !== index}><p>{answer}</p>{index === 4 && <Link className="accent" to="/bookings">Open My Bookings →</Link>}</div></article>)}</section></main>
}
