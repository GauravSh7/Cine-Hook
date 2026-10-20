import type { EventBookingSeat, EventSeatQuote, EventSessionBooking } from './event-types'

export type SeatType = 'REGULAR' | 'PREMIUM' | 'RECLINER'
export type BookingStatus = 'PENDING' | 'CONFIRMED' | 'FAILED' | 'CANCELLED'
export type PaymentStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'REFUND_PENDING' | 'REFUNDED'
export interface Timestamps { createdAt: string; updatedAt: string }
export interface User extends Timestamps { id: string; name: string; email: string; role: 'USER' | 'ADMIN'; dateOfBirth?: string | null; phone?: string | null; avatarUrl?: string | null }
export interface Movie extends Timestamps { id: string; title: string; description: string; descriptionHindi?: string | null; trailer?: { provider: 'YouTube'; videoId: string; sourceUrl: string; verifiedAt: string } | null; durationMinutes: number; releaseDate: string; language: string; genres: string[]; posterUrl: string | null; isActive: boolean; backdropUrl?: string | null; collections?: string[]; metadataSourceUrl?: string | null; artwork?: { kind: 'ILLUSTRATION' | 'TMDB'; sourceUrl: string | null; attribution: string } | null; rating?: { provider: 'TMDB'; value: number; scale: 10; voteCount: number; sourceUrl: string; verifiedAt: string } | null; bookingAvailability?: { cityId: string | null; hasShows: boolean; nextShowStartsAt?: string | null } }
export interface City extends Timestamps { id: string; name: string; state: string; countryCode: string }
export interface Theatre extends Timestamps { id: string; name: string; address: string; cityId: string }
export interface Screen extends Timestamps { id: string; name: string; capacity: number; theatreId: string }
export interface TheatreDetail extends Theatre { city: City; screens: Screen[] }
export interface Seat { id: string; screenId: string; rowName: string; seatNumber: number; seatType: SeatType }
export interface ShowPrice { showId: string; seatType: SeatType; pricePaise: number }
export interface Show extends Timestamps { id: string; movieId: string; screenId: string; startsAt: string; endsAt: string; status: 'SCHEDULED' | 'CANCELLED'; movie: Movie; screen: Screen & { theatre: Theatre & { city: City } }; prices: ShowPrice[] }
export type ShowDetail = Show
export interface AvailabilitySeat extends Seat { pricePaise: number; availability: 'AVAILABLE' | 'LOCKED' | 'BOOKED'; remainingHoldMs: number }
export interface Availability { showId: string; seats: AvailabilitySeat[] }
export interface BookingSeat { id: string; showId: string; seatId: string; rowName: string; seatNumber: number; seatType: SeatType; pricePaise: number }
interface BookingBase extends Timestamps { id: string; status: BookingStatus; totalPaise: number; expiresAt: string; confirmedAt: string | null; failureCode: string | null }
export interface MovieBooking extends BookingBase { bookingKind?: 'MOVIE'; showId: string; eventSessionId?: null; seats: BookingSeat[] }
export interface EventBooking extends BookingBase { bookingKind: 'EVENT'; showId: null; eventSessionId: string; seats: EventBookingSeat[] }
export type Booking = MovieBooking | EventBooking
export interface Reconciliation { reason: string; compensationRequired: boolean; resolvedAt: string | null }
export interface Payment { id: string; bookingId: string; amountPaise: number; currency: string; status: PaymentStatus; providerOrderId: string | null; providerPaymentId: string | null; capturedAt: string | null; bookingFinalizedAt: string | null; failureCode: string | null; reconciliation: Reconciliation | null }
export interface RefundAttempt { id: string; sequence: number; providerRefundId: string | null; status: 'REQUESTED' | 'PENDING' | 'FAILED' | 'PROCESSED'; lastErrorCode: string | null; processedAt: string | null }
export interface Refund { id: string; providerPaymentId: string; amountPaise: number; currency: string; reason: string; status: 'PENDING' | 'REFUNDED'; attempts: RefundAttempt[] }
export interface RefundView { booking: Pick<Booking, 'id' | 'status' | 'totalPaise'>; payment: Pick<Payment, 'id' | 'status' | 'amountPaise' | 'currency' | 'reconciliation'>; refunds: Refund[] }
export interface MovieBookingSummary { booking: MovieBooking; show: Show; eventSession?: null; payment: Payment | null; refunds: Refund[] }
export interface EventBookingSummary { booking: EventBooking; show: null; eventSession: EventSessionBooking; payment: Payment | null; refunds: Refund[] }
export type BookingSummary = MovieBookingSummary | EventBookingSummary
export interface Page<T> { items: T[]; page: number; limit: number }
export interface PageQuery { page?: number; limit?: number }
export interface CityQuery extends PageQuery { search?: string; state?: string }
export interface MovieQuery extends PageQuery { search?: string; language?: string; genre?: string; cityId?: string }
export interface TheatreQuery extends PageQuery { cityId?: string }
export interface ShowQuery extends PageQuery { movieId?: string; cityId?: string; theatreId?: string; date?: string; localDate?: string }
export interface AdminBookingQuery extends PageQuery { search?: string }
export interface OrderResult { payment: Payment; order: { id: string; amountPaise: number; currency: string; receipt: string; keyId: string }; expiresAt: string }
export interface PaymentVerification { bookingId: string; razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }
export interface MovieInput { title: string; description: string; durationMinutes: number; releaseDate: string; language: string; genres: string[]; posterUrl: string | null }
export interface ShowInput { movieId: string; screenId: string; startsAt: string; prices: { seatType: SeatType; pricePaise: number }[] }
export interface AuthResult { user: User; accessToken: string; tokenType: 'Bearer' }
export interface LoginInput { email: string; password: string }
export interface RegisterInput extends LoginInput { name: string; registrationToken?: string }
interface AdminBookingBase { id: string; user: { id: string; name: string }; status: BookingStatus; totalPaise: number; expiresAt: string; createdAt: string; payment: Pick<Payment, 'id' | 'status' | 'amountPaise'> | null }
export type AdminBooking = AdminBookingBase & (
  { bookingKind?: 'MOVIE'; show: { id: string; startsAt: string; movie: { id: string; title: string }; screen: { id: string; name: string; theatre: { id: string; name: string } } }; eventSession?: null; seats: Pick<BookingSeat, 'rowName' | 'seatNumber' | 'seatType' | 'pricePaise'>[] }
  | { bookingKind: 'EVENT'; show: null; eventSession: EventSessionBooking; seats: EventSeatQuote[] }
)
export interface AdminPayment extends Payment { createdAt: string; booking: { id: string; status: BookingStatus; user: { id: string; name: string } }; refunds: Pick<Refund, 'id' | 'status' | 'amountPaise' | 'providerPaymentId'>[] }
export interface Dashboard { totalMovies: number; activeShows: number; bookingsToday: number; capturedTodayPaise: number }
