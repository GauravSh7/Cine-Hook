import { BrowserRouter, Link, Route, Routes } from 'react-router'
import { SessionProvider } from './app/SessionProvider'
import { CityProvider } from './app/CityProvider'
import { PublicLayout } from './components/PublicLayout'
import { Protected } from './components/Protected'
import { HomePage } from './pages/HomePage'
import { MoviePage } from './pages/MoviePage'
import { SeatsPage } from './pages/SeatsPage'
import { CheckoutPage } from './pages/CheckoutPage'
import { BookingPage } from './pages/BookingPage'
import { BookingsPage } from './pages/BookingsPage'
import { AuthPage } from './pages/AuthPage'
import { AdminPage } from './pages/AdminPage'
import { RouteScope } from './components/RouteScope'
import { NavigationEffects } from './app/NavigationEffects'
import { CategoryPage } from './pages/CategoryPage'
import { ListingPage } from './pages/ListingPage'
import { OffersPage } from './pages/OffersPage'
import { WishlistPage } from './pages/WishlistPage'
import { AccountPage } from './pages/AccountPage'
import { HelpPage } from './pages/HelpPage'
import { FocusedLayout } from './components/FocusedLayout'
import { ChatbotPage } from './pages/ChatbotPage'
import { EventPage } from './pages/EventPage'
import { EventSeatsPage } from './pages/EventSeatsPage'

export default function App() {
  return <BrowserRouter><SessionProvider><CityProvider><NavigationEffects /><Routes>
    <Route path="/login" element={<RouteScope><AuthPage /></RouteScope>} />
    <Route path="/register" element={<RouteScope><AuthPage register /></RouteScope>} />
    <Route path="/" element={<PublicLayout><HomePage /></PublicLayout>} />
    <Route path="/movies" element={<PublicLayout><HomePage /></PublicLayout>} />
    {(['stream', 'events', 'sports', 'activities'] as const).map(category => <Route key={category} path={`/${category}`} element={<PublicLayout><RouteScope><CategoryPage category={category}/></RouteScope></PublicLayout>}/>)}
    {(['stream', 'events', 'sports', 'activities'] as const).map(category => <Route key={`${category}-details`} path={`/${category}/:id`} element={<PublicLayout><RouteScope><ListingPage category={category}/></RouteScope></PublicLayout>}/>)}
    {(['EVENTS', 'SPORTS', 'ACTIVITIES'] as const).map(kind => <Route key={`${kind}-bookable`} path={`/${kind.toLowerCase()}/bookable/:id`} element={<PublicLayout><RouteScope><EventPage kind={kind} /></RouteScope></PublicLayout>} />)}
    <Route path="/event-sessions/:id/seats" element={<RouteScope><EventSeatsPage /></RouteScope>} />
    <Route path="/offers" element={<PublicLayout><OffersPage /></PublicLayout>} />
    <Route path="/wishlist" element={<Protected><PublicLayout><RouteScope><WishlistPage /></RouteScope></PublicLayout></Protected>} />
    <Route path="/account" element={<Protected><RouteScope><div><header className="focused-header"><Link className="secondary" to="/movies">← Back</Link></header><AccountPage /></div></RouteScope></Protected>} />
    <Route path="/help" element={<PublicLayout><HelpPage /></PublicLayout>} />
    <Route path="/help/chat" element={<ChatbotPage />} />
    <Route path="/movies/:id" element={<PublicLayout><RouteScope><MoviePage /></RouteScope></PublicLayout>} />
    <Route path="/shows/:id/seats" element={<FocusedLayout><RouteScope><SeatsPage /></RouteScope></FocusedLayout>} />
    <Route path="/bookings" element={<Protected><PublicLayout><BookingsPage /></PublicLayout></Protected>} />
    <Route path="/bookings/:id/checkout" element={<Protected><RouteScope><FocusedLayout><CheckoutPage /></FocusedLayout></RouteScope></Protected>} />
    <Route path="/bookings/:id" element={<Protected><RouteScope><FocusedLayout><BookingPage /></FocusedLayout></RouteScope></Protected>} />
    <Route path="/admin/*" element={<Protected admin><AdminPage /></Protected>} />
    <Route path="*" element={<PublicLayout><main className="page-shell"><h1 className="text-3xl font-semibold">Page not found</h1><Link className="btn mt-6" to="/">Discover movies</Link></main></PublicLayout>} />
  </Routes></CityProvider></SessionProvider></BrowserRouter>
}
