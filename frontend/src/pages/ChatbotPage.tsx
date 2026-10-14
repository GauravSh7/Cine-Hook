import { Link } from 'react-router'

export function ChatbotPage() {
  return <main className="chatbot-page"><Link className="secondary chatbot-back" aria-label="Back to Help & Support" to="/help">← Back to Help &amp; Support</Link><section className="chatbot-card"><svg viewBox="0 0 80 80" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="3"><path d="M40 8v14M20 26h40a12 12 0 0 1 12 12v20a12 12 0 0 1-12 12H20A12 12 0 0 1 8 58V38a12 12 0 0 1 12-12ZM2 39v18m76-18v18M28 57h24"/><circle cx="28" cy="42" r="4" fill="currentColor"/><circle cx="52" cy="42" r="4" fill="currentColor"/></svg><h1>Chatbot support is coming soon</h1><Link className="btn" to="/help">Browse help topics</Link></section></main>
}
